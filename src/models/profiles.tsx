import {shell} from 'electron';
import Path from 'path';
import manifest from 'manifest';
import {Signal, signal, computed, Computed, action, createAction, reaction, Disposer, toJS} from 'statin';
import {promises as FS} from 'fs';
import {outputJson, readJson} from 'lib/fs';
import * as serialize from 'lib/serialize';
import {
	TargetedEvent,
	eem,
	uid,
	clamp,
	get1DPointToLineDistance,
	debounce,
	makePromise,
	arrayDeleteValue,
	formatDuration,
	isType,
	Type,
	idModifiers,
	reportIssue,
	findDatasetAncestor,
	roundDecimals,
	getOptionsDifference,
} from 'lib/utils';
import {positionSignal} from 'lib/signals';
import {SetRequired, SetOptional} from 'type-fest';
import type {Store} from 'models/store';
import type {Item, ItemDirectory, OptionsData} from '@drovp/types';
import {NumberSignal, AnyOptionsSignals, createOptions} from 'models/options';
import {ProfileOutputs} from 'models/items';
import {Operation, OperationPayload, PreparatorMeta} from 'models/operations';
import type {Issue} from 'components/Issues';
import {showOptionsTweaker} from 'components/OptionsTweaker';
import {makeToast} from 'components/Toast';
import {compressToEncodedURIComponent} from 'lz-string';

export interface SerializedProfile {
	id: string;
	processorId: string;
	createdAt?: number;
	title?: string;
	commonOptions?: OptionsData;
	options?: OptionsData;
	version: string;
	position?: Partial<ProfileGridPosition>;
}

export interface ProfileGridPosition {
	row: number;
	left: number;
	width: number;
}

export interface ProfileDraggingMeta {
	profileId: string;
	offsetX: number;
	width: number;
}

export interface ProfileExportData {
	title: string;
	processor: string;
	source: string;
	version: string;
	options?: {[key: string]: any};
}

export enum BatchItem {
	pending,
	completed,
	error,
}

export type AddingListener = (count: number) => void;

type ProfileCommonOptionsData = {maxThreads: number};
type ProfileCommonOptions = {maxThreads: NumberSignal};
export const PROFILE_COMMON_OPTIONS_SCHEMA = [
	{
		type: 'number' as const,
		name: 'maxThreads' as const,
		default: 1,
		min: 1,
		max: 8,
		step: 1,
		softMax: true,
	},
];

/**
 * Batch status is an array of status enums of current operations' batch.
 * This is used for fast generation of a nice progress bar with error/warning
 * indicators.
 */
export class Batch {
	items = signal<BatchItem[]>([]);
	index = signal<number>(0);
	completed = signal<number>(0);
	errors = signal<number>(0);

	reset = createAction(() => {
		this.items.edit((items) => {
			items.length = 0;
			items.push();
		});
		this.index(0);
		this.completed(0);
		this.errors(0);
	});

	progress = computed(() => (this.items().length > 0 ? this.index() / this.items().length : undefined));

	/**
	 * Bump the size of the batch.
	 */
	increment = createAction((amount = 1) => {
		const currentIndex = this.index();

		// Reset when incrementing a finished batch
		if (this.items().length > 0 && this.items().length <= currentIndex) this.reset();

		this.items.edit((items) => {
			for (let i = 0; i < amount; i++) items.push(BatchItem.pending);
		});
	});

	/**
	 * Drop batch items from the end.
	 */
	decrement = createAction((amount = 1) => {
		this.items.edit((items) => {
			items.splice(items.length - amount, amount);
			if (this.index() >= items.length) this.index(items.length);
		});
	});

	/**
	 * Insert new completion result.
	 */
	insert = createAction((item: BatchItem) => {
		const index = this.index();
		if (index >= this.items().length) throw new Error('Batch overflow.');
		this.items.edit((items) => (items[index] = item));
		this.index(index + 1);
		if (item === BatchItem.error) this.errors(this.errors() + 1);
		else this.completed(this.completed() + 1);
	});

	/**
	 * Removes all done batch items from the start of the batch.
	 */
	trimDone = createAction(() => {
		this.items.edit((items) => items.splice(0, this.index()));
		this.index(0);
	});

	/**
	 * Removes all pending batch items from the end of the batch.
	 * "pending" in batch context is both pending and queued items.
	 */
	trimPending = createAction((keep: number = 0) => {
		this.items.edit((items) => items.splice(this.index() + keep));
	});
}

// A leeway allowed for determining if 2 grid positions match
export const gridPrecision = 0.00002;

export class Profile {
	store: Store;
	id!: string;
	createdAt: number;
	categoryId: Signal<string>;
	processorId: string;
	processorName: string;
	pluginMeta: PluginNameMeta;
	position: ReturnType<typeof positionSignal>;
	title = signal<string>('');
	isDragged = signal<boolean>(false);
	isDraggedOver = signal<boolean>(false);
	preparationQueue: Operation[] = [];
	preparationPromise: Promise<void> | undefined;
	outputs: ProfileOutputs;
	batch = new Batch();
	// Options used by the app
	commonOptions: ProfileCommonOptions;
	// Options sent to processors (`options()` is a computed property below)
	optionsData = signal<OptionsData | undefined>(undefined);
	optionsDataReactionDisposer: Disposer;
	version: Signal<string>;

	// Adding jobs facilitate not freezing the app when adding huge number of items.
	// These numbers are used to display a real time counter of thus far added items into a profile.
	addingJobs = signal<number>(0);
	_added = 0; // Number of items added by current addItems() operations thus far
	addingListeners = new Set<AddingListener>();

	constructor(data: SetOptional<SerializedProfile, 'position' | 'createdAt'> & {categoryId: string}, store: Store) {
		this.store = store;
		this.id = data.id;
		this.categoryId = signal(data.categoryId);
		const slot = this.category().getFreeSlot(data.position);
		this.position = positionSignal(slot);
		this.processorId = data.processorId;
		this.version = signal(data.version);
		this.outputs = new ProfileOutputs(store.outputs, this);
		this.createdAt = parseInt(`${data.createdAt}`, 10) || Date.now();

		let pluginName: string;
		let processorName: string;

		try {
			[pluginName, processorName] = serialize.colonIdMeta(this.processorId);
		} catch {
			throw new Error(`Invalid processorId "${data.processorId}".`);
		}

		this.processorName = processorName;
		this.pluginMeta = serialize.pluginNameMeta(pluginName);
		this.title(typeof data.title === 'string' ? data.title : '');

		// Ensure profile has a valid grid position

		// We need to keep track of initial and last valid options data to prevent
		// its loss when processor disappears and re-appears (reload/reinstall).
		// This can't be a computed property, because it would inherently depend
		// on `options()`, but options in turn depends on last options data,
		// creating a circular dependency.
		this.optionsData(isType<{[key: string]: any}>(data.options, Type.Object) ? data.options : undefined);
		this.optionsDataReactionDisposer = reaction(() => {
			const options = this.options();
			const pluginVersion = this.plugin()?.version;
			if (options && pluginVersion) {
				this.optionsData(toJS(options) || undefined);
				this.version(pluginVersion);
			}
		});

		this.commonOptions = createOptions<ProfileCommonOptionsData>(
			PROFILE_COMMON_OPTIONS_SCHEMA,
			data.commonOptions
		) as ProfileCommonOptions;
	}

