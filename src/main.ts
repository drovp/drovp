import {app, BrowserWindow, shell, screen, Menu, MenuItem, Tray, nativeImage, ipcMain, dialog} from 'electron';
import * as Path from 'path';
import * as CP from 'child_process';
import * as FS from 'fs';
import {createStatefulWindow} from 'lib/windowStateKeeper';
import {makePromise} from 'lib/utils';
import manifest from 'manifest';
import {defaults} from 'config/defaults';
import type {SerializedSettings} from 'models/settings';
import type {RunUpdaterOptions} from 'models/app';
import type {ContextMenuIPCItem} from 'lib/contextMenus';
import {OpenWindowOptions} from '@drovp/types';
import {SetRequired} from 'type-fest';

const {promises: FSP} = FS;

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const APP_PATH = app.getAppPath();
const FORCED_USER_DATA_PATH = process.env.DROVP_FORCED_USER_DATA_PATH;
let isWindowsPortable = false;
const appReadyPromise = new Promise<void>((resolve) => {
	ipcMain.handle('ready', () => {
		devlog('ready');
		resolve();
	});
});

/**
 * Development only `console.log()`.
 */
function devlog(...args: any[]) {
	process.env.NODE_ENV === 'development' && console.log(...args);
}
function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

/**
 * Parse and process command line parameters.
 */
function processArgs(args: string[]) {
	// Handle protocol links
	const protocolHandle = `${manifest.name}://`;
	const lastArg = args[args.length - 1];
	if (lastArg && lastArg.indexOf(protocolHandle) === 0) {
		appReadyPromise.then(() => mainWindow?.webContents.send('protocol', lastArg.slice(protocolHandle.length)));
	}
}

// Development / Portable mode userData setup
devlog('cwd:', process.cwd());
if (FORCED_USER_DATA_PATH) {
	devlog('userData(forced):', FORCED_USER_DATA_PATH);
	app.setPath('userData', FORCED_USER_DATA_PATH);
} else if (IS_WIN) {
	const portableUserDataPath = Path.join(Path.dirname(process.execPath), 'userData');
	// Check for the presence of 'userData' directory, if it exists, flip into portable mode
	try {
		if (FS.statSync(portableUserDataPath).isDirectory()) {
			app.setPath('userData', portableUserDataPath);
			isWindowsPortable = true;
		}
	} catch {}
}

/**
 * App/window setup.
 */

// Enforce single instance
if (!app.requestSingleInstanceLock()) {
	app.exit(0);
} else {
	// Initial arguments handling
	processArgs(process.argv);

	// Someone tried to run a second instance
	app.on('second-instance', (event, args, workingDirectory) => {
		// Focus main window
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}

		processArgs(args);
	});

	// Create windows, tray icons, etc
	app.whenReady().then(async () => {
		await settingsLoading;
		app.dock?.[settings.taskbarButton ? 'show' : 'hide']();
		await createMainWindow();
		hideTrayIconMenuItem.enabled = settings.taskbarButton;
		alwaysOnTopMenuItem.checked = settings.alwaysOnTop;
		if (settings.trayIcon) createTrayIcon();

		// Register protocol if not already
		if (!app.isDefaultProtocolClient(manifest.name))
			app.setAsDefaultProtocolClient(manifest.name, process.execPath, []);
	});

	// Quit when all windows are closed
	app.on('window-all-closed', () => {
		// On OS X it is common for applications and their menu bar
		// to stay active until the user quits explicitly with Cmd + Q
		if (!IS_MAC) app.quit();
	});

	app.on('activate', () => {
		// On OS X it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		if (mainWindow === null) createMainWindow();
	});

	// Disable navigation to different files/urls in windows.
	app.on('web-contents-created', (event, contents) => {
		contents.on('will-navigate', (event) => {
			event.preventDefault();
			devlog(`Preventing window navigation to "${event.url}".`);
		});
	});
}

/**
 * Settings.
 */

let settings: SerializedSettings;
const settingsLoading = (async () => {
	try {
		const contents = await FSP.readFile(Path.join(app.getPath('userData'), 'settings.json'));
		settings = {...defaults, ...JSON.parse(contents.toString())};
	} catch {
		settings = defaults as SerializedSettings;
	}
})();

/**
 * Enables notifications on Windows.
 */
app.setAppUserModelId(process.execPath);

/**
 * Window/Tray creation.
 */
const icon = nativeImage.createFromPath(
	Path.join(APP_PATH, 'assets', IS_WIN ? 'logo.ico' : IS_LINUX ? 'logo.png' : 'IconTemplate.png')
);
let mainWindow: BrowserWindow | null;
let isQuitting = false;
let trayIcon: Tray | null;
let alwaysOnTopMenuItem = new MenuItem({
	label: 'Always on top',
	type: 'checkbox',
	accelerator: 't',
	click: () => toggleAlwaysOnTop(),
});
let hideTrayIconMenuItem = new MenuItem({
	label: 'Hide tray icon',
	click: () => setSetting('trayIcon', false),
});

