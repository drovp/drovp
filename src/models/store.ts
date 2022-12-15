import Path from 'path';
import {promises as FSP} from 'fs';
import {BrowserWindow} from 'electron';
import {readJson, outputFile} from 'lib/fs';
import Worker from 'models/worker';
import {debounce} from 'lib/utils';
import {reaction} from 'statin';
import {createContext} from 'preact';
import {useContext} from 'preact/hooks';
import {App} from 'models/app';
import {createSettings, Settings} from 'models/settings';
import {Operations} from 'models/operations';
import {Plugins} from 'models/plugins';
import {Dependencies} from 'models/dependencies';
import {Processors} from 'models/processors';
import {Profiles} from 'models/profiles';
import {Events} from 'models/events';
import {Node} from 'models/node';
import {Modals} from 'models/modals';
import {StagingController} from 'models/staging';
import {Outputs} from 'models/items';
import {Session, createSession} from 'models/session';
import {registerContextMenus} from 'models/contextMenus';
import {History} from 'poutr';
import {createMemoryHistory} from 'poutr';
import {ExpiringSet} from 'lib/expiringSet';

export interface Store {
	window: BrowserWindow;
	settings: Settings;
	session: Session;
	app: App;
	staging: StagingController;
	node: Node;
	events: Events;
	modals: Modals;
	operations: Operations;
	outputs: Outputs;
	plugins: Plugins;
	dependencies: Dependencies;
	processors: Processors;
	profiles: Profiles;
	worker: Worker;
	history: History;
	recentFiles: ExpiringSet<string>;
}

export async function createStore({
	appPath,
	userDataPath,
	isWindowsPortable,
	settingsFile = 'settings.json',
	profilesFile = 'profiles.json',
	processorsOptionsFile = 'processors.json',
}: {
	appPath: string;
	userDataPath: string;
	isWindowsPortable: boolean;
	settingsFile?: string;
	sessionFile?: string;
	profilesFile?: string;
	processorsOptionsFile?: string;
}) {
	// Settings need to load before we initialize other states, since they might
	// depend on some values.
	const settingsPath = Path.join(userDataPath, settingsFile);
	const savedSettings = await readJson(settingsPath).then(null, () => undefined);

	// Create store state bag
	const store = {} as Store;
	store.settings = createSettings(savedSettings);
	store.session = createSession();
	store.history = createMemoryHistory({window});
	store.app = new App({userDataPath, appPath, isWindowsPortable}, store);
	store.staging = new StagingController(store);
	store.node = new Node(store);
	store.events = new Events(store);
	store.modals = new Modals(store);
	store.operations = new Operations(store);
	store.outputs = new Outputs(store);
	store.plugins = new Plugins(store);
	store.dependencies = new Dependencies(store);
	store.processors = new Processors(Path.join(userDataPath, processorsOptionsFile), store);
	store.profiles = new Profiles(Path.join(userDataPath, profilesFile), store);
	store.worker = new Worker(store);
	store.recentFiles = new ExpiringSet<string>({
		lifespan: 1000,
		cleanInterval: 1000,
	});

	// Save/Restore last location in development
	if (process.env.NODE_ENV === 'development') {
		const lastPathFilePath = Path.join(userDataPath, 'lastPath.txt');
		const lastPath = await FSP.readFile(lastPathFilePath, {encoding: 'utf8'}).then(null, () => undefined);
		if (lastPath && lastPath.startsWith('/')) store.history.push(lastPath);
		store.history.subscribe(({location}) => {
			FSP.writeFile(lastPathFilePath, location.href).then(null, () => undefined);
		});
	}

	// Load stuff
	await Promise.all([store.node.load(), store.plugins.load(), store.profiles.load()]);
	store.dependencies.loadDependentUpon();

	// Register context menus
	registerContextMenus(store);

	// Reload/Save on changes
	store.plugins.startWatching();
	store.profiles.startWatching();

	// Auto-save settings
	reaction(
		() => JSON.stringify(store.settings, null, 2),
		debounce((data: string) => outputFile(settingsPath, data), 100)
	);

	// Install node if missing
	if (!store.node.isReady()) store.node.install();

	return store as Store;
}

export const Store = createContext<Store | null>(null);

export function useStore(): Store {
	const store = useContext(Store);
	if (store) return store;
	throw new Error('Store not available.');
}
