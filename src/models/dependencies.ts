import {shell} from 'electron';
import Path from 'path';
import FS from 'fs';
import {signal, action, createAction, computed} from 'statin';
import {eem, promiseThrottle, download, isType, Type, fetchJson, reportIssue} from 'lib/utils';
import {deletePath, prepareEmptyDirectory, deleteDirectoryWhenEmpty} from 'lib/fs';
import {extract} from 'lib/extract';
import type {Store} from 'models/store';
import type {Plugin} from 'models/plugins';
import {Staging, SubstageCreator} from 'models/staging';
import {colonIdMeta} from 'lib/serialize';
import type {Issue} from 'components/Issues';
import {InstallUtils, LoadUtils} from '@drovp/types';

const FSP = FS.promises;

type LoadFn = (utils: LoadUtils) => Promise<boolean>;
type InstallFn = (utils: InstallUtils) => Promise<void>;

export interface DependencyConfig {
	load: LoadFn;
	install?: InstallFn;
	instructions?: string;
}

const CONFIG_PROPS = ['load', 'install', 'instructions'];

export function validateDependencyConfig(config: unknown): config is DependencyConfig {
	if (!isType<{[key: string]: unknown}>(config, Type.Object)) throw new Error(`Not an object.`);

	const errors = [];

	if (!isType(config.load, Type.Function)) errors.push(`"load" has to be a function.`);
	if (!isType(config.install, Type.Function | Type.Undefined)) errors.push(`"install" has to be a function.`);
	if (!isType(config.instructions, Type.String | Type.Undefined)) errors.push(`"instructions" has to be a string.`);

	// Unknown config property
	for (const prop of Object.keys(config)) {
		if (!CONFIG_PROPS.includes(prop)) errors.push(`Unknown property "${prop}".`);
	}

	if (errors.length > 0) throw new Error(`Config errors:\n${errors.map((line) => `- ${line}`).join('\n')}`);

	return true;
}

export class Dependency {
	store: Store;
	id: string; // `plugin-name:dependency-name`
	name: string; // `dependency-name`
	plugin: Plugin;
	dataPath: string;
	payload = signal<unknown>(undefined);
	version = signal<string | undefined>(undefined);
	config: DependencyConfig | undefined;
	configError: string | undefined = undefined;
	instructions?: string;
	loadError = signal<string | undefined>(undefined);
	installError = signal<string | undefined>(undefined);
	state = signal<'uninitialized' | 'missing' | 'loading' | 'installing' | 'ready'>('uninitialized');

	constructor(plugin: Plugin, name: string, config: DependencyConfig, store: Store) {
		this.store = store;
		this.plugin = plugin;
		this.id = `${plugin.name}:${name}`;
		this.name = name;
		this.dataPath = Path.join(this.store.dependencies.path, plugin.name);

		try {
			if (validateDependencyConfig(config)) this.config = config;

			// Try loading instructions file
			const instructions = config.instructions;
			if (instructions && instructions?.slice(-3) === '.md') {
				try {
					const instructionsPath = Path.join(plugin.path, instructions);
					try {
						this.instructions = FS.readFileSync(instructionsPath, {encoding: 'utf8'});
					} catch (error) {
						this.instructions = `Couldn't load instructions file: \`${instructionsPath}\`\n\nError:\n\n\`\`\`\n${eem(
							error
						)}\n\`\`\``;
					}
				} catch (error) {}
			} else {
				this.instructions = typeof instructions === 'string' ? instructions : undefined;
			}
		} catch (error) {
			this.configError = eem(error);
			this.store.events
				.create({
					variant: 'danger',
					title: `Dependency initialization error`,
					message: `Dependency "<b>${this.id}</b>" has configuration errors.`,
					details: eem(error),
				})
				.open();
		}
	}

	isReady = computed(() => this.configError == null && this.config != null && this.state() === 'ready');

	hasInstaller = computed(() => this.config?.install != null);

	hasInstructions = computed(() => this.config?.instructions != null);

	dependents = computed(() => {
		return this.store.processors.all().filter((processor) => processor.dependencyIds.includes(this.id));
	});

	hasDependents = computed(() => this.dependents().length > 0);

