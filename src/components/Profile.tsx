import {h, RenderableProps} from 'preact';
import {useRef, useState, useEffect, useMemo, Ref} from 'preact/hooks';
import {action} from 'statin';
import {observer} from 'statin-preact';
import {useEventListener, useVolley, useScrollPosition, useCache} from 'lib/hooks';
import {TargetedEvent, isInputElement, uid} from 'lib/utils';
import {Icon} from 'components/Icon';
import {RouteProps, Redirect} from 'poutr';
import {Vacant} from 'components/Vacant';
import {Spinner} from 'components/Spinner';
import {Button} from 'components/Button';
import {TitleBar} from 'components/TitleBar';
import {createCopyParticle, infoParticle} from 'components/InfoParticle';
import {Options} from 'components/Options';
import {Issues} from 'components/Issues';
import {Checkbox} from 'components/Checkbox';
import {Alert} from 'components/Alert';
import {Instructions} from 'components/Instructions';
import {ProcessorCard} from 'components/ProcessorCard';
import {DependencyCard} from 'components/DependencyCard';
import {PluginCard} from 'components/PluginCards';
import {OperationsSection} from 'components/Operations';
import {Nav, NavLink, NavLinkRelativePart} from 'components/Nav';
import {ProfileProgress} from './ProfileProgress';
import {useStore} from 'models/store';
import {Profile as ProfileModel} from 'models/profiles';
import {resetOptions} from 'models/options';
import {Outputs} from './Outputs';
import {OptionNumber} from 'components/OptionNumber';
import {Scrollable} from 'components/Scrollable';

export const ProfileRoute = observer(function ProfileRoute({match, history, location}: RouteProps) {
	const {profiles} = useStore();
	const id = match?.groups?.id;

	if (!id) throw new Error(`Missing ID.`);

	const section = location.searchParams.get('section');
	const isNew = location.searchParams.has('new');
	const profile = profiles.byId().get(id);

	if (!section && profile) {
		const hasIssues = profile.issues().length > 0;
		const newSection = hasIssues ? 'details' : isNew ? 'options' : 'operations';
		return <Redirect to={`${location.path}?section=${newSection}${isNew ? '&new' : ''}`} />;
	}

	return section && profile ? (
		<div class="ProfileRoute">
			<Profile
				key={id}
				profile={profile}
				section={section}
				isNew={isNew}
				onSectionChange={(section) => history.replace(`/profiles/${id}?section=${section}`)}
			/>
			{section === 'operations' && <ProfileOutputs profile={profile} />}
		</div>
	) : (
		<Vacant title={[`Profile "`, <code>{id}</code>, `" not found`]} />
	);
});

type ProfileWrapperProps = RenderableProps<{
	innerRef?: Ref<HTMLDivElement | null>;
	class?: string;
	profile: ProfileModel;
	draggable?: boolean;
	hideProgress?: boolean;
	compact?: boolean;
	style?: string;
	onClick?: () => void;
}>;

/**
 * Creates a common droppable interface for profile related components.
 */
