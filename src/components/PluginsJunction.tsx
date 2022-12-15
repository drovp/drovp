import {h, VNode} from 'preact';
import {useRef} from 'preact/hooks';
import {RouteProps, Redirect} from 'poutr';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {useVolley, useCache} from 'lib/hooks';
import {Nav, NavLink} from 'components/Nav';
import {Vacant} from 'components/Vacant';
import {RegistryRoute} from './Registry';
import {NewPlugin} from './NewPlugin';
import {PluginsRoute} from './Plugins';
import {ManualPluginInstallerRoute} from './ManualPluginInstaller';

const sections: {[k: string]: (props: RouteProps) => VNode} = {
	plugins: (props: RouteProps) => <PluginsRoute {...props} />,
	registry: (props: RouteProps) => <RegistryRoute {...props} />,
	'manual-installer': (props: RouteProps) => <ManualPluginInstallerRoute {...props} />,
	'new-plugin': (props: RouteProps) => <NewPlugin {...props} />,
};

const defaultUrl = '/plugins';

export const PluginsJunction = observer(function PluginsJunction(props: RouteProps) {
	const {settings} = useStore();
	const {match, location, history} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	let [lastUrl, setLastUrl] = useCache<string>('pluginsJunction.lastUrl', defaultUrl);
	const section = match.groups?.section;

	// Click on the main nav plugins button, needs to be triaged
	if (section === 'plugins-junction') {
		// If request is coming from within this section, go to default page.
		// If it's coming from other sections, use the last cached url we were on.
		const fromInside = history.from?.path.match(/^\/(plugins|registry|new-plugin)(\/.*)?/) != null;
		return <Redirect to={fromInside ? defaultUrl : lastUrl} />;
	}

	setLastUrl(location.href);
	useVolley(containerRef);

	if (!section || !(section in sections)) {
		return (
			<main class="PluginsJunction" ref={containerRef}>
				<Vacant title={`Unknown route ${location.href}`} />
			</main>
		);
	}

	const contextMenu = section === 'plugins' ? 'plugins' : undefined;

	// Main pages
	return (
		<main class="PluginsJunction" ref={containerRef} data-context-menu={contextMenu}>
			<Nav>
				<NavLink to="/plugins" activeMatch={/^\/plugins(\/.*)?/} data-context-menu="plugins">
					Installed
				</NavLink>
				<NavLink to="/registry" activeMatch={/^\/registry(\/.*)?/}>
					Registry
				</NavLink>
				<NavLink to="/manual-installer" activeMatch={/^\/manual-installer(\/.*)?/}>
					Manual
				</NavLink>
				{settings.developerMode() && <NavLink to="/new-plugin">New</NavLink>}
			</Nav>
			{sections[section]?.(props)}
		</main>
	);
});
