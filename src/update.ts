/**
 * Script that handles updating the app.
 *
 * Process should be spawned with userData folder as its cwd.
 *
 * Required parameters:
 *
 *   --sequence       A json of an array with update actions to run in sequence.
 *   --restartaction  A json with action that restarts the app when something
 *                    goes wrong.
 *
 * Logs and errors will be output to UPDATE_LOG_FILE and UPDATE_ERROR_LOG_FILE
 * respectively, located in the cwd of this process, which gain, should be the
 * app's userData folder, so that the app can pick up on the when it restarts.
 */

import * as FS from 'fs';
import CP from 'child_process';
import Path from 'path';
import {promisify} from 'util';
import {UPDATE_LOG_FILE, UPDATE_ERROR_LOG_FILE} from 'config/constants';

const FSP = FS.promises;
const execFile = promisify(CP.execFile);
const exec = promisify(CP.exec);

/**
 * Types.
 */

export interface ActionReplaceContents {
	action: 'replace-contents';
	from: string;
	to: string;
	ignore?: string[];
}

export interface ActionReplaceFile {
	action: 'replace-file';
	from: string;
	to: string;
}

export interface ActionDelete {
	action: 'delete';
	path: string;
}

export interface ActionStart {
	action: 'start';
	path: string;
	args?: string[];
	detached?: boolean;
	cwd?: string;
}

export interface ActionExec {
	action: 'exec';
	command: string;
	cwd?: string;
}

export interface ActionWait {
	action: 'wait';
	time: number; // ms
}

export type SequenceAction =
	| ActionReplaceContents
	| ActionReplaceFile
	| ActionDelete
	| ActionStart
	| ActionExec
	| ActionWait;
export type Sequence = SequenceAction[];
export type Accumulator = (() => void)[];

/**
 * Create logging into a file.
 */

const logFilePath = Path.join(process.cwd(), UPDATE_LOG_FILE);
let logFileDescriptor: number | undefined;
const errorLogFilePath = Path.join(process.cwd(), UPDATE_ERROR_LOG_FILE);
let errorLogFileDescriptor: number | undefined;

// Ensure folder exists, and old files are gone
try {
	FS.mkdirSync(Path.dirname(logFilePath), {recursive: true});
	FS.rmSync(errorLogFilePath, {force: true});
	FS.rmSync(logFilePath, {force: true});
} catch {}

function logError(message: string) {
	if (errorLogFileDescriptor == null) errorLogFileDescriptor = FS.openSync(errorLogFilePath, 'a');
	else message = `\n${message}`;
	FS.writeSync(errorLogFileDescriptor, message, null, 'utf8');
	log(message);
}

function log(message: string) {
	if (logFileDescriptor == null) logFileDescriptor = FS.openSync(logFilePath, 'a');
	else message = `\n${message}`;
	console.log(message);
	FS.writeSync(logFileDescriptor, message, null, 'utf8');
}

function exitWithError(message: string): never {
	logError(message);
	exit(1);
}

function exit(code: number): never {
	if (logFileDescriptor != null) FS.close(logFileDescriptor);
	if (errorLogFileDescriptor != null) FS.close(errorLogFileDescriptor);
	process.exit(code);
}

/**
 * Prepare and validate inputs.
 */

const args: Record<string, string | boolean> = {};

// Parse args
for (let i = 0; i < process.argv.length; i++) {
	const arg = process.argv[i]!;
	const nextArg = process.argv[i + 1];
	if (arg.startsWith('-')) {
		const name = arg.replace(/^-+/, '');
		const value = nextArg ? (nextArg.startsWith('-') ? true : nextArg) : true;
		args[name] = value;
	}
}

// Parse & validate sequence
try {
	const {sequence: sequenceJson, restartaction: restartActionJson} = args;

	if (typeof sequenceJson !== 'string') throw new Error(`Missing --sequence parameter.`);
	if (typeof restartActionJson !== 'string') throw new Error(`Missing --restartaction parameter.`);

	const sequence = parseSequence(sequenceJson);
	const restartAction = JSON.parse(restartActionJson);

	if (!isActionObject(restartAction) || !['start', 'exec'].includes(restartAction.action)) {
		throw new Error(`Invalid restart action: ${JSON.stringify(restartAction, null, 2)}`);
	}

	log(`starting updating process...`);
	log(`sequence: ${JSON.stringify(sequence, null, 2)}`);
	log(`restart action: "${JSON.stringify(restartAction, null, 2)}"`);
	update(sequence, restartAction);
} catch (error) {
	exitWithError(`Invalid params: ${eem(error)}`);
}

