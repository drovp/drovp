import {h, RenderableProps} from 'preact';
import {action} from 'statin';
import {useMemo} from 'preact/hooks';
import {useLocation} from 'poutr';
import {observer} from 'statin-preact';
import {prevented} from 'lib/utils';
import {useStore} from 'models/store';
import {Icon, IconName} from 'components/Icon';
import {Tag} from 'components/Tag';
import {openContextMenu} from 'lib/contextMenus';

export const AppNav = observer(function AppNav() {
	const {app, node, plugins, settings} = useStore();
	const outdatedPluginsCount = plugins
		.all()
		.reduce((count, plugin) => (plugin.updateAvailable() ? count + 1 : count), 0);
	const appOrNodeUpdateAvailable = app.updateAvailable() || node.updateAvailable();

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
			<NavItem to="/settings" activeMatch={/^\/settings\/?.*/} icon="cog" tooltip="Settings">
				Settings
			</NavItem>
			<NavItem
				to="/about-junction"
				activeMatch={/^\/(about-junction|about|events|tutorial|changelog|uitests)\/?.*/}
				exactMatch={/^\/about\/?.*/}
				icon="help"
				indicator={appOrNodeUpdateAvailable ? 'success' : undefined}
				tooltip="About, Events, Tutorial"
			>
				About
			</NavItem>
		</nav>
	);
});

export type NavItemOptions = RenderableProps<{
	to: string;
	icon: IconName;
	count?: number | {number: number; variant: Variant};
	indicator?: Variant;
	activeMatch?: string | RegExp;
	exactMatch?: string | RegExp;
	tooltip?: string;
	[key: string]: any;
}>;

export function NavItem({
	to,
	count,
	tooltip,
	activeMatch,
	exactMatch,
	icon,
	indicator,
	children,
	...rest
}: NavItemOptions) {
	const [{path}, navigate] = useLocation();
	const countProps = typeof count === 'number' ? {number: count, variant: undefined} : count;

	let classNames = useMemo(() => `-to-${to.replace(/^\//, '').replace('/', '-')}`, [to]);
	if (activeMatch ? (typeof activeMatch === 'string' ? activeMatch === path : activeMatch.exec(path)) : path === to) {
		classNames += ' -active';
		if (!exactMatch || (typeof exactMatch === 'string' ? exactMatch === path : exactMatch.exec(path))) {
			classNames += ' -exact';
		}
	}

	return (
		<button class={classNames} onClick={prevented(() => navigate(to))} title={tooltip} {...rest}>
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
