import {h} from 'preact';
import Path from 'path';
import manifest from 'manifest';
import FS, {promises as FSP} from 'fs';
import OS from 'os';
import {ProcessorConfig} from '@drovp/types';
import {signal, createAction, action, computed} from 'statin';
import {eem, debounce, clearModuleCache, createUpdatesChecker, ucFirst, promiseThrottle} from 'lib/utils';
import {
	plugins as serializePlugins,
	SerializedPlugin,
	pluginNameMeta,
	colonIdMeta,
	serializePluginIdentifier,
} from 'lib/serialize';
import {deletePath} from 'lib/fs';
import {loadDynamicModule} from 'lib/loadDynamicModule';
import semverCompare from 'semver-compare';
import {registry} from 'lib/registry';
import type {CreatePluginTemplateProps} from 'dynamic/pluginTemplate';
import {PluginDependentsModalContent} from 'components/Plugin';
import {Staging, SubstageCreator} from 'models/staging';
import {Processor} from 'models/processors';
import {Dependency} from 'models/dependencies';
import {DependencyConfig} from 'models/dependencies';
import {NonOfficialPluginInstallWarning, ExternalPluginInstallWarning} from 'components/Warnings';
import type {Profile} from 'models/profiles';
import type {Store} from 'models/store';
import type {Issue} from 'components/Issues';

/**
 * Check if value satisfies one flags.
 * Flags is an array of allowed strings: ['foo', 'bar']
 * If first flag starts with !, it's transformed into a disallowed list: ['!bar']
 */
function satisfiesManifestFlags(value: string, flags: string[]) {
	const isBlockList = flags[0]?.[0] === '!';
	for (const rawFlag of flags) {
		const flag = rawFlag[0] === '!' ? rawFlag.slice(1) : rawFlag;
		if (flag === value) return !isBlockList;
	}
	return isBlockList;
}

function extractMinManifestEnginesVersion(value: string | undefined | null) {
	return (
		value
			?.split(' ')
			.find((item) => item.match(/^(>=|=|>|~)?(?!<)[\d\.]+$/i) != null)
			?.match(/[\d\.]+/)?.[0] || null
	);
}

export class Plugin {
	store: Store;
	meta: SerializedPlugin;
	name: string;
	path: string;
	mainPath: string;
	dataPath: string; // Directory where plugin can install dependencies
	isPlugin: boolean;
	isPrivate: boolean;
	isPublic: boolean;
	isLocal: boolean;
	isOfficial: boolean;
	isExternal: boolean;
	isNonStandard: boolean;
	source?: string;
	version: string;
	requiredNodeVersion: string | null;
	requiredAppVersion: string | null;
	description?: string;
	readme?: string;
	homepage?: string;
	npmUrl?: string;
	reportIssueUrl?: string;
	displayName: string;
	scope?: string;
	installUrl?: string;
	installMarkdownLink?: string;
	isCheckingForUpdates = signal(false);
	initializer: any; // The initializing function exported by plugin module

	constructor(data: SerializedPlugin, store: Store) {
		this.store = store;
		this.meta = data;
		this.name = data.name;
		this.path = data.path;
		this.mainPath = Path.join(data.path, data.main);
		this.dataPath = Path.join(store.plugins.dataPath, this.name);
		this.isPlugin = data.isPlugin;
		this.isPrivate = data.private === true;
		this.isPublic = !this.isPrivate;
		this.isLocal = data.isLocal;
		this.isOfficial = data.isOfficial;
		this.isExternal = data.isExternal;
		this.isNonStandard = data.isNonStandard;
		this.source = data.source;
		this.version = data.version;
		this.homepage = data.homepage;
		this.npmUrl = data.npmUrl;
		this.readme = data.readme;
		this.description = data.description;

		// Can be url, email, or null
		const bugs = data.bugs;
		this.reportIssueUrl = typeof bugs === 'string' ? bugs : bugs?.url ?? bugs?.email ?? this.homepage ?? undefined;

		const nameMeta = pluginNameMeta(this.name);
		this.displayName = nameMeta.displayName;
		this.scope = nameMeta.scope;

		if (this.isExternal && this.source) {
			this.installUrl = `${manifest.name}://install-external/${encodeURIComponent(this.source)}`;
		} else if (this.isPublic) {
			this.installUrl = `${manifest.name}://install/${this.name}`;
		}

		if (this.installUrl) {
			this.installMarkdownLink = `[Install Drovp plugin ${this.name}](${this.installUrl})`;
		}

		// Determine min required node & app versions
		this.requiredNodeVersion = extractMinManifestEnginesVersion(this.meta.engines?.node);
		this.requiredAppVersion = extractMinManifestEnginesVersion(this.meta.engines?.drovp);
	}