	destroy = createAction(() => {
		this.optionsDataReactionDisposer();

		// This order is important!
		// this.watchers.stop();
		this.clearQueue();
		for (const pendingOperation of this.pending()) {
			pendingOperation.stop('Operation killed due to profile being destroyed.');
		}
		this.clearHistory();
	});

	category = computed(() => {
		const category = this.store.profiles.categories.byId().get(this.categoryId());
		if (!category) throw new Error(`Profile's category doesn't exist.`);
		return category;
	});

	columnSpan = computed(() => {
		const columnSize = 1 / this.store.settings.profilesGridColumns();
		const position = this.position();
		return {
			start: getColumnSpanStart(position.left, columnSize),
			end: getColumnSpanEnd(position.left + position.width, columnSize),
		};
	});

	options = computed<AnyOptionsSignals | undefined>(() => {
		const schema = this.processor()?.optionsSchema;
		return schema ? createOptions(schema, this.optionsData.value) : undefined;
	});

	displayTitle = computed(() => this.title() || `${this.processorName} #${this.id}`);

	processor = computed(() => this.store.processors.byId().get(this.processorId));

	plugin = computed(() => this.store.plugins.byId().get(this.pluginMeta.name));

	humanThreadType = computed(() => {
		const threadType = this.processor()?.config.threadType;
		if (Array.isArray(threadType)) return threadType.join('+');
		switch (typeof threadType) {
			case 'function':
				return '{dynamic}';
			case 'string':
				return threadType;
		}
		return `${threadType}`;
	});

	/**
	 * Processor.isReady() is necessary, because loading dependencies are not
	 * part of issues, but they still are part of the isReady determination.
	 */
	isReady = computed(() => this.processor()?.isReady() === true && this.issues().length === 0);

	pending = computed(() => this.store.operations.pending().filter((x) => x.profile === this));

	operations = computed(() => {
		const operations: Operation[] = [];
		const all = this.store.operations.all();
		for (let i = 0; i < all.length; i++) {
			const operation = all[i]!;
			if (operation.profile === this) operations.push(operation);
		}
		return operations;
	});

	errors = computed(() => {
		const errors: Operation[] = [];
		const all = this.store.operations.errors();
		for (let i = 0; i < all.length; i++) {
			const operation = all[i]!;
			if (operation.profile === this) errors.push(operation);
		}
		return errors;
	});

	progress = computed(() => {
		let progress = this.batch.progress();
		if (progress == null) return null;
		let itemSliceSize = 1 / this.batch.items().length;
		for (let operation of this.pending()) progress += (operation.progress() || 0) * itemSliceSize;
		return progress;
	});

	hasPendingOperations = computed(() => this.pending().length > 0);

	dependenciesLoading = () => !!this.processor()?.dependenciesLoading();

	allModifiers = computed(() => {
		let config = this.processor()?.config.modifierDescriptions;
		let result: [string, string][] = [];
		if (typeof config === 'function') config = config(this.optionsData());
		config = {...config};
		delete config.Shift;
		config = {Shift: `tweak options for current drop`, ...config};
		if (config != null && typeof config === 'object') result = Object.entries(config);
		return result;
	});

	processorModifiers = computed(() => this.allModifiers().filter(([name]) => name !== 'Shift'));

	issues = computed<Issue[]>(() => {
		const issues: Issue[] = [];
		const processor = this.processor();

		if (!this.plugin()) {
			issues.push({
				title: `Plugin ${this.pluginMeta.displayName} is not installed.`,
				actions: [
					{
						icon: 'install',
						title: 'Install',
						variant: 'success',
						disableWhenStaging: true,
						action: () => this.store.plugins.install(this.pluginMeta.name),
					},
				],
			});
		} else if (!processor) {
			issues.push({
				title: `Processor "${this.processorName}" from plugin "${this.pluginMeta.displayName}" is missing.`,
				message: `Processor probably failed to load due to errors or misconfiguration, or plugin changed its API and renamed a processor.`,
			});
		}

		if (processor) issues.push(...processor.issues());

		return issues;
	});

	/**
	 * Data to copy this profile.
	 */
	copyData = () => {
		return {
			title: this.title(),
			processorId: this.processorId,
			categoryId: this.categoryId(),
			source: this.plugin()?.source || this.pluginMeta.name,
			version: this.version(),
			options: this.optionsData(),
			position: this.position(),
		};
	};

	/**
	 * This can't fail, it's used to duplicate profiles.
	 */
	exportData = computed<ProfileExportData>(() => {
		const fullOptionsData = this.optionsData();
		return {
			title: this.title(),
			processor: this.processorId,
			source: this.plugin()?.source || this.pluginMeta.name,
			version: this.version(),
			options: this.store.settings.compactImportCodes()
				? getOptionsDifference(fullOptionsData, this.processor()?.optionDefaults)
				: fullOptionsData,
		};
	});

	importJSON = computed(() => JSON.stringify(this.exportData()));
	importCode = computed(() => compressToEncodedURIComponent(this.importJSON()));
	importURL = computed(() => `${manifest.name}://import/${this.importCode()}`);
	importMarkdownLink = computed(
		() => `[Import ${manifest.productName} profile "${this.title() || this.processorName}"](${this.importURL()})`
	);

	updateQueuedOptions = () => {
		const optionsData = this.optionsData();
		for (const operation of this.store.operations.queued()) {
			if (operation.profile === this) {
				operation.maxThreadsAtCreation = this.commonOptions.maxThreads();
				operation.payload.options = {...operation.payload.options, ...optionsData};
			}
		}
	};

	shouldBulk = (items: Item[], meta: {modifiers: string}) => {
		const processor = this.processor();

		if (!processor) throw new Error(`Processor missing.`);

		const decider = processor.config.bulk;

		if (typeof decider === 'function') {
			try {
				return decider(items, this.optionsData(), meta);
			} catch (error) {
				const reportIssueUrl = processor.plugin.reportIssueUrl;
				this.store.events
					.create({
						variant: 'danger',
						title: `Processor config error`,
						message: `Processor ${processor.id}'s bulk deciding function threw an error.`,
						details: eem(error, true),
						actions: reportIssueUrl
							? [
									{
										variant: 'info',
										icon: 'bug',
										title: 'Report issue',
										action: () => shell.openExternal(reportIssueUrl),
									},
							  ]
							: undefined,
					})
					.open();
				throw error;
			}
		}

		return decider != null ? decider : false;
	};

