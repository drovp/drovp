import {fork, ChildProcess} from 'child_process';
import Path from 'path';
import {signal, createAction} from 'statin';
import type {Operation} from 'models/operations';
import {Store} from 'models/store';
import {Profile} from 'models/profiles';
import type {ThreadMessage, ThreadReady} from 'thread';
import type {OperationMeta, OperationLogLine, OperationStage, OperationOutput} from 'models/operations';
import type {Processor} from 'models/processors';
import type {SerializedInputItem} from 'models/items';
import type {ProgressData, Item} from '@drovp/types';
import {computed} from 'statin';
import {eem, makePromise, throttle} from 'lib/utils';

export interface SerializedOperation {
	id: string;
	priority: ProcessPriority;
	payload: SerializedOperationPayload;
}
export type SerializedOperationPayload =
	| {
			id: string;
			options?: {[key: string]: any};
			inputs: SerializedInputItem[];
			input: undefined;
	  }
	| {
			id: string;
			options?: {[key: string]: any};
			input?: SerializedInputItem;
			inputs: undefined;
	  };

export interface ProcessOptions {
	onLog: (line: OperationLogLine) => void;
	onMeta: (meta: OperationMeta) => void;
	onStage: (name: OperationStage) => void;
	onProgress: (progress: ProgressData) => void;
	onOutput: (output: OperationOutput) => void;
}

export interface ThreadJob {
	operation: Operation;
	resolve: () => void;
}

export interface ThreadConfig {
	processorPath: string;
	pluginPath: string;
	dependencies: Record<string, any>;
	dataPath: string;
}

function killProcess(process: ChildProcess) {
	process.removeAllListeners();
	process.stdout?.removeAllListeners();
	process.stderr?.removeAllListeners();
	process.kill();
}

async function serializeItem(item: Item): Promise<SerializedInputItem> {
	if (item.kind === 'blob') return {...item, contents: item.contents.toString('base64')};
	return item;
}

export class Thread {
	store: Store;
	// Path to the file that creates the actual thread child process
	protected path: string;
	// Path to the module this thread is for
	readonly processorId: string;
	idleSince: number = 0;
	protected process: ChildProcess | null = null;
	protected refreshWhenDone: boolean = false;
	protected job: ThreadJob | null = null;

	processor = computed(() => this.store.processors.byId().get(this.processorId));

	constructor(processorId: string, store: Store) {
		this.store = store;
		this.processorId = processorId;
		this.path = require.resolve(Path.join(store.app.appPath, 'thread.js'));
	}

	destroy() {
		this.spinDown(
			this.job ? `Thread destroyed while operation "${this.job.operation.id}" still in progress.` : undefined
		);
		this.cleanup();
	}

	get isBusy() {
		return this.job != null;
	}

	protected async spinUp() {
		if (this.process != null) return;

		if (!this.store.node.isReady()) {
			throw new Error(`Node is not ready, can't spin up any threads.`);
		}

		const processor = this.processor();

		if (!processor || !processor.isReady()) {
			throw new Error(`Processor "${this.processorId}" is not available or ready, can't spin up any threads.`);
		}

		const threadConfig: ThreadConfig = {
			processorPath: processor.path,
			pluginPath: processor.plugin.path,
			dependencies: processor.dependencyPayloads(),
			dataPath: processor.plugin.dataPath,
		};

		const threadProcess = fork(this.path, ['--config', JSON.stringify(threadConfig)], {
			execPath: this.store.node.nodePath,
			// Warnings only for local plugins
			execArgv:
				processor.plugin.isLocal && this.store.settings.developerMode()
					? undefined
					: ['--no-deprecation', '--no-warnings'],
			silent: true,
		});
		this.idleSince = Date.now();

		// We are communicating and handling everything through IPC, but these
		// can still happen when users use console.log/error commands.
		threadProcess.stdout?.on('data', (buffer) => {
			const data = buffer.toString();
			const id = this.job?.operation.id;
			if (id) {
				this.handleMessage({type: 'log', id, payload: data});
			} else {
				console.error(`Thread stdout with no job in progress: ${data}`);
				this.requestRefresh();
			}
		});
		threadProcess.stderr?.on('data', (buffer) => {
			const data = buffer.toString();
			const id = this.job?.operation.id;
			if (id) {
				this.handleMessage({type: 'log', id, payload: data});
				this.handleMessage({type: 'output', id, payload: {kind: 'error', message: data}});
			} else {
				console.error(`Thread stderr with no job in progress: ${data}`);
				this.requestRefresh();
			}
		});

		const [readyPromise, resolve, reject] = makePromise();
		const abort = (reason?: any) => {
			killProcess(threadProcess);
			reject(reason);
		};

		// Waiting for process to get ready events
		threadProcess.on('message', (message: ThreadReady) => {
			if (message && message?.type === 'ready') resolve();
			else abort(`Unexpected message while waiting on thread to get ready: ${JSON.stringify(message)}`);
		});
		threadProcess.on('close', (code) => abort(`Thread process closed with code ${code}.`));
		// The process could not be spawned
		// The process could not be killed
		// Sending a message to the child process failed
		threadProcess.on('error', (error) =>
			abort(`Thread process emitted an error when getting ready: ${error?.message}`)
		);

		await readyPromise;

		threadProcess.removeAllListeners();

		// Proper runtime events
		threadProcess.on('message', this.handleMessage);
		threadProcess.on('close', this.handleClose);
		threadProcess.on('error', this.handleError);

		this.process = threadProcess;
	}

