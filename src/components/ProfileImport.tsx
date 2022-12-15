import manifest from 'manifest';
import {clipboard} from 'electron';
import {h, RenderableProps, VNode} from 'preact';
import {useState, useEffect, useMemo, useRef} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useAbortableEffect, useVolley} from 'lib/hooks';
import {eem} from 'lib/utils';
import {registry, PluginRegistryMeta} from 'lib/registry';
import {
	colonIdMeta,
	serializePluginIdentifier,
	unwrapProfileImportCode,
	decodeProfileImportCode,
	validateProfileImportData,
} from 'lib/serialize';
import {useStore} from 'models/store';
import {listStringValues} from 'models/options';
import type {Processor} from 'models/processors';
import type {ProfileGridPosition} from 'models/profiles';
import {Input} from 'components/Input';
import {Textarea} from 'components/Textarea';
import {Dropdown} from 'components/Dropdown';
import {Checkbox} from 'components/Checkbox';
import {Alert} from 'components/Alert';
import {Button} from 'components/Button';
import {Nav, NavLink} from 'components/Nav';
import {Icon} from 'components/Icon';
import {Tag} from 'components/Tag';
import {Pre} from 'components/Pre';
import {Spinner} from 'components/Spinner';
import {ProfileCategories} from 'components/Profiles';
import {Scrollable} from 'components/Scrollable';

interface ProfileImportProps {
	categoryId?: string;
	hideTabs?: boolean;
	onCategoryIdChange?: (id: string) => void;
	position?: Partial<ProfileGridPosition>;
	initial?: string;
	initialSection?: 'new' | 'import';
	onPayload: (payload: any) => void;
	onClose: (meta?: {canceled?: boolean}) => void;
}

export function ProfileImport({
	initial,
	hideTabs: hideTabsRequested,
	categoryId: initialCategoryId,
	onCategoryIdChange,
	onClose,
	onPayload,
	position: initialGridPosition,
}: ProfileImportProps) {
	initial = typeof initial === 'string' ? initial.trim() : undefined;
	const {settings} = useStore();
	const initialCode = useMemo(() => {
		// Use initial when passed
		if (initial) return unwrapProfileImportCode(initial);

		// Try decoding clipboard data, and use it when its a valid import code
		try {
			const unwrapped = unwrapProfileImportCode(clipboard.readText().trim());
			const decoded = decodeProfileImportCode(unwrapped);
			validateProfileImportData(decoded.data);
			return unwrapped;
		} catch {
			return '';
		}
	}, [initial]);
	const hideTabs = hideTabsRequested || initialCategoryId != null;
	const [categoryId, setCategoryId] = useState<string>(initialCategoryId || settings.profileCategory());
	const [position, setPosition] = useState<Partial<ProfileGridPosition> | undefined>(initialGridPosition);
	const [importCode, setImportCode] = useState<string>(initialCode);
	const [screen, setScreen] = useState<'warning' | 'edit' | 'import'>(
		settings.warnProfileImport() ? 'warning' : 'import'
	);

	function updateCode(value: string) {
		setImportCode(unwrapProfileImportCode(value));
	}

	function handleCategoryIdChange(id: string) {
		setCategoryId(id);
		// If other than requested category is selected, remove suggested
		// gridPosition from final data, as it won't match anymore.
		setPosition(id === initialCategoryId ? initialGridPosition : undefined);
		onCategoryIdChange?.(id);
	}

	return (
		<div class="ProfileImport">
			{{
				warning: () => (
					<WarningScreen
						onClose={() => onClose({canceled: true})}
						onAcknowledged={() => setScreen('import')}
					/>
				),
				import: () => (
					<ImportScreen
						importCode={importCode}
						hideTabs={hideTabs}
						categoryId={categoryId}
						onCategoryIdChange={handleCategoryIdChange}
						onChange={updateCode}
						onEdit={() => setScreen('edit')}
						onPayload={onPayload}
						position={position}
						onClose={onClose}
					/>
				),
				edit: () => (
					<EditScreen
						importCode={importCode || ''}
						onSubmit={(code) => {
							updateCode(code);
							setScreen('import');
						}}
						onBack={() => setScreen('import')}
						onClose={() => onClose({canceled: true})}
					/>
				),
			}[screen]()}
		</div>
	);
}