	shouldExpandDirectory = (item: ItemDirectory, options: OptionsData, meta: {modifiers: string}) => {
		const processor = this.processor();

		if (!processor) throw new Error('Processor missing.');

		const decider = processor.config.expandDirectory;

		if (typeof decider === 'function') {
			try {
				return decider(item, options, meta);
			} catch (error) {
				const reportIssueUrl = processor.plugin.reportIssueUrl;
				this.store.events
					.create({
						variant: 'danger',
						title: `Processor config error`,
						message: `Processor ${processor.id}'s expandDirectory deciding function threw an error.`,
						details: eem(error, true),
						actions: reportIssueUrl
							? [
									{
										variant: 'info',
										icon: 'bug',
										title: 'Report issue',
										action: () => shell.openExternal(reportIssueUrl),
									},
							  ]
							: undefined,
					})
					.open();
				throw error;
			}
		}

		return decider != null ? decider : !processor.config.accepts?.directories;
	};

	/**
	 * Check if item will be accepted by this plugin.
	 */
	acceptsItem = (item: Item): boolean => {
		const accepts = this.processor()?.config.accepts;
		if (!accepts) return false;

		if (item.kind === 'file') {
			let flags = accepts.files;
			if (flags == null || typeof flags === 'boolean') return flags ?? false;

			const basename = Path.basename(item.path);

			for (const flag of Array.isArray(flags) ? flags : [flags]) {
				switch (typeof flag) {
					case 'string':
						if (flag === item.type) return true;
						if (flag === basename.toLowerCase()) return true;
						break;
					case 'function':
						return flag(item, this.optionsData());
					case 'object':
						if (flag.exec(basename)) return true;
						break;
				}
			}
		}

		if (item.kind === 'directory') {
			let flags = accepts.directories;
			if (flags == null || typeof flags === 'boolean') return flags ?? false;

			const basename = Path.basename(item.path);

			for (const flag of Array.isArray(flags) ? flags : [flags]) {
				switch (typeof flag) {
					case 'string':
						if (flag === basename.toLowerCase()) return true;
						break;
					case 'function':
						return flag(item, this.optionsData());
					case 'object':
						if (flag.exec(basename)) return true;
						break;
				}
			}
		}

		if (item.kind === 'blob') {
			let flags = accepts.blobs;
			if (flags == null || typeof flags === 'boolean') return flags ?? false;

			for (const flag of Array.isArray(flags) ? flags : [flags]) {
				switch (typeof flag) {
					case 'string':
						if (flag === item.mime) return true;
						break;
					case 'function':
						if (flag(item, this.optionsData())) return true;
						break;
				}
			}
		}

		if (item.kind === 'string') {
			let flags = accepts.strings;
			if (flags == null || typeof flags === 'boolean') return flags ?? false;

			for (const flag of Array.isArray(flags) ? flags : [flags]) {
				switch (typeof flag) {
					case 'string':
						if (flag === item.type) return true;
						break;
					case 'function':
						if (flag(item, this.optionsData())) return true;
						break;
					case 'object':
						if (flag.exec(item.contents)) return true;
						break;
				}
			}
		}

		if (item.kind === 'url') {
			let flags = accepts.urls;
			if (flags == null || typeof flags === 'boolean') return flags ?? false;
			const url = new URL(item.url.toLowerCase());
			const comparisonTarget = `${url.host}${url.pathname}`;

			for (const flag of Array.isArray(flags) ? flags : [flags]) {
				switch (typeof flag) {
					case 'string':
						if (comparisonTarget.startsWith(flag)) return true;
						break;
					case 'function':
						if (flag(item, this.optionsData())) return true;
						break;
					case 'object':
						if (flag.exec(item.url)) return true;
						break;
				}
			}
		}

		return false;
	};

	/**
	 * Checks if process would accept any of the items in collection.
	 *
	 * `limit` controls the number of items checked for performance reasons.
	 * This has to be fast because it's used when user drags something over and
	 * we need to mark droppable profiles immediately.
	 *
	 * TODO: Test on huge drag & drops and potentially move to filtering on drop
	 * instead of on hover when they prove to be slow/stutter too much.
	 */
	acceptsAny = (items: Item[], limit = 1000) => {
		const checkCount = Math.min(items.length, limit);
		for (let i = 0; i < checkCount; i++) {
			if (this.acceptsItem(items[i]!)) return true;
		}
		return false;
	};

	/**
	 * A cheat to create a computed property that throttles updates once per 300 ms.
	 * `app.time300` is current time that updates every 300ms, and
	 * `this._added` is not observable, so it'll update only when `app.time300`
	 * does, and when there are adding jobs.
	 * This is necessary since `this._added` can update MANY times per
	 * second, and making it observable would kill the performance.
	 */
	added = computed(() => {
		if (this.isAdding()) this.store.app.time300();
		return this._added;
	});

	isAdding = computed(() => this.addingJobs() > 0);

	/**
	 * Adding listeners are triggered in intervals during adding process
	 */
	registerAddingListener = (listener: AddingListener) => {
		this.addingListeners.add(listener);
		return () => {
			this.addingListeners.delete(listener);
		};
	};

