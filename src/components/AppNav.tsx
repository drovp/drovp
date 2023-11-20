import {h, RenderableProps} from 'preact';
import {ipcRenderer} from 'electron';
import {action} from 'statin';
import {useMemo} from 'preact/hooks';
import {useLocation} from 'poutr';
import {observer} from 'statin-preact';
import {prevented, TargetedEvent, isInsideElement} from 'lib/utils';
import {useStore} from 'models/store';
import {Icon, IconName} from 'components/Icon';
import {Tag} from 'components/Tag';
import {openContextMenu} from 'lib/contextMenus';

const longDragEnterWaiters = new Set<HTMLElement>();

export const AppNav = observer(function AppNav() {
	const {app, node, plugins, settings} = useStore();
	const outdatedPluginsCount = plugins
		.all()
		.reduce((count, plugin) => (plugin.updateAvailable() ? count + 1 : count), 0);
	const appOrNodeUpdateAvailable = app.updateAvailable() || node.updateAvailable();
	const renderWindowControls = app.isWindowTitleBarHidden() && process.platform === 'win32';

	function openProfilesContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		openContextMenu([
			{
				type: 'checkbox',
				label: 'Show tabs',
				checked: settings.showProfileTabs(),
				click: () => action(() => settings.showProfileTabs(!settings.showProfileTabs())),
			},
		]);
	}

	return (
		<nav class="AppNav">
			<NavItem
				to="/profiles"
				activeMatch={/^\/profiles\/?.*/}
				exactMatch="/profiles"
				icon="profile"
				tooltip="Profiles"
				onContextMenu={openProfilesContextMenu}
			>
				Profiles
			</NavItem>
			<NavItem
				to="/operations"
				activeMatch={/^\/operations\/?.*/}
				exactMatch="/operations"
				icon="operation"
				tooltip="Operations"
			>
				Operations
			</NavItem>
			<NavItem
				to="/extensions"
				activeMatch={/^\/(processors|dependencies)(\/.*)?/}
				exactMatch={/^\/(processors|dependencies)$/}
				icon="processor"
				tooltip="Extensions"
			>
				Extensions
			</NavItem>
			<NavItem
				to="/plugins-junction"
				activeMatch={/^\/(plugins-junction|plugins|registry|manual-installer|new-plugin)(\/.*)?/}
				exactMatch={/^\/(plugins-junction|plugins|registry|manual-installer|new-plugin)$/}
				icon="plugins"
				tooltip={outdatedPluginsCount > 0 ? `Plugins (${outdatedPluginsCount} updates available)` : 'Plugins'}
				count={outdatedPluginsCount > 0 ? {number: outdatedPluginsCount, variant: 'success'} : undefined}
				data-context-menu="plugins"
			>
				Plugins
			</NavItem>
			<NavItem
				to="/about-junction"
				activeMatch={/^\/(about-junction|about|settings|events|tutorial|changelog|uitests)\/?.*/}
				exactMatch={/^\/about\/?.*/}
				icon="logo"
				indicator={appOrNodeUpdateAvailable ? 'success' : undefined}
				tooltip="About, Settings, Changelog, Events, Tutorial"
			>
				Drovp
			</NavItem>
			{renderWindowControls && (
				<button
					className="WindowControl -minimize"
					onClick={() => ipcRenderer.send('minimize-window')}
					title="Minimize"
				/>
			)}
			{renderWindowControls && (
				<button
					className="WindowControl -close"
					onClick={() => ipcRenderer.send('close-app')}
					title="Close app"
				/>
			)}
		</nav>
	);
});

type NavItemOptions = RenderableProps<{
	to: string;
	icon: IconName;
	count?: number | {number: number; variant: Variant};
	indicator?: Variant;
	activeMatch?: string | RegExp;
	exactMatch?: string | RegExp;
	tooltip?: string;
	[key: string]: any;
}>;

function NavItem({to, count, tooltip, activeMatch, exactMatch, icon, indicator, children, ...rest}: NavItemOptions) {
	const [{path}, navigate] = useLocation();
	const countProps = typeof count === 'number' ? {number: count, variant: undefined} : count;

	let classNames = useMemo(() => `NavItem -to-${to.replace(/^\//, '').replace('/', '-')}`, [to]);
	if (activeMatch ? (typeof activeMatch === 'string' ? activeMatch === path : activeMatch.exec(path)) : path === to) {
		classNames += ' -active';
		if (!exactMatch || (typeof exactMatch === 'string' ? exactMatch === path : exactMatch.exec(path))) {
			classNames += ' -exact';
		}
	}

	function handleButtonDragEnter(event: TargetedEvent<HTMLButtonElement, DragEvent>) {
		const element = event.currentTarget;
		if (longDragEnterWaiters.has(element)) return;

		const cancel = () => {
			clearTimeout(timeoutId);
			element.removeEventListener('dragleave', handleLeave);
			longDragEnterWaiters.delete(element);
		};
		const trigger = () => {
			cancel();
			navigate(to);
		};
		const handleLeave = (event: DragEvent) => {
			if (!isInsideElement(element, event)) cancel();
		};
		let timeoutId = setTimeout(trigger, 300);
		longDragEnterWaiters.add(element);
		element.addEventListener('dragleave', handleLeave);
	}

	return (
		<button
			class={classNames}
			onDragEnter={handleButtonDragEnter}
			onClick={prevented(() => navigate(to))}
			title={tooltip}
			{...rest}
		>
			<span className="icon">
				<Icon name={icon} />
				{countProps != null && (
					<Tag class="count" variant={countProps.variant}>
						{countProps.number}
					</Tag>
				)}
				{indicator && <span class={`indicator -${indicator}`} />}
			</span>
			<span class="title">{children}</span>
		</button>
	);
}
