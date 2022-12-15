import {h, VNode} from 'preact';
import {useRef} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useVolley, useCache} from 'lib/hooks';
import {RouteProps, Redirect} from 'poutr';
import {Vacant} from 'components/Vacant';
import {Nav, NavLink} from 'components/Nav';
import {Tag} from 'components/Tag';
import {useStore} from 'models/store';

import {ProcessorsRoute} from 'components/Processors';
import {DependenciesRoute} from 'components/Dependencies';

const sections: {[k: string]: (props: RouteProps) => VNode} = {
	processors: (props: RouteProps) => <ProcessorsRoute {...props} />,
	dependencies: (props: RouteProps) => <DependenciesRoute {...props} />,
};

const defaultUrl = '/processors';

export const ExtensionsJunction = observer(function ExtensionsJunction(props: RouteProps) {
	const {processors, dependencies} = useStore();
	const {match, location, history} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	let [lastUrl, setLastUrl] = useCache<string>('extensionsJunction.lastUrl', defaultUrl);
	const section = match.groups?.section;

	// Click on the main nav button, needs to be triaged
	if (section === 'extensions') {
		// If request is coming from within this section, go to default page.
		// If it's coming from other sections, use the last cached url we were on.
		const fromInside = history.from?.path.match(/^\/(processors|dependencies)(\/.*)?/) != null;
		return <Redirect to={fromInside ? defaultUrl : lastUrl} />;
	}

	setLastUrl(location.href);
	useVolley(containerRef);

	if (!section || !(section in sections)) {
		return (
			<main class="ExtensionsJunction" ref={containerRef}>
				<Vacant title={`Unknown route ${location.href}`} />
			</main>
		);
	}

	const contextMenu = section === 'plugins' ? 'plugins' : undefined;

	// Main pages
	return (
		<main class="ExtensionsJunction" ref={containerRef} data-context-menu={contextMenu}>
			<Nav>
				<NavLink to="/processors" activeMatch={/^\/processors(\/.*)?/} tooltip="Processors">
					Processors <Tag>{processors.all().length}</Tag>
				</NavLink>
				<NavLink to="/dependencies" activeMatch={/^\/dependencies(\/.*)?/} tooltip="Dependencies">
					Dependencies <Tag>{dependencies.all().length}</Tag>
				</NavLink>
			</Nav>
			{sections[section]?.(props)}
		</main>
	);
});