	/**
	 * Filters out unsupported items, and expands directories.
	 */
	async normalizeItems(items: Item[], accumulator: Item[], options: OptionsData, meta: {modifiers: string}) {
		accumulator = accumulator || ([] as Item[]);
		const processor = this.processor();

		if (!processor) return accumulator;

		// We expand directories at the end, so that top level files are processed first
		const directoriesToExpand: string[] = [];

		try {
			for (const item of items) {
				if (item.kind === 'directory' && processor.config.accepts?.files != null) {
					// shouldExpandDirectory can fail as it can depend on processor's deciding function
					try {
						if (this.shouldExpandDirectory(item, options, meta)) {
							directoriesToExpand.push(item.path);
							continue;
						}
					} catch (error) {
						return [];
					}
				}

				if (this.acceptsItem(item)) accumulator.push(item);
			}

			// Expand directories
			for (let directoryPath of directoriesToExpand) {
				try {
					const itemPath = directoryPath;
					const nestedItems: Item[] = [];
					for (const file of await FS.readdir(itemPath)) {
						nestedItems.push(await serialize.file(Path.join(itemPath, file)));
					}
					await this.normalizeItems(nestedItems, accumulator, options, meta);
				} catch (error) {
					console.error(error);
				}
			}
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Item normalization error`,
					message: `Error when trying to normalize items dropped into processor "${processor.id}".`,
					details: eem(error, true),
				})
				.open();
		}

		return accumulator;
	}

	async dropItems(rawItems: Item[], meta: PreparatorMeta) {
		const processor = this.processor();
		if (!processor) return;

		let options: any;

		// Options tweaking
		if (meta.modifiers === 'Shift') {
			try {
				const tweakedData = await showOptionsTweaker(this.store, rawItems, this);
				if (tweakedData === false) return; // Canceled
				options = tweakedData.options;
				// Replace with modifiers that were held when confirming the new options
				meta.modifiers = tweakedData.modifiers;
			} catch (error) {
				this.store.events
					.create({
						variant: 'danger',
						title: 'Tweak options error',
						message: eem(error),
					})
					.open();
				return;
			}
		} else {
			// We clone so that preparators don't modify user's current options data
			const data = this.optionsData();
			options = data ? JSON.parse(JSON.stringify(data)) : data;
		}

		// Drop filter
		try {
			let dropFilter = processor.config.dropFilter;
			if (dropFilter) rawItems = await dropFilter(rawItems, options);
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Processor config error`,
					message: `Processor ${processor.id}'s dropFilter threw an error.`,
					details: eem(error, true),
				})
				.open();
			return;
		}

		let shouldBulk = false;

		// Ask processor if we should bulk, can fail if its bulk decider throws errors
		try {
			shouldBulk = this.shouldBulk(rawItems, meta);
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Processor config error`,
					message: `Processor ${processor.id}'s shouldBulk decider threw an error.`,
					details: eem(error, true),
				})
				.open();
			return;
		}

		action(() => {
			this.addingJobs(this.addingJobs() + 1);
		});

		const inputs: Item[] = [];

		// Start item serialization, which populates `items` accumulator in the background
		const serializingItems = this.normalizeItems(rawItems, inputs, options, meta);
		let serializingItemsDone = false;
		let creatingOperations: Promise<void> | undefined;
		let flushId: ReturnType<typeof setTimeout> | undefined;
		// Periodically flushes the accumulator. Doing it at the end is bad,
		// since when adding a lot of items you have to wait for the file
		// system to finish listing before the 1st operation can start.
		const flush = () => {
			// TODO: implement empty operations support & API
			if (inputs.length > 0) {
				creatingOperations = this.createOperations(
					inputs.map((item) => ({inputs: [item], options})),
					meta,
					!serializingItemsDone
				);
				inputs.length = 0;
			}
			if (!serializingItemsDone) flushId = setTimeout(flush, 100);
		};

		// When not bulking, all items have to create a separate operation, so
		// we start flushing them here.
		if (!shouldBulk) flushId = setTimeout(flush, 10);

		await serializingItems;
		serializingItemsDone = true;

		if (shouldBulk) {
			// TODO: implement empty operations support & API
			if (inputs.length > 0) await this.createOperations([{inputs, options}], meta);
		} else {
			// Serializing is done, flush the last batch immediately
			if (flushId) clearTimeout(flushId);
			flush();
			// Await the last operations creating promise created by flush
			await creatingOperations;
		}

		action(() => {
			const addingJobs = this.addingJobs() - 1;
			this.addingJobs(addingJobs);
			if (addingJobs < 1) {
				for (const listener of this.addingListeners) listener(this._added);
				this._added = 0;
			}
		});
	}

	/**
	 * Creates operations out of payloads, operation preparation queue, which batches, and periodically
	 * flushes prepared operations into queue.
	 * Also detects if preparation action runs too long, and if there is too
	 * many operations in queue, asks user to cancel.
	 */
	createOperations = async (payloads: OperationPayload[], meta: PreparatorMeta, moreComing?: boolean) => {
		const processor = this.processor();

		if (!processor) throw new Error(`Processor missing.`);

		const queue = this.preparationQueue;
		const isProcessing = queue.length > 0;

		action(() => {
			for (const payload of payloads) queue.push(new Operation(payload, this, this.store));
		});

		// If queue wasn't empty, it means we are already adding operations
		// below, so appending to the queue is all this call needed to do.
		if (isProcessing) return this.preparationPromise;

		const [promise, resolve] = makePromise();
		const hasPreparator = processor.hasPreparator;
		const maxAcceptableDuration = 1000 * 60;
		let index = 0;
		let done = false;
		const preparedBatch: Operation[] = [];
		let userPrompted = false;

		const prompt = async (lastDuration: number) => {
			const moreThan = moreComing ? 'more than ' : '';
			const {canceled, payload} = await this.store.modals.create({
				title: `Precaution!`,
				message: `<p>You've dropped ${moreThan}<strong>${
					queue.length
				}</strong> items into a profile that'll run a preparation action on all of them.</p><p>The last one took <strong>${formatDuration(
					lastDuration
				)}</strong>.<br>If the rest follows suite, it'll take ${moreThan}<strong>${formatDuration(
					lastDuration * queue.length
				)}</strong> to complete.</p><p>Do you want to proceed?</p>`,
				actions: [
					{
						variant: 'danger',
						icon: 'x',
						title: 'Cancel',
						focused: true,
						payload: false,
					},
					{
						variant: 'success',
						icon: 'check',
						title: 'Proceed',
						payload: true,
					},
				],
			}).promise;
			return !canceled && payload;
		};

		const prepare = async (operation: Operation) => {
			if (await this.prepareOperation(operation, meta)) preparedBatch.push(operation);
		};

		// Flushing because operations needs to go through an async preparation
		// step, and in most cases where preparators are instant, adding them
		// one after another would mean reactive trashing of UI.
		let flushId: NodeJS.Timeout;
		const flush = createAction(() => {
			for (const operation of preparedBatch) this.addOperation(operation);
			this.store.worker.requestFillThreads();
			preparedBatch.length = 0;
			if (!done) flushId = setTimeout(flush, 300);
		});

		// First flush should be fast
		flushId = setTimeout(flush, 10);

		while (index < queue.length) {
			const operation = queue[index++]!;

			// Detect long running preparations and consult the user
			if (hasPreparator && !userPrompted) {
				const startTime = Date.now();
				await prepare(operation);
				const duration = Date.now() - startTime;

				// The preparation would take too long, ask the user if they want to cancel
				if (duration > 100 && duration * (queue.length - index) > maxAcceptableDuration) {
					userPrompted = true;
					const shouldProceed = await prompt(duration);
					if (!shouldProceed) break;
				}
			} else {
				await prepare(operation);
			}
		}

		clearTimeout(flushId);
		flush();

		queue.length = 0;
		done = true;
		resolve();

		return promise;
	};

	addOperation = (operation: Operation) => {
		this.store.operations.addOperation(operation);
		this.batch.increment();
		this._added += 1;
	};

	/**
	 * Asks processor to prepare the operation payload.
	 * Returns boolean specifying whether the operation should proceed and be
	 * added to the queue.
	 */
	prepareOperation = async (operation: Operation, meta: PreparatorMeta) => {
		const processor = this.processor();

		if (!processor) throw new Error(`Can't prepare operation, profile's processor is missing.`);

		const preparator = processor.config?.operationPreparator;

		if (!preparator) return true;

		try {
			const preparedPayload = await preparator(operation.payload, {
				...meta,
				title: (value: string | undefined | null) => operation.title(value || null),
				dependencies: processor.dependencyPayloads(),
				settings: {
					fontSize: this.store.settings.fontSize(),
					theme: this.store.settings.theme(),
					compact: this.store.settings.compact(),
					developerMode: this.store.settings.developerMode(),
					editCommand: this.store.settings.editCommand(),
				},
				nodePath: this.store.node.nodePath,
				dataPath: processor.plugin.dataPath,
				...this.store.modals.commonModals(processor.plugin),
			});

			if (preparedPayload) operation.payload = preparedPayload;

			return !!preparedPayload;
		} catch (error) {
			const reportUrl = operation.profile.plugin()?.reportIssueUrl;
			const errorMessage = eem(error, true);
			this.store.events
				.create({
					title: 'Operation preparator error',
					variant: 'danger',
					message: `Processor ${processor.id}'s operation preparator threw an error. Operation was not processed.`,
					details: errorMessage,
					actions: reportUrl
						? [
								{
									icon: 'bug',
									title: 'Report issue',
									action: () =>
										reportIssue(reportUrl, {
											title: 'Preparator error',
											body: `Hi. The \`${this.processorId}\` processor's operation preparator has throw this error:\n\n\`\`\`\n${errorMessage}\n\`\`\``,
										}),
								},
						  ]
						: undefined,
				})
				.open();

			return false;
		}
	};

	stop = () => this.store.worker.stop(this);

	handleDragStart = createAction((event: TargetedEvent<HTMLElement, DragEvent>) => {
		// Fall through when there is already something inside dataTransfer
		if (event.dataTransfer == null || event.dataTransfer.items.length !== 0) return;
		event.dataTransfer.setData('profile', this.id);
		const {left} = event.currentTarget.getBoundingClientRect();
		this.store.app.draggingMeta({
			offsetX: event.x - left,
			width: this.position.value.width,
			profileId: this.id,
		} as ProfileDraggingMeta);
		this.isDragged(true);
	});

	handleDragEnter = createAction((event: DragEvent) => {
		// If event triggered on a droppable child, toggle off isDraggedOver
		const interceptor = findDatasetAncestor(event.target as HTMLElement, 'droppable');
		if (interceptor && interceptor !== event.currentTarget) {
			this.isDraggedOver(false);
			return;
		}

		if (this.isDraggedOver()) return;
		// Ensure all other profiles are not marked as draggedOver, since dragLeave events are unreliable
		this.store.profiles.resetDraggedOver();
		this.isDraggedOver(true);
	});

	handleDragLeave = createAction((event: DragEvent) => {
		const {clientX: x, clientY: y, currentTarget} = event;

		if (!(currentTarget instanceof Element)) return;

		const {top, left, right, bottom} = currentTarget.getBoundingClientRect();

		// Disable isDraggedOver only when cursor truly left the current target
		if (x < left || x >= right || y < top || y >= bottom) this.isDraggedOver(false);
	});

	pasteFromClipboard = async (modifiers = '') => {
		this.dropItems(await serialize.electronClipboard(), {modifiers, action: 'paste'});
	};

	handlePaste = async (event: ClipboardEvent) => {
		this.dropItems(await serialize.dataTransfer(event.clipboardData), {modifiers: '', action: 'paste'});
	};

	handleDrop = createAction(async (event: DragEvent) => {
		if (!event.dataTransfer) return;

		const modifiers = idModifiers(event);
		const droppedProfileId = event.dataTransfer.getData('profile');
		const dropType = droppedProfileId ? 'profile' : undefined;

		if (!this.isReady() && dropType !== 'profile') {
			this.store.events
				.create({
					variant: 'warning',
					title: `Profile drop error`,
					message: `Profile "${this.displayTitle()}" is not ready. You need to resolve its issues before you can drop items into it.`,
				})
				.open();
			return;
		}

		// Internal drag events.
		if (dropType) {
			switch (dropType) {
				case 'profile':
					const draggedProfile = this.store.profiles.byId().get(droppedProfileId);
					if (draggedProfile) {
						const draggedCategoryId = draggedProfile.categoryId();
						const draggedPosition = {...draggedProfile.position()};
						draggedProfile.categoryId(this.categoryId());
						draggedProfile.position(this.position());
						this.categoryId(draggedCategoryId);
						this.position(draggedPosition);
					}
					break;
			}
			return;
		}

		// Drag events started externally.
		let items = await serialize.dataTransfer(event.dataTransfer);
		if (items.length > 0) this.dropItems(items, {modifiers, action: 'drop'});

		// Consume the drop event data by replacing it with empty one
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as any)?.parentElement?.dispatchEvent?.(new DragEvent('drop', {bubbles: true}));
	});

	/**
	 * Delete all operation history for this profile.
	 */
	clearHistory = () => this.store.operations.clearHistory(this);

	clearQueue = () => this.store.operations.clearQueue(this);

	delete = (options?: {noToast?: boolean}) => this.store.profiles.delete(this.id, options);

	openInEditor = () => this.store.app.openInEditor(Path.join(this.store.plugins.path, this.id));

	toJSON(): SerializedProfile {
		return {
			id: this.id,
			processorId: this.processorId,
			title: this.title(),
			createdAt: this.createdAt,
			commonOptions: toJS(this.commonOptions),
			options: toJS(this.optionsData),
			version: this.version(),
			position: this.position(),
		};
	}
}