async function createMainWindow() {
	let windowShown: () => void;
	const windowShownPromise = new Promise<void>((resolve) => {
		windowShown = resolve;
	});

	// Create the browser window
	mainWindow = await createStatefulWindow('main', {
		title: manifest.productName,
		backgroundColor: '#222',
		show: false,
		width: 550,
		height: 600,
		minWidth: 420,
		minHeight: 530,
		icon,
		titleBarStyle: process.platform === 'linux' ? 'default' : 'hidden',
		// Enabling this on a mac when title bar is hidden has no other effect but making electron expose the
		// `env(titlebar-area-x)` css variable needed for navigation styling, as we have to use the native mac traffic
		// lights (they can't be disabled without loosing window corner radius, border, shadow, resizing, ...).
		titleBarOverlay: process.platform === 'darwin',
		focusable: true,
		autoHideMenuBar: true,
		skipTaskbar: !settings.taskbarButton,
		alwaysOnTop: settings.alwaysOnTop,
		webPreferences: {
			contextIsolation: false,
			nodeIntegration: true,
		},
	});

	// Set icon
	mainWindow.setIcon(icon);

	// Remove top native menu
	// mainWindow.setMenu(null);

	// Load the app
	mainWindow.loadFile(`windows/main/index.html`);

	// Show when ready
	mainWindow.once('ready-to-show', () => {
		if (mainWindow == null) return;
		mainWindow.show();
		windowShown();
	});

	// Clear the reference
	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	// Close to tray
	mainWindow.on('close', (event: Electron.Event) => {
		if (isQuitting) return;

		event.preventDefault();

		if (settings.trayIcon && settings.closeToTray) {
			mainWindow?.hide();
		} else {
			mainWindow?.webContents.send('close-intercept');
		}

		isQuitting = false;
	});

	// Minimize to tray
	mainWindow.on('minimize', (event: Electron.Event) => {
		if (!IS_MAC && settings.trayIcon && (!settings.taskbarButton || settings.minimizeToTray)) {
			event.preventDefault();
			mainWindow?.hide();
		}
	});

	const webContents = mainWindow.webContents;

	// Reset and limit zoom levels, if users want bigger ui, they can
	// increase font size in settings.
	webContents.on('did-finish-load', () => {
		webContents.setZoomFactor(1);
		webContents.setVisualZoomLevelLimits(1, 1);
	});

	// Keep track of devtools so we can re-open on re-start
	webContents.on('devtools-opened', () => {
		setSetting('openDevTools', true);
		// re-focus the page since normally devtools takes the focus
		webContents.focus();
	});
	webContents.on('devtools-closed', () => setSetting('openDevTools', false));

	return windowShownPromise;
}

function createTrayIcon() {
	trayIcon = new Tray(icon);
	trayIcon.setToolTip(manifest.productName);
	trayIcon.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: 'Show',
				click: () => {
					mainWindow?.show();
				},
			},
			alwaysOnTopMenuItem,
			hideTrayIconMenuItem,
			{
				label: 'Exit',
				click: () => {
					isQuitting = true;
					app.quit();
				},
			},
		])
	);

	trayIcon.on('click', () => {
		if (!mainWindow) createMainWindow();
		else {
			mainWindow.show();
			mainWindow.focus();
		}
	});
}

// Sync session variables
function setSetting<T extends keyof typeof settings>(name: T, value: (typeof settings)[T]) {
	if (settings[name] === value) return;
	settings[name] = value;
	mainWindow?.webContents.send('set-setting', name, value);
}

function toggleAlwaysOnTop(force?: boolean) {
	const enable = force ?? !settings.alwaysOnTop;

	if (settings.alwaysOnTop !== enable) setSetting('alwaysOnTop', enable);

	mainWindow?.setAlwaysOnTop(enable);
	alwaysOnTopMenuItem.checked = enable;
}

/**
 * Renderer request handlers.
 */

function getIpcEventBrowserWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
	// @ts-ignore getOwnerBrowserWindow() is undocumented and untyped for some reason
	return event.sender.getOwnerBrowserWindow();
}

ipcMain.on('exit', () => app.exit());
ipcMain.on('quit', () => {
	isQuitting = true;
	app.quit();
});
ipcMain.on('relaunch', (event, link) => {
	app.relaunch({args: process.argv.slice(1).concat(['--relaunch'])});
	app.exit(0);
});

// Open links and paths with OS's default apps
ipcMain.on('open-external', (event, link) => shell.openExternal(link));

// Update window progress
ipcMain.on('set-progress', (event, progress, mode) => mainWindow?.setProgressBar(progress, {mode}));