function PIActions({onClose, children}: RenderableProps<{onClose: () => void}>) {
	return (
		<div class="PIActions">
			<Button class="cancel" large variant="danger" onClick={onClose}>
				Cancel
			</Button>
			{children}
		</div>
	);
}

function ImportScreenWrap({
	children,
	onSubmit,
	onClose,
}: RenderableProps<{
	onSubmit?: () => void;
	onClose: () => void;
}>) {
	const isDisabled = onSubmit == null;
	const formRef = useRef<HTMLDivElement>(null);

	useVolley(formRef);

	return (
		<div class="PIImportScreen">
			<Scrollable class="form" innerRef={formRef}>
				{children}
			</Scrollable>

			<PIActions onClose={onClose}>
				<Button
					class="import"
					large
					semitransparent={isDisabled}
					variant={isDisabled ? undefined : 'accent'}
					disabled={isDisabled}
					onClick={onSubmit}
				>
					{!isDisabled && <Icon name="check" />}
					{isDisabled ? 'Waiting for requirements' : 'Import'}
				</Button>
			</PIActions>
		</div>
	);
}

interface ImportScreenProps {
	categoryId: string;
	hideTabs?: boolean;
	onCategoryIdChange: (id: string) => void;
	onChange: (value: string) => void;
	importCode: string;
	onEdit: () => void;
	position?: Partial<ProfileGridPosition>;
	onPayload: (payload: any) => void;
	onClose: (meta?: {canceled?: boolean}) => void;
}