export class Category {
	store: Store;
	id: string;
	title: Signal<string>;

	constructor({id, title}: {id: string; title: string}, store: Store) {
		this.store = store;
		this.id = id;
		this.title = signal(title);
	}

	copyData = () => ({id: this.id, title: this.title(), position: this.store.profiles.categories.all().indexOf(this)});

	profiles = computed(() => this.store.profiles.all().filter((profile) => profile.categoryId() === this.id));

	rows = computed(() => {
		const rows: Profile[][] = [];

		for (const profile of this.profiles()) {
			const rowIndex = profile.position().row;
			let arr = rows[rowIndex];
			if (!arr) arr = rows[rowIndex] = [];
			arr.push(profile);
		}

		// Ensure all rows are filled and ordered
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i];
			if (!row) {
				row = rows[i] = [];
			} else {
				row.sort((a, b) => {
					const aLeft = a.position().left;
					const bLeft = b.position().left;
					if (aLeft < bLeft) return -1;
					if (aLeft > bLeft) return 1;
					return 0;
				});
			}
		}

		return rows;
	});

	insertRowAt = createAction((index: number) => {
		for (const profile of this.profiles()) {
			const {row} = profile.position();
			if (row >= index) profile.position.edit((position) => (position.row += 1));
		}
	});

	deleteRow = createAction((index: number) => {
		for (const profile of this.profiles()) {
			const {row} = profile.position();
			if (row === index) profile.delete();
			if (row > index) profile.position.edit((position) => (position.row -= 1));
		}
	});

	isSlotFree = (slot: ProfileGridPosition, ignoreProfileId?: string) => {
		const slotRight = slot.left + slot.width;
		const row = this.rows()[slot.row];

		if (slot.left < 0 || slotRight > 1 + gridPrecision) return false;
		if (!row || row.length === 0) return true;

		for (const profile of row) {
			if (profile.id === ignoreProfileId) continue;
			const {left, width} = profile.position();
			const right = left + width;
			const leftLeftDelta = left - slot.left;
			const leftRightDelta = left - slotRight;
			const rightLeftDelta = right - slot.left;
			const rightRightDelta = right - slotRight;

			if (
				Math.abs(leftLeftDelta) < gridPrecision ||
				Math.abs(rightRightDelta) < gridPrecision ||
				(leftLeftDelta > gridPrecision && leftRightDelta < -gridPrecision) ||
				(rightLeftDelta > gridPrecision && rightRightDelta < -gridPrecision) ||
				(leftLeftDelta < -gridPrecision && rightRightDelta > gridPrecision)
			) {
				return false;
			}
		}

		return true;
	};

	/**
	 * Returns the slot if it fits where it wants to, or moves it around the row
	 * to the nearest free gap. Optionally can also resize the slot to fit gaps
	 * smaller than it's current width.
	 *
	 * Returns `undefined` if there's no gap big enough in slot's row.
	 */
	reslotInRow = (
		slot: ProfileGridPosition,
		{
			ignoreProfileId,
			refit = false,
			minWidth = 0.1,
			nearestGapOnly = false,
			nearestGapMaxDistance = Infinity,
		}: {
			ignoreProfileId?: string;
			/** Wether the re-slotting should be allowed to lower the width. */
			refit?: boolean;
			/** Min allowed width when refitting. */
			minWidth?: number;
			/**
			 * Tells the algorithm to only consider gap nearest to the passed slot.
			 * Helpful for finding a drop zone when drag & dropping profiles.
			 */
			nearestGapOnly?: boolean;
			/**
			 * When only the nearest gap is requested, this is the max allowed
			 * distance the gap is allowed to be from the passed slot's center
			 * for us to consider it.
			 */
			nearestGapMaxDistance?: number;
		} = {}
	) => {
		const row = this.rows()[slot.row];

		if (!row || row.length === 0) return normalizeProfilePosition(slot);

		// Find all free slots (gaps) in row
		const slotCenter = slot.left + slot.width / 2;
		const gaps: ProfileGridPosition[] = [];
		const positions = [
			{row: slot.row, left: 0, width: 0},
			...(ignoreProfileId ? row.filter((profile) => profile.id !== ignoreProfileId) : row).map(
				(profile) => profile.position.value
			),
			{row: slot.row, left: 1, width: 0},
		];

		// If there's no items in the row to move around, just return the slot
		if (positions.length === 2) return normalizeProfilePosition(slot);

		for (let i = 0; i < positions.length - 1; i++) {
			const prev = positions[i]!;
			const next = positions[i + 1]!;
			let prevEnd = prev.left + prev.width;
			let nextStart = next.left;
			const availableSpace = nextStart - prevEnd;

			// We found a space that is non-zero-ish, add it to the list of gaps
			if (availableSpace > gridPrecision * 10) {
				gaps.push({row: slot.row, left: prevEnd, width: availableSpace});
			}
		}

		// If only nearest gap should be considered, find it and pass it alone
		let gapsOfInterest: ProfileGridPosition[];
		if (nearestGapOnly) {
			let nearestGap: ProfileGridPosition | undefined;

			for (let gap of gaps) {
				if (!nearestGap) {
					const distance = get1DPointToLineDistance(slotCenter, gap.left, gap.width);
					if (distance <= nearestGapMaxDistance) nearestGap = gap;
				} else {
					const nearestDistance = get1DPointToLineDistance(slotCenter, nearestGap.left, nearestGap.width);
					const gapDistance = get1DPointToLineDistance(slotCenter, gap.left, gap.width);
					if (gapDistance < nearestDistance && gapDistance <= nearestGapMaxDistance) {
						nearestGap = gap;
					}
				}
			}

			if (nearestGap) gapsOfInterest = [nearestGap];
			else return;
		} else {
			gapsOfInterest = gaps;
		}

		// Lets loop through free slots and find the best match
		let bestSlotMatch: {distance: number; slot: ProfileGridPosition} | undefined;

		for (let gap of gapsOfInterest) {
			const gapCenter = gap.left + gap.width / 2;
			const gapDistance = slotCenter - gapCenter;
			const gapDistanceAbs = Math.abs(gapDistance);

			if (gapDistanceAbs > (bestSlotMatch?.distance || Infinity) || minWidth - gap.width > gridPrecision) {
				continue;
			}

			let slotMatch: ProfileGridPosition | undefined;

			if (slot.width - gap.width > gridPrecision) {
				if (!refit) continue;
				slotMatch = gap;
			} else {
				slotMatch = {
					...slot,
					left: clamp(gap.left, slot.left, gap.left + gap.width - slot.width),
				};
			}

			bestSlotMatch = {distance: gapDistanceAbs, slot: slotMatch};
		}

		let finalSlot = bestSlotMatch?.slot;
		if (finalSlot) return normalizeProfilePosition(finalSlot);
	};

	getFreeSlot = (suggested?: {row?: number; left?: number; width?: number}, forceRow?: boolean | undefined) => {
		const rows = this.rows();
		const rowIsSuggested = suggested?.row != null;
		const maxColumns = this.store.settings.profilesGridColumns();
		const slot = normalizeProfilePosition({
			row: suggested?.row ?? 0,
			left: suggested?.left ?? 0,
			width: suggested?.width ?? getCardWidthFraction(maxColumns),
		});

		// Basic validation
		if (!Number.isInteger(slot.row) || slot.row < 0) {
			throw new Error(`Suggested row "${slot.row}" is invalid.`);
		}
		if (
			typeof slot.left !== 'number' ||
			!Number.isFinite(slot.left) ||
			slot.left < 0 ||
			slot.left + slot.width > 1 + gridPrecision
		) {
			throw new Error(`Suggested left "${slot.left}" is invalid.`);
		}
		if (typeof slot.width !== 'number' || !Number.isFinite(slot.width) || slot.width <= 0 || slot.width > 1) {
			throw new Error(`Suggested width "${slot.width}" is invalid.`);
		}

		// If suggested fits into an empty space, use that
		if (this.isSlotFree(slot)) return slot;

		// Try finding a free slot, starting at suggested row
		for (let i = slot.row; i < rows.length; i++) {
			slot.row = i;
			const reslot = this.reslotInRow(slot);
			if (reslot) return normalizeProfilePosition(reslot);
			// If row was requested and there is no free space, stop searching
			// for free row by breaking here, and let the next step create the
			// new row below the suggested one.
			if (rowIsSuggested || forceRow) break;
		}

		// Place on new row
		if (forceRow) {
			this.insertRowAt(slot.row);
		} else {
			slot.row += 1;
			const nextRow = rows[slot.row];
			if (!nextRow || nextRow.length > 0) this.insertRowAt(slot.row);
		}

		return normalizeProfilePosition(slot);
	};
}

