import Path from 'path';
import {signal, createAction, computed, Disposer, toJS} from 'statin';
import {eem, isType, Type} from 'lib/utils';
import {instructions as serializeInstructions} from 'lib/serialize';
import {optionsSchemaFromLax, createOptions} from 'models/options';
import type {Store} from 'models/store';
import type {Plugin} from 'models/plugins';
import type {ProfileGridPosition} from 'models/profiles';
import type {Issue} from 'components/Issues';
import type {ProcessorConfig, OptionsSchema, OptionsData} from '@drovp/types';

const CONFIG_BOOLEAN_OR_FUNCTIONS = ['bulk', 'parallelize'];
const CONFIG_FUNCTIONS = [
	'expandDirectory',
	'dropFilter',
	'operationPreparator',
	'operationMetaFormatter',
	'profileMetaUpdater',
	'profileMetaFormatter',
];
const CONFIG_ALL_PROPS = [
	...CONFIG_BOOLEAN_OR_FUNCTIONS,
	...CONFIG_FUNCTIONS,
	'main',
	'description',
	'instructions',
	'dependencies',
	'optionalDependencies',
	'accepts',
	'threadType',
	'threadTypeDescription',
	'modifierDescriptions',
	'keepAlive',
	'options',
];

export function validateProcessorConfig(config: unknown): config is ProcessorConfig {
	if (!isType<{[key: string]: unknown}>(config, Type.Object)) throw new Error(`Not an object.`);

	const errors = [];

	// Strings
	if (!isType(config.main, Type.String)) errors.push(`"main" has to be a string.`);
	if (!isType(config.description, Type.String | Type.Undefined)) errors.push(`"description" has to be a string.`);
	if (!isType(config.instructions, Type.String | Type.Undefined)) errors.push(`"description" has to be a string.`);

	// Dependencies
	for (const prop of ['dependencies', 'optionalDependencies']) {
		const value = config[prop];
		if (
			!isType(value, Type.Array | Type.Undefined) ||
			(Array.isArray(value) && value.find((item) => !item || typeof item !== 'string'))
		) {
			errors.push(`"${prop}" has to be an array of strings.`);
		}
	}

	// Accepts flags
	const accepts = config.accepts;
	if (!isType<{[key: string]: unknown}>(accepts, Type.Object)) errors.push(`"accepts" has to be an object.`);
	else {
		const acceptsFlagType = Type.String | Type.Function | Type.RegExp;
		for (const prop of ['files', 'directories', 'blobs', 'strings', 'urls']) {
			const propValue = accepts[prop];
			if (
				Array.isArray(propValue)
					? propValue.find((flag) => !isType(flag, acceptsFlagType))
					: !isType(propValue, acceptsFlagType | Type.Boolean | Type.Undefined)
			) {
				errors.push(
					`"accepts.${prop}" has to be a boolean, string, regexp, function, or an array of string, regexp, function.`
				);
			}
		}
	}

	// Thread type
	if (
		!isType<string | (() => void) | undefined>(config.threadType, Type.Undefined | Type.String | Type.Function) &&
		(!Array.isArray(config.threadType) || config.threadType.findIndex((type) => typeof type !== 'string') !== -1)
	)
		errors.push(`"threadType" has to be a string, an array of strings, or a function returning one of those.`);

	// Thread type description
	if (!isType(config.threadTypeDescription, Type.Undefined | Type.String))
		errors.push(`"threadTypeDescription" has to be a string.`);

	// Keep alive
	if (!isType(config.keepAlive, Type.Undefined | Type.Boolean)) errors.push(`"keepAlive" has to be a boolean.`);

	// Options
	if (!isType(config.options, Type.Undefined | Type.Array | Type.Object)) {
		errors.push(`"options" has to be an array or an object.`);
	} else {
		// Try to create options
		if (config.options) {
			try {
				createOptions(config.options as any);
			} catch (error) {
				errors.push(eem(error));
			}
		}
	}

	// Boolean or function
	for (const prop of CONFIG_BOOLEAN_OR_FUNCTIONS) {
		if (!isType(config[prop], Type.Undefined | Type.Boolean | Type.Function))
			errors.push(`"${prop}" has to be a boolean, or a function.`);
	}

	// Function only
	for (const prop of CONFIG_FUNCTIONS) {
		if (!isType(config[prop], Type.Undefined | Type.Function)) errors.push(`"${prop}" has to be a function.`);
	}

	// progressFormatter
	if (!isType(config.progressFormatter, Type.Undefined | Type.Function) && config.progressFormatter !== 'bytes') {
		errors.push(`"progressFormatter" has to be "bytes", function, or undefined.`);
	}

	// Unknown config property
	for (const prop of Object.keys(config)) {
		if (!CONFIG_ALL_PROPS.includes(prop)) errors.push(`Unknown property "${prop}".`);
	}

	if (errors.length > 0) throw new Error(`${errors.map((line) => `- ${line}`).join('\n')}`);

	return true;
}

