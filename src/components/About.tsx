import manifest from 'manifest';
import {shell, clipboard} from 'electron';
import {h, VNode} from 'preact';
import {promises as FSP} from 'fs';
import {useRef} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useVolley, useCache} from 'lib/hooks';
import {ContextMenus} from 'lib/contextMenus';
import {RouteProps, Redirect} from 'poutr';
import {useStore} from 'models/store';
import {Button} from 'components/Button';
import {AppCard} from 'components/AppCard';
import {NodeCard} from 'components/NodeCard';
import {Icon} from 'components/Icon';
import {Vacant} from 'components/Vacant';
import {Nav, NavLink} from 'components/Nav';
import {Tag} from 'components/Tag';
import {UITestsRoute} from 'components/UITests';
import {EventsRoute} from 'components/Events';
import {Tutorial} from 'components/Tutorial';
import {Changelog} from 'components/Changelog';
import {Scrollable} from 'components/Scrollable';

// Register about-path context menu
ContextMenus.register('about-path', (path: unknown) => {
	if (typeof path !== 'string') throw new Error(`Invalid "about-path" context menu payload "${path}"`);

	return [
		{label: 'Go to path', click: () => shell.openPath(path)},
		{label: 'Copy path', click: () => clipboard.writeText(path)},
	];
});

async function ensurePathExistsAndOpen(path: string, open: (path: string) => void = (path) => shell.openPath(path)) {
	await FSP.mkdir(path, {recursive: true});
	open(path);
}

const sections: {[k: string]: (props: RouteProps) => VNode} = {
	about: (props: RouteProps) => <AboutRoute {...props} />,
	events: (props: RouteProps) => <EventsRoute {...props} />,
	tutorial: () => <Tutorial />,
	changelog: () => <AppChangelog />,
};

if (process.env.NODE_ENV === 'development') {
	sections.uitests = (props: RouteProps) => <UITestsRoute {...props} />;
}

const defaultUrl = '/about';

export const AboutJunction = observer(function AboutJunction(props: RouteProps) {
	const {settings, events} = useStore();
	const {match, location, history} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	let [lastUrl, setLastUrl] = useCache<string>('aboutJunction.lastUrl', defaultUrl);
	const section = match.groups?.section;

	// Click on the main nav button, needs to be triaged
	if (section === 'about-junction') {
		// If request is coming from within this section, go to default page.
		// If it's coming from other sections, use the last cached url we were on.
		const fromInside = history.from?.path.match(/^\/(about|events|tutorial|uitests)(\/.*)?/) != null;
		return <Redirect to={fromInside ? defaultUrl : lastUrl} />;
	}

	setLastUrl(location.href);
	useVolley(containerRef);

	if (!section || !(section in sections)) {
		return (
			<main class="AboutJunction" ref={containerRef}>
				<Vacant title={`Unknown route ${location.href}`} />
			</main>
		);
	}

	// Main pages
	return (
		<main class="AboutJunction" ref={containerRef}>
			<Nav>
				<NavLink to="/about" tooltip="About the app">
					About
				</NavLink>
				<NavLink to="/events" tooltip="Past errors, stagings, and other events">
					Events <Tag>{events.all().length}</Tag>
				</NavLink>
				<NavLink to="/changelog" tooltip="Application changelog">
					Changelog
				</NavLink>
				<NavLink to="/tutorial" tooltip="Application tutorial">
					Tutorial
				</NavLink>
				{process.env.NODE_ENV === 'development' && settings.developerMode() && (
					<NavLink to="/uitests">UI Tests</NavLink>
				)}
			</Nav>
			{sections[section]?.(props)}
		</main>
	);
});

function AppChangelog() {
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	return (
		<Scrollable innerRef={containerRef} class="AppChangelog">
			<Changelog repository={manifest.repository} currentVersion={manifest.version} />
		</Scrollable>
	);
}