export class Categories {
	store: Store;
	all = signal<Category[]>([]);
	byId = signal<Map<string, Category>>(new Map());

	constructor(store: Store) {
		this.store = store;
	}

	clear = () => {
		this.all([]);
		this.byId.edit((byId) => byId.clear());
	};

	create = createAction(
		({title, id: rawId, position: rawPosition}: {title: string; id?: string; position?: number}) => {
			const id = rawId || uid();
			const position = rawPosition == null || rawPosition < 0 ? Infinity : rawPosition;
			const category = new Category({id, title}, this.store);
			this.all.edit((all) => all.splice(position, 0, category));
			this.byId.edit((byId) => byId.set(id, category));
			return category;
		}
	);

	/**
	 * Ask user before deleting categories that have profiles.
	 */
	deleteMaybe = async (id: string) => {
		const category = this.byId().get(id);
		if (!category) return;
		const profilesCount = category.profiles().length;
		if (
			profilesCount === 0 ||
			(
				await this.store.modals.confirm({
					title: `Delete profiles tab`,
					message: `Profiles tab "${category.title()}" has ${profilesCount} profiles inside. Delete anyway?`,
				})
			).payload
		) {
			this.delete(id);
		}
	};

	delete = createAction((id: string) => {
		const activeCategoryId = this.store.settings.profileCategory();
		const activeCategoryIndex = this.all().findIndex((category) => category.id === activeCategoryId);
		const count = this.all().length;
		const category = this.byId().get(id);

		if (!category) throw new Error(`Category "${id}" doesn't exist.`);
		if (count <= 1) throw new Error(`Can't delete last category.`);

		// Delete profiles
		for (const profile of category.profiles()) profile.delete({noToast: true});

		// Delete category
		this.byId.edit((byId) => byId.delete(id));
		this.all.edit((all) => arrayDeleteValue(all, category));

		// Activate category next to deleted one
		if (category.id === activeCategoryId) {
			this.store.settings.profileCategory(this.all()[Math.max(0, activeCategoryIndex - 1)]!.id);
		}
	});