	issues = computed<Issue[]>(() => {
		const issues: Issue[] = [];
		const hasDependents = this.hasDependents();

		// Configuration error
		const configError = this.configError;
		if (configError) {
			issues.push({
				title: `Dependency is misconfigured`,
				actions: [
					{
						title: 'Details',
						icon: 'search',
						variant: 'danger',
						action: () =>
							this.store.modals.alert({
								variant: 'danger',
								title: 'Dependency configuration error',
								details: configError,
							}),
					},
				],
			});
		}

		// Load error
		const loadError = this.loadError();
		if (loadError) {
			issues.push({
				title: `Loading dependency failed`,
				actions: [
					{
						title: 'Details',
						icon: 'search',
						variant: 'danger',
						action: () =>
							this.store.modals.alert({
								variant: 'danger',
								title: 'Dependency load error',
								details: loadError,
							}),
					},
				],
			});
		}

		// Install error
		const installError = this.installError();
		if (installError) {
			issues.push({
				title: `Dependency installation failed`,
				actions: [
					{
						title: 'Details',
						icon: 'search',
						variant: 'danger',
						action: () =>
							this.store.modals.alert({
								variant: 'danger',
								title: 'Dependency installation error',
								details: installError,
							}),
					},
				],
			});
		}

		// If there is no install or load error, but payload is still falsy
		if (!loadError && !installError && !this.payload()) {
			const variant = hasDependents ? 'danger' : 'info';
			issues.push({
				variant,
				title: `Dependency not loaded`,
				actions: [
					{
						tooltip: 'Details',
						icon: 'help',
						variant,
						action: () =>
							this.store.modals.alert({
								variant,
								title: 'Dependency not loaded',
								message: hasDependents
									? `Dependency loader returned falsy value, which usually means that dependency was not installed correctly, and is missing.`
									: `Dependency is not loaded or missing, but nothing depends on it, so it's fine.`,
							}),
					},
				],
			});
		}

		// Merge in plugin issues
		issues.push(...this.plugin.issues());

		return issues;
	});

	load = promiseThrottle<unknown>(async () => {
		if (!this.config) return;

		action(() => {
			this.loadError(undefined);
			this.state('loading');
		});

		let errorMessage: string | undefined = undefined;
		let data: any;

		try {
			data = await this.config.load({
				id: this.id,
				name: this.name,
				dataPath: this.dataPath,
				pluginDataPath: this.plugin.dataPath,
			});
		} catch (error) {
			errorMessage = eem(error, true);
		}

		action(() => {
			this.state(!errorMessage && data ? 'ready' : 'missing');
			if (data && typeof data === 'object' && (typeof data.version === 'string' || data.payload != null)) {
				this.version(data.version);
				this.payload(data.payload);
			} else {
				// Legacy
				this.version(undefined);
				this.payload(data);
			}
			if (errorMessage) this.loadError(errorMessage);
		});

		return data;
	});

	install = async (substage?: SubstageCreator) => {
		if (!this.config?.install) return;

		let staging!: Staging;

		action(() => {
			this.installError(undefined);
			this.state('installing');
			const descriptor = {
				title: `Installing dependency "${this.name}"`,
				target: 'dependency' as const,
				action: 'install' as const,
				ids: [this.id],
			};
			staging = substage?.(descriptor) || this.store.staging.start(descriptor);
		});

		let installError: undefined | string = undefined;
		const tmpPath = this.dataPath + `-tmp`;

		if (this.hasInstaller()) {
			try {
				await FSP.mkdir(tmpPath, {recursive: true});
				await FSP.mkdir(this.dataPath, {recursive: true});
				await this.config.install({
					id: this.id,
					name: this.name,
					dataPath: this.dataPath,
					pluginDataPath: this.plugin.dataPath,
					tmpPath,
					progress: staging.progress,
					log: staging.log,
					stage: staging.stage,
					download,
					extract,
					fetchJson,
					cleanup: prepareEmptyDirectory,
					prepareEmptyDirectory,
					...this.store.modals.commonModals(this.plugin),
				});
			} catch (error) {
				const errorMessage = eem(error, true);
				staging.error(errorMessage);
				installError = errorMessage;
			}
		} else {
			staging.log(`dependency doesn't have an installer`);
		}

		try {
			action(() => {
				staging.progress(null);
				staging.stage('cleanup');
				staging.log('cleaning up unused directories');
			});
			await deletePath(tmpPath);
			await deleteDirectoryWhenEmpty(this.dataPath);
		} catch (error) {
			staging.log(eem(error));
		}

		if (installError) {
			action(() => {
				this.installError(installError);
				const reportUrl = this.plugin.reportIssueUrl;
				const homepageUrl = this.plugin.homepage;
				this.store.modals.alert({
					variant: 'danger',
					title: 'Dependency installation error',
					message: `Dependency "${this.id}" couldn't be installed.`,
					details: installError,
					actions: [
						reportUrl
							? {
									variant: 'info',
									icon: 'bug',
									title: 'Report bug',
									action: () =>
										reportIssue(reportUrl, {
											title: 'Dependency installation error',
											includeVersions: true,
											body: `Hi! I got this error when installing dependency "${this.name}":\n\n\`\`\`\n${installError}\n\`\`\``,
										}),
							  }
							: homepageUrl
							? {
									variant: 'info',
									icon: 'globe',
									title: 'Plugin homepage',
									action: () => shell.openExternal(homepageUrl),
							  }
							: {
									title: 'Go to plugin',
									action: () => this.store.history.push(`/plugins/${this.plugin.name}`),
							  },
					],
				});
			});
		}

		// Some dependency installers install all dependencies the plugin provides
		// (ffmpeg), so it's a good idea to reload all to update their current state.
		const siblingDependencies = this.plugin.dependencies().filter((dependency) => dependency !== this);
		for (const dependency of siblingDependencies) {
			if (dependency.hasDependents()) dependency.load();
		}

		// Reload ourselves and return
		await this.load();
		staging.done();
	};
}