export const ProfileWrapper = observer(function ProfileWrapper({
	innerRef,
	profile,
	class: className,
	hideProgress,
	children,
	draggable,
	compact,
	style,
	onClick,
}: ProfileWrapperProps) {
	const {app, staging} = useStore();
	const draggingMode = app.draggingMode();
	const isProfileDragged = draggingMode === 'profile';
	const isDraggedOver = profile.isDraggedOver();
	const displayTitle = profile.displayTitle();
	const isStaging = staging.isStaging();
	const isProfileReady = profile.isReady();
	const issuesCount = profile.issues().length;
	const dependenciesLoading = profile.dependenciesLoading();
	const hasPendingOperations = profile.pending().length > 0;
	const containerRef = innerRef || useRef<HTMLDivElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		return profile.registerAddingListener((count) => {
			const target = progressRef.current;
			if (target && count > 0) {
				infoParticle(
					<code>
						<b>+{count}</b>
					</code>,
					target
				);
			}
		});
	}, []);

	let classNames = `ProfileWrapper`;
	if (className) classNames += ` ${className}`;
	if (profile.isDragged()) classNames += ' -dragged';
	else if (draggingMode && (isProfileReady || isProfileDragged)) classNames += ' -drop-well';
	else if (onClick) classNames += ' -hoverable';

	if (dependenciesLoading) classNames += ' -is-loading';
	else if (isStaging) classNames += ' -is-staging';
	else if (!isProfileReady) classNames += ' -has-issues';

	if (isDraggedOver && (isProfileReady || isProfileDragged)) classNames += ' -dragged-over';

	// Extract header and content, so that we can insert universal
	// progress block in between them.
	// Is there some other/better convention/api to do component "slots"?
	let header: any;
	let content: any;
	if (children) {
		if (Array.isArray(children)) {
			content = [];
			for (const child of children) {
				if (!header && (child as any).type === 'header') header = child;
				else content.push(child);
			}
		} else {
			if ((children as any).type === 'header') header = children;
			else content = children;
		}
	}

	return (
		<article
			ref={containerRef}
			class={classNames}
			style={style}
			title={
				onClick
					? `${displayTitle}\nProcessor: ${profile.processorId}${
							dependenciesLoading ? '\nLoading dependencies...' : ''
					  }`
					: undefined
			}
			draggable={draggable}
			onDragStart={profile.handleDragStart}
			onDragEnter={profile.handleDragEnter}
			onDragLeave={profile.handleDragLeave}
			onDrop={profile.handleDrop}
			data-context-menu="profile"
			data-context-menu-payload={profile.id}
		>
			{header}
			{!hideProgress && (
				<div class="progress" ref={progressRef}>
					{dependenciesLoading && !hasPendingOperations ? (
						<div class="loading-dependencies">
							<Spinner />
						</div>
					) : isProfileReady || profile.pending().length > 0 ? (
						<ProfileProgress profile={profile} compact={compact} />
					) : (
						<div class={`issues ${issuesCount > 0 ? '-danger' : ''}`}>
							<Icon name="warning" />
							{!compact && (
								<span class="message">
									{issuesCount > 1
										? `${issuesCount} issues`
										: issuesCount === 1
										? `1 issue`
										: `staging in progress`}
								</span>
							)}
						</div>
					)}
				</div>
			)}
			{content}
			{onClick && (
				<button
					class="open"
					onClick={onClick}
					data-context-menu="profile"
					data-context-menu-payload={profile.id}
				/>
			)}
		</article>
	);
});

interface ProfileProps {
	profile: ProfileModel;
	section?: string;
	onSectionChange: (section: string) => void;
	isNew?: boolean;
}

export const Profile = observer(function Profile({profile, section, onSectionChange, isNew}: ProfileProps) {
	const {history} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const mountId = useMemo(() => uid(), []);
	const issues = profile.issues();
	const [cachedOperationsSection, setCachedOperationsSection] = useCache(
		`profile[${profile.id}].operationsSection`,
		'all'
	);
	const [operationsSection, setOperationsSection] = useState(cachedOperationsSection);
	const hasPending = profile.hasPendingOperations();
	const processor = profile.processor();
	const instructions = processor?.instructions || processor?.plugin.readme;

	setCachedOperationsSection(operationsSection);

	useEffect(() => {
		const titleElement = titleRef.current;
		if (titleElement && isNew) {
			// We have to wait, or chromium auto-scrolls the document out of
			// bounds to center the focused input which is due to the inward
			// animation positioned off screen. I just love when the environment
			// is trying to be smart and breaks everything in the process...
			const id = setTimeout(() => titleElement.focus(), 100);
			return () => clearTimeout(id);
		}
	}, []);

	useEventListener('paste', (event: ClipboardEvent) => {
		if (!isInputElement(event.target)) profile.handlePaste(event);
	});
	useVolley(containerRef, {perpetual: true});

	function handleDelete() {
		profile.delete();
		history.replace('/profiles');
	}

	return (
		<ProfileWrapper innerRef={containerRef} class="Profile" profile={profile} hideProgress={issues.length > 0}>
			<header>
				<input
					class="title"
					ref={titleRef}
					type="text"
					placeholder={profile.displayTitle()}
					value={profile.title()}
					onInput={(event) => action(() => profile.title(event.currentTarget.value))}
					title="Click to edit"
				/>
				{profile.isAdding() && (
					<div class="adding" title="Adding (serializing) dropped items">
						<Spinner /> <span class="count">{profile.added()}</span>
					</div>
				)}
				<div class="controls">
					<button
						class="processor-name"
						title={`Processor: ${profile.processorId}`}
						onClick={() => history.push(`/processors/${encodeURIComponent(profile.processorId)}`)}
					>
						<Icon name="processor" />
						{profile.processorName}
					</button>
					<Button
						variant="danger"
						semitransparent
						onClick={handleDelete}
						disabled={hasPending}
						tooltip={hasPending ? `Can't delete profile while operations are pending` : `Delete profile`}
					>
						<Icon name="trash" />
					</Button>
				</div>
			</header>

			{issues.length > 0 && <Issues issues={issues} />}

			<Nav style="overline" class="navigation">
				<NavLink
					to="operations"
					onClick={onSectionChange}
					activeMatch={section === 'operations'}
					tooltip="Operations"
				>
					<Icon name="operation" /> Operations
				</NavLink>
				<NavLink to="options" onClick={onSectionChange} activeMatch={section === 'options'} tooltip="Options">
					<Icon name="cog" /> <NavLinkRelativePart>Options</NavLinkRelativePart>
				</NavLink>
				{instructions && (
					<NavLink
						class="instructions"
						to={`${history.location.path}?section=instructions`}
						mode="replace"
						activeMatch={section === 'instructions'}
						tooltip="See instructions"
					>
						<Icon name="info" />
						<NavLinkRelativePart>Instructions</NavLinkRelativePart>
					</NavLink>
				)}
				<NavLink to="export" onClick={onSectionChange} activeMatch={section === 'export'} tooltip="Export">
					<Icon name="export" /> {!instructions && <NavLinkRelativePart>Export</NavLinkRelativePart>}
				</NavLink>
				<NavLink
					to="details"
					onClick={onSectionChange}
					activeMatch={section === 'details'}
					variant={issues.length > 0 ? 'danger' : undefined}
					tooltip="Profile details"
				>
					<Icon name="info" /> {!instructions && <NavLinkRelativePart>Details</NavLinkRelativePart>}
				</NavLink>
			</Nav>

			{section === 'options' ? (
				<ProfileOptions mountId={mountId} profile={profile} />
			) : section === 'export' ? (
				<ProfileExport profile={profile} />
			) : section === 'instructions' ? (
				<ProfileInstructions mountId={mountId} instructions={instructions} />
			) : section === 'details' ? (
				<ProfileDetails profile={profile} />
			) : (
				<OperationsSection
					allSignal={profile.operations}
					errorsSignal={profile.errors}
					section={operationsSection}
					onSection={setOperationsSection}
					onClearQueue={() => profile.clearQueue()}
					onClearHistory={() => profile.clearHistory()}
				/>
			)}
		</ProfileWrapper>
	);
});