// Window movement
ipcMain.handle('get-window-position', (event) => getIpcEventBrowserWindow(event).getPosition());
ipcMain.on('move-window-to', (event, x, y) => getIpcEventBrowserWindow(event).setPosition(x, y));

// Initiates dragging of a file at specified path
ipcMain.on('start-drag', async ({sender}, path) => {
	const paths: string[] = (Array.isArray(path) ? path : [path]).filter((path) => !!path);
	if (paths.length === 0) return;
	let icon = Path.join(APP_PATH, 'assets', 'file.png');

	try {
		if ((await FSP.stat(paths[0]!)).isDirectory()) {
			icon = Path.join(APP_PATH, 'assets', 'folder.png');
		}
	} catch {}

	sender.startDrag({file: path, icon: icon});
});

// File dialogs
ipcMain.handle('show-open-dialog', (event, options) => dialog.showOpenDialog(getIpcEventBrowserWindow(event), options));
ipcMain.handle('show-save-dialog', (event, options) => dialog.showSaveDialog(getIpcEventBrowserWindow(event), options));

// Return paths window needs to know about
ipcMain.handle('get-paths', (event, name) => ({
	resources: process.resourcesPath,
	app: APP_PATH,
	userData: app.getPath('userData'),
	isWindowsPortable,
}));

// Run updater
ipcMain.handle('run-updater', (event, {nodeBin, sequence, restartAction}: RunUpdaterOptions) => {
	// Start a detached process and exit
	try {
		// prettier-ignore
		const args = [
			Path.join(APP_PATH, 'update.js'),
			'--sequence', JSON.stringify(sequence),
			'--restartaction', JSON.stringify(restartAction),
		];
		const subprocess = CP.spawn(nodeBin, args, {
			cwd: app.getPath('userData'),
			detached: true,
			stdio: 'ignore',
		});
		subprocess.unref();
		app.exit();
	} catch (error) {
		return `spawning updater failed: ${eem(error)}`;
	}
});

// Reveal (un-minimize and focus) window that sent the event
ipcMain.on('reveal-window', (event) => {
	const srcWindow = getIpcEventBrowserWindow(event);
	if (srcWindow.isMinimized()) srcWindow.show();
	srcWindow.focus();
});

ipcMain.on('set-setting', (event, prop, value) => {
	if (!(prop in settings)) return;

	// @ts-ignore
	settings[prop] = value;

	// Special handling required for some settings
	switch (prop) {
		case 'alwaysOnTop':
			toggleAlwaysOnTop(value);
			break;

		case 'taskbarButton':
			app.dock?.[value ? 'show' : 'hide']();
			mainWindow?.setSkipTaskbar(!value);
			hideTrayIconMenuItem.enabled = value;
			break;

		case 'trayIcon':
			if (!value && trayIcon) {
				trayIcon.destroy();
				trayIcon = null;
			} else if (value && !trayIcon) {
				createTrayIcon();
			}
			break;
	}
});

ipcMain.on('start-drag', async ({sender}, path) => {
	const paths: string[] = (Array.isArray(path) ? path : [path]).filter((path) => !!path);
	if (paths.length === 0) return;
	let icon = Path.join(APP_PATH, 'assets', 'file.png');

	try {
		if ((await FSP.stat(paths[0]!)).isDirectory()) {
			icon = Path.join(APP_PATH, 'assets', 'folder.png');
		}
	} catch {}

	sender.startDrag({file: path, icon: icon});
});
ipcMain.on('open-devtools', ({sender}) => sender.openDevTools());
ipcMain.on('close-devtools', ({sender}) => sender.closeDevTools());
ipcMain.on('toggle-devtools', ({sender}) => sender.toggleDevTools());
ipcMain.on('reload-window', ({sender}) => {
	console.log('reload-window received');
	sender.reloadIgnoringCache();
});
ipcMain.on('minimize-window', (event) => getIpcEventBrowserWindow(event).minimize());
ipcMain.on('topmost-window', (event) => {
	if (!settings.alwaysOnTop) {
		// We can't use `win.moveTop()` because Windows developers in their infinite
		// wisdom decided it should do nothing if window isn't already focused...
		const window = getIpcEventBrowserWindow(event);
		window.setAlwaysOnTop(true);
		window.setAlwaysOnTop(false);
	}
});

