import {app, screen, BrowserWindow, BrowserWindowConstructorOptions, Rectangle} from 'electron';
import Path from 'path';
import {promises as FS} from 'fs';
import {debounce, promiseThrottle} from 'lib/utils';

type WindowState = Rectangle & {
	maximized: boolean;
	alwaysOnTop: boolean;
};
type WindowStatesMap = Record<string, WindowState>;

export class WindowStates {
	path: string;
	data: WindowStatesMap | null = null;
	isLoaded = false;

	constructor(options?: {path?: string}) {
		this.path = options?.path || Path.join(app.getPath('userData'), 'windows.json');
	}

	load = promiseThrottle(async () => {
		let fileContents: string;

		try {
			fileContents = await FS.readFile(this.path, {encoding: 'utf8'});
		} catch (error) {
			this.data = {};
			return;
		}

		try {
			this.data = JSON.parse(fileContents) as WindowStatesMap;
		} catch (error) {
			this.data = {};
		}

		this.isLoaded = true;
	});

	save = promiseThrottle(
		() => FS.writeFile(this.path, JSON.stringify(this.data || {}, null, 2), {encoding: 'utf8'}),
		'queue'
	);

	async get(name: keyof WindowStatesMap): Promise<WindowState | undefined> {
		if (this.data == null) await this.load();
		return this.data?.[name];
	}

	async set(name: string, rectangle: WindowState): Promise<void> {
		if (this.data == null) await this.load();
		if (this.data != null) this.data[name] = rectangle;
		await this.save();
	}
}

interface WindowStateKeeperOptions {
	timeout?: number;
	statesBag?: WindowStates;
}

let commonStatesBag: WindowStates | undefined;

export class WindowStateKeeper {
	protected name: string;
	protected rectangle: WindowState | undefined = undefined;
	protected window: BrowserWindow | null = null;
	protected options: WindowStateKeeperOptions;
	protected statesBag: WindowStates;

	static defaults: WindowStateKeeperOptions = {
		timeout: 100,
	};

	constructor(name: string, options?: WindowStateKeeperOptions) {
		if (options?.statesBag) {
			this.statesBag = options?.statesBag;
		} else {
			this.statesBag = commonStatesBag = commonStatesBag || new WindowStates();
		}
		this.options = {
			...WindowStateKeeper.defaults,
			...options,
		};
		this.name = name;
		this.changeHandler = debounce(this.changeHandler.bind(this), this.options.timeout);
		this.forget = this.forget.bind(this);
	}

	async load(): Promise<WindowState | undefined> {
		this.rectangle = await this.statesBag.get(this.name);
		return this.rectangle;
	}

	async get(): Promise<WindowState | null> {
		if (!this.statesBag.isLoaded) await this.statesBag.load();

		this.rectangle = await this.statesBag.get(this.name);

		if (this.rectangle == null) return null;

		// Fit the rectangle into the available window area
		let area = screen.getDisplayMatching(this.rectangle).workArea;
		let {x, y, width, height} = this.rectangle;
		width = Math.min(width, area.width);
		height = Math.min(height, area.height);
		x = Math.min(Math.max(x, area.x), area.x + area.width - width);
		y = Math.min(Math.max(y, area.y), area.y + area.height - height);
		Object.assign(this.rectangle, {x, y, width, height});

		return this.rectangle;
	}

	set(rectangle: WindowState): Promise<void> {
		this.rectangle = rectangle;
		return this.statesBag.set(this.name, rectangle);
	}

	protected changeHandler() {
		if (this.window != null)
			this.set({
				...this.window.getNormalBounds(),
				maximized: this.window.isMaximized(),
				alwaysOnTop: this.window.isAlwaysOnTop(),
			});
	}

	observe(window: BrowserWindow) {
		if (this.window) this.forget();
		this.window = window;
		window.addListener('resize', this.changeHandler);
		window.addListener('move', this.changeHandler);
		window.addListener('always-on-top-changed', this.changeHandler);
		window.addListener('closed', this.forget);
	}

	forget() {
		if (this.window == null) return;
		this.window.removeListener('resize', this.changeHandler);
		this.window.removeListener('move', this.changeHandler);
		this.window.removeListener('always-on-top-changed', this.changeHandler);
		this.window.removeListener('closed', this.forget);
		this.window = null;
	}
}

/**
 * Convenience function that removes boilerplate by creating both
 * WindowStateKeeper and BrowserWindow instance, attaches all necessary
 * events between them, and returns the managed BrowserWindow instance.
 */
export async function createStatefulWindow(
	name: string,
	options?: BrowserWindowConstructorOptions
): Promise<BrowserWindow> {
	const windowState = new WindowStateKeeper(name);
	const state = await windowState.get();
	const maximize = Boolean(state?.maximized);

	// Only manage properties not managed by options
	if (state) {
		// @ts-ignore
		delete state.maximized; // not a BrowserWindowOption, has to be triggered manually
		// @ts-ignore
		if (options?.hasOwnProperty('alwaysOnTop')) delete state.alwaysOnTop;
	}

	// Create the browser window
	const window = new BrowserWindow({
		...options,
		...state,
	});

	if (maximize) window.once('ready-to-show', () => window.maximize());

	windowState.observe(window);

	return window;
}
