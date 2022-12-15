import {ipcRenderer} from 'electron';
import * as Path from 'path';
import {h, ComponentChild} from 'preact';
import {Signal, signal, createAction, action} from 'statin';
import {arrayDelete, makePromise, ucFirst, idModifiers} from 'lib/utils';
import {isVariant} from 'lib/validators';
import type {Action, ClickEvent} from 'components/Actions';
import type {Store} from 'models/store';
import type {Profile, ProfileGridPosition} from 'models/profiles';
import {Plugin} from 'models/plugins';
import {ProfileNew} from 'components/ProfileNew';
import {ProfileImport} from 'components/ProfileImport';
import {ProfileCreator} from 'components/ProfileCreator';
import {OptionsPrompt} from 'components/OptionsPrompt';
import {isOpenWindowOptions} from 'lib/validators';
import {OptionsData, OptionsSchema, OptionString, OpenWindowOptions, CommonModals} from '@drovp/types';

let id = 0;

export interface ModalActionOptional extends Omit<Action, 'action'> {
	payload?: unknown;
	cancels?: boolean;
	action?: Action['action'];
}

export type ModalActionShorthand = 'close' | 'cancel' | 'ok';

export type ModalActionLoose = ModalActionOptional | ModalActionShorthand;

export interface ModalAction extends Action {
	payload?: unknown;
	cancels?: boolean;
}

export interface ModalDataBase {
	variant?: Variant;
	title?: string;
	message?: string;
	details?: string;
}

export interface ModalData extends ModalDataBase {
	content?: ComponentChild | ((modal: Modal) => ComponentChild);
	actions?: ModalActionLoose[];
	sideActions?: ModalActionLoose[];
	/** `true` by default. */
	backgroundCancels?: boolean;
	/** `true` by default. */
	cancellable?: boolean;
}

export interface ModalResult<T = unknown> {
	canceled: boolean;
	payload: T;
	modifiers: string;
}

export interface ModalCleaner<T = unknown> {
	(meta: ModalResult<T>): Promise<void | null> | void | null;
}

export class Modal<T = unknown> {
	store: Store;
	id: number;
	variant: Signal<Variant | undefined>;
	title?: string;
	message?: string;
	details?: string;
	content?: ComponentChild | ((modal: Modal) => ComponentChild);
	actions?: ModalAction[];
	sideActions?: ModalAction[];
	backgroundCancels?: boolean;
	cancellable: Signal<boolean>;
	closed = false;
	ignoreButtonPayload = false;
	payload: T | null = null;
	modifiers: string = '';
	canceled = false;
	promise: Promise<ModalResult<T>>;
	/** Async actions that need to complete before modal gets removed from collection/DOM. */
	cleaners = new Set<ModalCleaner<T>>();
	resolve: (meta: ModalResult<T>) => void;

	constructor(data: ModalData, store: Store) {
		this.store = store;
		this.id = id++;
		this.variant = signal(data.variant);
		this.title = data.title;
		this.message = data.message;
		this.details = data.details;
		this.content = data.content;
		const actionMapper = makeLooseToActionMapper(this);
		this.actions = (data.actions || []).map(actionMapper);
		this.sideActions = (data.sideActions || []).map(actionMapper);
		this.backgroundCancels = data.backgroundCancels !== false;
		this.cancellable = signal(data.cancellable ?? true);
		const [promise, resolve] = makePromise<ModalResult<T>>();
		this.promise = promise;
		this.resolve = resolve;
	}

	setPayload = (payload: T) => {
		this.ignoreButtonPayload = true;
		this.payload = payload;
	};

	close = async ({canceled, modifiers}: {canceled?: boolean; modifiers?: string} = {}) => {
		if (this.closed) return;
		this.closed = true;
		this.canceled = canceled || false;
		if (modifiers) this.modifiers = modifiers;
		const meta = {canceled: canceled || false, payload: this.payload as T, modifiers: this.modifiers};
		this.resolve(meta);
		await Promise.all([...this.cleaners].map((cleaner) => cleaner(meta)));
		for (const callback of this.cleaners) callback(meta);
		this.store.modals.delete(this.id);
	};

	registerCleaner = (callback: ModalCleaner<T>) => {
		this.cleaners.add(callback);
		return () => this.unregisterCleaner(callback);
	};

	unregisterCleaner = (callback: ModalCleaner<T>) => {
		this.cleaners.delete(callback);
	};
}

export class Modals {
	store: Store;
	all = signal<Modal<any>[]>([]);

	constructor(store: Store) {
		this.store = store;
	}

	delete = createAction((id: number) => {
		this.all.edit((all) => arrayDelete(all, (modal) => modal.id === id));
	});

	closeAndDeleteAll = createAction(() => {
		for (const modal of this.all()) {
			if (modal.cancellable()) modal.close({canceled: true});
		}
	});

	create = createAction(<T extends unknown>(data: ModalData) => {
		const modal = new Modal<T>(data, this.store);
		this.all.edit((all) => all.push(modal));
		return modal;
	});

	/**
	 * Creates modal with OK button at the bottom.
	 */
	alert = async (data: ModalDataBase & {actions?: ModalData['sideActions']}) => {
		await this.create<void>({...data, actions: [{title: 'OK', focused: true}], sideActions: data.actions}).promise;
	};

	/**
	 * Creates modal with OK and Cancel buttons at the bottom, which resolves
	 * into true or false payload.
	 */
	confirm = (data: ModalDataBase) => {
		return this.create<boolean>({
			...data,
			actions: [
				{title: 'Cancel', payload: false, cancels: true, focused: true},
				{title: 'OK', payload: true},
			],
		}).promise;
	};