export class Processor {
	readonly store: Store;
	readonly id: string; // plugin-name:processor-name
	readonly name: string;
	readonly description?: string;
	readonly plugin: Plugin;
	readonly path: string; // require-able path to the processor module
	readonly config: ProcessorConfig;
	readonly configError: string | undefined = undefined;
	readonly requiredDependencyIds: string[];
	readonly optionalDependencyIds: string[];
	readonly dependencyIds: string[];
	readonly instructions?: string;
	readonly hasPreparator: boolean;
	readonly hasInstructions: boolean;
	readonly optionsSchema: OptionsSchema | undefined;
	readonly optionDefaults: OptionsData | undefined;

	constructor(plugin: Plugin, name: string, config: ProcessorConfig | unknown, store: Store) {
		this.store = store;
		this.id = `${plugin.name}:${name}`;
		this.name = name;
		this.plugin = plugin;
		this.requiredDependencyIds = [];
		this.optionalDependencyIds = [];
		this.dependencyIds = [];

		this.config = {main: '__misconfigured__'};

		try {
			if (validateProcessorConfig(config)) {
				this.config = config;
				this.description = config.description;
				this.optionsSchema = config.options
					? Array.isArray(config.options)
						? config.options
						: optionsSchemaFromLax(config.options)
					: undefined;

				// Normalize dependency IDs
				for (const [prop, target] of [
					['dependencies', 'requiredDependencyIds'],
					['optionalDependencies', 'optionalDependencyIds'],
				] as const) {
					const configValue = config[prop];

					if (Array.isArray(configValue)) {
						for (const name of configValue) {
							if (name.includes(':')) {
								this[target].push(name);
							} else {
								// Current plugin dependency shorthand
								const id = `${plugin.name}:${name}`;

								if (!store.dependencies.byId().has(id)) {
									throw new Error(
										`Dependency "${name}" (auto-filled ID: ${id}) can't be found. Are you registering the dependency before the processor?`
									);
								}

								this[target].push(id);
							}
						}
					}
				}

				this.dependencyIds = [...this.requiredDependencyIds, ...this.optionalDependencyIds];

				// Try loading instructions file
				this.instructions = serializeInstructions(config.instructions, plugin.path);

				// Determine option defaults
				this.optionDefaults = this.optionsSchema ? toJS(createOptions(this.optionsSchema)) : undefined;
			}
		} catch (error) {
			this.configError = eem(error);
			this.store.events
				.create({
					variant: 'danger',
					title: `Processor initialization error`,
					message: `Processor "<b>${this.id}</b>" has configuration errors.`,
					details: this.configError,
					actions: plugin.isLocal
						? [
								{
									title: 'Edit plugin',
									variant: 'info',
									icon: 'edit',
									action: () => plugin.openInEditor(),
								},
						  ]
						: undefined,
				})
				.open();
		}

		this.path = Path.join(plugin.path, `${this.config.main}`);
		this.hasPreparator = this.config.operationPreparator != null;
		this.hasInstructions = this.config?.instructions != null;
	}

	dependenciesLoading = computed(() => {
		const dependenciesById = this.store.dependencies.byId();
		for (const dependencyId of this.dependencyIds) {
			const dependency = dependenciesById.get(dependencyId);
			if (dependency?.state() === 'loading') return true;
		}
		return false;
	});

