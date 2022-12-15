import {signal, computed, createAction} from 'statin';
import {throttle, isType, Type} from 'lib/utils';
import type {Store} from 'models/store';
import type {Operation} from 'models/operations';
import type {Profile} from 'models/profiles';
import type * as Types from '@drovp/types';

export interface InternalItemBase {
	operation: Operation;
}

export type ItemFile = InternalItemBase & Types.ItemFile;
export type ItemDirectory = InternalItemBase & Types.ItemDirectory;
export type ItemBlob = InternalItemBase & Types.ItemBlob;
export type ItemString = InternalItemBase & Types.ItemString;
export type ItemUrl = InternalItemBase & Types.ItemUrl;
export type ItemError = InternalItemBase & Types.ItemError;
export type ItemWarning = InternalItemBase & Types.ItemWarning;

export type Item = ItemError | ItemWarning | ItemFile | ItemDirectory | ItemBlob | ItemString | ItemUrl;

export type SerializedInputItem =
	| Types.ItemFile
	| Types.ItemDirectory
	| (Omit<Types.ItemBlob, 'contents'> & {contents: string})
	| Types.ItemString
	| Types.ItemUrl;

export interface OutputsData {
	all: Item[];
	files: Item[];
	urls: Item[];
	strings: Item[];
	errors: Item[];
}

export interface OutputsInterface {
	data: () => OutputsData;
	clearHistory: () => void;
}

const INPUT_KINDS = ['file', 'directory', 'blob', 'string', 'url'];

export function inputItemValidator(item: unknown): item is Types.Item {
	if (!isType<{[key: string]: unknown}>(item, Type.Object)) throw new Error(`Not an object.`);

	const errors = [];

	if (!isType(item.id, Type.String)) errors.push(`"id" has to be a string.`);
	if (!isType(item.created, Type.Number)) errors.push(`"created" has to be a number.`);
	if (!isType<string>(item.kind, Type.String) || !INPUT_KINDS.includes(item.kind))
		errors.push(`"kind" has to be a string of: ${INPUT_KINDS.join(',')}`);

	switch (item.kind) {
		case 'file':
			if (!isType(item.type, Type.String)) errors.push(`"type" has to be a string.`);
			if (!isType(item.size, Type.Number)) errors.push(`"size" has to be a number.`);
		case 'directory':
			if (!isType(item.path, Type.String)) errors.push(`"path" has to be a string.`);
			break;
		case 'string':
			if (!isType(item.type, Type.String)) errors.push(`"type" has to be a string.`);
			if (!isType(item.contents, Type.String)) errors.push(`"contents" has to be a string.`);
			break;
		case 'url':
			if (!isType(item.url, Type.String)) errors.push(`"url" has to be a string.`);
			break;
	}

	return true;
}

export class Outputs implements OutputsInterface {
	store: Store;
	all = signal<Item[]>([]);
	files = signal<Item[]>([]); // files + missing-files + directories + missing-directories
	urls = signal<Item[]>([]);
	strings = signal<Item[]>([]);
	errors = signal<Item[]>([]); // errors + warnings
	types = ['files', 'urls', 'strings', 'errors'] as const;

	constructor(store: Store) {
		this.store = store;
	}

	data = computed<OutputsData>(() => ({
		all: this.all(),
		files: this.files(),
		urls: this.urls(),
		strings: this.strings(),
		errors: this.errors(),
	}));

	add = createAction((item: Item) => {
		this.all.edit((outputs) => outputs.push(item));

		switch (item.kind) {
			case 'file':
			case 'directory':
				this.files.edit((outputs) => outputs.push(item));
				break;
			case 'url':
				this.urls.edit((outputs) => outputs.push(item));
				break;
			case 'string':
				this.strings.edit((outputs) => outputs.push(item));
				break;
			case 'warning':
			case 'error':
				this.errors.edit((outputs) => outputs.push(item));
				break;
		}

		this.requestTrimHistory();
	});

	getFilteredItems = (predicate: (item: Item, index: number, all: Item[]) => boolean) => {
		const items: OutputsData = {all: [], files: [], urls: [], strings: [], errors: []};
		const all = this.all();

		for (let i = 0; i < all.length; i++) {
			const item = all[i]!;
			if (predicate(item, i, all)) {
				items.all.push(item);
				switch (item.kind) {
					case 'file':
					case 'directory':
						items.files.push(item);
						break;
					case 'url':
						items.urls.push(item);
						break;
					case 'string':
						items.strings.push(item);
						break;
					case 'warning':
					case 'error':
						items.errors.push(item);
						break;
				}
			}
		}

		return items;
	};

	queryProfile = (profile: Profile) => this.getFilteredItems((item) => item.operation.profile === profile);

	/**
	 * Filters model's items in place.
	 */
	filter = createAction((predicate: (item: Item, index: number, all: Item[]) => boolean) => {
		const items = this.getFilteredItems(predicate);
		for (const [key, array] of Object.entries(items)) this[key as keyof OutputsData](array);
	});

	clearHistory = () => this.trimHistory(0);

	requestTrimHistory = throttle(() => this.trimHistory(), 2000);

	/**
	 * Trim profile history to the limit defined in by history limit settings.
	 * Called automatically on each operation end.
	 * Trims both `this.operations()` and `this.errors()`.
	 * `this.errors()` is trimmed
	 */
	trimHistory = createAction((forcedLimit?: number) => {
		const limit = forcedLimit ?? this.store.settings.outputsHistoryLimit();
		const all = this.all();

		// Unless forcedLimit, we trim only when history overflows limit by more
		// than 1% so this doesn't have to run after every single item addition.
		if (all.length < (forcedLimit != null ? limit : limit * 1.01)) return;

		const removedElements = all.splice(0, all.length - limit);
		const newestDeletedOutput = removedElements[removedElements.length - 1];

		if (newestDeletedOutput == null) return;
		this.all.changed();

		const minCreated = newestDeletedOutput.created;

		// Trim errors
		for (const type of this.types) {
			this[type].edit((outputs) => {
				const keepStartIndex = outputs.findIndex((item) => item.created > minCreated);
				outputs.splice(0, keepStartIndex === -1 ? outputs.length : keepStartIndex);
			});
		}
	});
}

export class ProfileOutputs implements OutputsInterface {
	outputs: Outputs;
	profile: Profile;

	constructor(outputs: Outputs, profile: Profile) {
		this.outputs = outputs;
		this.profile = profile;
	}

	data = computed(() => this.outputs.queryProfile(this.profile));

	clearHistory = () => this.outputs.filter((item) => item.operation.profile !== this.profile);
}
