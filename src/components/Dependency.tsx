import {shell} from 'electron';
import {h} from 'preact';
import {useRef, useState, useEffect, useMemo} from 'preact/hooks';

import {observer} from 'statin-preact';
import {computed} from 'statin';
import {useVolley} from 'lib/hooks';
import {colonIdMeta} from 'lib/serialize';
import {exists} from 'lib/fs';

import {RouteProps, Redirect} from 'poutr';
import {Icon, IconName} from 'components/Icon';
import {Logs} from 'components/Logs';
import {Instructions} from 'components/Instructions';
import {Spinner} from 'components/Spinner';
import {Issue, Issues} from 'components/Issues';
import {Vacant} from 'components/Vacant';
import {Button} from 'components/Button';
import {Nav, NavLink, NavLinkRelativePart} from 'components/Nav';
import {ProcessorCard} from 'components/ProcessorCard';
import {PluginCard} from 'components/PluginCards';
import {TitleBar} from 'components/TitleBar';
import {Scrollable} from 'components/Scrollable';

import {useStore} from 'models/store';
import {Plugin} from 'models/plugins';
import {Processor} from 'models/processors';

export const DependencyRoute = observer(function DependencyRoute({history, location, match}: RouteProps) {
	const id = decodeURIComponent(match.groups?.id || '');
	const [pluginId, dependencyName] = colonIdMeta(id);
	const {dependencies, processors, plugins, staging, operations} = useStore();
	const isStaging = staging.isStaging();
	const dependency = dependencies.byId().get(id);
	/**
	 * This needs to be its own detached computed signal, because this page
	 * has to display data also for dependencies that might be missing,
	 * therefore we can't rely on `dependency.dependents()` computed.
	 */
	const dependents = useMemo(
		() => computed(() => processors.all().filter((processor) => processor.dependencyIds.includes(id))),
		[id]
	)();
	const hasDependents = dependents.length > 0;
	const isReady = dependency?.isReady();
	const state = dependency?.state();
	const payload = dependency?.payload();
	const isLoading = state === 'loading';
	const plugin = pluginId != null ? plugins.byId().get(pluginId) : undefined;
	const loadError = dependency?.loadError();
	const installError = dependency?.installError();
	const configError = dependency?.configError;
	const hasInstaller = dependency?.hasInstaller();
	const version = dependency?.version();
	const hasInstructions = dependency?.hasInstructions();
	const [folderPath, setFolderPath] = useState<string | null>(null);
	let variant: Variant = 'success';

	let section = location.searchParams.get('section');
	if (!section) return <Redirect to={`${location.path}?section=details`} />;

	const isPending = operations.pending().length > 0;
	const controlsDisabled = isPending || isStaging || isLoading || state === 'installing' || configError != null;

	let stateIcon: IconName = 'circle-check';
	let stateTooltip = 'Ready';
	let issues: Issue[] = [];

	if (dependency == null) {
		if (plugin == null) {
			stateIcon = 'warning';
			stateTooltip = `Plugin ${'${pluginId}'} not installed`;
			issues = [
				{
					title: `Missing plugin`,
					message: `Plugin ${pluginId} which should provide this dependency is not installed.`,
					actions: [
						{
							icon: 'install',
							title: 'Install',
							variant: 'success',
							disableWhenStaging: true,
							action: () => pluginId && plugins.install(pluginId),
						},
					],
				},
			];
		} else {
			stateIcon = 'warning';
			stateTooltip = 'Missing dependency';
			issues = [
				{
					title: `Missing`,
					message: `Plugin "${pluginId}" doesn't provide this dependency.`,
					actions: !pluginId
						? undefined
						: [
								{
									iconRight: 'arrow-right',
									title: 'To plugin',
									variant: 'danger',
									action: () => history.push(`/registry/${pluginId}`),
								},
						  ],
				},
			];
		}
	} else {
		issues.push(...dependency.issues());

		if (configError) {
			variant = 'danger';
			stateTooltip = 'Misconfigured';
			stateIcon = 'warning';
		} else if (loadError) {
			variant = 'danger';
			stateTooltip = 'Load error';
			stateIcon = 'warning';
		} else if (installError) {
			variant = 'danger';
			stateTooltip = 'Install error';
			stateIcon = 'warning';
		} else if (!isReady) {
			variant = hasDependents ? 'danger' : 'info';
			stateTooltip = 'Not installed';
			stateIcon = hasDependents ? 'warning' : 'circle';
		}
	}

	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	useEffect(() => {
		if (dependency) {
			exists(dependency.dataPath).then((exists) => exists && setFolderPath(dependency.dataPath));
		}
	}, []);

	return (
		<article class="Dependency" ref={containerRef} data-context-menu="dependency" data-context-menu-payload={id}>
			<header class={`CommonHeader -${variant}`}>
				<div class="state" title={stateTooltip}>
					<Icon name={stateIcon} />
				</div>

				<div class="title">
					<h1>{dependencyName}</h1>
					<h2>Dependency</h2>
				</div>

				{dependency && (
					<div class="actions -primary">
						{folderPath && (
							<Button
								class="open"
								onClick={() => shell.openPath(folderPath)}
								disabled={controlsDisabled}
								tooltip={`Open directory:\n${folderPath}`}
							>
								<Icon name="folder" />
							</Button>
						)}

						<Button
							variant="success"
							class="reload"
							onClick={() => dependency.load()}
							disabled={controlsDisabled}
							tooltip="Reload"
						>
							{isLoading ? <Spinner /> : <Icon name="refresh" />}
						</Button>

						{hasInstaller && (
							<Button
								variant="success"
								class="install"
								onClick={() => dependency.install()}
								disabled={controlsDisabled}
								tooltip="Reinstall/Update"
							>
								{state === 'installing' ? <Spinner /> : <Icon name="install" />}
							</Button>
						)}
					</div>
				)}
			</header>

			{issues.length > 0 && <Issues issues={issues} />}

			{version && <TitleBar value={version}>Version</TitleBar>}

			<Nav style="tabs" class="navigation">
				<NavLink
					class="details"
					to={`${location.path}?section=details`}
					mode="replace"
					activeMatch={section === 'details'}
					tooltip="Details"
				>
					<Icon name="info" />
					<NavLinkRelativePart>Details</NavLinkRelativePart>
				</NavLink>
				{hasInstructions && (
					<NavLink
						class="instructions"
						to={`${location.path}?section=instructions`}
						mode="replace"
						activeMatch={section === 'instructions'}
						tooltip="See instructions"
					>
						<Icon name="info" />
						<NavLinkRelativePart>Instructions</NavLinkRelativePart>
					</NavLink>
				)}
				<NavLink
					class="payload"
					to={`${location.path}?section=payload`}
					mode="replace"
					activeMatch={section === 'payload'}
					tooltip="See payload"
				>
					<Icon name="payload" />
					<NavLinkRelativePart>Payload</NavLinkRelativePart>
				</NavLink>
			</Nav>

			{dependency && section === 'instructions' ? (
				<Instructions instructions={dependency.instructions} />
			) : section === 'details' ? (
				<DependencyDetails plugin={plugin} dependents={dependents} />
			) : (
				<DependencyPayload payload={payload} />
			)}
		</article>
	);
});

