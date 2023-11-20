import {h} from 'preact';
import {useRef, useState} from 'preact/hooks';
import {observer} from 'statin-preact';
import {colonIdMeta} from 'lib/serialize';
import {useVolley} from 'lib/hooks';
import {useStore} from 'models/store';
import {Processor as ProcessorModel} from 'models/processors';
import {ProcessorConfig} from '@drovp/types';
import {Icon, Help} from 'components/Icon';
import {Tag} from 'components/Tag';
import {Vacant} from 'components/Vacant';
import {Button} from 'components/Button';
import {TitleBar} from 'components/TitleBar';
import {RouteProps, Redirect} from 'poutr';
import {PluginCard} from 'components/PluginCards';
import {ProfileInstructions} from 'components/Profile';
import {ProfilesList} from 'components/ProfilesList';
import {Nav, NavLink} from 'components/Nav';
import {Issues} from 'components/Issues';
import {Scrollable} from 'components/Scrollable';
import {DependencyCard} from 'components/DependencyCard';

function FlagTypeToTags({
	type,
	config,
}: {
	type: keyof Exclude<ProcessorConfig['accepts'], undefined>;
	config: ProcessorConfig['accepts'];
}) {
	const [expand, setExpand] = useState(false);
	const conf = config?.[type];
	const limit = 20;
	if (!conf) return null;

	const rawFlags = Array.isArray(conf) ? conf : [conf];
	const trimmedFlags = expand ? rawFlags : rawFlags.slice(0, limit);

	return (
		<dl>
			<dt>Accepts {type}</dt>
			<dd>
				{trimmedFlags.map((flag) => (
					<span class="flag">
						{typeof flag === 'function' ? '(dynamic check)' : `${flag === true ? 'any' : flag}`}
					</span>
				))}
				{rawFlags.length > limit && !expand && '… '}
				{rawFlags.length > limit && (
					<Button muted semitransparent outline onClick={() => setExpand(!expand)}>
						{expand ? `less` : `${rawFlags.length - limit} more`}
					</Button>
				)}
			</dd>
		</dl>
	);
}

export const ProcessorRoute = observer(function ProcessorRoute({history, location, match}: RouteProps) {
	const id = decodeURIComponent(match.groups?.id || '');
	const [pluginId, processorName] = colonIdMeta(id);
	const containerRef = useRef<HTMLDivElement>(null);
	const {processors, plugins} = useStore();
	const processor = processors.byId().get(id);
	const plugin = plugins.byId().get(pluginId);
	const profiles = processor?.profiles() || [];
	const isReady = processor?.isReady() || false;
	const hasInstructions = processor?.hasInstructions;
	const issues = processor?.issues() || [];
	const hasIssues = issues.length > 0;

	let section = location.searchParams.get('section');
	if (!section) {
		return <Redirect to={`${location.path}?section=details`} />;
	}

	if (!processor) {
		issues.push({
			title: `Processor ${id} not found`,
			message: plugin
				? `Plugin ${pluginId} doesn't provide this processor.`
				: `Plugin ${pluginId} not installed.`,
			actions: plugin
				? undefined
				: [
						{
							title: 'Install plugin',
							icon: 'install',
							disableWhenStaging: true,
							action: () => plugins.install(pluginId),
						},
				  ],
		});
	}

	function createAndGoToProfile() {
		processor?.createAndGoToProfile();
	}

	useVolley(containerRef, {perpetual: true});

	let headerClassNames = 'CommonHeader';
	headerClassNames += isReady ? ' -success' : hasIssues ? ' -danger' : '';

	return (
		<article class="Processor" ref={containerRef} data-context-menu="processor" data-context-menu-payload={id}>
			<header class={headerClassNames}>
				<div
					class="state"
					title={isReady ? 'Ready' : hasIssues ? 'Dependency or plugin issues' : 'Staging in progress'}
				>
					<Icon name={isReady ? 'circle-check' : hasIssues ? 'warning' : 'pause'} />
				</div>

				<div class="title">
					<h1>{processorName}</h1>
					<h2>Processor</h2>
				</div>

				{processor && (
					<div class="actions">
						<Button
							disabled={!isReady}
							variant="accent"
							class="create-profile"
							onClick={createAndGoToProfile}
							tooltip="Create new profile"
						>
							<Icon name="profile-add" /> Profile
						</Button>
					</div>
				)}
			</header>

			{hasIssues && <Issues issues={issues} />}

			<Nav style="tabs" class="navigation">
				<NavLink
					class="details"
					to={`${location.path}?section=details`}
					mode="replace"
					activeMatch={section === 'details'}
					tooltip="Processor details"
				>
					<Icon name="info" /> Details
				</NavLink>
				{hasInstructions && (
					<NavLink
						to={`${location.path}?section=instructions`}
						mode="replace"
						activeMatch={section === 'instructions'}
						tooltip="Instructions"
					>
						<Icon name="info" /> Instructions
					</NavLink>
				)}
				<NavLink
					to={`${location.path}?section=profiles`}
					mode="replace"
					activeMatch={section === 'profiles'}
					tooltip="Profiles"
				>
					<Icon name="profile" /> Profiles
					<Tag>{profiles.length}</Tag>
				</NavLink>
			</Nav>

			{section === 'profiles' ? (
				<ProcessorProfiles processor={processor} />
			) : section === 'instructions' ? (
				<ProfileInstructions instructions={processor?.instructions} />
			) : (
				<ProcessorDetails processor={processor} />
			)}
		</article>
	);
});