const ProfileOptions = observer(function ProfileOptions({profile, mountId}: {profile: ProfileModel; mountId: string}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const processor = profile.processor();
	const profileOptions = profile.options() || {};

	if (!processor) {
		return (
			<div class="ProfileOptions" data-volley-ignore>
				<Vacant title="Missing processor">
					Processor <code>{profile.processorId}</code> is missing.
				</Vacant>
			</div>
		);
	}

	const profileOptionsSchema = processor.optionsSchema;

	useScrollPosition(`ProfileOptions.${mountId}`, containerRef);

	return (
		<Scrollable innerRef={containerRef} class="ProfileOptions">
			<CommonProfileOptions profile={profile} />

			{profileOptionsSchema ? (
				<Options
					schema={profileOptionsSchema}
					options={profileOptions}
					namespace="profile"
					menuItems={[
						{
							label: 'Apply changes to queued operations',
							click: () => {
								profile.updateQueuedOptions();
								infoParticle(
									<span>
										<Icon name="check" /> Applied
									</span>,
									{variant: 'success'}
								);
							},
						},
					]}
				/>
			) : (
				<Vacant>This processor has no profile options.</Vacant>
			)}
		</Scrollable>
	);
});

const CommonProfileOptions = observer(function CommonProfileOptions({profile}: {profile: ProfileModel}) {
	const [section, setSection] = useState<string | null>(null);
	const processor = profile.processor();
	const profileOptions = profile.options() || {};
	const threadType = processor?.config.threadType;
	const humanThreadType = profile.humanThreadType();
	const parallelizationMode = processor?.parallelizationMode();
	const queuedOperationsCount = profile.batch.items().length - profile.batch.index() - profile.pending().length;
	const modifierDescriptions = {
		Shift: 'tweak options for current drop',
		...profile.modifierDescriptions(),
	};
	const modifierNames = Object.keys(modifierDescriptions);

	function toggleSection(name: string) {
		setSection(section === name ? null : name);
	}

	function handleApplyToQueued(event: TargetedEvent<HTMLButtonElement>) {
		profile.updateQueuedOptions();
		infoParticle(
			<span>
				<Icon name="check" /> Applied
			</span>,
			event.currentTarget,
			{variant: 'success'}
		);
	}

	function handleResetOptions() {
		resetOptions(profile.commonOptions);
		resetOptions(profileOptions);
	}

	return (
		<div class="CommonProfileOptions">
			<div class="options">
				<div class="option maxThreads">
					<h1>
						Max threads{' '}
						<span
							class="count"
							title={`Thread type of this profile:\n${
								humanThreadType === '{dynamic}'
									? `determined dynamically for each operation`
									: humanThreadType
							}`}
						>
							{humanThreadType}
						</span>
					</h1>
					<div class="row">
						{parallelizationMode ? (
							<div class="controls">
								<OptionNumber signal={profile.commonOptions.maxThreads} />
							</div>
						) : (
							<span class="disabled">{processor ? `Single thread mode` : `Processor missing`}</span>
						)}
						<Button
							class="helpToggle"
							semitransparent
							selected={section === 'threads'}
							onClick={() => toggleSection('threads')}
							tooltip="Toggle help"
						>
							<Icon name={section === 'threads' ? 'chevron-up' : 'chevron-down'} />
						</Button>
					</div>
				</div>
				<div class="option modifiers">
					<h1>Modifiers</h1>
					<div className="row">
						<Button
							semitransparent
							selected={section === 'modifiers'}
							class="helpToggle"
							onClick={() => toggleSection('modifiers')}
							tooltip="Toggle help"
						>
							<span class="count">{modifierNames.length}</span>
							<Icon name={section === 'modifiers' ? 'chevron-up' : 'chevron-down'} />
						</Button>
					</div>
				</div>
				<div class="option utils">
					<h1>Utils</h1>
					<div class="row">
						<Button
							semitransparent
							variant="info"
							disabled={queuedOperationsCount === 0}
							onClick={handleApplyToQueued}
							tooltip={`Apply changes to queued operations.${
								profile.processor()?.hasPreparator
									? `\nCareful! Might overwrite tweaks by processor's preparator.`
									: ''
							}`}
						>
							<Icon name="circle-check" />
						</Button>
						<Button
							semitransparent
							variant="warning"
							onClick={handleResetOptions}
							tooltip="Reset all options to their default values"
						>
							<Icon name="refresh" />
						</Button>
					</div>
				</div>
			</div>
			{section === 'threads' && (
				<div class="expando threads TextContent">
					{parallelizationMode === false ? (
						<p>Processor allows only a single thread to run at any given time.</p>
					) : (
						[
							<p>
								Sets the max allowed size of a thread pool for operations of this profile.
								<br />
								Operation with the smallest <b>Max threads</b> set's the size of its thread pool.
							</p>,
						]
					)}
					{processor ? (
						typeof threadType === 'function' ? (
							[
								<p>
									This processor's operation thread type is determined dynamically when operation is
									created, probably based on profile options.
								</p>,
								processor.config.threadTypeDescription != null && (
									<p>
										<em>Processor's thread type description:</em>
										<hr />
										{processor.config.threadTypeDescription}
										<hr />
									</p>
								),
								<p>
									NOTE: Operations whose thread type was determined dynamically remember{' '}
									<b>Max threads</b>
									setting at their creation time. This means changing this setting has no effect on
									queued operations, and will only affect new ones.
								</p>,
							]
						) : (
							<p>
								This processor uses{' '}
								<code>{Array.isArray(threadType) ? threadType.join('+') : `${threadType}`}</code> thread
								type.
							</p>
						)
					) : (
						<p>Processor, along with its threading details are not available.</p>
					)}
				</div>
			)}
			{section === 'modifiers' && (
				<div class="expando modifiers TextContent">
					<p class="-muted">
						<em>Effects of modifiers when dropping items into this profile:</em>
					</p>
					<ul class="modifierDescriptions">
						{modifierNames.map((name) => (
							<li>
								<kbd>{name}</kbd> - {modifierDescriptions[name as keyof typeof modifierDescriptions]}
							</li>
						))}
					</ul>
					{modifierNames.length > 1 && (
						<p class="-muted">
							<Icon name="help" />{' '}
							<em>
								If you want to both tweak options <b>and</b> use one of the other modifiers, hold the
								other modifier while pressing the <b>Start</b> button when confirming tweaking.
							</em>
						</p>
					)}
				</div>
			)}
		</div>
	);
});

const ProfileExport = observer(function ProfileExport({profile}: {profile: ProfileModel}) {
	const {settings} = useStore();
	const url = profile.importURL();
	const markdown = profile.importMarkdownLink();
	const code = profile.importCode();
	const json = profile.importJSON();

	return (
		<Scrollable class="ProfileExport">
			<Alert icon="help">
				Sharing codes below allows other people to clone this profile for themselves. They can enter it into
				Profile importer, or in case you're sharing a link, just click it.
			</Alert>

			<div class="entry">
				<label for="compact-mode">Compact mode</label>
				<Checkbox
					id="compact-mode"
					checked={settings.compactImportCodes()}
					onChange={(checked) => settings.compactImportCodes(checked)}
				/>
				<p>
					<em>
						Only include options that differ from defaults. Creates a considerably smaller import code, but
						has a small potential for creating profiles that don't exactly match the original (when plugin
						changed its defaults without bumping major version).
					</em>
				</p>
			</div>

			<div class="entry">
				<label for="import-code">Import code</label>
				<Button onClick={createCopyParticle(code)} tooltip="Copy">
					<Icon name="copy" /> Copy
				</Button>
				<span>
					<strong>{code.length}</strong> characters
				</span>
				<div class="preview">
					<div class="value">{code}</div>
				</div>
			</div>

			<div class="entry">
				<label for="url-export">URL</label>
				<Button onClick={createCopyParticle(url)} tooltip="Copy">
					<Icon name="copy" /> Copy
				</Button>
				<span>
					<strong>{url.length}</strong> characters
				</span>
				<div class="preview">
					<div class="value">{url}</div>
				</div>
			</div>

			<div class="entry">
				<label for="markdown-link">Markdown link</label>
				<Button onClick={createCopyParticle(markdown)} tooltip="Copy">
					<Icon name="copy" /> Copy
				</Button>
				<span>
					<strong>{markdown.length}</strong> characters
				</span>
				<div class="preview">
					<div class="value">{markdown}</div>
				</div>
			</div>

			<div class="entry">
				<label for="import-json">Raw json</label>
				<Button onClick={createCopyParticle(json)} tooltip="Copy">
					<Icon name="copy" /> Copy
				</Button>
				<span>
					<strong>{json.length}</strong> characters
				</span>
				<div class="preview">
					<div class="value">{json}</div>
				</div>
			</div>
		</Scrollable>
	);
});

export const ProfileDetails = observer(function ProfileDetails({
	profile,
	class: className,
}: {
	profile: ProfileModel;
	class?: string;
}) {
	const processor = profile.processor();
	const requiredDependencyIds = processor?.requiredDependencyIds || [];
	const optionalDependencyIds = processor?.optionalDependencyIds || [];
	const pluginMeta = {...profile.pluginMeta, ...(processor?.plugin.meta || {description: 'Plugin not installed!'})};

	let classNames = 'ProfileDetails ExtensionDetails';
	if (className) classNames += ` ${className}`;

	return (
		<Scrollable class={classNames}>
			<div class="processor">
				<TitleBar variant="accent">Processor</TitleBar>
				{processor ? (
					<ProcessorCard processor={processor} />
				) : (
					<Vacant>
						Processor <code>{profile.processorId}</code> is missing.
					</Vacant>
				)}
			</div>

			{requiredDependencyIds.length > 0 && (
				<div class="dependencies">
					<TitleBar variant="success">Required dependencies</TitleBar>
					{requiredDependencyIds.length > 0 && (
						<div class="CardsGrid dependencies">
							{requiredDependencyIds.map((id) => (
								<DependencyCard id={id} />
							))}
						</div>
					)}
				</div>
			)}

			{optionalDependencyIds.length > 0 && (
				<div class="dependencies">
					<TitleBar variant="success">Optional dependencies</TitleBar>
					{optionalDependencyIds.length > 0 && (
						<div class="CardsGrid dependencies">
							{optionalDependencyIds.map((id) => (
								<DependencyCard id={id} />
							))}
						</div>
					)}
				</div>
			)}

			<div class="plugin">
				<TitleBar>Source plugin</TitleBar>
				<PluginCard meta={pluginMeta} markMissing />
			</div>
		</Scrollable>
	);
});

export function ProfileInstructions({instructions, mountId}: {instructions: string | undefined; mountId?: string}) {
	const containerRef = useRef<HTMLDivElement>(null);

	if (mountId) useScrollPosition(`ProfileInstructions.${mountId}`, containerRef);

	return (
		<Scrollable class="ProfileInstructions" innerRef={containerRef}>
			<Instructions instructions={instructions} />
		</Scrollable>
	);
}

const ProfileOutputs = observer(function ProfileRoute({profile}: {profile: ProfileModel}) {
	const {settings} = useStore();
	return (
		<Outputs
			title="Profile outputs"
			tooltip={`Outputs of profile ${profile.title()}`}
			outputs={profile.outputs}
			heightRatio={settings.profileOutputsDrawerHeight()}
			onHeightRatioChange={(height) => action(() => settings.profileOutputsDrawerHeight(height))}
			maxHeightRatio={0.5}
		/>
	);
});