/**
 * ACTIONS.
 */

async function actionReplaceContents(
	{from, to, ignore}: ActionReplaceContents,
	undoAccumulator?: Accumulator,
	cleanupAccumulator?: Accumulator
) {
	const backupDirName = `.BACKUP-${uid()}`;
	const backupDir = Path.join(to, backupDirName);
	const ignoredFiles = [...(ignore || []), backupDirName];

	log(`from: "${from}"\nto: "${to}"\nignore: "${ignoredFiles.join('", "')}"`);

	// Validate inputs
	if (typeOfPath(to) !== 'directory') throw new Error(`destination is not a directory: ${to}`);
	if (typeOfPath(from) !== 'directory') throw new Error(`source is not a directory: ${from}`);
	if ((await FSP.readdir(from)).length === 0) throw new Error(`source directory is empty`);

	// Create backup directory
	log(`creating backup dir: "${backupDir}"`);
	await deletePath(backupDir);
	await FSP.mkdir(backupDir);

	undoAccumulator?.push(() => deletePath(backupDir));
	cleanupAccumulator?.push(makePathCleaner(backupDir));

	// Backup
	try {
		log(`backing up old files...`);
		await moveFiles(to, backupDir, {ignore: ignoredFiles, undoAccumulator});
	} catch (error) {
		throw new Error(`Backing up existing files failed: ${eem(error)}`);
	}

	// Replace
	try {
		log(`placing new files...`);
		await moveFiles(from, to, {ignore: ignoredFiles, undoAccumulator});
	} catch (error) {
		throw new Error(`Moving new files failed: ${eem(error)}`);
	}
}

async function actionReplaceFile(
	{from, to}: ActionReplaceFile,
	undoAccumulator?: Accumulator,
	cleanupAccumulator?: Accumulator
) {
	log(`from: "${from}"\nto: "${to}"`);

	if (typeOfPath(from) !== 'file') throw new Error(`source is not a file: ${from}`);
	if (typeOfPath(to) !== 'file') throw new Error(`destination is not a file: ${to}`);

	const backupPath = `${to}.BACKUP-${uid()}`;

	log(`backing up...`);
	await move(to, backupPath, {undoAccumulator});
	cleanupAccumulator?.push(makePathCleaner(backupPath));

	log(`replacing file...`);
	await move(from, to, {undoAccumulator});
}

async function actionDelete({path}: ActionDelete, undoAccumulator?: Accumulator, cleanupAccumulator?: Accumulator) {
	const backupPath = `${path}.BACKUP-${uid()}`;
	log(`backing up to: ${backupPath}`);
	await FSP.rename(path, backupPath);
	undoAccumulator?.push(() => FSP.rename(backupPath, path));
	cleanupAccumulator?.push(makePathCleaner(backupPath));
}

async function actionStart({
	path,
	args,
	detached,
	cwd,
}: {
	path: string;
	args?: string[];
	detached?: boolean;
	cwd?: string;
}) {
	if (!(await isPathExecutable(path))) throw new Error(`path is not executable: ${path}`);
	args = Array.isArray(args) ? args : [];
	cwd = cwd || Path.dirname(path);

	if (detached) {
		// Start a detached process and move on
		log(`spawning a detached process: "${path}"\nargs: ${args.join(' ')}\ncwd: "${cwd}"`);
		const subprocess = CP.spawn(path, args, {cwd, detached: true, stdio: 'ignore'});
		subprocess.unref();
	} else {
		log(`executing file: "${path}"\nargs: ${args.join(' ')}\ncwd: "${cwd}"`);
		await execFile(path, args, {cwd});
	}
}

async function actionExec({command, cwd}: {command: string; cwd?: string}) {
	cwd = cwd || process.cwd();
	log(`executing command: ${command}\ncwd: "${cwd}"`);
	const {stdout, stderr} = await exec(command, {cwd});
	log(`stdout: ${stdout}\nstderr: ${stderr}`);
}

async function actionWait({time}: {time: number}) {
	log(`waiting for ${time}ms`);
	await new Promise((resolve) => setTimeout(resolve, time));
}