export const ImportScreen = observer(function ImportScreen({
	importCode,
	onEdit,
	hideTabs,
	categoryId,
	onCategoryIdChange,
	onChange,
	onClose,
	onPayload,
	position,
}: ImportScreenProps) {
	importCode = importCode.trim();
	const cancel = () => onClose({canceled: true});

	const makeImportCodeInput = (variant?: Variant) => (
		<div class="import-code">
			<Input
				placeholder="Import code, url, markdown link, or json"
				variant={variant}
				value={importCode}
				onChange={onChange}
				tooltip="Import code"
			/>
			<Button semitransparent muted variant="info" onClick={onEdit} tooltip="Edit import code">
				<Icon name="edit" />
			</Button>
		</div>
	);

	if (importCode.length === 0) {
		return (
			<ImportScreenWrap onClose={cancel}>
				{makeImportCodeInput()}

				<div>
					<Alert variant="info" icon="info">
						Enter import code.
					</Alert>
				</div>
			</ImportScreenWrap>
		);
	}

	const decoded = useMemo(() => {
		try {
			const decoded = decodeProfileImportCode(importCode);
			validateProfileImportData(decoded.data);
			return decoded;
		} catch (error) {
			return new Error(eem(error));
		}
	}, [importCode]);

	if (decoded instanceof Error) {
		return (
			<ImportScreenWrap onClose={cancel}>
				{makeImportCodeInput('danger')}

				<div>
					<Alert variant="danger" icon="warning">
						<pre>{eem(decoded)}</pre>
					</Alert>
				</div>
			</ImportScreenWrap>
		);
	}

	const data = decoded.data;
	const processorId = decoded.data.processor;
	const [pluginName, processorName] = colonIdMeta(processorId);
	const {plugins, processors, profiles, history, settings} = useStore();
	const [customTitle, setCustomTitle] = useState(data.title || '');
	const [customProcessorName, setCustomProcessorName] = useState(processorName);
	const customProcessorId = `${pluginName}:${customProcessorName}`;
	const originalProcessorIsAvailable = processors.byId().has(processorId);
	const plugin = plugins.byId().get(pluginName);
	const processor = processors.byId().get(customProcessorId);
	const isReadyToImport = processor != null;

	useEffect(() => {
		setCustomProcessorName(processorName);
	}, [processorId]);

	function importProfile() {
		if (!data) return;

		const newProfile = profiles.create({
			title: customTitle,
			categoryId,
			version: data.version,
			processorId: customProcessorId,
			options: data.options,
			position,
		});

		history.replace(`/profiles/${newProfile.id}`);
		onPayload(newProfile);
		onClose();
	}

	return (
		<ImportScreenWrap onClose={cancel} onSubmit={isReadyToImport ? importProfile : undefined}>
			{makeImportCodeInput('success')}

			{!hideTabs && settings.showProfileTabs() && (
				<div class="category">
					<ProfileCategories activeId={categoryId} onActivate={onCategoryIdChange} />
				</div>
			)}

			{data && (
				<div class="title">
					<header>
						<h1>Title</h1>
						<Input value={customTitle} placeholder="Enter profile title" onChange={setCustomTitle} />
					</header>
				</div>
			)}

			<PIPluginInstaller name={pluginName} source={data.source} version={data.version} />

			{plugin && (
				<div class="processor">
					<header>
						<h1>Processor</h1>
						<h2
							class={originalProcessorIsAvailable ? '-success' : '-warning'}
							title={
								originalProcessorIsAvailable
									? `Processor ${processorId} is available`
									: `Original processor ${processorId} is not available`
							}
						>
							<Icon name={originalProcessorIsAvailable ? 'check' : 'warning'} />
							{originalProcessorIsAvailable ? (
								<span class="-relative">{customProcessorName}</span>
							) : (
								<Dropdown
									value={customProcessorName}
									variant={!processor ? 'warning' : undefined}
									onChange={setCustomProcessorName}
								>
									{[
										<option value={processorName} disabled>
											{processorName}
										</option>,
										...plugin
											.processors()
											.map((processor) => (
												<option value={processor.name}>{processor.name}</option>
											)),
									]}
								</Dropdown>
							)}
						</h2>
					</header>

					{!processor && (
						<Alert variant="warning">
							Installed version of the plugin <b>{pluginName}</b> doesn't come with processor{' '}
							<b>{customProcessorName}</b>. If the plugin is outdated, updating it might fix this. If the
							import code is outdated, maybe maintainers only renamed it. You can try selecting one of the
							plugin's currently available processors and hope the options still fit.
							<br />
							It's also wise to investigate changelogs on plugin's homepage when available.
						</Alert>
					)}
				</div>
			)}

			{processor != null && <PIOptionsViewer options={data.options} processor={processor} />}
		</ImportScreenWrap>
	);
});

type PluginManifestState =
	| {state: 'uninitialized'; data?: never}
	| {state: 'loading'; data?: never}
	| {state: 'ok'; data: PluginRegistryMeta}
	| {state: 'error'; data?: never; message: string};