	/**
	 * Kills the process and forgets about it.
	 */
	spinDown(message?: string) {
		if (this.process == null) return;

		killProcess(this.process);

		this.process = null;

		if (this.job != null) {
			this.job.operation.handleOutput({
				kind: 'error',
				message:
					message ||
					`Thread spinDown requested while operation "${this.job.operation.id}" still in progress.`,
			});
			this.job.resolve();
			this.cleanup();
		}
	}

	/**
	 * Requests a process recreation after current job, or immediately when idle.
	 */
	requestRefresh() {
		if (this.job) this.refreshWhenDone = true;
		else this.refresh();
	}

	/**
	 * Destroys current process so it is recreated when needed next time.
	 * This is used to reload the module when module files have changed
	 * without having to restart the app.
	 */
	refresh() {
		this.refreshWhenDone = false;
		this.spinDown(
			this.job
				? `Thread refresh requested while operation "${this.job.operation.id}" still in progress.`
				: undefined
		);
	}

	async processOperation(operation: Operation) {
		try {
			const [promise, resolve] = makePromise();

			if (this.job) throw new Error(`Thread "${this.processorId}" is busy.`);

			this.job = {operation, resolve};

			if (!this.process) await this.spinUp();

			// Encode blob contents into base64
			let tmpPayload = {...operation.payload, inputs: undefined, input: undefined} as SerializedOperationPayload;
			const payloadInputs = operation.payload.inputs;
			if (Array.isArray(payloadInputs)) {
				const serializedItems: SerializedInputItem[] = [];

				for (const item of payloadInputs) serializedItems.push(await serializeItem(item));

				tmpPayload.inputs = serializedItems;
			}

			const serializedOperation = {
				id: operation.id,
				priority: this.store.settings.operationsProcessPriority(),
				payload: tmpPayload,
			} satisfies SerializedOperation;

			this.process!.send(serializedOperation);
			await promise;
		} catch (error) {
			this.job?.operation.handleOutput({kind: 'error', message: eem(error, true)});
		}

		this.cleanup();
	}

	protected cleanup() {
		this.job = null;
		this.idleSince = Date.now();
	}

	protected handleMessage = (message: ThreadMessage) => {
		if (!message || typeof message.type !== 'string') {
			console.error('Invalid thread message:', message);
			return;
		}

		if (!this.job || this.job.operation.id !== message.id) {
			const operation = this.store.operations.byId().get(message.id);
			const processor = operation ? this.store.processors.byId().get(operation.profile.processorId) : null;

			if (this.store.settings.developerMode()) {
				this.store.events
					.create({
						variant: 'danger',
						title: `Zombie operation process`,
						message: `Operation "${message.id}"${
							processor ? ` of processor "${processor.id}"` : ''
						} produced a message after it supposedly resolved its process. Message:`,
						details: JSON.stringify(message, null, 2),
					})
					.open();
			}

			// Kill the zombie
			this.requestRefresh();

			return;
		}

		const operation = this.job.operation;

		switch (message.type) {
			case 'output':
				operation.handleOutput(message.payload);
				break;
			case 'title':
				operation.handleTitle(message.payload);
				break;
			case 'log':
				operation.handleLog(message.payload);
				break;
			case 'meta':
				operation.handleMeta(message.payload);
				break;
			case 'stage':
				operation.handleStage(message.payload);
				break;
			case 'progress':
				operation.handleProgress(message.payload);
				break;
			case 'done':
				this.job.resolve();
				this.cleanup();
				if (this.refreshWhenDone) this.refresh();
				break;
			default:
				console.error(`Unexpected thread message:`, message);
		}
	};

	protected handleClose = () => {
		this.spinDown(
			this.job ? `Thread closed while operation "${this.job.operation.id}" still in progress.` : undefined
		);
	};

	protected handleError = (error: Error) => {
		console.error('Thread error:', error);
	};
}

interface WorkerOptions {
	cleanupInterval: number;
}

export default class Worker {
	static defaults: WorkerOptions = {
		cleanupInterval: 10000, // milliseconds after which unused threads are disposed
	};

	store: Store;
	options: WorkerOptions;
	protected threadsByProcessor: Map<string, Thread[]>;
	protected cleanupID: ReturnType<typeof setTimeout> | null;
	isPaused = signal<boolean>(false);

	constructor(store: Store, options?: Partial<WorkerOptions>) {
		this.store = store;
		this.options = {...Worker.defaults, ...options};
		this.threadsByProcessor = new Map();
		this.cleanupID = setInterval(this.clearUnusedThreads, this.options.cleanupInterval * 1.1);
	}

