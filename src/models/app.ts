import manifest from 'manifest';
import {promises as FSP} from 'fs';
import * as Path from 'path';
import {UPDATE_LOG_FILE, UPDATE_ERROR_LOG_FILE} from 'config/constants';
import {ipcRenderer} from 'electron';
import {promisify} from 'util';
import {exec} from 'child_process';
import semverCompare from 'semver-compare';
import {Item} from '@drovp/types';
import {signal, Signal, createAction, reaction, action, computed} from 'statin';
import {
	eem,
	uid,
	isOfType,
	debounce,
	promiseThrottle,
	fetchJson,
	createUpdatesChecker,
	reportIssue,
	download,
	idKey,
	idModifiers,
} from 'lib/utils';
import {registerDraggingListener} from 'lib/draggingListener';
import {extract} from 'lib/extract';
import {addUrlItemsFromStrings} from 'lib/serialize';
import {exists, deletePath, prepareEmptyDirectory} from 'lib/fs';
import type {Store} from 'models/store';
import type {Staging, SubstageCreator} from 'models/staging';
import type {SerializedSettings} from 'models/settings';
import {makeToast} from 'components/Toast';
import {AppClosePrompt} from 'components/App';
import type {Sequence, SequenceAction} from 'update';

const execPromise = promisify(exec);

type SupportedWinArch = 'x64';
type SupportedLinuxArch = 'x64';
type SupportedMacArch = 'x64' | 'arm64';

interface VersionData {
	version: string;
	binariesVersion: string;
	electronVersion: string;
	date: string;
	universal: {
		core: string;
	};
	win32: {
		x64: {
			nsis: string;
			portable: string;
			binaries: string;
		};
	};
	linux: {
		x64: {
			AppImage: string;
		};
	};
	darwin: {
		x64: {
			dmg: string;
			archive: string;
			binaries: string;
		};
		arm64: {
			dmg: string;
			archive: string;
			binaries: string;
		};
	};
}

interface VersionResponse {
	stable: VersionData;
	beta: VersionData;
}

export interface RunUpdaterOptions {
	nodeBin: string;
	sequence: Sequence;
	restartAction: SequenceAction;
}

export class App {
	store: Store;
	readonly appPath: string;
	readonly userDataPath: string;
	readonly binPath: string;
	readonly rootPath: string;
	readonly updateDataPath: string;
	readonly isWindowsPortable: boolean;
	width = signal(0);
	height = signal(0);
	focused = signal(true);
	osTheme: Signal<'dark' | 'light'>;
	version = manifest.version;
	isModalWindowOpen = signal(false);
	draggingMode = signal<null | string>(null);
	draggingMeta = signal<any>(null);
	lastDropTime = 0;
	latest = signal<null | VersionResponse>(null);
	isCheckingForUpdates = signal(false);
	topmostWindowTimeoutId: ReturnType<typeof setTimeout> | null = null;
	lastDragEnd = 0; // timestamp

	/**
	 * A map of <pluginId, latestAvailableVersion>. We can't keep latest version
	 * on each plugin model as they get recreated on each reload.
	 */
	pluginUpdates = signal(new Map<string, string>());

	// Time interval observables.
	// These values facilitate creating computed properties that update at most
	// once per time{X} milliseconds.
	time300 = signal(Date.now());
	time1000 = signal(Date.now());