	move = createAction((from: number, to: number) =>
		this.all.edit((all) => {
			const category = all[from];

			if (!category || all.length === 0 || from < 0 || from >= all.length || to < 0 || to >= all.length) {
				throw new Error(`Categories.move arguments outside categories size limits.`);
			}

			all.splice(from, 1);
			all.splice(to, 0, category);
		})
	);

	swap = createAction((a: number, b: number) =>
		this.all.edit((all) => {
			if (!all[a] || !all[b]) throw new Error(`Categories.swap arguments outside limits.`);
			const tmpA = all[a]!;
			all[a] = all[b]!;
			all[b] = tmpA;
		})
	);
}

export class Profiles {
	storeFilePath: string;
	store: Store;
	all = signal<Profile[]>([]);
	byId = signal<Map<string, Profile>>(new Map());
	[Symbol.iterator] = () => this.all()[Symbol.iterator]();
	categories: Categories;
	changeReactionDisposer: Disposer | null = null;
	byPluginIdComputedSignals: Map<string, Computed<Profile[]>> = new Map();

	constructor(storeFilePath: string, store: Store) {
		this.store = store;
		this.storeFilePath = storeFilePath;
		this.categories = new Categories(store);
	}

	/**
	 * 0-1 floating progress of all profiles.
	 */
	progress = computed(() => {
		const pendingOperations = this.store.operations.pending();
		let total = 0;
		let done = 0;

		if (pendingOperations.length === 0) return 0;

		for (const {batch} of this.all()) {
			const itemsCount = batch.items().length;
			const index = batch.index();
			if (itemsCount > index) {
				total += itemsCount;
				done += index;
			}
		}

		for (const operation of pendingOperations) {
			const progress = operation.progress();
			if (progress != null) done += progress;
		}

		return clamp(0, done / total, 1);
	});

	byPluginId = (id: string) => {
		let pluginProfilesSignal = this.byPluginIdComputedSignals.get(id);
		if (!pluginProfilesSignal) {
			pluginProfilesSignal = computed(() =>
				this.all()
					.filter((profile) => profile.processorName === id)
					.sort((a, b) => (a.title < b.title ? -1 : 1))
			);
			this.byPluginIdComputedSignals.set(id, pluginProfilesSignal);
		}
		return pluginProfilesSignal();
	};

	startWatching = () => {
		if (this.changeReactionDisposer) return;

		// Auto-save profiles data file
		this.changeReactionDisposer = reaction(
			() => this.toJSON(),
			debounce((data) => outputJson(this.storeFilePath, data, {space: 2}), 300)
		);
	};

	stopWatching = () => {
		this.changeReactionDisposer?.();
	};

	load = createAction(async () => {
		try {
			// Check if we can safely reload
			if (this.store.operations.pending().length > 0) {
				throw new Error(`Can't reload profiles when operations are pending.`);
			}

			// Cleanup
			for (let profile of this.all()) profile.destroy();
			this.all.edit((all) => (all.length = 0));
			this.byId.edit((byId) => byId.clear());

			// Load from file
			let storedData: any;
			try {
				storedData = await readJson(this.storeFilePath);
			} catch {}

			// MIGRATIONS
			// V1
			const columns = this.store.settings.profilesGridColumns();
			if (isV1(storedData)) storedData = migrateV1ToV2(storedData, columns);

			// Populate with empty default category when empty
			const storedProfiles: V2 = isV2(storedData) ? storedData : [{id: 'main', title: 'Main', profiles: []}];

			for (const {profiles, ...data} of storedProfiles) {
				const category = this.categories.create(data);
				for (const profile of profiles) this.create({...profile, categoryId: category.id});
			}

			// Activate first category
			action(() => {
				const {profiles, settings} = this.store;
				const firstCategory = profiles.categories.all()[0];
				if (!profiles.categories.byId().has(settings.profileCategory()) && firstCategory) {
					settings.profileCategory(firstCategory.id);
				}
			});
		} catch (error) {
			if ((error as any)?.code !== 'ENOENT') {
				console.error(`profiles.load():`, error);
			}
		}
	});

