import {h} from 'preact';
import {Signal, signal, computed, createAction, action} from 'statin';
import {eem, arrayDeleteValue} from 'lib/utils';
import {Store} from 'models/store';
import {createProgress, Progress, ProgressData} from 'models/progress';
import {Action} from 'components/Actions';
import {StagingModal} from 'components/StagingModal';

let id = 0;

export type StagingDescriptor = {title: string; skipModal?: boolean} & (
	| {target: 'plugins'; action: 'install' | 'uninstall' | 'setup'; ids: string[]}
	| {target: 'plugins'; action: 'create'; ids: string[]} // (re)loading plugins
	| {target: 'plugins'; action: 'load'} // (re)loading plugins
	| {target: 'dependency'; action: 'install'; ids: string[]}
	| {target: 'node'; action: 'install'}
	| {target: 'development'; action: 'mocking'}
	| {target: 'app'; action: 'update'}
);

export type SubstageCreator = (descriptor: StagingDescriptor) => Staging;

export type StagingSubscriber = (staging: Staging) => void;

export class Staging {
	store: Store;
	id: number;
	descriptors = signal<StagingDescriptor[]>([]);
	stageName = signal<string | null>(null);
	progressData = signal<ProgressData | null | undefined>(undefined);
	progress: Progress;
	logs = signal<string[]>([]);
	errors = signal<string[]>([]);
	isDone = signal<boolean>(false);
	expandLogs: Signal<boolean>;
	actions?: Action[];
	created: number;
	ended?: number;
	subscribers = new Set<StagingSubscriber>();

	constructor(store: Store, descriptor: StagingDescriptor) {
		this.store = store;
		this.id = id++;
		this.descriptors.edit((all) => all.push(descriptor));
		this.created = Date.now();
		this.progress = createProgress(createAction((data) => this.progressData(data)));
		this.expandLogs = signal(this.store.settings.expandStagingLogs() === 'always');
	}

	hasError = computed(() => this.errors().length > 0);

	title = computed(() => {
		const descriptors = this.descriptors();
		return descriptors[descriptors.length - 1]!.title;
	});

	guard = () => {
		if (this.isDone()) throw new Error(`Stale staging method called.`);
	};

	log = createAction((...args: any[]) => {
		this.guard();
		const message = args
			.map((value) =>
				value && Buffer.isBuffer(value)
					? `${value}`
					: typeof value === 'object'
					? JSON.stringify(value, null, 2)
					: `${value}`
			)
			.join(' ');
		this.logs.edit((lines) => lines.push(...message.split('\n')));
	});

	error = createAction((error: string | Error | Buffer) => {
		this.guard();
		const string = eem(error, true);
		this.errors.edit((errors) => errors.push(string));
		this.log(string);
		if (this.store.settings.expandStagingLogs() === 'error') this.expandLogs(true);
	});

	stage = createAction((name: string | null) => {
		this.guard();
		this.stageName(name);
		if (name) this.log(`\n______________________________\n>> ${name}\n`);
	});

	substage = async (makeSubstage: (substage: SubstageCreator) => unknown) => {
		let isDone = false;
		let substageDescriptor: StagingDescriptor | undefined;
		let done: (() => void) | undefined;
		let errorsCount = 0;

		await makeSubstage((descriptor: StagingDescriptor): Staging => {
			action(() => {
				substageDescriptor = descriptor;
				this.descriptors.edit((all) => all.push(descriptor));
				this.stage(null);
				this.progress(null);
				this.log(`\n______________________________\n>>>>>>>>>> SUBSTAGE >>>>>>>>>>\n>> ${descriptor.title}\n`);
			});

			done = createAction(() => {
				if (isDone) throw new Error(`done() called on stale substage "${descriptor.title}".`);
				isDone = true;
				this.stage(null);
				this.progress(null);
				this.descriptors.edit((all) => arrayDeleteValue(all, descriptor));
			});

			return {
				...this,
				error: (error: string | Error | Buffer) => {
					errorsCount++;
					this.error(error);
				},
				done,
			};
		});

		if (!isDone) {
			done?.();
			this.error(
				substageDescriptor
					? `Substage "${substageDescriptor.title}" didn't terminate.`
					: `Substage didn't start.`
			);
		}

		return isDone && errorsCount === 0;
	};

	subscribe = (subscriber: StagingSubscriber) => {
		if (this.isDone()) subscriber(this);
		else this.subscribers.add(subscriber);
		return () => this.unsubscribe(subscriber);
	};

	unsubscribe = (subscriber: StagingSubscriber) => this.subscribers.delete(subscriber);

	done = createAction(() => {
		this.guard();
		this.isDone(true);
		this.ended = Date.now();
		for (const subscriber of this.subscribers) subscriber(this);
	});
}

export class StagingController {
	store: Store;
	current = signal<Staging | undefined>(undefined);

	constructor(store: Store) {
		this.store = store;
	}

	isStaging = computed(() => {
		const current = this.current();
		return current != null && !current.isDone();
	});

	matchStaging = (
		target?: string,
		action?: string | string[],
		additionalCheck?: (descriptor: StagingDescriptor) => boolean
	) => {
		const current = this.current();

		if (current == null || current.isDone()) return null;

		const descriptors = current.descriptors();

		for (const descriptor of descriptors) {
			if (additionalCheck != null && !additionalCheck(descriptor)) continue;
			if (target != null && descriptor.target === target) {
				const matches =
					action == null
						? true
						: Array.isArray(action)
						? action.includes(descriptor.action)
						: descriptor.action === action;
				if (matches) return descriptor;
			}
		}

		return null;
	};

	start = createAction((descriptor: StagingDescriptor, inAction?: (staging: Staging) => void): Staging => {
		if (this.isStaging()) {
			const currentStaging = this.current()!;
			const currentJson = JSON.stringify(currentStaging.descriptors(), null, 2);
			const requestedJson = JSON.stringify(descriptor, null, 2);
			throw new Error(
				`Can't start staging while another is in progress.` +
					`\n\nCurrent staging descriptor:\n${currentJson}\n\nRequested staging descriptor:\n${requestedJson}`
			);
		}

		const staging = new Staging(this.store, descriptor);
		staging.subscribe(
			createAction(() => {
				const hasError = staging.hasError();
				const lines = staging.logs();
				this.store.events.create({
					title: staging.title(),
					icon: hasError ? 'x' : 'check',
					variant: hasError ? 'danger' : 'success',
					message: `Done, ${lines.length} logged lines${hasError ? ', contains errors' : ''}.`,
					details: lines.join('\n'),
					actions: staging.actions,
				});
				this.current(undefined);
			})
		);

		inAction?.(staging);
		this.current(staging);

		if (descriptor.skipModal !== true) {
			this.store.modals.create({
				cancellable: false,
				content: (modal) => <StagingModal modal={modal} staging={staging} />,
			});
		}

		return staging;
	});
}