const PIPluginInstaller = observer(function PIPluginInstaller({
	name,
	source,
	version,
}: {
	name: string;
	source: string;
	version: string;
}) {
	const {plugins, staging} = useStore();
	const installed = plugins.byId().get(name);
	const isInstalled = installed != null;
	const meta = serializePluginIdentifier(name);
	const isExternal = meta.isExternal;
	const major = parseInt(version.split('.')[0]!, 10);
	const [pluginManifest, setPluginManifest] = useState<PluginManifestState>({state: 'uninitialized'});
	const installedVersion = installed?.version;
	const registryVersion = pluginManifest.data?.version;
	const majorMatchesInstalled = installedVersion?.startsWith(`${major}.`);
	const majorMatchesRegistry = registryVersion?.startsWith(`${major}.`);
	const isOfficial = name.startsWith(`@${manifest.name}/`);
	const isImpostor = isExternal && isOfficial;
	const isStaging = staging.isStaging();
	const isInstalling = staging.matchStaging('plugins', 'install') != null;

	useAbortableEffect(
		async (signal) => {
			if (isExternal) {
				setPluginManifest({state: 'uninitialized'});
				return;
			}

			setPluginManifest({state: 'loading'});

			try {
				setPluginManifest({state: 'ok', data: await registry.meta(source, {signal})});
			} catch (error) {
				setPluginManifest({state: 'error', message: eem(error)});
			}
		},
		[source]
	);

	const actions: VNode[] = [];

	if (isExternal) {
		actions.push(
			<Button
				outline
				semitransparent
				multiline
				variant="info"
				disabled={isStaging}
				loading={isInstalling}
				onClick={() => plugins.install(source)}
			>
				<span class="title">Install external</span>
				<span class="description">
					This will install the plugin from external source listed above. At the moment this always installs
					the latest version available.
				</span>
			</Button>
		);
	} else {
		if (installed && version !== installed.version) {
			actions.push(
				<Button
					outline
					semitransparent
					multiline
					variant="info"
					disabled={isStaging}
					loading={isInstalling}
					onClick={() => plugins.install(`${name}@^${major}`)}
				>
					<span class="title">
						Install <code>^{major}</code>
					</span>
					<span class="description">
						This will install the highest major version{' '}
						<b>
							<code>{major}</code>
						</b>{' '}
						of the plugin from the registry.
					</span>
				</Button>
			);
		}

		if (!majorMatchesRegistry && registryVersion && (!installed || registryVersion !== installed.version)) {
			actions.push(
				<Button
					outline
					semitransparent
					multiline
					variant="info"
					disabled={isStaging}
					loading={isInstalling}
					onClick={() => plugins.install(`${name}@*`)}
				>
					<span class="title">Install latest {registryVersion ? registryVersion : ''}</span>
					<span class="description">
						This will install the latest version available in the registry. Since the latest is higher than
						the version requested by import code, there might be incompatibilities.
					</span>
				</Button>
			);
		}
	}

	return (
		<div class="PIPluginInstaller">
			<header>
				<h1>Plugin</h1>
				<h2 class="name">
					<Icon
						variant={isOfficial ? 'accent' : 'warning'}
						name={isOfficial ? 'logo' : 'warning'}
						tooltip={isOfficial ? 'Official plugin' : 'Non-official plugin'}
					/>
					<span class="-relative" title={name}>
						{meta.displayName}
					</span>
				</h2>
			</header>

			<ul class="versions">
				<li class="requested" title="Version requested by import code">
					<h1>requested</h1>
					<Icon name="tag" />
					<span class="version">{version}</span>
				</li>

				<li class="spacer"></li>

				<li
					class={`installed ${isInstalled ? (majorMatchesInstalled ? '-success' : '-warning') : '-danger'}`}
					title={
						isInstalled
							? `Installed version${!majorMatchesInstalled ? ` (major mismatch)` : ''}`
							: `Plugin not installed`
					}
				>
					<h1>installed</h1>
					<Icon name={isInstalled && majorMatchesInstalled ? 'check' : 'tag'} />
					<span class="version">{installedVersion || 'n/a'}</span>
				</li>

				<li
					class={`source ${pluginManifest.state === 'error' ? '-danger' : isExternal ? '-warning' : ''}`}
					title={
						isExternal
							? `Import code requests plugin from outside of the registry:\n${source}`
							: `Plugin from npm registry:\n${source}`
					}
				>
					<h1>source</h1>
					<span class="spacer" />
					{isExternal ? (
						<span class="name -relative">{source}</span>
					) : (
						<a class="title" href={`https://www.npmjs.com/package/${name}`}>
							<Icon name={isExternal ? 'warning' : 'npm'} />
							<span class="-relative">{source}</span>
						</a>
					)}
					{!isExternal && <Icon name="tag" />}
					{!isExternal && (
						<span
							class="version"
							title={
								isExternal
									? `Can't retrieve latest version for external sources`
									: pluginManifest.state === 'loading'
									? `Retrieving latest version`
									: pluginManifest.state === 'ok'
									? `Latest version available in registry`
									: pluginManifest.state === 'error'
									? `Latest version couldn't be loaded: ${pluginManifest.message}`
									: 'n/a'
							}
						>
							{pluginManifest.state === 'loading' ? (
								<Spinner />
							) : pluginManifest.state === 'ok' ? (
								pluginManifest.data.version
							) : pluginManifest.state === 'error' ? (
								'error'
							) : (
								'N/A'
							)}
						</span>
					)}
				</li>
			</ul>

			{pluginManifest.state === 'error' && (
				<Alert variant="danger">
					Error when checking latest available version in registry:
					<Pre>{pluginManifest.message}</Pre>
				</Alert>
			)}

			{isImpostor && (
				<Alert variant="danger">
					This import code requests to install an <b>official</b> plugin from an <b>external</b> source.
					Official plugins will always be available in the npm registry, so this is probably a malicious
					impostor plugin.
					<br />
					<b>Do not install, unless you know what you're doing!</b>
				</Alert>
			)}

			{!isOfficial && !isInstalled && (
				<Alert variant="warning">
					This is a non-official plugin, and as such {manifest.productName} can't vouch for its safety. Only
					install this kind of plugins if you trust them.
					<br />
					Signs of a shady plugin: low quality readme, published very recently by a new npm account with
					nothing else under its name, low installs, no source code available, ...
				</Alert>
			)}

			{isExternal && (
				<Alert variant="warning">
					This import code requests to install plugin{' '}
					<code>
						<b>{name}</b>
					</code>{' '}
					from an external source{' '}
					<code>
						<b>{source}</b>
					</code>
					.
					<br />
					External sources pose an additional risk as they are not checked and removed when infected as in the
					npm registry.
				</Alert>
			)}

			{installed && !majorMatchesInstalled && (
				<Alert variant="warning">
					Import code requests plugin version <b>{version}</b>, but installed is already{' '}
					<b>{installed.version}</b>. This means major versions don't match (<b>{major}</b>≠
					<b>{parseInt(installed.version.split('.')[0]!, 10)}</b>). Major version bumps occur when backwards
					incompatible changes are introduced. You should look up plugin's changelog to see if there is
					anything you need to do to migrate after importing the profile.
				</Alert>
			)}

			{installed && !majorMatchesInstalled && (
				<Alert variant="warning">
					There are currently{' '}
					<b>
						<code>{installed.dependentProfiles().length}</code>
					</b>{' '}
					profiles depending on installed version.
				</Alert>
			)}

			{actions.length > 0 && <div class="actions">{actions}</div>}
		</div>
	);
});

