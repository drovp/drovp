import {defaults} from 'config/defaults';
import manifest from 'manifest';
import {formatLongDuration, formatSize} from 'lib/utils';
import {createOptions, OptionsSignals} from 'models/options';
import {makeOptionsSchema} from '@drovp/types';

export type SerializedSettings = typeof defaults;
export type Settings = OptionsSignals<SerializedSettings>;

const IS_MAC = process.platform === 'darwin';
export const schema = makeOptionsSchema<SerializedSettings>()([
	{
		name: 'fontSize',
		type: 'number',
		default: defaults.fontSize,
		min: 12,
		max: 18,
		step: 1,
		title: 'Font size',
		description: `Shortcuts: <kbd>-</kbd> / <kbd>=</kbd>`,
		hint: 'px',
	},
	{
		name: 'compact',
		type: 'boolean',
		default: defaults.compact,
		title: 'Compact',
		description: `Shortcut: <kbd>C</kbd>`,
	},
	{
		name: 'theme',
		type: 'select',
		default: defaults.theme,
		options: ['os', 'dark', 'light'],
		title: 'Theme',
		description: `Shortcut: <kbd>D</kbd>`,
	},
	{
		name: 'showProfileTabs',
		type: 'boolean',
		default: defaults.showProfileTabs,
		title: 'Profile tabs',
		description: `Show tabs in <b>Profiles</b> section.`,
	},
	{
		name: 'profilesGridColumns',
		type: 'number',
		min: 3,
		max: 100,
		step: 1,
		softMax: true,
		default: defaults.profilesGridColumns,
		title: 'Profiles grid columns',
		description: `Number of columns in profile's grid. Controls grid snapping.`,
	},
	{
		name: 'beepOnOperationError',
		type: 'boolean',
		default: defaults.beepOnOperationError,
		title: 'Beep on operation error',
		description: 'Play a short beep whenever operation receives an error output.',
	},

	{
		type: 'divider',
		title: 'Checking for updates',
	},
	{
		name: 'updateChannel',
		type: 'select',
		default: defaults.updateChannel,
		options: ['stable', 'beta'],
		title: 'Update channel',
		isHidden: true,
	},
	{
		name: 'appUpdatesCheckingInterval',
		type: 'number',
		steps: [0, 20, 72, 168, 336, 720],
		default: defaults.appUpdatesCheckingInterval,
		title: 'App',
		hint: (hours) => (hours === 0 ? '<em>disabled</em>' : formatLongDuration(hours! * 60 * 60_000)),
		description: (value) =>
			value === 0 ? `Check manually in <a href="route://about">About section</a>.` : undefined,
	},
	{
		name: 'pluginUpdatesCheckingInterval',
		type: 'number',
		steps: [0, 20, 72, 168, 336, 720],
		default: defaults.pluginUpdatesCheckingInterval,
		title: 'Plugins',
		hint: (hours) => (hours === 0 ? '<em>disabled</em>' : formatLongDuration(hours! * 60 * 60_000)),
		description: (value) =>
			value === 0 ? `Check manually in <a href="route://plugins">Plugins section</a>.` : undefined,
	},
	{
		name: 'nodeUpdatesCheckingInterval',
		type: 'number',
		steps: [0, 168, 336, 720, 2160, 4320],
		default: defaults.nodeUpdatesCheckingInterval,
		title: 'Node.js',
		hint: (hours) => (hours === 0 ? '<em>disabled</em>' : formatLongDuration(hours! * 60 * 60_000)),
		description: (value) =>
			value === 0
				? `Check manually in <a href="route://about">About section</a>.`
				: `Framework used to execute plugins. Some plugins might be written for newer versions, so it's a good idea to update it from time to time.`,
	},

	{
		type: 'divider',
		title: 'Window',
		description: `At least one of <strong>Taskbar Button</strong> or <strong>Tray Icon</strong> has to be enabled.`,
	},

	{
		name: 'taskbarButton',
		type: 'boolean',
		default: defaults.taskbarButton,
		title: IS_MAC ? 'Dock button' : 'Taskbar button',
		hint: (value: any, settings: any) => (!settings.trayIcon ? '⚠ required' : null),
		isDisabled: (value: any, settings: any) => !settings.trayIcon,
		isResettable: false,
	},
	{
		name: 'trayIcon',
		type: 'boolean',
		default: defaults.trayIcon,
		title: 'Tray icon',
		hint: (value: any, settings: any) => (!settings.taskbarButton ? '⚠ required' : null),
		isDisabled: (value: any, settings: any) => !settings.taskbarButton,
		isResettable: false,
	},
	{
		name: 'minimizeToTray',
		type: 'boolean',
		default: defaults.minimizeToTray,
		title: 'Minimize to tray',
		hint: (value: any, settings: any) => (!settings.taskbarButton ? 'forced' : undefined),
		// This setting makes only sense when both trayIcon and taskbarButton are enabled
		// MAC doesn't allow us to take over minimization, and I don't think this setting makes sense there either?
		isHidden: (value: any, settings: any) => IS_MAC || !settings.trayIcon || !settings.taskbarButton,
	},
	{
		name: 'closeToTray',
		type: 'boolean',
		default: defaults.closeToTray,
		title: 'Close to tray',
		isHidden: (value: any, settings: any) => !settings.trayIcon,
	},
	{
		name: 'taskbarProgress',
		type: 'boolean',
		default: defaults.taskbarProgress,
		title: 'Taskbar progress',
		isHidden: (value: any, settings: any) => !settings.taskbarButton,
	},
	{
		name: 'alwaysOnTop',
		type: 'boolean',
		default: defaults.alwaysOnTop,
		title: 'Always on top',
	},

	{type: 'divider', title: 'Advanced'},

	{
		name: 'compactImportCodes',
		type: 'boolean',
		default: defaults.compactImportCodes,
		title: 'Compact import codes',
		description: `When copying import codes, use a compact mode that only includes options that differ from defaults. Creates a considerably smaller import code, but has a small potential for re-creating profiles that don't exactly match the original (when plugin decided to change its defaults without bumping major version).`,
	},
	{
		name: 'operationsProcessPriority',
		type: 'select',
		options: ['LOW', 'BELOW_NORMAL', 'NORMAL', 'ABOVE_NORMAL', 'HIGH', 'HIGHEST'],
		default: defaults.operationsProcessPriority,
		title: 'Process priority',
		description: `Priority to set for all operations' child processes. Might not work on all platforms.`,
	},
	{
		name: 'operationsHistoryLimit',
		type: 'number',
		min: 1,
		default: defaults.operationsHistoryLimit,
		title: 'Operations history limit',
		description: `Limit only affects completed operations, not the queue, which will be as big as you make it.`,
	},
	{
		name: 'outputsHistoryLimit',
		type: 'number',
		min: 1,
		default: defaults.outputsHistoryLimit,
		title: 'Outputs history limit',
		description: `Limits the global outputs history size.`,
	},
	{
		name: 'operationLogLimit',
		type: 'number',
		min: 1,
		default: defaults.operationLogLimit,
		title: 'Operation log limit',
		hint: (value) => formatSize(value!),
		description: `Max number of characters a single operation log can contain.`,
	},
	{
		name: 'expandStagingLogs',
		type: 'select',
		options: ['never', 'error', 'always'],
		default: defaults.expandStagingLogs,
		title: 'Expand staging logs',
		description: `Expanded logs prevent modal from closing on its own when staging's done.`,
	},
	{
		name: 'developerMode',
		type: 'boolean',
		default: defaults.developerMode,
		title: 'Developer mode',
		description: `Enable features for developing ${manifest.name} plugins.`,
	},
	{
		name: 'editCommand',
		type: 'string',
		default: defaults.editCommand,
		title: 'Edit command',
		description: `
			Command to open your preferred code editor.
			<br/>
			<code>\${path}</code> will be replaced with the path of a directory or file to edit.
		`,
		isHidden: (value: any, settings: any) => !settings.developerMode,
	},

	// Hidden persistent settings
	{name: 'lastAppUpdatesCheckTime', type: 'number', default: defaults.lastAppUpdatesCheckTime, isHidden: true},
	{name: 'lastNodeUpdatesCheckTime', type: 'number', default: defaults.lastNodeUpdatesCheckTime, isHidden: true},
	{name: 'lastPluginUpdatesCheckTime', type: 'number', default: defaults.lastPluginUpdatesCheckTime, isHidden: true},
	{name: 'openDevTools', type: 'boolean', default: defaults.openDevTools, isHidden: true},
	{name: 'globalOutputsDrawerHeight', type: 'number', default: defaults.globalOutputsDrawerHeight, isHidden: true},
	{name: 'profileOutputsDrawerHeight', type: 'number', default: defaults.profileOutputsDrawerHeight, isHidden: true},
	{name: 'profileCategory', type: 'string', default: defaults.profileCategory, isHidden: true},

	// Warnings
	{name: 'warnNonOfficialInstall', type: 'boolean', default: defaults.warnNonOfficialInstall, isHidden: true},
	{name: 'warnExternalInstall', type: 'boolean', default: defaults.warnExternalInstall, isHidden: true},
	{name: 'warnProfileImport', type: 'boolean', default: defaults.warnProfileImport, isHidden: true},
]);

export function createSettings(initial?: any) {
	return createOptions<SerializedSettings>(schema, initial);
}
