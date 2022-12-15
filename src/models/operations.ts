import {shell} from 'electron';
import {promises as FSP, Stats} from 'fs';
import Path from 'path';
import {Signal, signal, createAction, action, computed} from 'statin';
import {
	eem,
	uid,
	arrayDeleteValue,
	formatDuration,
	formatPercent,
	formatSize,
	getExtensionType,
	throttle,
} from 'lib/utils';
import {Profile, BatchItem} from 'models/profiles';
import type {Store} from 'models/store';
import type {ProgressData, AnyPayload, Item} from '@drovp/types';
import type {Item as ItemModel} from 'models/items';
import type {Thread} from 'models/worker';

const bytesFormatter = ({completed}: ProgressData) => (completed ? formatSize(completed) : '');

export interface OperationOutputFile {
	kind: 'file';
	path: string;
}
export interface OperationOutputDirectory {
	kind: 'directory';
	path: string;
}
export interface OperationOutputURL {
	kind: 'url';
	url: string;
}
export interface OperationOutputString {
	kind: 'string';
	type: string;
	contents: string;
}
export interface OperationOutputError {
	kind: 'error';
	message: string;
}
export interface OperationOutputWarning {
	kind: 'warning';
	message: string;
}
export type OperationOutput =
	| OperationOutputFile
	| OperationOutputDirectory
	| OperationOutputURL
	| OperationOutputString
	| OperationOutputWarning
	| OperationOutputError;

export type OperationTitle = string | null;
export type OperationLogLine = string;
export type OperationStage = string;
export type OperationMeta = unknown;

export interface OperationPayload {
	inputs?: Item[];
	options?: {[key: string]: any};
}

export interface PreparatorMeta {
	action: 'drop' | 'paste';
	modifiers: string;
}

/**
 * This should be a state machine T.T, but I'm not gonna add a state machine
 * library dependency and introduce a different state type concept just to make
 * one model into a sate machine :(.
 */
export class Operation {
	id: string;
	store: Store;
	profile: Profile;
	inputs: ItemModel[]; // Inputs with operation instance attached
	thread: Thread | null = null;
	isBulk: boolean;
	state = signal<'queued' | 'pending' | 'done'>('queued');
	runs = signal(0); // how many times was this operation started
	title = signal<OperationTitle>(null);
	outputs = signal<ItemModel[]>([]);
	meta = signal<unknown>(null);
	logsCount = signal<number>(0);
	logs = signal<string>('');
	hasError = signal<boolean>(false); // True if there is at least one error in outputs
	belongsToErrors = signal<boolean>(false); // true if operation errored at least once (1st run or restarts)
	stage = signal<string | null>(null); // Completed progress
	progressData = signal<ProgressData>({}); // Completed progress
	created: Signal<number>; // Operation creation time
	started = signal<number | null>(null); // Operation start time
	ended = signal<number | null>(null); // Operation end time
	payload: AnyPayload;
	threadTypes: string[];
	maxThreadsAtCreation: number;
	getMaxThreads: () => number;

	constructor(rawPayload: OperationPayload, profile: Profile, store: Store) {
		const processor = profile.processor();
		if (!processor) throw new Error(`Processor "${profile.processorId}" missing when creating an operation.`);

		this.store = store;
		this.id = uid(12);
		this.inputs = rawPayload.inputs ? rawPayload.inputs.map((item) => ({...item, operation: this})) : [];
		this.created = signal(Date.now());
		// Causes freezes when many operations access their `.state` at
		// the same time, so we spread the initialization by doing it here.
		// Was causing stutters in mobx, not sure if it's the case in statin.
		this.state('queued');
		this.profile = profile;
		this.isBulk = rawPayload.inputs != null && rawPayload.inputs.length > 1;
		this.created(Date.now());

		// Construct payload
		this.payload = {...rawPayload, id: this.id} as AnyPayload;
		Object.defineProperty(this.payload, 'input', {get: () => this.payload?.inputs?.[0]});

		// Figure out types of loads this operation will use, and max number of threads it allows
		const threadType = processor.config.threadType;
		const parallelize = processor.config.parallelize;
		const isParallelized = typeof parallelize === 'function' ? parallelize(this.payload) : parallelize !== false;
		let isDynamicThreadType = false;

		switch (typeof threadType) {
			case 'string':
				this.threadTypes = [threadType];
				break;
			case 'function': {
				isDynamicThreadType = true;
				const result = threadType(this.payload);
				const normalizedResult = Array.isArray(result) ? result : [result];
				if (normalizedResult.findIndex((threadType) => typeof threadType !== 'string') !== -1) {
					throw new Error(
						`Processor "${
							processor.id
						}" threadType determiner function returned invalid result.\nOnly a string or an array of strings is allowed, but it returned: "${
							normalizedResult ? JSON.stringify(normalizedResult) : normalizedResult
						}"`
					);
				}
				this.threadTypes = normalizedResult;
				break;
			}
			default:
				this.threadTypes = Array.isArray(threadType) ? threadType : ['undefined'];
		}

		this.maxThreadsAtCreation = isParallelized ? profile.commonOptions.maxThreads() : 1;
		this.getMaxThreads = isDynamicThreadType
			? () => this.maxThreadsAtCreation
			: () => profile.commonOptions.maxThreads.value;
	}

