import Path from 'path';
import {promises as FSP} from 'fs';
import {promisify} from 'util';
import {exec} from 'child_process';
import semverCompare from 'semver-compare';
import {signal, computed, action} from 'statin';
import {eem, fetchJson, download, spawn, SpawnOptions, promiseThrottle, createUpdatesChecker} from 'lib/utils';
import {deletePath} from 'lib/fs';
import {extract} from 'lib/extract';
import type {Store} from 'models/store';
import type {Staging} from 'models/staging';

const execPromise = promisify(exec);

const NODE_BASE_URL = 'https://nodejs.org/dist/';
const IS_WIN = process.platform === 'win32';

function getDistArchiveName(version: string) {
	const base = `node-${version}-${IS_WIN ? 'win' : process.platform}-${process.arch}`;
	return {base, file: `${base}.${IS_WIN ? '7z' : 'tar.xz'}`};
}

export interface NodeDistribution {
	version: string; // v15.5.0
	date: string; // 2020-12-22
	files: string[]; // 'win-x64-zip', ...
	npm: string; // '7.3.0'
	v8: string; // '8.6.395.17'
	lts: boolean;
	security: boolean;
}

export class Node {
	store: Store;
	directory: string;
	binPath: string;
	nodePath: string;
	npmPath: string;
	version = signal<string | null>(null);
	availableVersion = signal<string | null>(null);
	error = signal<string | undefined>(undefined);
	isCheckingForUpdates = signal<boolean>(false);

	constructor(store: Store) {
		this.store = store;
		this.directory = Path.join(this.store.app.userDataPath, 'node');
		this.binPath = Path.join(this.directory, 'bin');
		this.nodePath = Path.join(this.binPath, 'node');
		this.npmPath = Path.join(this.binPath, IS_WIN ? 'npm.cmd' : 'npm');

		// Updates checking
		createUpdatesChecker(
			store.settings.nodeUpdatesCheckingInterval,
			store.settings.lastNodeUpdatesCheckTime,
			promiseThrottle(() => this.checkForUpdates())
		);
	}

	isReady = computed(() => this.version() != null && this.error() == null);

	isInstalling = () => this.store.staging.matchStaging('node', 'install') != null;

	updateAvailable = computed(() => {
		const available = this.availableVersion();
		const current = this.version();
		return available && current && semverCompare(available, current) > 0 ? available : false;
	});

	load = async () => {
		try {
			const {stdout, stderr} = await execPromise(`"${this.nodePath}" -v`);
			action(() => {
				const error = stderr.trim();
				this.error(error || undefined);
				this.version(error ? null : stdout.trim().replace(/^v/, ''));
			});
		} catch (error) {
			action(() => {
				this.error(eem(error));
				this.version(null);
			});
		}
	};

	checkForUpdates = promiseThrottle(async () => {
		action(() => this.isCheckingForUpdates(true));

		let errorMessage: string | undefined;
		try {
			const availableVersion = (await this.getLatest())?.version?.replace(/^v/, '') || null;
			action(() => this.availableVersion(availableVersion));
		} catch (error) {
			errorMessage = eem(error);
		}

		action(() => {
			if (errorMessage) {
				this.store.events
					.create({
						variant: 'danger',
						title: `Node version check error`,
						message: errorMessage,
					})
					.open();
			}
			this.isCheckingForUpdates(false);
		});

		return this.updateAvailable();
	});

	getLatest = async () => {
		const distributions = await fetchJson<NodeDistribution[]>(`${NODE_BASE_URL}index.json`);
		const latest = distributions?.[0];
		if (latest) return latest;
		throw new Error(`Couldn't find latest distribution. Returned JSON: ${JSON.stringify(distributions)}`);
	};