	constructor(
		{userDataPath, appPath, isWindowsPortable}: {userDataPath: string; appPath: string; isWindowsPortable: boolean},
		store: Store
	) {
		this.store = store;
		this.appPath = appPath;
		this.userDataPath = userDataPath;
		this.isWindowsPortable = isWindowsPortable;
		this.binPath = Path.join(process.resourcesPath, 'bin');
		this.updateDataPath = Path.join(userDataPath, 'update');

		// Lets attempt to get an app root folder path in a stable manner, as
		// electron apparently doesn't have an API for this ffs...
		switch (process.platform) {
			case 'win32':
				this.rootPath = Path.dirname(process.execPath);
				break;

			case 'darwin':
				this.rootPath = Path.resolve(appPath, '../../../'); // lol
				break;

			case 'linux':
				// This value is not used on linux yet, as we can't modify contents of AppImage
				this.rootPath =
					process.env.APPIMAGE && process.env.APPDIR ? process.env.APPDIR : Path.dirname(process.execPath);
				break;

			default:
				throw new Error(`Unsupported platform.`);
		}

		this.handleResize();

		registerDraggingListener((isDragging, event) => {
			if (isDragging) {
				this.startDragging(event);
			} else {
				this.endDragging();
			}
		});
		addEventListener('focus', this.handleFocus);
		addEventListener('blur', this.handleBlur);
		addEventListener('resize', debounce(this.handleResize, 200));
		addEventListener('drop', () => (this.lastDropTime = Date.now()));

		// Sets up time interval observables
		setInterval(() => action(() => this.time300(Date.now())), 300);
		setInterval(() => action(() => this.time1000(Date.now())), 1000);

		// Cancel dragging on any input
		// Sometimes, dragging might get stuck (dropping while scrolling edges,
		// etc...), and this helps user escape this state.
		addEventListener('keydown', (event) => {
			const keyId = idKey(event);
			const modifiersId = idModifiers(event);
			// Ignore repeat keys, and keys that are just modifiers
			if (!event.repeat && modifiersId !== keyId) this.endDragging();
		});
		addEventListener('keyup', (event) => {
			const keyId = idKey(event);
			// If alt was released shortly after drop, it was probably used
			// as a modifier, and shouldn't cause window menu to show up.
			if (keyId === 'Alt' && Date.now() - this.lastDropTime < 1000) {
				event.preventDefault();
			}
		});
		addEventListener('mousedown', this.endDragging);
		addEventListener('wheel', this.endDragging);

		// Keep track of OS theme, doing this in CSS with @media requires
		// duplicating whole color schemes and bloating the file CSS file.
		const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		this.osTheme = signal(darkModeMediaQuery.matches ? 'dark' : 'light');
		darkModeMediaQuery.addEventListener(
			'change',
			createAction((event) => this.osTheme(event.matches ? 'dark' : 'light'))
		);

		// Updates checking
		createUpdatesChecker(
			store.settings.appUpdatesCheckingInterval,
			store.settings.lastAppUpdatesCheckTime,
			promiseThrottle(() => this.checkForUpdates())
		);

		// Protocol url handlers
		ipcRenderer.on('protocol', (event, path: string) => {
			const [action, ...parts] = path.split('/');
			const payload = parts.join('/');

			switch (action) {
				case 'install':
					this.store.history.push(`/registry/${payload}`);
					break;

				case 'install-external': {
					const uriSafePayload = encodeURIComponent(decodeURIComponent(payload));
					this.store.history.push(`/external-installer?source=${uriSafePayload}`);
					break;
				}

				case 'import':
					this.store.modals.profileImport({initial: payload});
					break;

				case 'drop': {
					const profileId = String(parts[0]);
					const profile = this.store.profiles.byId().get(profileId);

					if (!profile) {
						this.store.app.showError({
							title: 'drop protocol error',
							message: `Received <b>drop</b> protocol request for profile id "<b>${profileId}</b>", which doesn't exist. Request URL:`,
							details: `${manifest.name}://${path}`,
						});
						break;
					}

					const items: Item[] = parts
						.slice(1)
						.map(decodeURIComponent)
						.map((contents) => ({
							id: uid(),
							created: Date.now(),
							kind: 'string',
							type: 'text/plain',
							contents,
						}));
					addUrlItemsFromStrings(items);

					if (items.length == 0) {
						this.store.app.showError({
							title: 'drop protocol error',
							message: `Received <b>drop</b> protocol request for profile id "<b>${profileId}</b>", but no inputs. Request URL:`,
							details: `${manifest.name}://${path}`,
						});
						break;
					}

					profile.dropItems(items, {action: 'protocol', modifiers: ''});

					break;
				}
			}
		});

		ipcRenderer.on('close-intercept', this.close);

		// Sync settings with main process
		const settings = this.store.settings;
		for (let setting of Object.keys(settings) as (keyof SerializedSettings)[]) {
			reaction(
				() => settings[setting](),
				(value: ReturnType<(typeof settings)[typeof setting]>) => {
					ipcRenderer.send(`set-setting`, setting, value);
				}
			);
		}

		ipcRenderer.on('set-setting', (event, setting: string, value: any) => {
			if (isOfType<keyof typeof settings>(setting, setting in settings)) {
				action(() => settings[setting](value));
			}
		});
	}

