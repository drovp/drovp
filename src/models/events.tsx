import {signal, createAction} from 'statin';
import type {Store} from 'models/store';
import {Signal} from 'statin';
import {arrayDeleteValue} from 'lib/utils';
import {ModalActionLoose} from 'models/modals';
import {IconName} from 'components/Icon';

let id = 0;

export type EventVariant = Exclude<Variant, 'accent'>;

export interface EventData {
	icon?: IconName;
	title: string;
	message?: string;
	details?: string;
	variant?: EventVariant;
	actions?: ModalActionLoose[];
}

export class Event {
	store: Store;
	id: number;
	created: number;
	icon?: IconName;
	variant: EventVariant;
	title: string;
	message?: string;
	details?: string;
	actions?: ModalActionLoose[];

	constructor(data: EventData, store: Store) {
		this.store = store;
		this.id = id++;
		this.variant = data.variant || 'info';
		this.created = Date.now();
		this.icon = data.icon;
		this.title = data.title;
		this.message = data.message;
		this.details = data.details;
		this.actions = data.actions;
	}

	open = () => this.store.modals.alert(this);

	delete = () => this.store.events.delete(this.id);
}

export class Events {
	store: Store;
	byId = signal<Map<number, Event>>(new Map());
	all = signal<Event[]>([]);

	byType: Record<EventVariant, Signal<Event[]>> = {
		info: signal<Event[]>([]),
		success: signal<Event[]>([]),
		warning: signal<Event[]>([]),
		danger: signal<Event[]>([]),
	};

	constructor(store: Store) {
		this.store = store;
	}

	create = createAction((data: EventData) => {
		const event = new Event(data, this.store);
		this.byId.edit((byId) => byId.set(event.id, event));
		this.all.edit((all) => all.unshift(event));
		this.byType[event.variant].edit((all) => all.unshift(event));
		return event;
	});

	delete = createAction((id: number) => {
		const event = this.byId().get(id);
		if (event) {
			this.byId.edit((byId) => byId.delete(event.id));
			this.all.edit((all) => arrayDeleteValue(all, event));
			this.byType[event.variant].edit((all) => arrayDeleteValue(all, event));
		}
	});

	deleteAll = createAction(() => {
		this.all.edit((all) => (all.length = 0));
		this.byId.edit((byId) => byId.clear());
		for (const group of Object.values(this.byType)) group.edit((group) => (group.length = 0));
	});

	deleteType = createAction((name: EventVariant) => {
		const currentAll = this.all();
		const byId = this.byId();
		const all: Event[] = [];

		for (const event of currentAll) {
			if (event.variant !== name) {
				all.push(event);
			} else {
				byId.delete(event.id);
			}
		}

		this.byId.changed();
		this.all(all);
		this.byType[name]([]);
	});
}