	/**
	 * Computes the current progress as a `0-1` floating point, or `undefined`
	 * when `total` is not tracked.
	 */
	progress = computed<number | undefined>(() => {
		if (this.state() === 'done') return 1;
		const progress = this.progressData();
		if (!progress || progress.total == null || !progress.completed || progress.completed > progress.total) {
			return undefined;
		}
		const fraction = progress.completed / progress.total;
		return Number.isNaN(fraction) ? undefined : fraction;
	});

	/**
	 * Formats `this.progress()` into human readable string. Uses either
	 * processor view, or falls back to percent format.
	 */
	humanProgress = computed(() => {
		const progressFormatter = this.profile.processor()?.config.progressFormatter;
		const formatProgress =
			typeof progressFormatter === 'function'
				? progressFormatter
				: progressFormatter === 'bytes'
				? bytesFormatter
				: false;
		const progress = this.progressData();

		if (formatProgress) {
			try {
				return progress ? formatProgress(progress) : undefined;
			} catch (error) {
				console.error(error);
			}
		}

		const progressValue = this.progress();
		return progressValue != null ? formatPercent(progressValue) : undefined;
	});

	/**
	 * Computes the current (when pending) or total (when finished) operation
	 * duration.
	 *
	 * `time1000` is a current time value that updates every 1000 ms.
	 */
	duration = computed(() => {
		const started = this.started();
		if (started == null) return null;
		const ended = this.ended();
		if (ended != null) return ended - started;
		return Math.max(this.store.app.time300() - started, 0);
	});

	/**
	 * Formats `this.duration()` into human readable string.
	 */
	elapsed = computed(() => {
		const duration = this.duration();
		return duration != null ? formatDuration(duration) : undefined;
	});

	/**
	 * Human readable remaining time.
	 */
	remaining = computed(() => {
		if (this.ended()) return undefined;
		this.store.app.time1000(); // ensure this updates every second
		const eta = this.eta.value;
		if (eta == null) {
			this.eta(); // ensure we recompute as soon as available
			return undefined;
		}
		return formatDuration(Date.now() - eta);
	});

	/**
	 * ETA calculation.
	 */
	eta = signal<null | number>(null);
	etaSnaps: null | {time: number; progress: number}[] = [{time: Date.now(), progress: 0}];
	updateEta = createAction((progress: number) => {
		const time = Date.now();
		const lastSnap = this.etaSnaps?.[this.etaSnaps.length - 1];
		const isSecondApart = !lastSnap || time - lastSnap.time > 1000;

		if (!this.etaSnaps) this.etaSnaps = [];

		// Only add new snap when it's at least a second apart from the last one
		if (isSecondApart) {
			// Trim reports older than 5 seconds
			const thresholdTime = time - 5000;
			const index = this.etaSnaps.findIndex((snap) => snap.time >= thresholdTime);
			// Leave at least one
			if (index > 0 && index < this.etaSnaps.length - 1) this.etaSnaps.splice(0, index);
			this.etaSnaps.push({time, progress});
		}

		// Calculate new eta
		const firstSnap = this.etaSnaps[0];
		if (firstSnap && firstSnap.time !== time && (isSecondApart || !this.eta.value)) {
			if (this.started() == null) {
				this.eta(null);
			} else {
				const cursorTimeDelta = time - firstSnap.time;
				const cursorProgressDelta = progress - firstSnap.progress;
				const remaining = ((1 - progress) / cursorProgressDelta) * cursorTimeDelta;
				this.eta(time + remaining);
			}
		}
	});

	/**
	 * Process event handlers.
	 */

	handleStage = createAction((name: string) => {
		this.stage(name);
		this.handleLog(`>>STAGE: ${name}`);
	});

	handleProgress = createAction((progress: ProgressData) => {
		this.progressData(progress);
		const progressFraction = this.progress();
		if (progressFraction != null) this.updateEta(progressFraction);
	});

	handleTitle = createAction((value: string | undefined | null) => this.title(value || null));

