import {shell} from 'electron';
import manifest from 'manifest';
import {h, RenderableProps} from 'preact';
import {useState, useEffect, useRef, Ref, useMemo} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useVolley, useCachedState} from 'lib/hooks';
import {registry, PluginRegistryMeta} from 'lib/registry';
import {useStore} from 'models/store';
import {Plugin as PluginModel} from 'models/plugins';
import {Dependency} from 'models/dependencies';
import {RouteProps} from 'poutr';
import {Nav, NavLink} from 'components/Nav';
import {Icon} from 'components/Icon';
import {Tag} from 'components/Tag';
import {Button} from 'components/Button';
import {Markdown} from 'components/Markdown';
import {TitleBar} from 'components/TitleBar';
import {Issues} from 'components/Issues';
import {ProcessorCard} from 'components/ProcessorCard';
import {DependencyCard} from 'components/DependencyCard';
import {Vacant} from 'components/Vacant';
import {PluginInstallButton} from './PluginInstallButton';
import {ProfilesList} from 'components/ProfilesList';
import {Scrollable} from 'components/Scrollable';
import {PluginCards} from 'components/PluginCards';
import {PluginDisplayName} from 'components/PluginDisplayName';
import {Changelog} from 'components/Changelog';

export const PluginRoute = observer(function PluginRoute({match, location, history}: RouteProps) {
	const junctionSection = match.groups?.section;
	const id = match.groups?.id;
	const section = location.searchParams.get('section') || undefined;

	if (!junctionSection || !id) return <Vacant title={`Invalid plugin route "${location.href}".`} />;

	const {plugins} = useStore();
	const isRegistry = junctionSection === 'registry';
	const installed = plugins.byId().get(id);
	const [npmData, setNpmData] = useCachedState<PluginRegistryMeta | null>(`pluginNpmData:${id}`, null);
	const [isLoading, setIsLoading] = useState<boolean>(isRegistry);
	const [responseStatus, setResponseStatus] = useState<string | number | null>(npmData ? 200 : null);
	const data = isRegistry ? npmData : installed?.meta;

	// Fetch npm data
	useEffect(() => {
		if (!isRegistry) {
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		registry
			.meta(id)
			.then((meta) => {
				setNpmData(meta);
				setResponseStatus(200);
			})
			.catch((error) => setResponseStatus(error.status))
			.finally(() => setIsLoading(false));
	}, [id]);

	// We don't have any plugin data available
	if (!data) {
		return isLoading ? (
			<Vacant loading title={[`Loading plugin `, <strong>{id}</strong>]} />
		) : (
			<Vacant
				title={responseStatus || 'Not found'}
				actions={[
					{
						icon: 'search',
						title: 'Search registry',
						action: () => history.push(`/registry?search=${encodeURIComponent(id)}`),
					},
				]}
			>
				Plugin <strong>{id}</strong> not found.
			</Vacant>
		);
	}

	return (
		<Plugin
			data={data}
			section={section}
			onSectionChange={(section: string) => history.replace(`/${junctionSection}/${id}?section=${section}`)}
		/>
	);
});

export type PluginData = PluginNameMeta & Partial<PluginMeta> & {isNpmSourced?: boolean};

export type PluginHeaderProps = RenderableProps<{
	data: PluginData;
	compact?: boolean;
}>;

export const PluginHeader = observer(function PluginHeader({data, compact}: PluginHeaderProps) {
	const {name, description, npmUrl} = data;
	const {staging, plugins, profiles, history, modals} = useStore();
	const installed = plugins.byId().get(name);
	const isLocal = installed?.isLocal ?? false;
	const isExternal = installed?.isExternal === true;
	const issuesCount = (installed && installed.issues().length) || 0;
	const homepage = data.homepage;
	const homepageDomain = useMemo(() => (homepage ? new URL(homepage).host.split('.')[0] : null), [homepage]);
	let bugs = data.bugs;
	if (typeof bugs === 'object') bugs = bugs.url;
	const dependentProfilesCount = profiles
		.all()
		.reduce((count, profile) => (profile.pluginMeta.name === name ? count + 1 : count), 0);
	const dependentPluginsCount = plugins.all().reduce((count, plugin) => {
		for (const processor of plugin.processors()) {
			if (processor.plugin.name === name) continue;

			for (const dependencyId of processor.dependencyIds) {
				if (dependencyId.split(':')[0] === name) return count + 1;
			}
		}
		return count;
	}, 0);
	const availableUpdateVersion = installed?.updateAvailable();

	let classNames = 'PluginHeader';
	if (compact) classNames += ` -compact`;

	function newProfile(event: MouseEvent) {
		const processors = installed?.processors();

		if (!installed || !processors || processors.length === 0) return;

		event.preventDefault();
		event.stopPropagation();

		if (processors.length === 1) {
			const profile = profiles.create({processorId: processors[0]!.id});
			history.push(`/profiles/${profile.id}?new`);
		} else {
			modals.newProfile({pluginId: installed.name});
		}
	}

	return (
		<header class={classNames} title={name}>
			<div class="info">
				<h1>
					<PluginDisplayName id={name} isExternal={isExternal} />
					<div class="meta">
						{installed && (
							<span class="version" title="Installed version">
								{installed.version}
								{availableUpdateVersion && (
									<span
										class="update-available"
										title={`Update to ${availableUpdateVersion} is available`}
									>
										<Icon name="update" />
										{availableUpdateVersion}
									</span>
								)}
							</span>
						)}

						{(dependentProfilesCount > 0 || dependentPluginsCount > 0) && (
							<span class="dependents">
								{dependentProfilesCount > 0 && (
									<span class="profiles" title={`${dependentProfilesCount} dependent profiles`}>
										{dependentProfilesCount} <Icon name="profile" />
									</span>
								)}
								{dependentPluginsCount > 0 && (
									<span class="plugins" title={`${dependentPluginsCount} dependent plugins`}>
										{dependentPluginsCount} <Icon name="plugins" />
									</span>
								)}
							</span>
						)}
					</div>
				</h1>

				<div class="links">
					{isLocal && installed && (
						<button class="link local" title="Open folder" onClick={() => shell.openPath(installed.path)}>
							<Icon name="hdd" />
							local
						</button>
					)}

					{npmUrl && (
						<a class="link npm" href={npmUrl} title={npmUrl}>
							<Icon name="npm" />
							registry
						</a>
					)}

					{homepage && (
						<a class="link homepage" href={homepage} title={homepage}>
							<Icon name={homepageDomain === 'github' ? 'github' : 'home'} />
							{homepageDomain || 'Home'}
						</a>
					)}

					{bugs && !compact && (
						<a class="link issues" href={bugs} title={bugs}>
							<Icon name="bug" />
							Issues
						</a>
					)}
				</div>

				<h2>{description || <em>No description.</em>}</h2>
			</div>

			<div class="actions">
				<PluginInstallButton id={name} />
				{installed &&
					(issuesCount > 0 ? (
						<div class="issues">
							<Icon name="warning" /> {issuesCount} issues
						</div>
					) : installed.processors().length > 0 ? (
						<Button
							class="add-profile"
							variant="accent"
							onClick={newProfile}
							disabled={staging.isStaging()}
							semitransparent
							tooltip="Create profile"
						>
							<Icon name="profile-add" />
							Profile
						</Button>
					) : (
						installed.dependencies().length > 0 && (
							<div
								class="dependency-provider-sign"
								title="This plugin provides dependencies for other plugins"
							>
								Dependency provider
							</div>
						)
					))}
			</div>
		</header>
	);
});

interface PluginProps {
	data: PluginData;
	forceRegistrySource?: boolean;
	section?: string;
	onSectionChange?: (section: string) => void;
}

export const Plugin = observer(function Plugin({data, section, onSectionChange}: PluginProps) {
	const {plugins} = useStore();
	const {name, repository} = data;
	const installed = plugins.byId().get(name);
	const issues = installed?.issues();
	section = !installed ? 'readme' : section || 'readme';

	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	return (
		<section class="Plugin" ref={containerRef} data-context-menu="plugin" data-context-menu-payload={name}>
			<PluginHeader data={data} />

			{issues && issues.length > 0 && <Issues issues={issues} />}

			<Nav style="tabs">
				<NavLink
					to="readme"
					onClick={onSectionChange}
					activeMatch={section === 'readme'}
					tooltip={`Readme provided by the plugin`}
				>
					<Icon name="book" /> Readme
				</NavLink>
				<NavLink
					to="changelog"
					onClick={onSectionChange}
					activeMatch={section === 'changelog'}
					tooltip={`Changelog`}
				>
					<Icon name="changelog" /> Changelog
				</NavLink>
				{installed && (
					<NavLink
						to="extensions"
						onClick={onSectionChange}
						activeMatch={section === 'extensions'}
						tooltip={`All the ways in which this plugin extends ${manifest.productName}`}
					>
						<Icon name="puzzle" /> Extensions
						<Tag>{installed.processors().length + installed.dependencies().length}</Tag>
					</NavLink>
				)}
			</Nav>

			<Scrollable class="content">
				{section === 'extensions' &&
					(installed ? <PluginExtensions plugin={installed} /> : <Vacant title="Plugin not installed." />)}
				{section === 'changelog' && <Changelog repository={repository} currentVersion={installed?.version} />}
				{section === 'readme' &&
					(data.readme ? <Markdown contents={data.readme} /> : <Vacant title="No readme." />)}
			</Scrollable>
		</section>
	);
});

export function PluginExtensions({plugin}: {plugin: PluginModel}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const processors = plugin.processors();
	const dependencies = plugin.dependencies();

	useVolley(containerRef);

	return (
		<div class="PluginExtensions" ref={containerRef}>
			{processors.length === 0 && dependencies.length === 0 && (
				<Vacant title="Empty">This plugin doesn't extend {manifest.productName} in any meaningful way.</Vacant>
			)}

			{dependencies.length > 0 && <TitleBar variant="success">Dependencies</TitleBar>}
			{dependencies.length > 0 && (
				<div class="CardsGrid dependencies">
					{dependencies.map((dependency: Dependency | string) => (
						<DependencyCard id={typeof dependency === 'string' ? dependency : dependency.id} />
					))}
				</div>
			)}

			{processors.length > 0 && <TitleBar variant="accent">Processors</TitleBar>}
			{processors.length > 0 && (
				<div class="CardsGrid processors">
					{processors.map((processor) => (
						<ProcessorCard processor={processor} />
					))}
				</div>
			)}
		</div>
	);
}

export const PluginDependents = observer(function PluginDependents({
	class: className,
	plugin,
	innerRef,
	onNav,
}: {
	class?: string;
	plugin: PluginModel;
	innerRef?: Ref<HTMLDivElement | null>;
	// When one of the cards is clicked, causing a navigation.
	// Useful when this is used in a modal.
	onNav?: () => void;
}) {
	const dependentProfiles = plugin.dependentProfiles();
	const dependentPlugins = plugin.dependentPlugins();
	const containerRef = innerRef || useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	let classNames = 'PluginDependents';
	if (className) classNames += ` ${className}`;

	return (
		<div class={classNames} ref={containerRef}>
			{dependentPlugins.length === 0 && dependentProfiles.length === 0 && (
				<Vacant title="Empty">Nothing depends on this plugin</Vacant>
			)}
			{dependentPlugins.length > 0 && <TitleBar>Plugins</TitleBar>}
			{dependentPlugins.length > 0 && (
				<PluginCards plugins={dependentPlugins.map((plugin) => plugin.meta)} onNav={onNav} />
			)}
			{dependentProfiles.length > 0 && <TitleBar variant="accent">Profiles</TitleBar>}
			{dependentProfiles.length > 0 && <ProfilesList profiles={dependentProfiles} onNav={onNav} />}
		</div>
	);
});

export function PluginDependentsModalContent({plugin, onClose}: {plugin: PluginModel; onClose: () => void}) {
	return (
		<Scrollable class="PluginDependentsModalContent">
			<PluginDependents plugin={plugin} onNav={onClose} />
		</Scrollable>
	);
}