/**
 * Modal windows with context.
 */
{
	type InternalOpenWindowOptions = SetRequired<OpenWindowOptions, 'title'> & {id: string};
	interface ModalWindowResponse {
		canceled: boolean;
		payload?: any;
	}
	interface ModalWindowContext {
		resolver: (data: ModalWindowResponse) => void;
		payload?: any;
	}

	const modalWindowContexts = new Map<number, ModalWindowContext>();

	ipcMain.handle('get-modal-window-payload', (event) => {
		return modalWindowContexts.get(event.sender.id)?.payload;
	});

	ipcMain.handle('resolve-modal-window', (event, payload) => {
		return modalWindowContexts.get(event.sender.id)?.resolver({canceled: false, payload});
	});

	ipcMain.handle('open-modal-window', async (event, options: InternalOpenWindowOptions, payload) => {
		const [promise, resolve] = makePromise<{canceled: boolean; payload?: any}>();
		const parentWindow = getIpcEventBrowserWindow(event);
		const childWindow = await createStatefulWindow(options.id, {
			title: options.title,
			backgroundColor: '#222',
			parent: parentWindow,
			show: false,
			width: options.width || 550,
			height: options.height || 600,
			minWidth: options.minWidth || 400,
			minHeight: options.minHeight || 500,
			autoHideMenuBar: true,
			focusable: true,
			webPreferences: {
				contextIsolation: false,
				nodeIntegration: true,
			},
		});
		const childId = childWindow.webContents.id;
		let resolved = false;

		let cleanupAndResolve = (response: ModalWindowResponse, skipClose?: boolean) => {
			if (resolved) return;
			resolved = true;
			modalWindowContexts.delete(childId);
			if (!skipClose) childWindow.close();
			resolve(response);
		};

		// Register context
		modalWindowContexts.set(childId, {resolver: cleanupAndResolve, payload});

		// Setup
		childWindow.once('ready-to-show', () => childWindow?.show());
		childWindow.on('closed', () => {
			cleanupAndResolve({canceled: true}, true);
		});
		childWindow.loadFile(options.path);

		const webContents = childWindow.webContents;

		// Reset zoom on load. Dunno why but I was getting zoomed window on startups
		webContents.on('did-finish-load', () => {
			webContents.setZoomFactor(1);
		});

		return promise;
	});
}

/**
 * Context menus.
 */
{
	/**
	 * Context menu creation abstraction that filters falsy items and appends development utils at the end.
	 */
	function displayContextMenu(
		window: BrowserWindow,
		items?: (MenuItem | Electron.MenuItemConstructorOptions | null | undefined | false)[] | null | undefined,
		onClose?: () => void
	) {
		const menuItems = Array.isArray(items)
			? (items.filter((item) => !!item) as (MenuItem | Electron.MenuItemConstructorOptions)[])
			: [];

		// Add global items
		if (window === mainWindow) {
			menuItems.push(
				new MenuItem({type: 'separator'}),
				new MenuItem({
					label: 'Compact',
					type: 'checkbox',
					accelerator: 'c',
					checked: settings.compact,
					click: () => setSetting('compact', !settings.compact),
				}),
				alwaysOnTopMenuItem
			);
		}

		// Add development items
		if (settings.developerMode) {
			const cursorScreenPos = screen.getCursorScreenPoint();
			const clientBounds = window.getContentBounds();
			const x = cursorScreenPos.x - clientBounds.x;
			const y = cursorScreenPos.y - clientBounds.y;

			menuItems.push(
				new MenuItem({type: 'separator'}),
				new MenuItem({
					label: 'Inspect element',
					click: () => window.webContents.inspectElement(x, y),
				}),
				new MenuItem({
					label: 'Toggle devtools',
					accelerator: 'CmdOrCtrl+Shift+I',
					click: () => window.webContents.toggleDevTools(),
				})
			);
		}

		if (menuItems.length > 0) {
			const menu = Menu.buildFromTemplate(menuItems);
			menu.popup({window, callback: onClose});
		} else {
			onClose?.();
		}
	}

	function makePathedContextMenuItems(
		items: ContextMenuIPCItem[],
		clickCreator: (path: number[]) => () => void,
		parentPath?: number[]
	): Electron.MenuItemConstructorOptions[] {
		return items.map((item, index) => {
			const path = parentPath ? [...parentPath, index] : [index];
			if (('type' in item && item.type === 'separator') || 'role' in item) return item;
			if (Array.isArray(item.submenu)) {
				return {...item, submenu: makePathedContextMenuItems(item.submenu, clickCreator, path)};
			}
			return {...item, click: clickCreator(path)};
		});
	}

	ipcMain.handle(
		'open-context-menu',
		(event, rawItems: ContextMenuIPCItem[] | null | undefined) =>
			new Promise<number[] | null>((resolve, reject) => {
				if (rawItems && !Array.isArray(rawItems)) {
					reject(new Error(`Can't create context menu, passed items is not a valid array.`));
					return;
				}
				const items = rawItems
					? makePathedContextMenuItems(rawItems, (path) => () => resolve(path))
					: undefined;
				displayContextMenu(getIpcEventBrowserWindow(event), items, () => resolve(null));
			})
	);
}