	handleLog = (line: OperationLogLine) => {
		let currentLogs = this.logs();

		// Add a new line between logs if it doesn't appear naturally
		if (currentLogs && currentLogs[currentLogs.length - 1] !== '\n') currentLogs += '\n';

		const limit = this.store.settings.operationLogLimit();
		let newLogs = `${currentLogs}${line.replace(/\n+$/, '')}`;

		if (newLogs.length > limit) {
			newLogs = `... logs trimmed to Operation Log Limit setting size ...\n${newLogs.slice(-limit)}`;
		}

		// This is done because handleLog can be called a LOT of times, so there
		// is a risk of hitting statin's circular reaction stack limit.
		this.logs.value = newLogs;
		this.logsCount.value += 1;
		this.triggerLogChange();
	};

	protected triggerLogChange = throttle(
		createAction(() => {
			this.logs.changed();
			this.logsCount.changed();
		})
	);

	handleMeta = (meta: unknown) => this.meta(meta);

	handleOutput = async (operationOutput: OperationOutput) => {
		let item: ItemModel | undefined;

		switch (operationOutput.kind) {
			case 'file': {
				const path = Path.normalize(operationOutput.path);
				const extensionType = getExtensionType(path);
				let stat: Stats | undefined;
				try {
					stat = await FSP.stat(path);
				} catch {}
				item = {
					...operationOutput,
					id: uid(),
					operation: this,
					created: Date.now(),
					kind: 'file',
					path: path,
					type: extensionType,
					exists: !!stat?.isFile(),
					size: stat?.size ?? 0,
				};
				break;
			}
			case 'directory': {
				const path = Path.normalize(operationOutput.path);
				let stat: Stats | undefined;
				try {
					stat = await FSP.stat(path);
				} catch {}
				item = {
					...operationOutput,
					id: uid(),
					operation: this,
					created: Date.now(),
					kind: 'directory',
					exists: !!stat?.isDirectory(),
					path: path,
				};
				break;
			}
			case 'url':
				item = {...operationOutput, id: uid(), operation: this, created: Date.now()};
				break;
			case 'string':
				item = {...operationOutput, id: uid(), operation: this, created: Date.now()};
				break;
			case 'warning':
			case 'error':
				item = {...operationOutput, id: uid(), operation: this, created: Date.now()};
				break;
		}

		action(() => {
			if (!item) return;
			this.outputs.edit((outputs) => outputs.push(item!));
			this.store.outputs.add(item);

			if (item.kind === 'warning' || item.kind === 'error') {
				if (item.kind === 'error') {
					if (!this.belongsToErrors()) {
						this.store.operations.errors.edit((errors) => errors.push(this));
						this.belongsToErrors(true);
					}
					this.hasError(true);
				}
				this.handleLog(`${item.kind === 'error' ? 'Error' : 'Warning:'}: ${item.message}`);
				if (this.store.settings.beepOnOperationError()) shell.beep();
			}
		});
	};

	/**
	 * Creates a thread and sends the operation to be processed by it.
	 */
	process = async () => {
		const processor = this.profile.processor();

		try {
			if (!processor) {
				this.store.events
					.create({
						variant: 'danger',
						title: `Operation start error`,
						message: `Can't start the operation, profile's processor "${this.profile.processorId}" is missing.`,
					})
					.open();
				return;
			}
			this.thread = this.store.worker.getFreeThread(processor.id);
			await this.thread.processOperation(this);
		} catch (error) {
			this.handleOutput({
				kind: 'error',
				message: eem(error, true),
			});
		}

		this.end();
		this.thread = null;
	};

	/**
	 * Starts the operation.
	 */
	start = async () => {
		if (this.state() === 'pending') throw new Error(`Can't start already pending operation.`);

		action(() => {
			this.runs(this.runs() + 1);

			// Remove this operation from queued and add to pending operations
			this.store.operations.queued.edit((queued) => arrayDeleteValue(queued, this));
			this.store.operations.pending.edit((pending) => pending.push(this));

			this.state('pending');
			this.started(Date.now());
		});

		await this.process();
	};

	/**
	 * Ends the operation:
	 * - removes itself from `operations.pending`
	 * - requests profile `historyTrim()`
	 * - starts next operation in line
	 * - fills up batch progress
	 */
	end = createAction(() => {
		this.stage(null);
		this.state('done');
		this.ended(Date.now());
		this.eta(null);
		this.etaSnaps = null;

		this.store.operations.pending.edit((pending) => arrayDeleteValue(pending, this));
		this.store.operations.requestTrimHistory();
		this.store.worker.requestFillThreads();

		// Profile batch status
		this.profile.batch.insert(this.hasError() ? BatchItem.error : BatchItem.completed);
	});

	/**
	 * Reapply current options of the parent profile.
	 */
	updateOptions = createAction(() => {
		this.payload.options = this.profile.optionsData();
	});