function ProcessorDetails({processor}: {processor?: ProcessorModel}) {
	const requiredDependencyIds = processor?.requiredDependencyIds || [];
	const optionalDependencyIds = processor?.optionalDependencyIds || [];

	if (!processor) {
		return (
			<Scrollable class="ProcessorDetails ExtensionDetails">
				<Vacant title="Processor missing" />
			</Scrollable>
		);
	}

	const pluginMeta = processor.plugin.meta;

	return (
		<Scrollable class="ProcessorDetails ExtensionDetails">
			<div class="processor">
				<TitleBar>Description</TitleBar>
				<ProcessorDescription processor={processor} />
			</div>

			{requiredDependencyIds.length > 0 && (
				<div class="dependencies">
					<TitleBar variant="success">Required dependencies</TitleBar>
					<div class="CardsGrid dependencies">
						{requiredDependencyIds.map((id) => (
							<DependencyCard id={id} />
						))}
					</div>
				</div>
			)}

			{optionalDependencyIds.length > 0 && (
				<div class="dependencies">
					<TitleBar variant="success">Optional Dependencies</TitleBar>
					<div class="CardsGrid dependencies">
						{optionalDependencyIds.map((id) => (
							<DependencyCard id={id} />
						))}
					</div>
				</div>
			)}

			<div class="plugin">
				<TitleBar>Source plugin</TitleBar>
				<PluginCard meta={pluginMeta} markMissing />
			</div>
		</Scrollable>
	);
}

export function ProcessorDescription({processor}: {processor: ProcessorModel}) {
	const {bulk, threadType, threadTypeDescription, keepAlive, accepts} = processor.config;
	const parallelizationMode = processor.parallelizationMode();

	return (
		<div class="ProcessorDescription">
			{processor.description && <div class="description">{processor.description}</div>}

			<div class="properties">
				<FlagTypeToTags type="files" config={accepts} />
				<FlagTypeToTags type="directories" config={accepts} />
				<FlagTypeToTags type="blobs" config={accepts} />
				<FlagTypeToTags type="urls" config={accepts} />
				<FlagTypeToTags type="strings" config={accepts} />

				{bulk && (
					<dl>
						<dt>Accepts bulks</dt>
						<dd>
							Dragging multiple items into a profile of this processor will create one operation where all
							items will be processed at the same time.
						</dd>
					</dl>
				)}

				<dl>
					<dt>
						Thread type{' '}
						<Help tooltip="Operation parallelization is managed and limited based on thread types" />
					</dt>
					<dd>
						{!threadType
							? `Undefined - shares thread pool with all other processors with uncategorized thread type.`
							: threadTypeDescription
							? threadTypeDescription
							: typeof threadType === 'function'
							? `Determined dynamically on operation by operation basis.`
							: (Array.isArray(threadType) ? threadType : [threadType]).map((type) => (
									<code class="flag">{type}</code>
							  ))}
					</dd>
				</dl>

				<dl>
					<dt>Parallelization</dt>
					<dd
						dangerouslySetInnerHTML={{
							__html:
								parallelizationMode === 'maybe'
									? `Wether the app will run multiple operations at the same time is determined dynamically based on profile's configuration.`
									: parallelizationMode === 'always'
									? `Enabled. The app will run multiple operations at the same time, while respecting each profile's <b>Max threads</b> setting.`
									: `Disabled. The app will not run more than one operation of its thread type at any given time.`,
						}}
					/>
				</dl>

				{keepAlive && (
					<dl>
						<dt>Keep alive</dt>
						<dd>
							This processor has requested at least one thread process to always be ready and open in the
							background. Normally, all idle threads are disposed after a couple seconds of inactivity.
						</dd>
					</dl>
				)}
			</div>
		</div>
	);
}

export const ProcessorProfiles = observer(function ProcessorProfiles({processor}: {processor?: ProcessorModel}) {
	if (!processor) {
		return (
			<div class="ProcessorProfiles">
				<Vacant title="Processor missing" />
			</div>
		);
	}

	const profiles = processor.profiles();

	if (profiles.length === 0) {
		return (
			<div class="ProcessorProfiles">
				<Vacant title="No profiles yet" />
			</div>
		);
	}

	return <ProfilesList class="ProcessorProfiles" profiles={profiles} />;
});