async function update(sequence: Sequence, restartAction: SequenceAction) {
	// When reversed and each fn executed, this array has to undo everything
	const undoAccumulator: (() => any)[] = [];
	// This is run in order to cleanup after sequences when everything finished
	// correctly. Used to cleanup backups and stuff.
	const cleanupAccumulator: (() => any)[] = [];

	try {
		for (let i = 0; i < sequence.length; i++) {
			const action = sequence[i]!;
			log(`executing action ${i + 1}: ${action.action}`);
			await executeAction(action, undoAccumulator, cleanupAccumulator);
		}
	} catch (error) {
		logError(eem(error));
		log(`undoing sequences...`);

		try {
			for (const step of undoAccumulator.reverse()) await step();
		} catch (error) {
			log(eem(error));
		}

		log(`executing restart action...`);
		await executeAction(restartAction);
		exit(1);
	}

	log(`everything seems fine, cleaning up...`);
	try {
		for (const step of cleanupAccumulator) await step();
	} catch (error) {
		log(eem(error));
	}

	exit(0);
}

async function executeAction(action: SequenceAction, undoAccumulator?: Accumulator, cleanupAccumulator?: Accumulator) {
	switch (action.action) {
		case 'replace-contents':
			await actionReplaceContents(action, undoAccumulator, cleanupAccumulator);
			break;

		case 'replace-file':
			await actionReplaceFile(action, undoAccumulator, cleanupAccumulator);
			break;

		case 'delete':
			await actionDelete(action, undoAccumulator, cleanupAccumulator);
			break;

		case 'start':
			await actionStart(action);
			break;

		case 'exec':
			await actionExec(action);
			break;

		case 'wait':
			await actionWait(action);
			break;

		default:
			throw new Error(`Unknown action "${(action as any).action}": ${JSON.stringify(action, null, 2)}`);
	}
}

/**
 * HELPERS.
 */

function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

async function deletePath(path: string) {
	await FSP.rm(path, {force: true, recursive: true});
}

async function moveFiles(
	sourceDir: string,
	destinationDir: string,
	{ignore, undoAccumulator}: {ignore?: string[]; undoAccumulator?: Accumulator}
) {
	const shouldIgnore = Array.isArray(ignore) ? (file: string) => ignore.includes(file) : () => false;

	for (const file of await FSP.readdir(sourceDir)) {
		if (shouldIgnore(file)) {
			log(`ignoring file: "${file}"`);
			continue;
		}

		const oldPath = Path.join(sourceDir, file);
		const newPath = Path.join(destinationDir, file);
		await move(oldPath, newPath, {undoAccumulator});
	}
}

async function move(oldPath: string, newPath: string, {undoAccumulator}: {undoAccumulator?: Accumulator}) {
	log(`renaming: "${oldPath}" > ${newPath}`);
	try {
		await FSP.rename(oldPath, newPath);
		undoAccumulator?.push(() => FSP.rename(newPath, oldPath));
	} catch (error) {
		let errorCode = (error as any)?.code;
		if (errorCode !== 'EXDEV') throw error;

		// Copy instead of renaming for cross-partition moves
		log(`paths are on different partitions, doing a copy & delete instead`);
		await FSP.cp(oldPath, newPath, {recursive: true});
		await FSP.rm(oldPath, {recursive: true, force: true});
		undoAccumulator?.push(async () => {
			await FSP.cp(newPath, oldPath);
			await FSP.rm(newPath, {recursive: true, force: true});
		});
	}
}

function makePathCleaner(path: string) {
	return async () => {
		log(`deleting: "${path}"`);
		await deletePath(path);
	};
}

function parseSequence(sequenceJson: string): Sequence {
	const sequence = JSON.parse(sequenceJson);
	if (!Array.isArray(sequence) || sequence.find((item) => !isActionObject(item)) != null) {
		throw new Error(`Invalid sequence: ${sequenceJson}`);
	}
	return sequence;
}

function isActionObject(value: any): value is SequenceAction {
	return value && typeof value === 'object' && typeof value?.action === 'string';
}

function typeOfPath(path: string) {
	try {
		const stat = FS.statSync(path);
		if (stat.isDirectory()) return 'directory';
		if (stat.isFile()) return 'file';
	} catch {}
}

async function isPathExecutable(path: string) {
	try {
		await FSP.access(path, FS.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export const uid = (size = 10) =>
	Array(size)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join('');
