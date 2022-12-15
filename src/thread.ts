import {throttle, normalizePath} from 'lib/utils';
import {promises as FS} from 'fs';
import manifest from 'manifest';
import type {OperationStage, OperationTitle, OperationLogLine, OperationMeta, OperationOutput} from 'models/operations';
import {createProgress} from 'models/progress';
import type {PayloadData, Processor, ProcessorUtils, ProgressData, OutputMeta} from '@drovp/types';
import type {SerializedOperationPayload, ThreadConfig} from 'models/worker';

export interface ThreadReady {
	type: 'ready';
}
export interface ThreadOutput {
	id: string;
	type: 'output';
	payload: OperationOutput;
}
export interface ThreadTitle {
	id: string;
	type: 'title';
	payload: OperationTitle;
}
export interface ThreadLog {
	id: string;
	type: 'log';
	payload: OperationLogLine;
}
export interface ThreadMeta {
	id: string;
	type: 'meta';
	payload: OperationMeta;
}
export interface ThreadStage {
	id: string;
	type: 'stage';
	payload: OperationStage;
}
export interface ThreadProgress {
	id: string;
	type: 'progress';
	payload: ProgressData;
}
export interface ThreadDone {
	id: string;
	type: 'done';
}
export type ThreadMessage =
	| ThreadOutput
	| ThreadTitle
	| ThreadLog
	| ThreadMeta
	| ThreadStage
	| ThreadProgress
	| ThreadDone;

// Globals
const configParamIndex = process.argv.indexOf('--config');
const configJson = process.argv[configParamIndex + 1];
if (configParamIndex === -1 || !configJson) {
	console.error(`Missing config param.`);
	process.exit(1);
}
const {processorPath, pluginPath, dependencies, dataPath} = JSON.parse(configJson) as ThreadConfig;
const rawConsoleLog = console.log;

let processor: Processor | undefined;
let currentOperationUtils: Utils | null = null;

interface Utils extends ProcessorUtils {
	id: string;
	_flushPendingMessages: () => void;
}

// Helpers
function send(type: 'ready'): void;
function send(type: 'done', id: string): void;
function send(type: 'stage', id: string, payload: OperationStage): void;
function send(type: 'progress', id: string, payload: ProgressData): void;
function send(type: 'title', id: string, payload: OperationLogLine): void;
function send(type: 'log', id: string, payload: OperationLogLine): void;
function send(type: 'meta', id: string, payload: OperationMeta): void;
function send(type: 'output', id: string, payload: OperationOutput): void;
function send(type: string, id?: string, payload?: unknown): void {
	process.send!({type, id, payload});
}

function handleError(error: Error) {
	if (currentOperationUtils) {
		currentOperationUtils.output.error(error);
		send('done', currentOperationUtils.id);
	} else {
		process.stderr.write(error.stack || error.message);
	}
	process.exit(1);
}

function toString(value: any) {
	if (typeof value === 'object' && value) return JSON.stringify(value, null, 2);
	return `${value}`;
}

process.on('uncaughtException', handleError);

/**
 * Creates utilities isolated to current operation.
 * They produce no effects when new operation replaces the current one.
 */