	/**
	 * App title intended to be used as a window title.
	 */
	title = computed(() => `${manifest.productName} (BETA)`);

	latestVersion = computed(() => {
		return this.latest()?.[this.store.settings.updateChannel()].version;
	});

	updateAvailable = computed(() => {
		const latestVersion = this.latestVersion();
		return latestVersion && semverCompare(latestVersion, manifest.version) > 0 ? latestVersion : false;
	});

	// Current app theme, computed from settings.theme and operating system dark mode
	theme = computed(() => {
		const theme = this.store.settings.theme();
		return theme === 'os' ? this.osTheme() : theme;
	});

	polarTheme = computed(() => (this.theme() === 'light' ? 'dark' : 'light'));

	isWindowTitleBarHidden = computed(() => process.platform !== 'linux');

	// Notifies main process that everything is ready
	ready = () => ipcRenderer.send('ready');

	isUpdating = () => this.store.staging.matchStaging('app', 'update') != null;

	retrieveLatestVersionData = async () => {
		const url = new URL('latest.json', manifest.homepage);
		return await fetchJson<VersionResponse>(url.toString(), {cache: 'no-cache'});
	};

	checkForUpdates = async (showErrorToUser = false) => {
		action(() => this.isCheckingForUpdates(true));

		let latestData: VersionResponse | undefined;
		try {
			latestData = await this.retrieveLatestVersionData();
			action(() => {
				this.store.settings.lastAppUpdatesCheckTime(Date.now());
			});
		} catch (error) {
			const event = this.store.events.create({
				variant: 'danger',
				title: `Update check error`,
				details: eem(error),
			});
			if (showErrorToUser) event.open();
		}

		action(() => {
			this.isCheckingForUpdates(false);
			this.latest(latestData || null);
		});

		return this.updateAvailable();
	};

	checkUpdateError = async () => {
		const errorLogFilePath = Path.join(this.userDataPath, UPDATE_ERROR_LOG_FILE);
		const updateLogFilePath = Path.join(this.userDataPath, UPDATE_LOG_FILE);
		if (await exists(errorLogFilePath)) {
			try {
				const errorLog = await FSP.readFile(errorLogFilePath, {encoding: 'utf-8'});
				let updateLog: string | undefined;
				try {
					updateLog = await FSP.readFile(updateLogFilePath, {encoding: 'utf-8'});
				} catch {}
				this.store.events
					.create({
						variant: 'danger',
						title: 'Update error',
						message: `There was an error while updating the app.`,
						details: errorLog,
						actions: [
							{
								icon: 'bug',
								title: 'Report issue',
								action: () =>
									reportIssue(manifest.bugs, {
										title: 'Update error',
										body: `\`\`\`\n${updateLog || errorLog}\n\`\`\``,
									}),
							},
						],
					})
					.open();
				await deletePath(errorLogFilePath);
			} catch {}
		}
	};

	updateMaybe = async () => {
		const updateAvailable = await this.checkForUpdates();
		if (updateAvailable) {
			await this.update();
		} else {
			this.store.modals.alert({
				title: `App update`,
				message: `You already have the latest version installed.`,
			});
		}
	};