const DependencyPayload = observer(function DependencyInstructions({payload}: {payload: any}) {
	const contentRef = useRef<HTMLDivElement>(null);
	const json = useMemo(() => (payload ? JSON.stringify(payload, null, 2) : `${payload}`), [payload]);

	useVolley(contentRef);

	return (
		<Scrollable innerRef={contentRef} class="DependencyPayload ExtensionDetails">
			{!payload ? (
				<Vacant title="Undefined">This dependency didn't provide any payload, or isn't loaded yet.</Vacant>
			) : (
				<Logs lines={json} />
			)}
		</Scrollable>
	);
});

function DependencyDetails({plugin, dependents}: {plugin?: Plugin; dependents: Processor[]}) {
	const contentRef = useRef<HTMLDivElement>(null);

	useVolley(contentRef);

	return (
		<Scrollable innerRef={contentRef} class="DependencyDetails ExtensionDetails">
			{!plugin ? (
				<Vacant title="Plugin missing" />
			) : (
				[
					<div class="plugin">
						<TitleBar>Source plugin</TitleBar>
						<PluginCard meta={plugin} markMissing />
					</div>,
					<div class="dependents">
						<TitleBar variant="accent">Dependent processors</TitleBar>
						{dependents.length === 0 ? (
							<Vacant title="Nothing depends on this" />
						) : (
							dependents.map((processor) => <ProcessorCard processor={processor} />)
						)}
					</div>,
				]
			)}
		</Scrollable>
	);
}
