import {ipcRenderer, shell, clipboard} from 'electron';

// prettier-ignore
export type Role = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'delete' | 'selectAll' | 'reload'
	| 'forceReload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut' | 'toggleSpellChecker' | 'togglefullscreen'
	| 'window' | 'minimize' | 'close' | 'help' | 'about' | 'services' | 'hide' | 'hideOthers' | 'unhide' | 'quit'
	| 'startSpeaking' | 'stopSpeaking' | 'zoom' | 'front' | 'appMenu' | 'fileMenu' | 'editMenu' | 'viewMenu'
	| 'shareMenu' | 'recentDocuments' | 'toggleTabBar' | 'selectNextTab' | 'selectPreviousTab' | 'mergeAllWindows'
	| 'clearRecentDocuments' | 'moveTabToNewWindow' | 'windowMenu';

export type ContextMenuClick = () => void;
export type ContextMenuItem =
	| {role: Role}
	| {type: 'separator'}
	| {
			type?: 'normal';
			label: string;
			subLabel?: string;
			enabled?: boolean;
			click?: ContextMenuClick;
			submenu?: ContextMenuItem[];
	  }
	| {
			type: 'checkbox' | 'radio';
			label: string;
			subLabel?: string;
			enabled?: boolean;
			checked?: boolean;
			click?: ContextMenuClick;
			submenu?: ContextMenuItem[];
	  };
export type ContextMenuIPCItem =
	| {role: Role}
	| {type: 'separator'}
	| {
			type?: 'normal';
			label: string;
			subLabel?: string;
			enabled?: boolean;
			submenu?: ContextMenuIPCItem[];
	  }
	| {
			type: 'checkbox' | 'radio';
			label: string;
			subLabel?: string;
			enabled?: boolean;
			checked?: boolean;
			submenu?: ContextMenuIPCItem[];
	  };

export type ContextMenuCreator = (payload: any, event: MouseEvent) => ContextMenuItem[];

// Generic global context menus
window.addEventListener('contextmenu', (event) => {
	if (event.defaultPrevented) return;

	event.preventDefault();
	event.stopPropagation();

	if (!(event?.target instanceof HTMLElement)) return;

	// Text selection
	const selection = window.getSelection()?.toString();
	if (selection && selection.length > 0) {
		openContextMenu([{role: 'copy'}, {type: 'separator'}, {role: 'selectAll'}]);
		return;
	}

	// Disable completely on some elements
	if (event.target.closest('select')) {
		openContextMenu();
		return;
	}

	// Inputs & Text areas
	const editableInput = event.target.closest('input:not([read-only]),textarea:not([read-only])');
	if (editableInput) {
		openContextMenu([
			{role: 'undo'},
			{role: 'redo'},
			{type: 'separator'},
			{role: 'cut'},
			{role: 'copy'},
			{role: 'paste'},
			{type: 'separator'},
			{role: 'selectAll'},
		]);
		return;
	}

	// Custom context menus
	// Only if event didn't come from an anchor element located withing the menu spawner.
	const menuSpawner = event.target.closest<HTMLElement>('[data-context-menu]');
	const parentAnchor = event.target.closest<HTMLElement>('a');
	const skipCustomMenu = parentAnchor != null && parentAnchor.closest('[data-context-menu]') !== parentAnchor;
	if (!skipCustomMenu && menuSpawner) {
		const name = menuSpawner.dataset.contextMenu;
		const payload = menuSpawner.dataset.contextMenuPayload;
		if (name) ContextMenus.show(name, event, payload);
		return;
	}

	// Anchor links
	const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
	if (anchor) {
		const href = anchor.href;
		if (href) {
			openContextMenu([
				{label: 'Open', click: () => shell.openExternal(href)},
				{label: 'Copy', click: () => clipboard.writeText(href)},
			]);
		}
		return;
	}

	// Generic app context menu with quick tools
	openContextMenu();
});

export const ContextMenus = {
	menuCreators: new Map<string, ContextMenuCreator>(),
	menuResponders: new Map<string, (path: number[]) => void>(),

	/**
	 * Example:
	 * ```
	 * ContextMenus.register('path', (path: unknown) => [
	 * 	{label: 'Go to path', click: () => shell.openPath(path)},
	 * 	{label: 'Copy path', click: () => clipboard.writeText(path)},
	 * ]);
	 * ```
	 */
	register(name: string, menuCreator: ContextMenuCreator) {
		if (this.menuCreators.has(name)) throw new Error(`Context menu "${name}" already exists.`);
		this.menuCreators.set(name, menuCreator);
	},

	has(name: string) {
		return this.menuCreators.has(name);
	},

	unregister(name: string) {
		return this.menuCreators.delete(name);
	},

	show(name: string, event: MouseEvent, payload: unknown) {
		const creator = this.menuCreators.get(name);
		if (!creator) throw new Error(`Request to show unregistered context menu "${name}".`);
		openContextMenu(creator(payload, event));
	},
};

export async function openContextMenu(items?: (ContextMenuItem | null | undefined | false)[]) {
	const filteredItems = items?.filter((item) => !!item) || [];
	const path = await ipcRenderer.invoke('open-context-menu', JSON.parse(JSON.stringify(filteredItems)));

	// Menu closed without any item clicked
	if (!Array.isArray(path)) return;

	// I don't have a patience to type this atm, so `any` it is
	let walker: any = filteredItems;
	for (let i = 0; i < path.length; i++) {
		const index = path[i]!;
		if (Array.isArray(walker)) {
			const item = walker[index];
			if (item) walker = i < path.length - 1 ? item.submenu : item.click;
		} else {
			walker = undefined;
		}
	}

	if (typeof walker === 'function') {
		walker();
	} else {
		throw new Error(`Invalid context menu item click handler.`);
	}
}