	update = async (substage?: SubstageCreator) => {
		if (process.env.NODE_ENV === 'development') {
			this.store.modals.alert({
				title: `Update error`,
				message: `Updating is disabled in development mode.`,
			});
			return;
		}

		try {
			var latest = await this.retrieveLatestVersionData();
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: `Update error`,
					message: `Couldn't retrieve latest version data.`,
					details: eem(error),
				})
				.open();
			return;
		}

		const channel = latest[this.store.settings.updateChannel()];
		const updateCore = semverCompare(channel.version, manifest.version) > 0;
		const updateElectron = semverCompare(channel.electronVersion, manifest.electronVersion) > 0;
		const updateBinaries = semverCompare(channel.binariesVersion, manifest.binariesVersion) > 0;

		// Already up to date
		if (!updateElectron && !updateBinaries && !updateCore) {
			makeToast({message: 'App is already up to date'});
			return;
		}

		// We need to swap all binaries and electron
		const descriptor = {target: 'app' as const, action: 'update' as const, title: `Updating the app`};
		const staging = substage?.(descriptor) || this.store.staging.start(descriptor);
		const sequence: Sequence = [{action: 'wait', time: 100}];
		let restartAction: SequenceAction | undefined;

		try {
			await prepareEmptyDirectory(this.updateDataPath);

			switch (process.platform) {
				case 'linux': {
					const archUrls = channel.linux[process.arch as SupportedLinuxArch];
					const appImagePath = process.env.APPIMAGE;

					if (!appImagePath) {
						throw new Error(`APPIMAGE environment variable is missing, can't update.`);
					}

					const appImageSequence = await this.setupAppImageUpdate(archUrls.AppImage, appImagePath, staging);
					restartAction = {action: 'start', path: appImagePath, detached: true};
					sequence.push(...appImageSequence, restartAction);
					break;
				}

				case 'darwin': {
					restartAction = {
						action: 'exec',
						command: `open "/Applications/${manifest.productName}.app"`,
						cwd: process.cwd(),
					};
					const archUrls = channel.darwin[process.arch as SupportedMacArch];

					if (updateElectron) {
						const nsisSequence = await this.setupDmgUpdate(archUrls.archive, staging);
						sequence.push(...nsisSequence);
					} else {
						if (updateCore) {
							const updateCoreSequence = await this.setupCoreUpdate(channel.universal.core, staging);
							sequence.push(...updateCoreSequence);
						}

						if (updateBinaries) {
							const updateCoreSequence = await this.setupBinariesUpdate(archUrls.binaries, staging);
							sequence.push(...updateCoreSequence);
						}
					}

					sequence.push(restartAction);
					break;
				}

				case 'win32': {
					const archUrls = channel.win32[process.arch as SupportedWinArch];
					restartAction = {
						action: 'start',
						path: process.execPath,
						cwd: process.cwd(),
						detached: true,
					};

					if (updateElectron) {
						if (this.isWindowsPortable) {
							const portableSequence = await this.setupPortableUpdate(archUrls.portable, staging);
							sequence.push(...portableSequence, restartAction);
						} else {
							const nsisSequence = await this.setupNsisUpdate(archUrls.nsis, staging);
							sequence.push(...nsisSequence);
						}
					} else {
						if (updateCore) {
							const updateCoreSequence = await this.setupCoreUpdate(channel.universal.core, staging);
							sequence.push(...updateCoreSequence);
						}

						if (updateBinaries) {
							const updateCoreSequence = await this.setupBinariesUpdate(archUrls.binaries, staging);
							sequence.push(...updateCoreSequence);
						}

						sequence.push(restartAction);
					}
					break;
				}
			}

			if (!restartAction) throw new Error(`Missing restart action, can't start updater.`);

			const runUpdaterOptions: RunUpdaterOptions = {nodeBin: this.store.node.nodePath, sequence, restartAction};

			// When run-updater returns, it's an error
			const error = await ipcRenderer.invoke('run-updater', runUpdaterOptions);
			staging.error(`${error}`);
		} catch (error) {
			staging.error(eem(error));
		}

		staging.done();
	};

	setupNsisUpdate = async (installerUrl: string, staging: Staging) => {
		staging.stage('downloading installer');
		staging.log(`url: ${installerUrl}`);
		const downloadedFile = await download(installerUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);
		return [{action: 'start', path: downloadedPath, detached: true}] as Sequence;
	};

	setupPortableUpdate = async (archiveUrl: string, staging: Staging) => {
		staging.stage('downloading');
		staging.log(`url: ${archiveUrl}`);
		const downloadedFile = await download(archiveUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);

		staging.progress(null);
		staging.stage('extracting');
		const extractedPath = Path.join(this.updateDataPath, 'portable-contents');
		staging.log(`destination: "${extractedPath}"`);
		await extract(downloadedPath, extractedPath, {onLog: staging.log, onProgress: staging.progress});
		staging.progress(null);

		return [{action: 'replace-contents', from: extractedPath, to: this.rootPath, ignore: ['userData']}] as Sequence;
	};

	setupAppImageUpdate = async (appImageUrl: string, appImagePath: string, staging: Staging) => {
		staging.stage('downloading');
		staging.log(`url: ${appImageUrl}`);
		const downloadedFile = await download(appImageUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);
		staging.progress(null);

		// Ensure AppImage is marked as executable
		staging.log(`marking as executable: "${downloadedPath}"`);
		await FSP.chmod(downloadedPath, 0o755);

		return [{action: 'replace-file', from: downloadedPath, to: appImagePath}] as Sequence;
	};

	setupDmgUpdate = async (archiveUrl: string, staging: Staging) => {
		staging.stage('downloading');
		staging.log(`url: ${archiveUrl}`);
		const downloadedFile = await download(archiveUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);

		staging.progress(null);
		staging.stage('extracting');
		const extractedPath = Path.join(this.updateDataPath, 'dmg-contents');
		staging.log(`destination: "${extractedPath}"`);
		await extract(downloadedPath, extractedPath, {onLog: staging.log, onProgress: staging.progress});
		staging.progress(null);

		return [{action: 'replace-contents', from: extractedPath, to: this.rootPath}] as Sequence;
	};

	setupCoreUpdate = async (coreUrl: string, staging: Staging) => {
		staging.stage('downloading core');
		staging.log(`url: ${coreUrl}`);
		const downloadedFile = await download(coreUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);

		staging.progress(null);
		staging.stage('extracting');
		const extractedPath = Path.join(this.updateDataPath, 'core');
		staging.log(`destination: "${extractedPath}"`);
		await extract(downloadedPath, extractedPath, {onLog: staging.log, onProgress: staging.progress});
		staging.progress(null);

		return [{action: 'replace-contents', from: extractedPath, to: this.appPath}] as Sequence;
	};

	setupBinariesUpdate = async (binariesUrl: string, staging: Staging) => {
		staging.stage('downloading binaries');
		staging.log(`url: ${binariesUrl}`);
		const downloadedFile = await download(binariesUrl, this.updateDataPath, {
			onProgress: staging.progress,
			onLog: staging.log,
		});
		const downloadedPath = Path.join(this.updateDataPath, downloadedFile);
		staging.log(`downloaded file: "${downloadedPath}"`);

		staging.progress(null);
		staging.stage('extracting');
		const extractedPath = Path.join(this.updateDataPath, 'bin');
		staging.log(`destination: "${extractedPath}"`);
		await extract(downloadedPath, extractedPath, {onLog: staging.log, onProgress: staging.progress});
		staging.progress(null);

		// Ensure binaries are marked as executable.
		// When unix binaries are packed on windows, 7zip doesn't mark them as such.
		for (const file of await FSP.readdir(extractedPath)) {
			const filePath = Path.join(extractedPath, file);
			if (await exists(filePath, (stat) => stat.isFile())) {
				staging.log(`marking as executable: "${filePath}"`);
				await FSP.chmod(filePath, 0o755);
			}
		}

		return [{action: 'replace-contents', from: extractedPath, to: this.binPath}] as Sequence;
	};

	queueTopmostWindow = (time = 1000) => {
		this.cancelQueueTopmostWindow();
		this.topmostWindowTimeoutId = setTimeout(() => ipcRenderer.send('topmost-window'), time);
	};

	cancelQueueTopmostWindow = () => {
		if (this.topmostWindowTimeoutId) {
			clearTimeout(this.topmostWindowTimeoutId);
			this.topmostWindowTimeoutId = null;
		}
	};

	startDragging = createAction((event: DragEvent) => {
		const transfer = event.dataTransfer;
		if (transfer != null) {
			// Bring window to the top of all other windows when dragging over it for a period of time.
			// We ignore macOS because it handles this natively already.
			if (process.platform !== 'darwin') this.queueTopmostWindow(1000);

			if (transfer.types[0] === 'profile') this.draggingMode('profile');
			else if (transfer.types[0] === 'Files') this.draggingMode('files');
			else if (transfer.items.length > 0) this.draggingMode('items');
		} else {
			this.endDragging();
		}
	});

	endDragging = createAction(() => {
		if (this.draggingMode()) {
			this.lastDragEnd = Date.now();
		}
		this.cancelQueueTopmostWindow();
		this.draggingMode(null);
		this.draggingMeta(null);

		// Ensure all profiles drop their dragged flags
		for (const profile of this.store.profiles.all()) {
			profile.isDragged(false);
			profile.isDraggedOver(false);
		}
	});

	reportIssue = (title: string, body?: string) => {
		reportIssue(manifest.bugs, {title, body});
	};

	openInEditor = async (path: string) => {
		try {
			await execPromise(this.store.settings.editCommand().replace('${path}', path));
		} catch (error) {
			this.store.events
				.create({
					variant: 'danger',
					title: 'Command error',
					message: `Couldn't open path in editor. Maybe incorrect <b>Edit command</b> configuration?`,
					details: `Command: ${this.store.settings.editCommand()}\n   Path: ${path}\n  Error: ${eem(error)}`,
				})
				.open();
		}
	};

	handleResize = createAction(() => {
		this.width(window.innerWidth);
		this.height(window.innerHeight);
	});

	handleFocus = createAction(() => this.focused(true));

	handleBlur = createAction(() => this.focused(false));

	// Prompts the user when queue is not empty, or operations are pending
	close = () => {
		if (this.store.operations.pending().length + this.store.operations.queued().length > 0) {
			this.store.modals.create({
				variant: 'danger',
				title: 'Unfinished operations!',
				content: AppClosePrompt,
				actions: [
					{
						variant: 'danger',
						icon: 'power',
						title: 'Quit',
						action: () => this.quit(),
					},
					{
						icon: 'x',
						title: 'Cancel',
						muted: true,
						focused: true,
						action: () => {},
					},
				],
			});
		} else {
			this.quit();
		}
	};

	// Gracefully quits the app
	quit = () => ipcRenderer.send('quit');

	// Force exit, ignores any prevention or whatever is going on
	exit = () => ipcRenderer.send('exit');

	/**
	 * Displays a modal with error and report button.
	 */
	showError = ({title, message, details}: {title: string; message?: string; details?: string}) => {
		this.store.events
			.create({
				variant: 'danger',
				title,
				message,
				details,
				actions: [
					{
						variant: 'info',
						icon: 'bug',
						title: 'Report bug',
						action: () =>
							this.store.app.reportIssue(
								title,
								`${message ? `${message}\n\n` : ''}${details ? `\`\`\`\n${details}\n\`\`\`` : ''}`
							),
					},
				],
			})
			.open();
	};

	/**
	 * App error handler.
	 */
	handleError = (error: any) => this.showError({title: 'Error', details: eem(error, true)});
}