function createUtils(id: string): Utils {
	// To ignore calls from potential zombie processes
	function sendIfCurrent(type: 'done'): void;
	function sendIfCurrent(type: 'stage', payload: OperationStage): void;
	function sendIfCurrent(type: 'progress', payload: ProgressData): void;
	function sendIfCurrent(type: 'title', payload: OperationTitle): void;
	function sendIfCurrent(type: 'log', payload: OperationLogLine): void;
	function sendIfCurrent(type: 'meta', payload: OperationMeta): void;
	function sendIfCurrent(type: 'output', payload: OperationOutput): void;
	function sendIfCurrent(type: any, payload?: unknown): void {
		if (id === currentOperationUtils?.id) send(type, id, payload);
	}

	// Title
	const title = (value: string | undefined | null) => sendIfCurrent('title', value || null);

	// Log
	const log = (...args: string[]) => sendIfCurrent('log', args.map(toString).join(' '));

	// Meta
	const meta = (meta: unknown) => sendIfCurrent('meta', meta);

	// Stage
	const stage = (name: string) => sendIfCurrent('stage', name);

	// Progress
	const sendProgress = () => sendIfCurrent('progress', progress.data);
	const sendProgressSoon = throttle(sendProgress, 100);
	const progress = createProgress((progressData) => {
		// Ensure the progress is send immediately when it reaches 100%
		// so that it won't lag behind operation promise resolution.
		if (progressData && progressData.completed != null && progressData.completed === progressData.total) {
			sendProgressSoon.cancel();
			sendProgress();
		} else {
			sendProgressSoon();
		}
	});

	// Output
	const output = {
		file: (path: string, meta?: OutputMeta) =>
			sendIfCurrent('output', {...meta, kind: 'file', path: normalizePath(path)}),
		directory: (path: string, meta?: OutputMeta) =>
			sendIfCurrent('output', {...meta, kind: 'directory', path: normalizePath(path)}),
		url: (url: string, meta?: OutputMeta) => sendIfCurrent('output', {...meta, kind: 'url', url}),
		string: (contents: string, meta?: OutputMeta<{type?: string}>) =>
			sendIfCurrent('output', {type: 'text/plain', ...meta, kind: 'string', contents}),
		warning: (error: Error | string, meta?: OutputMeta) => {
			sendIfCurrent('output', {
				...meta,
				kind: 'warning',
				message: typeof error === 'string' ? error : error?.stack || error?.message || `${error}`,
			});
		},
		error: (error: Error | string, meta?: OutputMeta) => {
			sendIfCurrent('output', {
				...meta,
				kind: 'error',
				message: typeof error === 'string' ? error : error?.stack || error?.message || `${error}`,
			});
		},
	};

	return {
		id,
		log,
		meta,
		title,
		stage,
		progress,
		_flushPendingMessages: () => sendProgressSoon.flush(),
		output,
		dependencies,
		appVersion: manifest.version,
		dataPath,
	};
}

// Listen for and process operations
process.on('message', async (serializedOperation: SerializedOperationPayload) => {
	if (currentOperationUtils) {
		handleError(
			new Error(
				`New operation "${serializedOperation.id}" received while "${currentOperationUtils.id}" is still in progress.`
			)
		);
		return;
	}

	const utils = (currentOperationUtils = createUtils(serializedOperation.id));
	const end = (error?: any) => {
		if (error) utils.output.error(error);
		currentOperationUtils = null;
		utils._flushPendingMessages();
		send('done', serializedOperation.id);
		// Restore native console.log
		console.log = rawConsoleLog;
	};

	// Replace native console.log with the utils log
	console.log = utils.log;

	// Decode base64 encoded binary blobs
	for (let item of serializedOperation.inputs || []) {
		if (item && 'kind' in item && item.kind === 'blob') {
			// @ts-ignore
			item.contents = Buffer.from(item.contents, 'base64');
		}
	}

	const payload = serializedOperation as PayloadData;

	// Shorthand for first item in inputs array
	Object.defineProperty(payload, 'input', {get: () => payload?.inputs?.[0]});

	try {
		// Load processor if it isn't yet
		if (!processor) {
			try {
				try {
					// Check if processor exists
					if (processorPath) await FS.stat(processorPath);
					else throw new Error(`Processor path is missing.`);
				} catch (error) {
					end(
						(error as any)?.code === 'ENOENT'
							? new Error(`Processor path doesn't exist: "${processorPath}"`)
							: error
					);
					return;
				}

				// Change current working directory to that of a plugin
				if (pluginPath) process.chdir(pluginPath);
				else throw new Error(`Plugin path is missing, can't set chdir().`);

				// Load plugin
				processor = await import(`file:${processorPath}`);
				if (typeof processor !== 'function') processor = (processor as any)?.default;
				if (typeof processor !== 'function') processor = (processor as any)?.default;
				if (typeof processor !== 'function') {
					end(new Error(`Processor module didn't export any function.`));
					return;
				}
			} catch (error) {
				end(error);
				return;
			}
		}

		// Execute operation
		await processor(payload, utils);
		end();
	} catch (error) {
		end(error);
	}
});

// Ensure console.* are not out of sync with IPC messages
// @ts-ignore
if (process.stdout._handle) process.stdout._handle.setBlocking(true);

// Notify worker that thread is ready
send('ready');