	/**
	 * Checks if:
	 * - node is available
	 * - node version is equal or higher than required one
	 *
	 * Doesn't check for dependencies, as not all need to be installed for stuff
	 * to work. Only processor's ready state should be determined by the state
	 * of it's dependencies.
	 */
	isReady = computed(() => !this.store.staging.isStaging() && this.issues().length === 0);

	dependencies = computed(() => this.store.dependencies.all().filter((dependency) => dependency.plugin === this));
	processors = computed(() => this.store.processors.all().filter((processor) => processor.plugin === this));

	/**
	 * List of profiles depending on any processor of this plugin.
	 */
	dependentProfiles = computed(() =>
		this.processors().reduce<Profile[]>((profiles, processor) => {
			profiles.push(...processor.profiles());
			return profiles;
		}, [])
	);

	/**
	 * List of plugins that have processor that depends on any dependency
	 * provided by this plugin.
	 */
	dependentPlugins = computed(() => {
		const plugins: Plugin[] = [];

		for (const dependency of this.dependencies()) {
			for (const {plugin} of dependency.dependents()) {
				if (plugin !== this && !plugins.includes(plugin)) plugins.push(plugin);
			}
		}

		return plugins;
	});

	/**
	 * Checks or sets latest available update. This is stored on App model
	 * so that it persists between plugin reloads.
	 */
	updateAvailable = (version?: false | string) => {
		const pluginUpdates = this.store.app.pluginUpdates();
		if (version === false) this.store.app.pluginUpdates.edit((map) => map.delete(this.name));
		else if (typeof version === 'string') this.store.app.pluginUpdates.edit((map) => map.set(this.name, version));
		return pluginUpdates.get(this.name) || false;
	};

	/**
	 * Doesn't aggregate dependency issues.
	 */
	issues = computed<Issue[]>(() => {
		const issues: Issue[] = [];

		// Node
		if (!this.store.node.isReady()) {
			const error = this.store.node.error();
			issues.push({
				title: `Node.js framework not ready`,
				message: error || undefined,
				actions: [
					{
						icon: 'install',
						title: 'Install',
						variant: 'success',
						disableWhenStaging: true,
						action: () => this.store.node.install(),
					},
				],
			});
		}

		// Node version
		const requiredNodeVersion = this.requiredNodeVersion;
		const currentNodeVersion = this.store.node.version();

		if (currentNodeVersion && requiredNodeVersion && semverCompare(requiredNodeVersion, currentNodeVersion) > 0) {
			issues.push({
				title: `Requires newer version of Node.js framework`,
				message: `Required: <strong><code>${requiredNodeVersion}</code></strong>, installed: <strong><code>${currentNodeVersion}</code></strong>`,
				actions: [
					{
						icon: 'install',
						title: 'Install',
						variant: 'success',
						disableWhenStaging: true,
						action: () => this.store.node.install(),
					},
				],
			});
		}

		// App version
		if (this.requiredAppVersion && semverCompare(this.requiredAppVersion, manifest.version) > 0) {
			const prevVersion = Math.max(0, (parseInt(this.version.split('.')[0]!, 10) || 0) - 1);
			const downgradeTag = `${this.name}@${prevVersion}`;
			issues.push({
				title: `Requires newer version of the app`,
				message: `
				<p>
					Required: <strong><code>${this.requiredAppVersion}</code></strong>, current: <strong><code>${
					manifest.version
				}</code></strong>
				</p>
				<p>
					In case you don't want to update the app for some reason, you can always try to downgrade the plugin to a lower major version. Just head over to <a href="route://manual-installer?source=${encodeURIComponent(
						downgradeTag
					)}">Manual installer</a> and enter <b>${downgradeTag}</b> to downgrade.
				</p>
				`,
				actions: [
					{
						icon: 'install',
						title: 'Install',
						variant: 'success',
						disableWhenStaging: true,
						action: () => this.store.app.updateMaybe(),
					},
				],
			});
		}

		// OS
		const platform = OS.platform();
		const osFlags = this.meta.os;
		if (osFlags && !satisfiesManifestFlags(platform, osFlags)) {
			issues.push({
				title: `Plugin doesn't support your operating system`,
				message: `Supported: <strong><code>${osFlags.join(
					', '
				)}</code></strong>, your OS: <strong><code>${platform}</code></strong>`,
			});
		}

		// Arch
		const arch = OS.arch();
		const archFlags = this.meta.cpu;
		if (archFlags && !satisfiesManifestFlags(arch, archFlags)) {
			issues.push({
				title: `Plugin doesn't support your CPU architecture`,
				message: `Supported: <strong><code>${archFlags.join(
					', '
				)}</code></strong>, your arch: <strong><code>${platform}</code></strong>`,
			});
		}

		return issues;
	});

	hasPendingOperations = computed(() => {
		for (const operation of this.store.operations.pending()) {
			if (operation.profile.pluginMeta.name === this.name) return true;
		}
		return false;
	});