function PIOptionsViewer({options, processor}: {options: any; processor: Processor}) {
	const isEmpty = !options;
	const optionsJson = useMemo(() => (options ? JSON.stringify(options, null, 2) : undefined), [options]);
	const stringValues = useMemo(
		() => listStringValues(options, processor.optionsSchema),
		[options, processor.optionsSchema]
	);
	const hasSuspiciousString = stringValues.find((s) => s.isSuspicious) != null;
	const [section, setSection] = useState<'all' | 'strings'>('all');

	return (
		<div class="PIOptionsViewer">
			<header>
				<h1>Options</h1>
				{!isEmpty && (
					<Nav>
						<NavLink
							to="all"
							activeMatch={section === 'all'}
							onClick={() => setSection('all')}
							tooltip="All options as JSON"
						>
							All
						</NavLink>
						<NavLink
							to="strings"
							variant={hasSuspiciousString ? 'warning' : undefined}
							activeMatch={section === 'strings'}
							onClick={() => setSection('strings')}
							tooltip={`List of only string options.\nString options can contain dangerous paths, or malicious code.`}
						>
							Strings <Tag>{stringValues.length}</Tag>
						</NavLink>
					</Nav>
				)}
			</header>

			{isEmpty ? (
				<Alert>This import code doesn't come with profile options.</Alert>
			) : section === 'all' ? (
				<Pre class="all">{optionsJson}</Pre>
			) : (
				<dl class="strings">
					{stringValues.length === 0 ? (
						<dd>
							<span class="placeholder">no string values</span>
						</dd>
					) : (
						stringValues.map(({name, value, isSuspicious}) => {
							return [
								<dt class={isSuspicious ? '-warning' : undefined}>
									<span class="name" title={name}>
										{name}
									</span>
									{isSuspicious && (
										<Icon
											variant="warning"
											name="warning"
											tooltip="String includes JavaScript template literal, which makes it potentially dangerous."
										/>
									)}
								</dt>,
								<dd class={isSuspicious ? '-warning' : undefined}>{valueToStringElement(value)}</dd>,
							];
						})
					)}
				</dl>
			)}
		</div>
	);
}