	dependenciesReady = computed(() => {
		const dependenciesById = this.store.dependencies.byId();
		for (const dependencyId of this.requiredDependencyIds) {
			if (!dependenciesById.get(dependencyId)?.isReady()) return false;
		}
		return true;
	});

	isReady = computed(
		() => !this.dependenciesLoading() && !this.store.staging.isStaging() && this.issues().length === 0
	);

	parallelizationMode = computed(() =>
		typeof this.config.parallelize === 'function' ? 'maybe' : this.config.parallelize === false ? false : 'always'
	);

	issues = computed<Issue[]>(() => {
		const issues: Issue[] = [];

		// Configuration error
		const configError = this.configError;
		if (configError) {
			issues.push({
				title: `Processor is misconfigured`,
				actions: [
					{
						title: 'Details',
						icon: 'search',
						variant: 'danger',
						action: () =>
							this.store.modals.alert({
								title: 'Processor configuration errors',
								details: configError,
							}),
					},
				],
			});
		}

		// Don't count loading dependencies as issues while they're still loading
		if (!this.dependenciesReady() && !this.dependenciesLoading()) {
			issues.push({title: `Dependencies are not ready`});
		}

		// Try constructing options to see if there are any schema errors
		if (this.optionsSchema) {
			try {
				createOptions(this.optionsSchema);
			} catch (error) {
				issues.push({
					title: `Options schema error`,
					actions: [
						{
							title: 'Details',
							variant: 'danger',
							action: () =>
								this.store.modals.alert({
									title: 'Options schema error',
									variant: 'danger',
									message: `Processor "${this.id}" has an error in it's options schema:`,
									details: eem(error),
								}),
						},
					],
				});
			}
		}

		// Merge in plugin issues
		issues.push(...this.plugin.issues());

		return issues;
	});

	profiles = computed(() => this.store.profiles.all().filter((profile) => profile.processorId === this.id));

	dependencyPayloads = computed(() => {
		const payloads: {[key: string]: unknown} = {};

		for (const dependencyId of this.dependencyIds) {
			const dependency = this.store.dependencies.byId().get(dependencyId);
			if (dependency) {
				const payload = dependency.payload();
				payloads[dependency.id] = payload;
				payloads[dependency.name] = payload;
			}
		}

		return payloads;
	});

	hasPendingOperations = computed(() => {
		for (const operation of this.store.operations.pending()) {
			if (operation.profile.processorId === this.id) return true;
		}
		return false;
	});

	createProfile = (data?: {categoryId?: string; title?: string} & Partial<ProfileGridPosition>) =>
		this.store.profiles.create({
			...data,
			categoryId: data?.categoryId || this.store.settings.profileCategory(),
			processorId: this.id,
		});

	createAndGoToProfile = (data?: {categoryId?: string; title?: string; position?: Partial<ProfileGridPosition>}) => {
		const profile = this.createProfile(data);
		this.store.history.push(`/profiles/${profile.id}?new`);
		return profile;
	};
}

export class Processors {
	store: Store;
	all = signal<Processor[]>([]);
	byId = signal<Map<string, Processor>>(new Map());
	optionsData: Record<string, Record<string, any> | undefined> = {};
	changeReactionDisposer: Disposer | null = null;
	[Symbol.iterator] = () => this.all()[Symbol.iterator]();

	constructor(store: Store) {
		this.store = store;
	}

	sorted = computed(() => {
		const sorted = [...this.all()];
		sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		return sorted;
	});

	create = createAction((plugin: Plugin, name: string, config: ProcessorConfig | unknown) => {
		const processor = new Processor(plugin, name, config, this.store);

		if (this.byId().has(processor.id)) throw new Error(`Processor id "${processor.id} already exists"`);

		this.byId.edit((byId) => byId.set(processor.id, processor));
		this.all.edit((all) => all.push(processor));

		return processor;
	});

	cleanByPlugin = createAction((plugin: Plugin) => {
		const newAll = [];
		const byId = this.byId();

		for (const processor of this.all()) {
			if (processor.plugin === plugin) byId.delete(processor.id);
			else newAll.push(processor);
		}

		this.all(newAll);
		this.byId.changed();
	});
}