	/**
	 * Loads plugin's module.
	 *
	 * Loading and initialization is separated so that initialization of all new
	 * plugins can happen synchronously at the same time so that it wont cause
	 * any content layout shifts.
	 */
	load = async () => {
		// This is false when installed plugin doesn't have proper keywords in
		// its manifest. Used to stop initialization of modules that are not plugins.
		if (!this.isPlugin) return;

		this.initializer = null;
		let errorMessage: string | undefined;

		// Ensure plugin's dataPath exists
		await FSP.mkdir(this.dataPath, {recursive: true});

		// Load the module
		try {
			const module = require(this.path);
			this.initializer = typeof module === 'function' ? module : module?.default;
		} catch (error) {
			errorMessage = eem(error, true);
		}

		const isFunction = typeof this.initializer === 'function';

		if (errorMessage || !isFunction) {
			this.initializer = null;
			this.store.events
				.create({
					variant: 'danger',
					title: `Plugin loading error`,
					message: `Plugin "${this.name}" module didn't load.`,
					details: errorMessage ? errorMessage : `Plugin's default export is not a function.`,
				})
				.open();
		}
	};

	/**
	 * Initialize loaded plugin.
	 *
	 * Loading and initialization is separated so that initialization of all new
	 * plugins can happen synchronously at the same time so that it wont cause
	 * any content layout shifts.
	 */
	initialize = createAction(() => {
		if (!this.initializer) return;

		try {
			this.initializer({
				registerDependency: this.registerDependency,
				registerProcessor: this.registerProcessor,
			});
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Plugin initialization error`,
					message: `Plugin "${this.name}" could not be initialized.`,
					details: eem(error, true),
				})
				.open();
		}
	});

	checkForUpdates = async () => {
		if (!this.isLocal && this.version) {
			action(() => this.isCheckingForUpdates(true));
			let latestVersion!: string;
			try {
				latestVersion = await registry.latestVersion(this.name);
			} catch (error) {
				console.error(`Plugin "${this.name}" update check error:`, error);
			}

			action(() => {
				if (latestVersion && latestVersion > this.version) this.updateAvailable(latestVersion);
				this.isCheckingForUpdates(false);
			});
		} else {
			action(() => this.updateAvailable(false));
		}
	};

	/**
	 * Updates immediately in case of a patch and a minor version bumps, but
	 * informs and asks the user whether to update major versions.
	 */
	updateMaybe = () => !this.isLocal && this.store.plugins.updateMaybe(this.name);

	/**
	 * Update installed plugin from registry.
	 */
	update = () => !this.isLocal && this.store.plugins.update(this.name);

	/**
	 * Prompt that warns against uninstalling, and lists dependents if any.
	 */
	uninstallPrompt = () => {
		const dependentProfiles = this.dependentProfiles();
		const dependentPlugins = this.dependentPlugins();
		const hasDependents = dependentProfiles.length > 0 || dependentPlugins.length > 0;
		const actionWord = this.isLocal ? 'delete' : 'uninstall';

		this.store.modals.create({
			variant: 'warning',
			title: `Plugin ${actionWord}`,
			message: `Are you sure you want to ${actionWord} plugin <b><code>${this.displayName}</code></b>?${
				hasDependents ? `\n\nHere's what depends on it:` : ''
			}`,
			content: hasDependents
				? (modal) => <PluginDependentsModalContent plugin={this} onClose={() => modal.close()} />
				: undefined,
			actions: [
				{
					icon: 'x',
					title: 'Cancel',
					focused: true,
					action: () => {},
				},
				{
					variant: 'danger',
					icon: 'trash',
					title: ucFirst(actionWord),
					action: () => this.uninstall(),
				},
			],
		});
	};

	uninstall = () => this.store.plugins.uninstall(this.name);

	openInEditor = () => this.store.app.openInEditor(this.path);

	destroy = createAction(() => {
		this.store.processors.cleanByPlugin(this);
		this.store.dependencies.cleanByPlugin(this);
	});

	/**
	 * Plugin API.
	 */

	registerProcessor = (name: string, config: ProcessorConfig) => {
		const id = `${this.name}:${name}`;

		try {
			if (typeof name !== 'string' || name.length === 0) {
				throw new Error('Processor name has to be non-empty a string.');
			}

			this.store.processors.create(this, name, config);
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Processor config error`,
					message: `Processor "<b>${id}</b>" couldn't be initialized because it's misconfigured.`,
					details: eem(error),
				})
				.open();
		}
	};

	registerDependency = createAction((name: string, config: DependencyConfig) => {
		const id = `${this.name}:${name}`;

		try {
			if (typeof name !== 'string' || name.length === 0) {
				throw new Error('Dependency name has to be a non-empty string.');
			}

			this.store.dependencies.create(this, name, config);
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Dependency config error`,
					message: `Dependency "<b>${id}</b>" couldn't be initialized because it's misconfigured.`,
					details: eem(error),
				})
				.open();
		}
	});
}

export class Plugins {
	store: Store;
	all = signal<Plugin[]>([]);
	byId = signal<Map<string, Plugin>>(new Map());
	path: string;
	[Symbol.iterator] = () => this.ordered()[Symbol.iterator]();
	dataPath: string;
	fsWatcher: FS.FSWatcher | null = null;
	fsWatchingUnavailable = signal(false);
	symlinkDirIsInitialized = false;

	constructor(store: Store) {
		this.store = store;
		this.path = Path.join(store.app.userDataPath, 'plugins');
		this.dataPath = Path.join(store.app.userDataPath, 'pluginsData');

		// Updates checking
		createUpdatesChecker(
			store.settings.pluginUpdatesCheckingInterval,
			store.settings.lastPluginUpdatesCheckTime,
			async () => (await this.checkForUpdates()).length > 0
		);
	}

	ordered = computed<Plugin[]>(() => [...this.all()].sort((a, b) => (a.displayName < b.displayName ? -1 : 1)));

	checkingForUpdates = computed(() => this.all().find((plugin) => plugin.isCheckingForUpdates()) != null);

	updatesAvailable = computed(() => this.all().filter((plugin) => plugin.updateAvailable()).length);

	isWatching = () => this.fsWatcher != null;

	/**
	 * Reloads plugins when any filesystem change happens below `this.path` (debounced).
	 */
	startWatching() {
		if (this.fsWatchingUnavailable()) return;

		this.stopWatching();

		// Start watching
		try {
			this.fsWatcher = FS.watch(
				this.path,
				{recursive: true},
				debounce((event, file) => {
					// Ignore `./node_modules`, auto-reloading is only for local development plugins
					const comingFromModules = typeof file === 'string' && file.includes('node_modules');
					if (!comingFromModules && !this.store.staging.isStaging()) {
						this.reload();
					}
				}, 1000)
			);
		} catch (error) {
			if ((error as any)?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
				action(() => {
					this.fsWatchingUnavailable(true);
				});
			} else {
				this.store.events
					.create({
						variant: 'danger',
						title: 'Plugins loading error',
						message: `Can't start plugins directory watcher.`,
						details: eem(error),
					})
					.open();
			}
		}
	}

	stopWatching() {
		if (this.fsWatcher) {
			this.fsWatcher.close();
			this.fsWatcher = null;
		}
	}

	load = async () => {
		// Check if directory exists, create if not
		try {
			await FS.promises.stat(this.path);
		} catch (error) {
			if ((error as any)?.code === 'ENOENT') {
				try {
					await FS.promises.mkdir(this.path, {recursive: true});
				} catch (creationError) {
					this.store.events
						.create({
							variant: 'danger',
							title: `Plugins loading error`,
							message: `Can't create plugins directory.`,
							details: eem(creationError),
						})
						.open();
					return;
				}
			} else {
				this.store.events
					.create({
						variant: 'danger',
						title: `Plugins loading error`,
						message: `Unexpected error when checking for plugins directory.`,
						details: eem(error),
					})
					.open();
				return;
			}
		}

		// Load plugins and start watching for changes
		await this.reload();
		this.startWatching();
	};

	reload = createAction(async (substage?: SubstageCreator) => {
		const descriptor = {
			title: `Loading plugins`,
			target: 'plugins' as const,
			action: 'load' as const,
			skipModal: true,
		};
		const staging = substage?.(descriptor) || this.store.staging.start(descriptor);

		// Pause operation queue
		const resume = !this.store.worker.isPaused();
		if (resume) this.store.worker.pause();

		// Clear existing module cache so plugins actually get reloaded
		clearModuleCache();

		// Ensure plugin directory exists, if this fails, it'll be picked up by
		// serializer below.
		try {
			await FSP.mkdir(this.path, {recursive: true});
		} catch {}

		// Serialize plugins
		const serializedPlugins = await serializePlugins(this.path, {
			onError: createAction((error) => {
				staging.error(error.details || error.message);
				this.store.modals.alert({
					details: error.details || error.message,
					message: error.details ? error.message : undefined,
					title: `Plugin serialization error`,
					variant: 'danger',
				});
			}),
			onWarning: createAction((warning) => {
				staging.error(warning.details || warning.message);
				this.store.modals.alert({
					details: warning.details || warning.message,
					message: warning.details ? warning.message : undefined,
					title: `Plugin serialization warning`,
					variant: 'warning',
					actions:
						warning.code === 'DUPLICATE'
							? [
									{
										icon: 'trash',
										title: 'Uninstall registry version',
										action: () => this.store.plugins.uninstallNpm(warning.payload!),
									},
							  ]
							: undefined,
				});
			}),
		});

		const newById: Map<string, Plugin> = new Map();
		const newAll: Plugin[] = [];

		// Load new plugins
		for (let data of serializedPlugins) {
			let plugin = new Plugin(data, this.store);
			await plugin.load();
			newById.set(plugin.name, plugin);
			newAll.push(plugin);
		}

		action(() => {
			// Cleanup old plugins
			for (const plugin of this.all()) plugin.destroy();

			// Replace existing plugins
			this.all(newAll);
			this.byId(newById);
			this.store.worker.requestRefreshThreads();

			// Initialize new plugins
			for (const plugin of newAll) plugin.initialize();
		});

		this.store.dependencies.loadDependentUpon();

		if (resume) this.store.worker.resume();
		staging.done();
	});

	/**
	 * Warns about installing non-official plugins.
	 */
	installMaybe = (input: string) => {
		const install = () => this.install(input);
		const meta = serializePluginIdentifier(input);
		const WarningComponent = meta.isExternal
			? this.store.settings.warnExternalInstall()
				? ExternalPluginInstallWarning
				: undefined
			: !meta.isOfficial
			? this.store.settings.warnNonOfficialInstall()
				? NonOfficialPluginInstallWarning
				: undefined
			: undefined;

		if (WarningComponent) {
			this.store.modals.create({
				variant: 'warning',
				title: 'Warning!',
				content: <WarningComponent id={input} />,
				actions: [
					{
						icon: 'x',
						title: 'Cancel',
						muted: true,
						focused: true,
						action: () => {},
					},
					{
						variant: 'success',
						icon: 'install',
						title: 'Install',
						disableWhenStaging: true,
						action: install,
					},
				],
			});
		} else {
			return install();
		}
	};

	/**
	 * Install one or multiple plugins.
	 *
	 * Input accepts npm module tags so you can specify exact version of modules
	 * to install.
	 *
	 * ```
	 * plugins.install('module');
	 * plugins.install('module@^1');
	 * ```
	 */
	install = async (input: string | string[], substage?: SubstageCreator, skipAppUpdateCheck?: boolean) => {
		const {dependencies, plugins, modals} = this.store;
		const inputs = (Array.isArray(input) ? input : [input]).map(serializePluginIdentifier);
		const pluginIds = inputs
			.map(({name}) => name)
			.filter<string>(function (name): name is string {
				return !!name;
			});
		const installIds = inputs.map(({installId}) => installId);
		const descriptor = {
			title: pluginIds.length > 1 ? `Installing ${pluginIds.length} plugins` : `Installing ${pluginIds[0]}`,
			target: 'plugins' as const,
			action: 'install' as const,
			ids: pluginIds,
		};
		const staging = substage?.(descriptor) || this.store.staging.start(descriptor);
		const resolveSnapshot = this.initSnapshot();
		const errorAndDone = createAction((error: unknown) => {
			staging.error(eem(error));
			staging.done();
		});

		// Pause operation queue
		const resume = !this.store.worker.isPaused();
		if (resume) this.store.worker.pause();

		const suspendWatching = this.isWatching();
		if (suspendWatching) this.stopWatching();

		// Check if there is an app update available
		try {
			if (!skipAppUpdateCheck) await this.appUpdatePromptMaybe(staging);
		} catch (error) {
			errorAndDone(error);
			return;
		}

		// Start installation process
		staging.log(`installing plugins:\n- ${installIds.join('\n- ')}\n`);

		try {
			// Check if npm is initialized in plugins directory
			const manifestFile = Path.join(this.path, 'package.json');
			try {
				await FSP.mkdir(this.path, {recursive: true});
				await FSP.access(manifestFile, FS.constants.R_OK | FS.constants.W_OK);
			} catch (error) {
				// Unknown error, probably we don't have access
				if ((error as any)?.code !== 'ENOENT') throw error;

				// Initialize before installing, otherwise npm will walk up the
				// directory tree and install in the first package.json it finds.
				const manifest = {
					description: `This file is used to track plugins installed from registry. Don't edit it manually unless you know what you're doing`,
					public: false,
				};
				const contents = JSON.stringify(manifest, null, 2);
				await FSP.writeFile(manifestFile, contents);
			}

			// Finally, install the plugins(s)
			await this.store.node.npm(['install', ...installIds], {
				cwd: this.path,
				onStdout: staging.log,
				onStderr: staging.log,
			});
		} catch (error) {
			errorAndDone(error);
			this.store.app.showError({
				title: `Plugin install error`,
				message: `There has been an error while installing these plugins: ${installIds.join(', ')}`,
				details: eem(error),
			});
			return;
		}

		// Load installed plugins
		await staging.substage((substage) => this.reload(substage));
		await dependencies.loadDependentUpon();

		// Gather all processor dependencies that might need installing
		const {freshPlugins, newDependencies, newProcessors} = resolveSnapshot();
		const freshProcessors = freshPlugins.map((plugin) => plugin.processors()).flat();

		action(() => {
			// Remove updatesAvailable flag from installed plugins
			for (const plugin of freshPlugins) plugin.updateAvailable(false);

			// Report snapshot
			staging.log(`freshPlugins: ${freshPlugins.map(({name}) => name).join(', ')}`);
			staging.log(`newProcessors: ${newProcessors.map(({id}) => id).join(', ')}`);
			staging.log(`newDependencies: ${newDependencies.map(({id}) => id).join(', ')}`);
		});

		// Installing new dependencies with dependents
		staging.log(`installing new dependencies with dependents`);
		for (const dependency of newDependencies) {
			if (dependency.hasDependents()) await staging.substage((substage) => dependency?.install(substage));
		}

		// Installing potentially uninstalled processor dependencies
		staging.log(`ensuring new and updated processor dependencies are installed`);

		const attemptedDependencyIds = new Set<string>();
		const attemptedPluginIds = new Set<string>();

		for (const processor of freshProcessors) {
			for (const id of processor.dependencyIds) {
				if (attemptedDependencyIds.has(id)) continue;
				attemptedDependencyIds.add(id);

				let dependency = dependencies.byId().get(id);

				// If missing, check if it's external, in which case install the carrying plugin
				if (!dependency) {
					let idMeta: [string, string];

					try {
						idMeta = colonIdMeta(id);
					} catch {
						staging.log(`invalid dependency id "${id}"`);
						modals.alert({
							variant: 'danger',
							title: `Dependency installation error`,
							message: `Processor's "${processor.id}" dependency "${id}" is not a valid id.`,
						});
						continue;
					}

					const [pluginId, dependencyName] = idMeta;
					let plugin = plugins.byId().get(pluginId);

					if (!plugin && !attemptedPluginIds.has(pluginId)) {
						attemptedPluginIds.add(pluginId);
						staging.log(`plugin "${pluginId}" is not installed`);
						await staging.substage((substage) => this.install(pluginId, substage));
						plugin = plugins.byId().get(pluginId);
					}

					if (plugin && !dependencies.byId().has(id)) {
						staging.log(`plugin "${pluginId}" doesn't provide dependency "${id}"`);
						modals.alert({
							variant: 'danger',
							title: `Dependency installation error`,
							message: `Processor "${processor.id}" depends on "${id}" but plugin "${pluginId}" doesn't provide dependency "${dependencyName}".`,
						});
					}

					dependency = dependencies.byId().get(id);
				}

				if (dependency) {
					if (!dependency.isReady()) {
						staging.log(`dependency "${dependency.id}" is registered but not ready`);
						await staging.substage((substage) => dependency?.install(substage));
						if (!dependency.isReady()) {
							modals.alert({
								variant: 'danger',
								title: `Dependency installation error`,
								message: `Processor's "${processor.id}" dependency "${dependency.id}" couldn't be installed.`,
								details: dependency.installError(),
							});
						}
					}
				}
			}
		}

		if (suspendWatching) this.startWatching();
		if (resume) this.store.worker.resume();
		staging.done();
	};

	uninstall = async (pluginId: string) => {
		const history = this.store.history;
		const plugin = this.byId().get(pluginId);

		if (!plugin) {
			this.store.events
				.create({
					title: `Plugin uninstall error`,
					message: `Plugin "${pluginId}" not found.`,
				})
				.open();
			return;
		}

		if (plugin.hasPendingOperations()) {
			this.store.events
				.create({
					title: `Plugin uninstall error`,
					message: `Can't uninstall plugin "${pluginId}". One of its processors has operations pending.`,
				})
				.open();
			return;
		}

		const staging = this.store.staging.start({
			title: `Uninstalling plugin ${pluginId}`,
			target: 'plugins',
			action: 'uninstall',
			ids: [pluginId],
		});

		// Pause operation queue
		const resume = !this.store.worker.isPaused();
		if (resume) this.store.worker.pause();

		this.stopWatching();
		plugin.destroy();

		if (plugin.isLocal) {
			try {
				await deletePath(plugin.path);
			} catch (error) {
				this.store.app.showError({
					title: `Plugin uninstall error`,
					message: `Error when deleting plugin "${pluginId}".`,
					details: eem(error),
				});
			}
		} else {
			await staging.substage((substage) => this.uninstallNpm(pluginId, substage));
		}

		this.startWatching();
		await staging.substage((substage) => this.reload(substage));
		staging.done();
		if (resume) this.store.worker.resume();
		if (history.location.path.startsWith(`/plugins/${pluginId}`)) history.push('/plugins');
	};

	uninstallNpm = async (pluginId: string, substage?: SubstageCreator) => {
		const descriptor = {
			title: `Uninstalling plugin ${pluginId}`,
			target: 'plugins' as const,
			action: 'uninstall' as const,
			ids: [pluginId],
		};
		const staging = substage?.(descriptor) || this.store.staging.start(descriptor);
		try {
			await this.store.node.npm(['uninstall', pluginId], {
				cwd: this.path,
				onStdout: staging.log,
				onStderr: staging.log,
			});
		} catch (error) {
			this.store.app.showError({
				title: `Plugin uninstall error`,
				message: `Error when uninstalling plugin "${pluginId}".`,
				details: eem(error),
			});
		}
		await staging.substage((substage) => this.reload(substage));
		staging.done();
	};

	checkForUpdates = promiseThrottle(async () => {
		await Promise.all(this.all().map((plugin) => plugin.checkForUpdates()));
		const outdatedPlugins = this.all().filter((plugin) => plugin.updateAvailable());
		return outdatedPlugins;
	});

	appUpdatePromptMaybe = async (staging: Staging) => {
		const msInHalfDay = 1000 * 60 * 60 * 12;
		const appUpdateAvailable =
			this.store.app.updateAvailable() ||
			(Date.now() - this.store.settings.lastAppUpdatesCheckTime() > msInHalfDay
				? await this.store.app.checkForUpdates()
				: false);

		if (appUpdateAvailable) {
			const {canceled, payload: updateApp} = await this.store.modals.create({
				variant: 'warning',
				title: 'App update available!',
				message: `It is recommended to update the app before installing or updating plugins, as new plugins might depend on APIs that are not be present in an outdated app.`,
				actions: [
					{
						muted: true,
						title: 'Skip',
						payload: false,
					},
					{
						variant: 'success',
						title: 'Update app',
						focused: true,
						payload: true,
					},
				],
			}).promise;

			if (!canceled && updateApp) await staging.substage((substage) => this.store.app.update(substage));
		}
	};

	/**
	 * Updates immediately in case of a patch and a minor version bumps, but
	 * informs and asks the user whether to update major versions.
	 */
	updateMaybe = async (pluginId?: string | string[]) => {
		const pluginIds = Array.isArray(pluginId)
			? pluginId
			: pluginId
			? [pluginId]
			: this.all()
					.filter((plugin) => !plugin.isLocal && !plugin.isExternal)
					.map((plugin) => plugin.name);
		const byId = this.byId();
		const updateablePluginIds = pluginIds.filter((id) => byId.get(id)?.updateAvailable() !== false);
		const majorVersionUpdates = updateablePluginIds
			.map((id) => byId.get(id)!)
			.filter((plugin) => {
				const newVersion = plugin.updateAvailable();
				if (!newVersion) return;
				const currentMajorVersion = parseInt(plugin.version.split('.')[0] || '', 10) || 0;
				const newMajorVersion = parseInt(newVersion.split('.')[0] || '', 10) || currentMajorVersion;
				return newMajorVersion > currentMajorVersion;
			});

		if (updateablePluginIds.length === 0) return;

		const staging = this.store.staging.start({
			title:
				updateablePluginIds.length > 1
					? `Updating ${updateablePluginIds.length} plugins`
					: `Updating ${updateablePluginIds[0]}`,
			target: 'plugins',
			action: 'install',
			ids: updateablePluginIds,
		});

		// Check if there is an app update available
		await this.appUpdatePromptMaybe(staging);

		// Warn for major version updates
		if (majorVersionUpdates.length > 0) {
			const {canceled, payload: proceed} = await this.store.modals.create({
				variant: 'warning',
				title: 'Major version update!',
				message: `
				<p>Careful! These plugins will be updated to a new major version:</p>
				<p>${majorVersionUpdates
					.map((plugin) => {
						return `
						<a href="route://plugins/${plugin.name}" title="Plugin page changelog" data-close-modals="true"><b>${
							plugin.displayName
						}:</b></a>
						<code>${plugin.version} -> <b>${plugin.updateAvailable()}</b></code>
						(<a href="route://plugins/${
							plugin.name
						}?section=changelog" title="Plugin page changelog" data-close-modals="true">changelog</a>)`;
					})
					.join('<br>')}</p>
				<p>Major version updates usually mean backwards incompatible changes. You should examine plugin's changelog before updating.</p>
				`,
				actions: [
					{
						icon: 'x',
						title: 'Cancel',
						muted: true,
						focused: true,
						payload: false,
					},
					{
						variant: 'success',
						icon: 'update',
						title: 'Update',
						payload: true,
					},
				],
			}).promise;

			if (!canceled && proceed) {
				await staging.substage((substage) => this.update(updateablePluginIds, substage, true));
			}
		} else {
			await staging.substage((substage) => this.update(updateablePluginIds, substage, true));
		}

		staging.done();
	};

	update = async (pluginId?: string | string[], substage?: SubstageCreator, skipAppUpdateCheck?: boolean) => {
		const byId = this.byId();
		const pluginIds = Array.isArray(pluginId)
			? pluginId
			: pluginId
			? [pluginId]
			: this.all()
					.filter((plugin) => !plugin.isLocal)
					.map((plugin) => plugin.name);
		const installedPluginIds = pluginIds.filter((id) => byId.has(id));

		if (installedPluginIds.length === 0) return;

		await this.install(installedPluginIds, substage, skipAppUpdateCheck);
	};

	create = async (props: CreatePluginTemplateProps) => {
		const staging = this.store.staging.start(
			{
				target: 'plugins',
				action: 'create',
				ids: [props.name],
				title: `Creating plugin "${props.name}"`,
			},
			(staging) => {
				staging.stage('writing files');
				staging.progress(1, 5, true);
			}
		);

		this.stopWatching();

		let stderr = '';
		const pluginPath = Path.join(this.path, props.name);

		try {
			const {files, dependencies, devDependencies, postCreate} =
				loadDynamicModule('pluginTemplate').compose(props);
			const handleStderr = (data: Buffer) => {
				const str = data.toString();
				stderr += str;
				staging.log(str);
			};

			for (const file of files) {
				const filePath = Path.join(pluginPath, file.name);
				const dirPath = Path.dirname(filePath);
				action(() => {
					staging.log(`creating: ${file.name}`);
				});
				await FSP.mkdir(dirPath, {recursive: true});
				await FSP.writeFile(filePath, file.contents);
			}

			if (dependencies && dependencies.length > 0) {
				action(() => {
					staging.stage('installing dependencies');
					staging.progress(2, 5, true);
				});
				await this.store.node.npm(['install', ...dependencies], {
					cwd: pluginPath,
					onStdout: staging.log,
					onStderr: handleStderr,
				});
			}

			if (devDependencies && devDependencies.length > 0) {
				action(() => {
					staging.stage('installing dev dependencies');
					staging.progress(3, 5, true);
				});
				await this.store.node.npm(['install', ...devDependencies, '--save-dev'], {
					cwd: pluginPath,
					onStdout: staging.log,
					onStderr: handleStderr,
				});
			}

			if (postCreate) {
				action(() => {
					staging.stage('running scripts');
					staging.progress(4, 5, true);
				});
				for (const command of postCreate) {
					await this.store.node.npm(['run', command], {
						cwd: pluginPath,
						onStdout: handleStderr, // error output from scripts goes to stdout unfortunately
						onStderr: handleStderr,
					});
				}
			}
		} catch (error) {
			const errorMessage = `${stderr ? `\n${stderr}` : ''}\n${eem(error, true)}`;
			staging.error(`${errorMessage}\n`);
			const reportAction = {
				variant: 'info' as const,
				icon: 'bug' as const,
				title: 'Report bug',
				action: () =>
					this.store.app.reportIssue(
						`Error creating a plugin boilerplate`,
						`\`\`\`\n${errorMessage}\n\`\`\``
					),
			};
			staging.actions = [reportAction];
			this.store.modals.alert({
				variant: 'danger',
				title: `Plugin template error`,
				message: `There was an error creating your plugin template. You should report this!`,
				details: errorMessage,
				actions: [reportAction],
			});

			try {
				staging.log(`Cleaning up unsuccessful plugin template, deleting: "${pluginPath}"`);
				await deletePath(pluginPath);
			} catch {}
		}

		await staging.substage((substage) => this.reload(substage));
		staging.done();
		this.startWatching();

		return !staging.hasError();
	};

	/**
	 * Initiates a snapshot of currently installed plugins.
	 * Resolving a snapshot returns an array of plugins, processors and
	 * dependencies installed or updated since the snapshot was initiated.
	 */
	initSnapshot: () => () => PluginsSnapshot = () => {
		const {processors, dependencies} = this.store;
		const oldPluginsIdVersionMap = new Map(this.all().map((plugin) => [plugin.name, plugin.version]));
		const oldProcessorIds = new Set(processors.all().map(({id}) => id));
		const oldDependencyIds = new Set(dependencies.all().map(({id}) => id));

		return () => {
			const freshPlugins = this.all().filter(
				(plugin) => plugin.version !== oldPluginsIdVersionMap.get(plugin.name)
			);

			return {
				freshPlugins,
				newPlugins: this.all().filter((plugin) => !oldPluginsIdVersionMap.has(plugin.name)),
				newProcessors: processors.all().filter(({id}) => !oldProcessorIds.has(id)),
				freshProcessors: freshPlugins.map((plugin) => plugin.processors()).flat(),
				newDependencies: dependencies.all().filter(({id}) => !oldDependencyIds.has(id)),
			};
		};
	};
}

export interface PluginsSnapshot {
	freshPlugins: Plugin[];
	newPlugins: Plugin[];
	newProcessors: Processor[];
	freshProcessors: Processor[];
	newDependencies: Dependency[];
}
