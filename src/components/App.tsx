import {h, FunctionComponent, Fragment} from 'preact';
import {useEffect, useRef} from 'preact/hooks';
import manifest from 'manifest';
import {Switch, Route, Redirect, RouteProps} from 'poutr';
import {reaction} from 'statin';
import {observer} from 'statin-preact';
import {useStore} from 'models/store';
import {ProfilesJunction} from 'components/Profiles';
import {SettingsRoute} from 'components/Settings';
import {PluginsJunction} from 'components/PluginsJunction';
import {OperationsJunction} from 'components/Operations';
import {ExtensionsJunction} from 'components/Extensions';
import {AboutJunction} from 'components/About';
import {Modals} from 'components/Modals';
import {Tutorial} from 'components/Tutorial';
import {Vacant} from 'components/Vacant';
import {AppNav} from './AppNav';
import {QueueBar} from './QueueBar';

function UnknownRoute({location}: RouteProps) {
	return (
		<div class="Unknown">
			<Vacant title="Unknown route" details={location.path} />
		</div>
	);
}

function nodeGuarded(Component: FunctionComponent<RouteProps>) {
	return observer(function NodeGuarded(props: RouteProps) {
		const {node, staging} = useStore();

		if (node.isReady()) return <Component {...props} />;

		const isInstalling = staging.matchStaging('node') != null;

		return (
			<Vacant
				variant={isInstalling ? undefined : 'danger'}
				class="NodeGuard"
				icon="warning"
				loading={isInstalling}
				title={isInstalling ? `Installing Node.js` : `Node.js is missing`}
				details={isInstalling ? undefined : node.error()}
				actions={[
					{
						variant: 'info',
						semitransparent: true,
						icon: 'refresh',
						title: 'Check again',
						disableWhenStaging: true,
						action: () => node.load(),
					},
					{
						variant: 'success',
						semitransparent: true,
						icon: 'install',
						title: 'Install',
						disableWhenStaging: true,
						action: () => node.install(),
					},
				]}
			>
				<p>
					Node.js is a framework used to install and execute plugins and their processors. The app can't
					function without it.
				</p>
				<p>{manifest.productName} installs it only for itself, and doesn't pollute your system.</p>
			</Vacant>
		);
	});
}

export function App() {
	const containerRef = useRef<HTMLDivElement>(null);
	const {app, modals} = useStore();

	useEffect(() => {
		app.ready();

		// Can't use jsx attribute as inert is not typed yet...
		return reaction(() => {
			const isModalOpen = modals.all().length > 0;
			const container = containerRef.current as HTMLDivElement & {inert: boolean};
			if (container) container.inert = isModalOpen;
		});
	}, []);

	return (
		<Fragment>
			<div class="App" ref={containerRef}>
				<AppNav />
				<Switch>
					<Redirect key="root" path={/^\/$/} to={'/profiles'} />
					<Route
						key="profiles"
						path={/^\/profiles(\/(?<id>.+))?$/}
						component={nodeGuarded(ProfilesJunction)}
					/>
					<Route
						key="operations"
						path={/^\/operations(\/(?<id>.+))?$/}
						component={nodeGuarded(OperationsJunction)}
					/>
					<Route
						key="extensions"
						path={/^\/(?<section>(extensions|processors|dependencies))(\/(?<id>.+))?$/}
						component={nodeGuarded(ExtensionsJunction)}
					/>
					<Route
						key="plugins"
						path={
							/^\/(?<section>(plugins-junction|plugins|registry|manual-installer|new-plugin))(\/(?<id>.+))?$/
						}
						component={nodeGuarded(PluginsJunction)}
					/>
					<Route key="settings" path={/^\/settings$/} component={SettingsRoute} />
					<Route
						key="about"
						path={/^\/(?<section>(about-junction|about|events|tutorial|changelog|uitests))$/}
						component={AboutJunction}
					/>
					<Route key="tutorial" path={/^\/tutorial/} component={Tutorial} />
					<Route key="unknown" path={/.*/} component={UnknownRoute} />
				</Switch>
				<QueueBar />
			</div>
			<Modals />
		</Fragment>
	);
}