export function AboutRoute(props: RouteProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	return (
		<Scrollable innerRef={containerRef} class="About">
			<AboutHeader />

			<div class="versions">
				<AppCard />
				<NodeCard />
			</div>

			<AppPaths />

			<AppVersions />

			<AppLicenses licenses={manifest.licenses} />

			<footer>
				Copyright &copy; {new Date().getFullYear()} {manifest.productName}
			</footer>
		</Scrollable>
	);
}

const AboutHeader = observer(function AboutHeader() {
	return (
		<header class="AboutHeader">
			<Icon name="logo" class="logo" />
			<div class="meta">
				<h1>{manifest.productName}</h1>
				<div class="links">
					<Button
						underline
						variant="accent"
						href={manifest.homepage}
						tooltip={`Homepage:\n${manifest.homepage}`}
					>
						Homepage <Icon name="open-external" />
					</Button>
					<Button
						underline
						variant="warning"
						href={manifest.bugs}
						tooltip={`Issues tracker:\n${manifest.bugs}`}
					>
						Issues <Icon name="open-external" />
					</Button>
					<Button
						class="discussions"
						underline
						variant="info"
						href={manifest.discussions}
						tooltip={`Discussions:\n${manifest.discussions}`}
					>
						Discussions <Icon name="open-external" />
					</Button>
				</div>
			</div>
		</header>
	);
});

function AppLicenses({
	licenses,
}: {
	licenses: {
		name: string;
		platform?: string;
		license: string;
		link: string;
	}[];
}) {
	licenses = licenses.filter(
		({platform}) =>
			platform == null ||
			platform
				.split(',')
				.map((platform) => platform.trim())
				.includes(process.platform)
	);

	return (
		<section class="AppLicenses ListBox">
			<h1>Licenses</h1>
			<p>This product contains code from the following libraries and their respective dependencies.</p>
			<ul>
				{licenses.map((item) => (
					<li>
						<h1>
							{item.name} <span class="muted">- {item.license}</span>
						</h1>
						<a href={item.link} title={item.link}>
							{item.link.replace(/^https?:\/\/(www\.)?/, '')}
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

function AppVersions() {
	const {settings} = useStore();
	const versions: [string, string][] = [
		['Electron', process.versions.electron],
		['Node', process.versions.node],
		['Chrome', process.versions.chrome],
		['v8', process.versions.v8],
	];

	return (
		<section class="AppVersions ListBox">
			<h1>Versions</h1>
			<p>
				Current app environment versions.{' '}
				{settings.developerMode() && (
					<em>
						Note that only main plugin files run in this environment. Processors run in the raw node binary
						managed above.
					</em>
				)}
			</p>
			<ul>
				{versions.map(([title, version]) => (
					<li>
						<h1>{title}</h1>
						<code>{version}</code>
					</li>
				))}
			</ul>
		</section>
	);
}

const AppPaths = observer(function AppPaths() {
	const {app, node, plugins, dependencies} = useStore();

	const paths = [
		['userData', app.userDataPath],
		['node', node.directory],
		['plugins', plugins.path, true],
		['pluginsData', plugins.dataPath],
		['dependencies', dependencies.path],
	] as const;

	return (
		<section class="AppPaths">
			<h1>Paths</h1>

			<ul class="paths">
				{paths.map(([title, path, editable]) => (
					<li data-context-menu="about-path" data-context-menu-payload={path}>
						<div class="path" title={path}>
							<code class="name">{title}</code>
							<code class="value">{path}</code>
						</div>
						{editable && (
							<Button
								transparent
								tooltip="Open in editor"
								onClick={() => ensurePathExistsAndOpen(path, (path) => app.openInEditor(path))}
							>
								<Icon name="edit" />
							</Button>
						)}
						<Button transparent tooltip="Open folder" onClick={() => ensurePathExistsAndOpen(path)}>
							<Icon name="folder-open" />
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
});