export class Dependencies {
	store: Store;
	all = signal<Dependency[]>([]);
	byId = signal<Map<string, Dependency>>(new Map());
	path: string;
	[Symbol.iterator] = () => this.all()[Symbol.iterator]();

	constructor(store: Store) {
		this.store = store;
		this.path = Path.join(store.app.userDataPath, 'dependencies');
	}

	sorted = computed(() => {
		const sorted = [...this.all()];
		sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		return sorted;
	});

	create = createAction((plugin: Plugin, name: string, config: DependencyConfig) => {
		const dependency = new Dependency(plugin, name, config, this.store);

		if (this.byId().has(dependency.id)) throw new Error(`Dependency "${dependency.id}" already exists`);

		this.byId.edit((byId) => byId.set(dependency.id, dependency));
		this.all.edit((all) => all.push(dependency));

		return dependency;
	});

	cleanByPlugin = createAction((plugin: Plugin) => {
		const newAll = [];
		const byId = this.byId();

		for (const dependency of this.all()) {
			if (dependency.plugin === plugin) byId.delete(dependency.id);
			else newAll.push(dependency);
		}

		this.all(newAll);
		this.byId.changed();
	});

	/**
	 * Load only dependencies that have dependents.
	 */
	loadDependentUpon = async () => {
		const checkingPromises: Promise<unknown>[] = [];
		for (const dependency of this.all()) {
			if (dependency.hasDependents()) checkingPromises.push(dependency.load());
		}
		await Promise.all(checkingPromises);
	};

	install = async (id: string, substage?: SubstageCreator) => {
		let pluginName: string;
		let dependencyName: string;

		try {
			[pluginName, dependencyName] = colonIdMeta(id);
		} catch {
			this.store.events
				.create({
					variant: 'danger',
					title: `Dependency installation error`,
					message: `Invalid dependency id "${id}". Expected format: "plugin:dependency"`,
				})
				.open();
			return;
		}

		const descriptor = {
			title: `Installing dependency "${dependencyName}"`,
			target: 'dependency' as const,
			action: 'install' as const,
			ids: [id],
		};
		const staging = substage?.(descriptor) || this.store.staging.start(descriptor);

		let errorAndStop = (error: {message: string; details?: string}) => {
			action(() => {
				this.store.events
					.create({
						...error,
						variant: 'danger',
						title: `Dependency installation error`,
					})
					.open();
				staging.error(error.message);
				staging.done();
			});
		};

		let plugin = this.store.plugins.byId().get(pluginName);

		// Install plugin if missing
		if (!plugin) {
			staging.progress(null);
			try {
				await staging.substage((substage) => this.store.plugins.install(pluginName, substage));
			} catch (error) {
				errorAndStop({
					message: `Error installing plugin "${pluginName}".`,
					details: eem(error),
				});
				return;
			}

			// Re-query the plugin
			plugin = this.store.plugins.byId().get(pluginName);
		}

		// If plugin still doesn't exist, abort
		if (!plugin) {
			errorAndStop({message: `Plugin "${pluginName}" is missing post installation. This shouldn't happen.`});
			return;
		}

		const dependency = this.byId().get(id);
		if (!dependency) {
			errorAndStop({
				message: `Couldn't install dependency "${id}" because plugin "${pluginName}" doesn't have a dependency named "${dependencyName}".`,
			});
			return;
		}

		try {
			await staging.substage((substage) => dependency.install(substage));
		} catch (error) {
			errorAndStop({
				message: `Error installing dependency "${dependency.id}".`,
				details: eem(error),
			});
			return;
		}

		staging.done();
	};
}