	/**
	 * Creates a prompt for a string input. Shorthand for promptOptions
	 */
	prompt = async (
		data: ModalDataBase,
		stringOptions?: Omit<OptionString, 'title' | 'description' | 'type' | 'name'>
	) => {
		const result = await this.promptOptions<{value: string}>(
			data,
			[{...stringOptions, preselect: true, name: 'value', type: 'string', title: false}],
			{submitOnEnter: true, autofocusCancel: false}
		);
		return {...result, payload: result.payload?.value || ''};
	};

	/**
	 * Creates modal with options interface for passed options schema. Resolves with serialized options data.
	 */
	promptOptions = <T extends OptionsData | undefined = undefined>(
		data: ModalDataBase,
		schema: OptionsSchema<T>,
		{submitOnEnter, autofocusCancel = true}: {submitOnEnter?: boolean; autofocusCancel?: boolean} = {}
	) => {
		return this.create<T>({
			...data,
			content: (modal) => (
				<OptionsPrompt
					schema={schema}
					onPayload={(payload) => modal.setPayload(payload)}
					onSubmit={submitOnEnter ? () => modal.close() : undefined}
				/>
			),
			actions: [
				{title: 'Cancel', payload: false, cancels: true, focused: autofocusCancel},
				{title: 'OK', payload: true},
			],
		}).promise;
	};

	/**
	 * Creates a modal with Cancel button at the bottom. Intended for displaying
	 * interfaces.
	 */
	present = <T extends unknown>(data: ModalDataBase) =>
		this.create<T>({...data, actions: [{title: 'Cancel', cancels: true}]}).promise;

	newProfile = async (props?: {categoryId?: string; position?: Partial<ProfileGridPosition>; pluginId?: string}) =>
		this.create<Profile>({
			title: `Select processor for new profile`,
			content: (modal) => <ProfileNew {...props} onPayload={modal.setPayload} onClose={modal.close} />,
		});

	profileImport = (props?: {initial?: string; categoryId?: string; position?: Partial<ProfileGridPosition>}) =>
		this.create<Profile>({
			content: (modal) => <ProfileImport {...props} onPayload={modal.setPayload} onClose={modal.close} />,
		});

	createProfile = (props?: {
		categoryId?: string;
		position?: Partial<ProfileGridPosition>;
		initialSection?: 'new' | 'import';
	}) =>
		this.create<Profile>({
			content: (modal) => <ProfileCreator {...props} onPayload={modal.setPayload} onClose={modal.close} />,
		});

	/**
	 * Constructs plugin related methods to be consumed by APIs.
	 */
	commonModals = (plugin: Plugin) =>
		({
			showOpenDialog: (options: Electron.OpenDialogOptions) =>
				ipcRenderer.invoke('show-open-dialog', options) as Promise<Electron.OpenDialogReturnValue>,
			showSaveDialog: (options: Electron.SaveDialogOptions) =>
				ipcRenderer.invoke('show-save-dialog', options) as Promise<Electron.OpenDialogReturnValue>,
			alert: (data: ModalDataBase) => this.store.modals.alert(sanitizeModalDataBase(data, 'Alert')),
			confirm: (data: ModalDataBase) => this.store.modals.confirm(sanitizeModalDataBase(data, 'Confirm')),
			prompt: (
				data: ModalDataBase,
				stringOptions?: Omit<OptionString, 'title' | 'description' | 'type' | 'name'>
			) => this.store.modals.prompt(sanitizeModalDataBase(data, 'Confirm'), stringOptions),
			promptOptions: <T extends OptionsData | undefined = undefined>(
				data: ModalDataBase,
				schema: OptionsSchema<T>
			) => this.store.modals.promptOptions<T>(sanitizeModalDataBase(data, 'Confirm'), schema),
			openModalWindow: (async (rawOptions: string | OpenWindowOptions, payload?: any) => {
				const options = typeof rawOptions === 'string' ? {path: rawOptions} : rawOptions;
				isOpenWindowOptions(options);
				const resolvedPath = Path.resolve(plugin.path, options.path);
				const relativePath = Path.relative(plugin.path, resolvedPath);
				if (!resolvedPath.startsWith(plugin.path)) {
					throw new Error(`Traversing up from plugin directory is not allowed.`);
				}
				action(() => this.store.app.isModalWindowOpen(true));
				const result = await ipcRenderer.invoke(
					'open-modal-window',
					{...options, id: `${plugin.name}/${relativePath}`, path: resolvedPath},
					payload
				);
				action(() => this.store.app.isModalWindowOpen(false));

				return result;
			}) as <T = unknown>(options: OpenWindowOptions, payload: any) => Promise<ModalResult<T>>,
		} as CommonModals);
}

function makeLooseToActionMapper<T extends unknown>(modal: Modal<T>) {
	return function (looseAction: ModalActionLoose) {
		let action: ModalActionOptional;

		switch (looseAction) {
			case 'ok':
				action = {title: 'OK', payload: true};
				break;
			case 'cancel':
			case 'close':
				action = {title: ucFirst(looseAction as string), payload: false, cancels: true};
				break;
			default:
				action = looseAction;
		}

		const result: ModalAction = {
			...action,
			action: (event: ClickEvent) => {
				if (!modal.ignoreButtonPayload) modal.payload = action.payload as T;
				modal.close({canceled: !!action.cancels, modifiers: idModifiers(event)});
				action.action?.(event);
			},
		};
		return result;
	};
}

export function sanitizeModalDataBase(data: any, defaultTitle: string): ModalDataBase {
	data = data || {};
	return {
		variant: isVariant(data.variant) ? data.variant : undefined,
		title: typeof data.title === 'string' ? data.title : defaultTitle,
		message: typeof data.message === 'string' ? data.message : undefined,
		details: typeof data.details === 'string' ? data.details : undefined,
	};
}