	destroy = () => {
		if (this.cleanupID) clearInterval(this.cleanupID);
		this.killAllThreads();
	};

	killAllThreads = () => {
		for (let threads of this.threadsByProcessor.values()) {
			threads.forEach((thread) => thread.destroy());
		}
		this.threadsByProcessor.clear();
	};

	/**
	 * Pulls operations from queue and starts them until they fill their
	 * individual thread types.
	 */
	fillThreads = createAction(() => {
		if (this.isPaused()) return;

		const queued = this.store.operations.queued();
		const pending = this.store.operations.pending();
		const threadsCountMap: Record<string, number> = {};
		// These limits are calculated by finding the min value of currently
		// pending & about to be started operation's processor's maxThread options.
		const maxThreadsMap: Record<string, number> = {};
		// Inserts thread into `threads` map, and updates `maxThreads` accordingly
		const insertThread = (operation: Operation) => {
			for (const threadType of operation.threadTypes) {
				if (threadsCountMap[threadType] == null) threadsCountMap[threadType] = 0;
				if (maxThreadsMap[threadType] == null) maxThreadsMap[threadType] = Infinity;
				threadsCountMap[threadType]++;
				maxThreadsMap[threadType] = Math.min(maxThreadsMap[threadType]!, operation.getMaxThreads());
			}
		};

		// Construct thread state maps of currently pending operations
		for (const operation of pending) insertThread(operation);

		// Starting operations has to happen outside of the loop that goes
		// through them, because queued array is shifted on each `.start()`.
		const operationsToStart: Operation[] = [];

		// This array can get BIG, so optimize speed
		queueLoop: for (let i = 0; i < queued.length; i++) {
			const operation = queued[i]!;

			// Checks if this operation can be slotted, and skips it if there is
			// not enough free load type threads for this processor.
			for (let i = 0; i < operation.threadTypes.length; i++) {
				const threadType = operation.threadTypes[i]!;
				const threadsCount = threadsCountMap[threadType];
				const maxThreadsCount = maxThreadsMap[threadType];

				if (
					threadsCount != null &&
					maxThreadsCount != null &&
					threadsCount >= Math.min(operation.getMaxThreads(), maxThreadsCount)
				) {
					continue queueLoop;
				}
			}

			insertThread(operation);
			operationsToStart.push(operation);
		}

		for (const operation of operationsToStart) operation.start();
	});

	/**
	 * Requests threads to be filled soon.
	 * Threads are usually filled on operation end. Sometimes, you might want
	 * to stop many operations at the same time, so this ensures we are not
	 * running fillThreads more than once in this scenario.
	 */
	requestFillThreads = throttle(this.fillThreads, 100);

	/**
	 * Queue controls.
	 *
	 * There is currently no mechanism to pause individual operations,
	 * so the currently pending ones are left to complete.
	 */
	resume = createAction(() => {
		this.isPaused(false);
		this.requestFillThreads();
	});

	pause = createAction(() => this.isPaused(true));

	toggle = () => (this.isPaused() ? this.resume() : this.pause());

	/**
	 * Stops (kills) all or profile specific ongoing operations.
	 */
	stop = createAction((onlyProfile?: Profile) => {
		this.pause();
		for (const operation of this.store.operations.pending()) {
			if (onlyProfile && onlyProfile !== operation.profile) continue;
			operation.stop();
		}
	});

	createThread = (processorId: string) => {
		const thread = new Thread(processorId, this.store);
		let processorThreads: Thread[] | undefined = this.threadsByProcessor.get(processorId);
		if (processorThreads == null) {
			processorThreads = [];
			this.threadsByProcessor.set(processorId, processorThreads);
		}
		processorThreads.push(thread);
		return thread;
	};

	getFreeThread = (processorId: string) => {
		return this.threadsByProcessor.get(processorId)?.find((x) => !x.isBusy) || this.createThread(processorId);
	};

	clearUnusedThreads = () => {
		const idleTimeCutoff = Date.now() - this.options.cleanupInterval;
		for (let [processorId, threads] of this.threadsByProcessor.entries()) {
			const processor = this.store.processors.byId().get(processorId);
			const minThreads = processor?.config.keepAlive ? 1 : 0;
			const newThreads = threads.filter((thread) => thread.isBusy);
			const idleThreads = threads.filter((thread) => !thread.isBusy);

			for (let thread of idleThreads) {
				if (newThreads.length < minThreads || thread.idleSince > idleTimeCutoff) {
					newThreads.push(thread);
				} else {
					thread.destroy();
				}
			}

			this.threadsByProcessor.set(processorId, newThreads);
		}
	};

	requestRefreshThreads = (processor?: Processor) => {
		// Refresh only threads of a specific processor
		if (processor) {
			this.threadsByProcessor.get(processor.path)?.forEach((thread) => thread.requestRefresh());
			return;
		}

		// Refresh all threads
		for (let [, threads] of this.threadsByProcessor.entries()) {
			threads.forEach((thread) => thread.requestRefresh());
		}
	};
}