	/**
	 * Sets all profiles' draggedOver flag to false.
	 * This is needed because dragLeave events are unreliable.
	 */
	resetDraggedOver = createAction(() => {
		for (const profile of this.all()) profile.isDraggedOver(false);
	});

	create = createAction((data: SetRequired<Partial<SerializedProfile>, 'processorId'> & {categoryId?: string}) => {
		if (data.id && this.byId().has(data.id)) {
			throw new Error(`Attempt to create a profile with already existing ID "${data.id}".`);
		}

		const categoryId = data.categoryId || this.store.settings.profileCategory();
		const category = this.categories.byId().get(categoryId);

		if (!category) throw new Error(`Category ID "${categoryId}" doesn't exist.`);

		const pluginVersion = this.store.processors.byId().get(data.processorId)?.plugin?.version;
		const profile = new Profile(
			{
				...data,
				id: data.id || uid(),
				categoryId,
				version: data.version || pluginVersion || '0.0.0',
			},
			this.store
		);

		this.all.edit((all) => all.push(profile));
		this.byId.edit((byId) => byId.set(profile.id, profile));

		return profile;
	});

	duplicate = createAction((profileId: string) => {
		const profile = this.byId().get(profileId);
		if (!profile) throw new Error(`Can't duplicate, profile "${profileId}" doesn't exist.`);
		const copyData = profile.copyData();
		const newTitle = copyData.title
			? String(copyData.title).replace(/ *(#(\d+))? *$/, (match, p1, p2) => ` #${Number(p2 || 1) + 1}`)
			: '';
		const newProfile = this.create({
			...copyData,
			title: newTitle,
		});

		// If duplicate was requested from original profile's page, navigate to the new profile
		if (this.store.history.location.path === `/profiles/${profileId}`) {
			this.store.history.push(`/profiles/${newProfile.id}`);
		}

		return newProfile;
	});

	delete = createAction((profileId: string, {noToast}: {noToast?: boolean} = {}) => {
		const profile = this.byId().get(profileId);

		if (!profile) return;

		if (profile.hasPendingOperations()) {
			this.store.events
				.create({
					variant: 'danger',
					title: 'Profile deletion error',
					message: `Can't delete a profile with pending operations.`,
				})
				.open();
			return;
		}

		const displayTitle = profile.displayTitle();
		const copyData = profile.copyData();
		const categoryData = profile.category().copyData();

		profile.destroy();

		const undo = createAction(() => {
			// Profile already exists, user probably clicked the action multiple times
			if (this.byId().has(profileId)) return;

			// Recreate category when necessary
			const categories = this.store.profiles.categories;
			if (!categories.byId().has(copyData.categoryId)) categories.create(categoryData);

			const newProfile = this.create({...copyData});

			event.delete();

			makeToast({
				message: 'Profile restored',
				variant: 'info',
				action: {
					variant: 'info',
					title: 'Go to',
					action: () => this.store.history.push(`/profiles/${newProfile.id}`),
				},
			});
		});

		// Create undo toast
		if (!noToast) {
			makeToast({
				message: 'Profile deleted',
				variant: 'info',
				action: {variant: 'info', title: 'Undo', action: undo},
			});
		}

		// Create event
		const event = this.store.events.create({
			variant: 'info',
			icon: 'trash',
			title: 'Profile deleted',
			message: `Profile "${displayTitle}" was deleted. Click undo below if that was a mistake.`,
			actions: [{variant: 'info', icon: 'undo', title: 'Undo', action: undo}, 'close'],
		});

		// Delete it from collections
		this.byId.edit((byId) => byId.delete(profileId));
		this.all.edit((all) => arrayDeleteValue(all, profile));
	});

	toJSON(): V2 {
		return this.categories.all().map((category) => ({
			id: category.id,
			title: category.title(),
			profiles: category.profiles().map((profile) => profile.toJSON()),
		}));
	}
}

/**
 * Utils.
 */

export function normalizeProfilePosition(position: ProfileGridPosition) {
	position.row = Math.max(0, position.row);
	position.width = roundDecimals(clamp(0, position.width, 1), 6);
	position.left = roundDecimals(clamp(0, position.left, 1 - position.width), 6);
	return position;
}

export function isProfileDraggingMeta(value: any): value is ProfileDraggingMeta {
	return (
		value &&
		typeof value === 'object' &&
		typeof value.profileId === 'string' &&
		typeof value.offsetX === 'number' &&
		typeof value.width === 'number'
	);
}

export function getColumnSpanStart(value: number, columnSize: number, precision = 0.00002) {
	let column = Math.floor(value / columnSize);
	let leftover = value % columnSize;
	if (columnSize - leftover > precision) column++;
	return column;
}

export function getColumnSpanEnd(value: number, columnSize: number, precision = 0.00002) {
	let column = Math.floor(value / columnSize);
	let leftover = value % columnSize;
	if (leftover > precision) column++;
	return column;
}

/**
 * Calculates an effective width fraction of a profile card out of number of max
 * columns and suggested width.
 */
export function getCardWidthFraction(columns: number, suggestedWidth = 200) {
	const pixelsPerColumn = Math.round(window.innerWidth / columns);
	const suggestedColumns = Math.round(suggestedWidth / pixelsPerColumn);
	return roundDecimals(Math.max(1 / columns, suggestedColumns / columns), 6);
}

/**
 * Migrations.
 */

type V1 = {
	id: string;
	processorId: string;
	title?: string;
	commonOptions?: OptionsData;
	options?: OptionsData;
	version: string;
}[];

type V2 = {
	id: string;
	title: string;
	profiles: SerializedProfile[];
}[];

/**
 * Version checks must check for existence of at least one data item.
 */

function isV1(obj: any): obj is V1 {
	const first = obj?.[0];
	return (
		obj &&
		Array.isArray(obj) &&
		first &&
		typeof first === 'object' &&
		typeof first.processorId === 'string' &&
		typeof first.id === 'string'
	);
}

function isV2(obj: any): obj is V2 {
	const first = obj?.[0];
	return obj && Array.isArray(obj) && first && typeof first === 'object' && Array.isArray(first.profiles);
}

function migrateV1ToV2(v1: V1, columns: number): V2 {
	const profiles: SerializedProfile[] = [];
	const result: V2 = [{id: 'main', title: 'Main', profiles}];
	const width = 1 / Math.round(1 / getCardWidthFraction(columns));

	let row = 0;
	let left = 0;

	for (const profile of v1) {
		if (left + width > 1) {
			row++;
			left = 0;
		}
		profiles.push({...profile, position: {row, left, width}});
		left += width;
	}

	return result;
}
