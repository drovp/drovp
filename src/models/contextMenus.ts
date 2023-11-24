import Path from 'path';
import {shell, clipboard} from 'electron';
import {isOfType, uid, idModifiers} from 'lib/utils';
import {ContextMenus, ContextMenuItem} from 'lib/contextMenus';
import type {Item} from 'models/items';
import type {Store} from 'models/store';

export function registerContextMenus(store: Store) {
	const {dependencies, operations, profiles, plugins, processors, history, settings} = store;

	/**
	 * Profile.
	 */
	ContextMenus.register('profile', (id: unknown, event) => {
		if (typeof id !== 'string') throw new Error(`Invalid "profile" context menu payload "${id}".`);

		const profile = profiles.byId.value.get(id);
		const history = store.history;
		const modifiers = idModifiers(event);

		if (!profile) return [];

		const items: ContextMenuItem[] = [];

		// If profile accepts strings/urls, and there is some in clipboard,
		// provide paste item
		const imageBlobFormat = clipboard.availableFormats().find((item) => item.indexOf('image/') === 0);
		const clipboardText = clipboard.readText();
		const isTextInClipboard = clipboardText.length > 0;
		const isTextInClipboardUrl =
			clipboardText
				.toLowerCase()
				.trim()
				.match(/^https?:\/\//) != null;
		const accepts = profile.processor()?.config.accepts;

		if (accepts?.urls && isTextInClipboardUrl) {
			let urlJuice = clipboardText.replace(/[\w-]+:\/\/(www\.)?/i, '');
			if (urlJuice.length > 22) urlJuice = urlJuice.slice(0, 20) + '…';
			items.push({
				label: `Paste URL: "${urlJuice}"`,
				click: () =>
					profile.dropItems([{id: uid(), created: Date.now(), kind: 'url', url: clipboardText}], {
						modifiers: '',
						action: 'paste',
					}),
			});
		}

		if (accepts?.blobs && imageBlobFormat) {
			items.push({
				label: `Paste image`,
				click: () => {
					const buffer = clipboard.readImage()?.toPNG();
					if (!buffer) return;
					profile.dropItems(
						[{id: uid(), created: Date.now(), kind: 'blob', mime: 'image/png', contents: buffer}],
						{modifiers, action: 'paste'}
					);
				},
			});
		}

		if (accepts?.strings && isTextInClipboard) {
			items.push({
				label: `Paste "${clipboardText.slice(0, 10)}..."`,
				click: () =>
					profile.dropItems(
						[{id: uid(), created: Date.now(), kind: 'string', type: 'text/plain', contents: clipboardText}],
						{modifiers, action: 'paste'}
					),
			});
		}

		if (accepts?.strings || accepts?.urls) {
			items.push({
				label: `Input strings`,
				click: async () => {
					const {canceled, payload} = await store.modals.prompt(
						{
							title: 'Strings input',
							message: `Each line will create a separate string and/or URL item to drop into this profile.`,
						},
						{default: clipboardText, rows: 5}
					);

					if (!canceled) {
						const items = payload
							.split('\n')
							.map((value) => value.trim())
							.filter((value) => !!value)
							.map((contents) => ({
								id: uid(),
								created: Date.now(),
								kind: 'string' as const,
								type: 'text/plain',
								contents,
							}));

						if (items.length > 0) profile.dropItems(items, {modifiers, action: 'paste'});
					}
				},
			});
		}

		if (items.length > 0) items.push({type: 'separator'});

		items.push(
			{
				label: 'Stop pending operations',
				click: () => profile.stop(),
				enabled: profile.hasPendingOperations(),
			},
			{type: 'separator'},
			{
				label: 'Clear queue',
				click: () => profile.clearQueue(),
			},
			{
				label: 'Clear history',
				click: () => profile.clearHistory(),
			},
			{type: 'separator'},
			{
				label: `Duplicate profile`,
				click: () => profiles.duplicate(profile.id),
			},
			{
				label: `Delete profile`,
				enabled: !profile.hasPendingOperations(),
				click: () => profiles.delete(profile.id),
			},
			{type: 'separator'},
			{
				label: `Go to processor`,
				click: () => history.push(`/processors/${encodeURIComponent(profile.processorId)}`),
			},
			{
				label: `Go to plugin`,
				click: () => history.push(`/plugins/${encodeURIComponent(profile.pluginMeta.displayName)}`),
			},
			{type: 'separator'},
			{
				label: 'Copy',
				submenu: [
					{
						label: 'Import Code',
						click: () => clipboard.writeText(profile.importCode()),
					},
					{
						label: 'Import URL',
						click: () => clipboard.writeText(profile.importURL()),
					},
					{
						label: 'Import Markdown link',
						click: () => clipboard.writeText(profile.importMarkdownLink()),
					},
					{
						label: 'Import JSON',
						click: () => clipboard.writeText(profile.importJSON()),
					},
				],
			}
		);

		// Developer mode
		const plugin = profile.plugin();
		if (plugin && plugin.isLocal && settings.developerMode()) {
			items.push(
				{type: 'separator'},
				{
					label: `Edit plugin`,
					enabled: !!plugin,
					click: () => plugin.openInEditor(),
				}
			);
		}

		return items;
	});

	/**
	 * Plugin.
	 */
	ContextMenus.register('plugin', (name: unknown) => {
		if (typeof name !== 'string') throw new Error(`Invalid "plugin" context menu payload "${name}".`);

		const plugin = plugins.byId.value.get(name);
		const items: ContextMenuItem[] = [
			{
				label: 'Reload',
				click: () => plugins.reload(),
			},
		];

		if (!plugin) {
			items.push({
				label: 'Install',
				click: () => plugins.install(name),
			});

			return items;
		}

		if (plugin.isLocal) {
			items.push({
				label: 'Edit',
				click: () => plugin.openInEditor(),
			});
			items.push({
				label: 'Delete',
				click: () => plugin.uninstallPrompt(),
			});
		} else {
			const newVersion = plugin.updateAvailable();
			if (newVersion) {
				items.push({
					label: `Update to ${newVersion}`,
					click: () => plugin.updateMaybe(),
				});
			} else {
				items.push({
					label: 'Check for updates',
					click: () => plugin.checkForUpdates(),
				});
			}
			items.push({
				label: 'Uninstall',
				click: () => plugin.uninstallPrompt(),
			});
		}

		const installUrl = plugin.installUrl;
		const installMarkdownLink = plugin.installMarkdownLink;
		if (installUrl && installMarkdownLink) {
			items.push(
				{type: 'separator'},
				{
					label: 'Copy',
					submenu: [
						{
							label: 'Install URL',
							click: () => clipboard.writeText(installUrl),
						},
						{
							label: 'Install markdown link',
							click: () => clipboard.writeText(installMarkdownLink),
						},
					],
				}
			);
		}

		return items;
	});

	/**
	 * Plugins.
	 */
	ContextMenus.register('plugins', (name: unknown) => {
		return [
			{
				label: 'Reload all plugins',
				click: () => plugins.reload(),
			},
			{
				label: 'Check all for updates',
				click: () => plugins.checkForUpdates(),
			},
		];
	});

	/**
	 * Processor.
	 */
	ContextMenus.register('processor', (id: unknown) => {
		if (typeof id !== 'string') throw new Error(`Invalid "processor" context menu payload "${id}".`);

		const processor = processors.byId.value.get(id);

		if (!processor) return [];

		const items: ContextMenuItem[] = [
			{
				label: 'To Plugin',
				click: () => history.push(`/plugins/${processor.plugin.name}`),
			},
		];

		// Developer mode
		const plugin = processor.plugin;
		if (plugin.isLocal && settings.developerMode()) {
			items.push(
				{type: 'separator'},
				{label: `Edit plugin "${plugin.displayName}"`, click: () => plugin.openInEditor()}
			);
		}

		return items;
	});

	/**
	 * Operation.
	 */
	ContextMenus.register('operation', (id: unknown) => {
		if (typeof id !== 'string') throw new Error(`Invalid "operation" context menu payload "${id}"`);

		const operation = operations.byId.value.get(id);

		if (!operation) {
			throw new Error(`"operation" context menu payload "${id}" refers to non-existent operation.`);
		}

		const state = operation.state();
		const items: ContextMenuItem[] = [];

		if (state === 'pending') {
			items.push({label: 'Stop', click: () => operation.stop()});
		} else {
			if (state === 'queued') items.push({label: 'Force start', click: () => operation.start()});
			if (state === 'done') {
				items.push({label: 'Restart', click: () => operation.restart()});

				const profileOptions = operation.profile.optionsData();
				const optionsChanged = JSON.stringify(operation.payload.options) !== JSON.stringify(profileOptions);

				if (optionsChanged) {
					items.push({
						label: 'Restart with new options',
						click: () => {
							operation.updateOptions();
							operation.restart();
						},
					});
				}
			}
			items.push({label: 'Delete', click: () => operation.delete()});
		}

		return items;
	});

	/**
	 * Dependency.
	 */
	ContextMenus.register('dependency', (id: unknown) => {
		if (typeof id !== 'string') throw new Error(`Invalid "dependency" context menu payload "${id}".`);

		const dependency = dependencies.byId.value.get(id);

		if (!dependency) return [];

		const items: ContextMenuItem[] = [
			{
				label: 'To Plugin',
				click: () => history.push(`/plugins/${dependency.plugin.name}`),
			},
			{
				label: 'Open directory',
				click: () => shell.openPath(dependency.dataPath),
			},
		];

		// Developer mode
		const plugin = dependency.plugin;
		if (plugin.isLocal && settings.developerMode()) {
			items.push(
				{type: 'separator'},
				{label: `Edit plugin "${plugin.displayName}"`, click: () => plugin.openInEditor()}
			);
		}

		return items;
	});

	/**
	 * Item.
	 */
	ContextMenus.register('item', (item: unknown) => {
		if (!isOfType<Item>(item, typeof item === 'object' && item != null && typeof (item as any).kind === 'string')) {
			throw new Error(`Invalid "item" context menu payload: ${item}`);
		}
		const items: ContextMenuItem[] = [];

		switch (item.kind) {
			case 'file': {
				const normalizedPath = Path.normalize(item.path);
				if (item.kind === 'file') {
					items.push({label: `Open file`, click: () => shell.openPath(normalizedPath)});
					items.push({
						label: `Show in folder`,
						click: () => shell.showItemInFolder(normalizedPath),
					});
				} else {
					items.push({
						label: `Open containing folder`,
						click: () => shell.openPath(Path.dirname(normalizedPath)),
					});
				}
				items.push({label: `Copy path`, click: () => clipboard.writeText(normalizedPath)});
				break;
			}

			case 'directory': {
				const normalizedPath = Path.normalize(item.path);
				if (item.kind === 'directory') {
					items.push({label: `Open folder`, click: () => shell.openPath(normalizedPath)});
					items.push({label: `Show in folder`, click: () => shell.showItemInFolder(normalizedPath)});
				} else {
					items.push({
						label: `Open containing folder`,
						click: () => shell.openPath(Path.dirname(normalizedPath)),
					});
				}
				items.push({label: `Copy path`, click: () => clipboard.writeText(normalizedPath)});
				break;
			}

			case 'url':
				items.push({label: `Open URL`, click: () => shell.openExternal(item.url)});
				items.push({label: `Copy URL`, click: () => clipboard.writeText(item.url)});
				break;

			case 'string':
				items.push({label: `Copy string`, click: () => clipboard.writeText(item.contents)});
				break;
		}

		// Related navigation links
		const operation = item.operation;

		if (operation) {
			items.push({type: 'separator'});

			const inOperation = history.location.path.match(/^\/operations\/.+/) != null;
			if (!inOperation) {
				items.push({
					label: `To Operation`,
					click: () =>
						history.push(`/profiles/${operation.profile.id}?section=operations&id=${operation.id}`),
				});
			}

			items.push(
				{label: `To Profile`, click: () => history.push(`/profiles/${operation.profile.id}`)},
				{label: `To Processor`, click: () => history.push(`/processors/${operation.profile.processorId}`)},
				{label: `To Plugin`, click: () => history.push(`/plugins/${operation.profile.pluginMeta.name}`)}
			);

			// Developer mode
			const plugin = operation.profile.plugin();
			if (plugin && plugin.isLocal && settings.developerMode()) {
				items.push(
					{type: 'separator'},
					{label: `Edit plugin "${plugin.displayName}"`, click: () => plugin.openInEditor()}
				);
			}
		}

		return items;
	});
}