	install = async (subStage?: Staging) => {
		if (this.store.staging.isStaging() || this.store.operations.pending().length > 0) {
			this.store.modals.create({
				variant: 'danger',
				title: 'Staging or operations in progress',
				message: `Wait for current staging or operations to finish before updating.`,
				actions: ['ok'],
			});
			return;
		}

		const staging =
			subStage || this.store.staging.start({title: 'Installing node.js', target: 'node', action: 'install'});
		const backupDir = `${this.directory}_BACKUP`;

		try {
			this.store.worker.killAllThreads();
			const {version} = await this.getLatest();
			const {base: archiveBase, file: archiveName} = getDistArchiveName(version);
			const archiveUrl = `${NODE_BASE_URL}${version}/${archiveName}`;
			const extractedDirectory = Path.join(this.directory, archiveBase);

			// Backup current directory
			try {
				action(() => {
					staging.stage('backing up');
					staging.log(`Backing up: ${this.directory}`);
					staging.log(`To: ${backupDir}`);
				});
				await deletePath(backupDir); // ensure backup path is free
				await FSP.rename(this.directory, backupDir);
			} catch (error) {
				// We don't care if the current dir exists or not, but any other
				// error means we probably couldn't move it, and working over
				// directory that is not empty is sketchy.
				if ((error as any)?.code !== 'ENOENT') throw error;
			}

			// Download distribution archive
			action(() => {
				staging.stage('downloading');
				staging.log(`Downloading: ${archiveUrl}`);
				staging.log(`To: ${this.directory}`);
			});
			const archiveFilename = await download(archiveUrl, this.directory, {onProgress: staging.progress});
			const archivePath = Path.join(this.directory, archiveFilename);

			// Extract it
			action(() => {
				staging.progress(null);
				staging.stage('extracting');
				staging.log(`Extracting: ${archivePath}`);
				staging.log(`To: ${this.directory}`);
			});
			await extract(archivePath, {onLog: staging.log, onProgress: staging.progress});
			action(() => staging.progress(null));

			// Extracted directory needs to be normalized to the directory structure expected by node model
			staging.stage('normalizing directory tree');
			if (IS_WIN) {
				// Windows just needs to rename extracted directory to bin
				const binDir = Path.join(this.directory, 'bin');
				staging.log(`Renaming: ${extractedDirectory}\nTo: ${binDir}`);
				await FSP.rename(extractedDirectory, binDir);
			} else {
				// MacOS and Linux need to move all files from the extracted directory to node directory
				staging.log(`Moving files from: ${extractedDirectory}\nTo: ${this.directory}`);
				for (const file of await FSP.readdir(extractedDirectory)) {
					staging.log(`${Path.join(archiveBase, file)} -> ${file}`);
					await FSP.rename(Path.join(extractedDirectory, file), Path.join(this.directory, file));
				}

				// Cleanup now empty extractedDirectory
				staging.log(`Deleting: ${extractedDirectory}`);
				await deletePath(extractedDirectory);

				// Mark binaries as executable
				staging.log(`Setting node and npm binaries as executable.`);
				await FSP.chmod(this.nodePath, '777');
				await FSP.chmod(this.npmPath, '777');
			}

			// Everything went well, cleanup backups and archives
			action(() => {
				staging.stage('cleanup');
				staging.log(`Installation successful, cleaning up...`);
				staging.log(`Deleting: ${archivePath}`);
				staging.log(`Deleting: ${backupDir}`);
			});
			await deletePath(archivePath);
			await deletePath(backupDir);
		} catch (error) {
			action(() => {
				staging.error(eem(error));
				staging.stage('restoring backup');
			});
			// Cleanup the failed attempt, and restore the backup
			try {
				action(() => {
					staging.stage('cleaning up');
					staging.log(`Installation failed, cleaning up...`);
					staging.log(`Deleting: ${this.directory}`);
				});
				// await deletePath(this.directory);
				action(() => {
					staging.stage('restoring backup');
					staging.log(`Restoring: ${backupDir}`);
					staging.log(`To: ${this.directory}`);
				});
				// await FSP.rename(backupDir, this.directory);
			} catch {}
		}

		staging.stage('reloading node');
		await this.load();
		staging.done();
	};

	npm = (args: string[], options?: SpawnOptions) => {
		if (!this.isReady()) throw new Error(`Can't use npm, node.js is not installed.`);

		// Ensure process environment PATH has node binaries directory inside,
		// and all other environment variables are inherited. This is important
		// so that plugins with postinstall scripts install correctly.
		const paths: string[] = [this.binPath];
		if (options?.env?.PATH) paths.push(options?.env?.PATH);
		if (process.env.PATH) paths.push(process.env.PATH);

		options = options || {};
		options.env = {
			...(JSON.parse(JSON.stringify(process.env)) as Record<string, string>),
			...options.env,
		};
		options.env.PATH = paths.join(IS_WIN ? ';' : ':');
		const spawnArgs = [...args, '--loglevel=error', '--no-audit', '--no-fund', '--no-update-notifier'];

		options.onStdout?.(Buffer.from(`Running npm with args: ${spawnArgs.join(' ')}`));

		// Breaks on windows without this
		if (['.cmd', '.bat'].includes(Path.extname(this.npmPath).toLowerCase())) {
			options.shell = true;
		}

		return spawn(this.npmPath, spawnArgs, options);
	};
}