	/**
	 * Restarts the operation.
	 */
	restart = async () => {
		if (this.state() !== 'done') throw new Error(`Can't restart queued or pending operation.`);

		let promise: Promise<void>;

		action(() => {
			this.profile.batch.increment();
			this.ended(null);
			this.outputs([]);
			this.hasError(false);
			this.meta(null);
			this.stage(null);
			this.progressData({});
			this.logsCount(0);
			this.logs('');
			promise = this.start();
		});

		return promise!;
	};

	/**
	 * Forcibly kills the ongoing operation process.
	 */
	stop = createAction((message: string = 'Stopped by user.') => this.thread?.spinDown(message));

	/**
	 * Forcibly kills the ongoing operation process.
	 */
	delete = createAction(() => {
		this.stop();
		if (this.state() !== 'done') this.profile.batch.decrement();
		this.store.operations.deleteOperation(this);
	});
}

/**
 * Operations storage is optimized to never have to run any expensive queries
 * on huge arrays.
 *
 * All operations are stored in a `this.byId` map, and than they are divided
 * into per profile, queued, and pending arrays. Per profile operation arrays
 * are stored on each profile's model (`profile.operations`).
 *
 * Managing this is a bit of a juggle, but significantly improves performance.
 */
export class Operations {
	store: Store;
	byId = signal<Map<string, Operation>>(new Map());
	queued = signal<Operation[]>([]);
	pending = signal<Operation[]>([]);
	all = signal<Operation[]>([]);
	errors = signal<Operation[]>([]);

	constructor(store: Store) {
		this.store = store;
	}

	isPending = computed(() => this.pending().length > 0);

	historySize = computed(() => this.all().length - this.queued().length - this.pending().length);

	deleteOperation = createAction((operation: Operation) => {
		const deleteOperation = (operations: Operation[]) => arrayDeleteValue(operations, operation);
		switch (operation.state()) {
			case 'pending':
				this.pending.edit(deleteOperation);
				break;
			case 'queued':
				this.queued.edit(deleteOperation);
				break;
		}
		this.all.edit(deleteOperation);
	});

	addOperation = (operation: Operation) => {
		this.byId.edit((byId) => byId.set(operation.id, operation));
		if (operation.state.value === 'queued') this.queued.edit((operations) => operations.push(operation));
		this.all.edit((operations) => operations.push(operation));
	};

	filter = createAction((predicate: (operation: Operation, index: number, operations: Operation[]) => boolean) => {
		const byId = this.byId();
		const all = this.all();
		const newAll: Operation[] = [];
		const newErrors: Operation[] = [];

		for (let i = 0; i < all.length; i++) {
			const operation = all[i]!;
			if (predicate(operation, i, all)) {
				newAll.push(operation);
				if (operation.belongsToErrors.value) newErrors.push(operation);
			} else {
				byId.delete(operation.id);
			}
		}

		this.all(newAll);
		this.errors(newErrors);
		this.byId.changed();
	});

	/**
	 * Clear the whole or profile specific queue.
	 */
	clearQueue = createAction((onlyProfile?: Profile) => {
		if (onlyProfile) {
			this.queued(this.queued().filter((operation) => operation.profile !== onlyProfile));
		} else {
			this.queued.edit((queued) => (queued.length = 0));
		}

		this.filter(
			onlyProfile
				? (operation) => operation.state.value !== 'queued' || operation.profile !== onlyProfile
				: (operation) => operation.state.value !== 'queued'
		);

		// Update profile's batch
		for (const profile of onlyProfile ? [onlyProfile] : this.store.profiles.all()) {
			profile.batch.trimPending(profile.pending().length);
		}
	});

	/**
	 * Clear all history. Also clears batch status. Doesn't touch queue.
	 */
	clearHistory = (onlyProfile?: Profile) => {
		if (onlyProfile) {
			this.filter((operation) => operation.state.value !== 'done' || operation.profile !== onlyProfile);
		} else {
			this.trimHistory(0);
		}
	};

	requestTrimHistory = throttle(() => this.trimHistory(), 2000);

	/**
	 * Trim profile history to the limit defined in by history limit settings.
	 * Called automatically on each operation end.
	 * Trims both `this.operations()` and `this.errors()`.
	 */
	trimHistory = createAction((forcedLimit?: number) => {
		// Unless forcedLimit, we trim only when history overflows limit by more
		// than 1% so this doesn't have to run too often.
		const limit = forcedLimit ?? this.store.settings.operationsHistoryLimit() * 1.01;
		const all = this.all();

		if (all.length <= limit) return;

		let historySize = 0;

		this.filter((operation) => {
			const isDone = operation.state.value === 'done';
			if (isDone) historySize++; // queued/pending items don't constitute "history"
			return historySize < limit || !isDone;
		});
	});
}

export default Operations;