function valueToStringElement(value: any) {
	const stringified = `${value}`;
	return (
		<Pre>
			{value == null ? (
				<span class="placeholder">{`${value}`}</span>
			) : stringified === '' ? (
				<span class="placeholder">empty</span>
			) : (
				stringified
			)}
		</Pre>
	);
}

function WarningScreen({onClose, onAcknowledged}: {onClose: () => void; onAcknowledged: () => void}) {
	const {settings} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	return (
		<div class="PIWarningScreen">
			<div class="copy" ref={containerRef}>
				<h1>Warning!</h1>

				<p>
					Be wary of installing non official plugins (not marked with <Icon name="logo" /> icon, and their
					registry ID doesn't start with <code>@drovp/</code> prefix), and only install when you trust them.
				</p>

				<p>
					When importing profiles, carefully examine their options! Especially string values might lead to
					paths that overwrite your existing system files, or in case the option accepts string templates,
					even contain malicious code.
				</p>

				<label>
					<Checkbox
						checked={!settings.warnProfileImport()}
						onChange={(state) => settings.warnProfileImport(!state)}
					/>{' '}
					Don't show this again.
				</label>
			</div>

			<PIActions onClose={onClose}>
				<Button large variant="warning" onClick={onAcknowledged}>
					I understand <Icon name="arrow-right" />
				</Button>
			</PIActions>
		</div>
	);
}

function EditScreen({
	importCode,
	onSubmit,
	onBack,
	onClose,
}: {
	importCode: string;
	onSubmit: (json: string) => void;
	onBack: () => void;
	onClose: () => void;
}) {
	let [json, setJson] = useState(
		useMemo(() => {
			try {
				return JSON.stringify(decodeProfileImportCode(importCode).data, null, 2);
			} catch {
				return '';
			}
		}, [importCode])
	);
	let [error, setError] = useState<string | null>(null);
	const isEmpty = json.trim() === '';
	const isDisabled = error != null || isEmpty;
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	function handleChange(value: string) {
		setJson(value);
		validate(value);
	}

	function validate(json: string) {
		try {
			const data = JSON.parse(json);
			validateProfileImportData(data);
			setError(null);
		} catch (error) {
			setError(eem(error));
		}
	}

	useEffect(() => validate(json), []);

	return (
		<div class="PIEditScreen">
			<div class="editor" ref={containerRef}>
				<div class="actions">
					<Button
						class="back"
						semitransparent
						onClick={onBack}
						tooltip="Discard changes and return to import screen"
					>
						<Icon name="arrow-left" /> Discard
					</Button>
					<Button
						class="submit"
						semitransparent={isDisabled}
						variant={isDisabled ? undefined : 'success'}
						disabled={isDisabled}
						// We re-stringify to ensure no useless whitespace in result
						onClick={() => onSubmit(JSON.stringify(JSON.parse(json)))}
						tooltip="Confirm changes and return to import"
					>
						{!isDisabled && <Icon name="check" />}
						{isDisabled ? 'Waiting for requirements' : 'Confirm'}
					</Button>
				</div>

				<Textarea rows={10} resizable={false} value={json} onChange={handleChange} />

				{isEmpty && (
					<Alert variant="info" icon="info">
						Enter import data as JSON.
					</Alert>
				)}
				{!isEmpty && error && (
					<Alert variant="danger" icon="warning">
						<pre>{error}</pre>
					</Alert>
				)}
				{!isDisabled && (
					<Alert variant="success" icon="check">
						Seems fine.
					</Alert>
				)}
			</div>

			<PIActions onClose={onClose} />
		</div>
	);
}
