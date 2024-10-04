import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useVolley} from 'lib/hooks';
import {formatRelevantTime, formatDuration, clamp, rafThrottle} from 'lib/utils';
import {useStore} from 'models/store';
import type {Operation as OperationModel} from 'models/operations';
import {Icon} from 'components/Icon';
import {Progress} from 'components/Progress';
import {Nav, NavLink, NavLinkRelativePart} from 'components/Nav';
import {Tag} from 'components/Tag';
import {Vacant} from 'components/Vacant';
import {Button} from 'components/Button';
import {Logs} from 'components/Logs';
import {Items} from 'components/Items';
import {TitleBar} from 'components/TitleBar';
import {Scrollable} from 'components/Scrollable';
import {ProcessorCard} from 'components/ProcessorCard';
import {PluginCard} from 'components/PluginCards';
import {PayloadEditor} from 'components/PayloadEditor';

interface OperationSubRouteProps {
	id?: string | null;
}

export const OperationSubRoute = observer(function OperationSubRoute({id}: OperationSubRouteProps) {
	const {operations, history} = useStore();

	if (!id) return <Vacant title={`Operation section is missing ID param.`} />;

	const operation = operations.byId().get(id);

	return operation ? (
		<Operation
			operation={operation}
			section={history.location.searchParams.get('operationSection')}
			onSectionChange={(section) => {
				const params = new URLSearchParams(history.location.search);
				params.set('operationSection', section);
				history.replace(`?${params.toString()}`);
			}}
		/>
	) : (
		<Vacant title={[`Operation "`, <code>{id}</code>, `" not found`]} />
	);
});

interface OperationProps {
	operation: OperationModel;
	section?: string | null;
	onSectionChange: (section: string) => void;
}

const Operation = observer(function Operation({operation, section, onSectionChange}: OperationProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const {history, staging} = useStore();
	const state = operation.state();
	const isQueued = state === 'queued';
	const isDone = state === 'done';
	const isPending = state === 'pending';
	const hasError = operation.hasError();
	const title = operation.title();

	section = section || 'io';

	function deleteOperation() {
		const profileId = operation.profile.id;
		operation.delete();
		history.replace(`/profiles/${profileId}?section=operations`);
	}

	let classNames = `Operation -${state}`;
	let headerClassNames = '';
	if (hasError) {
		classNames += ' -error';
		headerClassNames += ' -danger';
	} else if (state === 'done') {
		headerClassNames += ' -success';
	}

	useVolley(containerRef, {perpetual: true});

	return (
		<section
			ref={containerRef}
			class={classNames}
			data-context-menu="operation"
			data-context-menu-payload={operation.id}
		>
			<header class={headerClassNames}>
				<Button
					class="back"
					semitransparent
					variant="info"
					muted
					onClick={() => history.push(`/profiles/${operation.profile.id}?section=operations`)}
					tooltip="To operations"
				>
					<Icon name="arrow-left" />
				</Button>
				{title ? (
					<h1 title={title}>{title}</h1>
				) : (
					<h1 class="-id" title="Operation ID">
						<code>{operation.id}</code>
					</h1>
				)}

				{isQueued ? (
					<Button
						class="force-start"
						variant="success"
						semitransparent
						muted
						onClick={operation.start}
						tooltip="Force start"
					>
						<Icon name="play" />
					</Button>
				) : (
					<Button
						class="restart"
						variant="success"
						semitransparent
						muted
						onClick={operation.restart}
						tooltip="Restart operation"
						disabled={!isDone || staging.isStaging()}
					>
						<Icon name="refresh" />
					</Button>
				)}

				{isPending ? (
					<Button
						class="stop"
						variant="danger"
						semitransparent
						muted
						onClick={() => operation.stop()}
						tooltip="Stop operation"
					>
						<Icon name="stop" />
					</Button>
				) : (
					<Button
						class="delete"
						variant="warning"
						semitransparent
						muted
						onClick={deleteOperation}
						tooltip="Delete operation"
					>
						<Icon name="trash" />
					</Button>
				)}
			</header>
			<OperationProgress operation={operation} />

			<Nav style="bar">
				<NavLink to="io" onClick={onSectionChange} activeMatch={section === 'io'} tooltip="Inputs/Outputs">
					<Icon name="input" />
					Inputs / Outputs
					<Icon name="output" />
				</NavLink>
				<NavLink to="payload" onClick={onSectionChange} activeMatch={section === 'payload'} tooltip="Payload">
					<Icon name="payload" />
					<NavLinkRelativePart>Payload</NavLinkRelativePart>
				</NavLink>
				<NavLink to="logs" onClick={onSectionChange} activeMatch={section === 'logs'} tooltip="Logs">
					<Icon name="notes" />
					<NavLinkRelativePart>Logs</NavLinkRelativePart>
					<LogsCountTag operation={operation} />
				</NavLink>
				<NavLink
					to="details"
					onClick={onSectionChange}
					activeMatch={section === 'details'}
					tooltip="OperationDetails"
				>
					<Icon name="info" />
					<NavLinkRelativePart>Details</NavLinkRelativePart>
				</NavLink>
			</Nav>

			{section === 'io' ? (
				<InputsOutputs key="io" operation={operation} />
			) : section === 'logs' ? (
				<OperationLogs key="logs" operation={operation} />
			) : section === 'payload' ? (
				<PayloadEditor key="payload" operation={operation} />
			) : (
				<OperationDetails key="details" operation={operation} />
			)}
		</section>
	);
});

const LogsCountTag = observer(function LogsCountTag({operation}: {operation: OperationModel}) {
	return <Tag>{operation.logsCount()}</Tag>;
});

export const OperationProgress = observer(function OperationProgress({operation}: {operation: OperationModel}) {
	const progress = operation.progress();
	const state = operation.state();
	const hasError = operation.hasError();
	const isQueued = state === 'queued';
	const isPending = state === 'pending';
	const isDone = state === 'done';

	let tooltip: string | undefined | null;
	let label: string | undefined | null;
	let labelLeft: string | undefined | null;
	let labelRight: string | undefined | null;

	if (isQueued) {
		tooltip = 'Queued';
		label = 'queued';
	} else if (isDone) {
		const elapsed = operation.elapsed();
		tooltip = `Done in ${elapsed}`;
		labelLeft = elapsed;
		label = 'done';
	} else if (progress != null) {
		const stage = operation.stage();
		tooltip = `Elapsed/${stage ? 'Stage' : 'Progress'}/Remaining`;
		labelLeft = operation.elapsed()!;
		label = stage || operation.humanProgress()!;
		labelRight = operation.remaining()!;
	} else {
		const humanProgress = operation.humanProgress();
		labelLeft = operation.elapsed();
		label = operation.stage();
		labelRight = humanProgress;
		tooltip = `Elapsed`;
		if (label) tooltip += '/Stage';
		if (labelRight) tooltip += '/Progress';
	}

	return (
		<Progress
			key={operation.id}
			variant={isQueued ? undefined : hasError ? 'danger' : isDone ? 'success' : 'info'}
			completed={progress || (isPending ? 1 : 0)}
			indeterminate={isPending && progress == null}
			tooltip={tooltip}
			labelLeft={labelLeft}
			label={label}
			labelRight={labelRight}
		/>
	);
});

const InputsOutputs = observer(function InputsOutputs({operation}: {operation: OperationModel}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const inputs = operation.inputs;
	const outputs = operation.outputs();

	function initResize(event: PointerEvent) {
		const container = containerRef.current;
		const inputs = container?.children[0];
		if (!container || !inputs) return;
		event.preventDefault();
		event.stopPropagation();

		const initialCursor = document.documentElement.style.cursor;
		const containerHeight = container.getBoundingClientRect().height;
		const initSize = inputs.getBoundingClientRect().height;
		const initPos = event.y;
		const handleMove = (event: PointerEvent) => {
			updateSize(`${Math.round(clamp(30, initSize + event.y - initPos, containerHeight * 0.9))}px`);
		};
		const updateSize = rafThrottle((size: string) => container.style.setProperty('--max-inputs-height', `${size}`));
		const handleUp = () => {
			document.documentElement.style.cursor = initialCursor;
			removeEventListener('pointermove', handleMove);
			removeEventListener('pointerup', handleUp);
			removeEventListener('pointercancel', handleUp);
		};

		document.documentElement.style.cursor = 'ns-resize';
		addEventListener('pointermove', handleMove);
		addEventListener('pointerup', handleUp);
		addEventListener('pointercancel', handleUp);
	}

	return (
		<div class="InputsOutputs" ref={containerRef}>
			{inputs.length > 0 ? (
				<Items class="inputs" items={inputs} style={`--items: ${inputs.length}`} />
			) : (
				<div class="inputs placeholder">No inputs</div>
			)}
			<div class="divider" onPointerDown={initResize} title="Drag to expand">
				<div class="count -inputs">
					<span class="value">{inputs.length}</span>
					in
					<Icon name="arrow-up" />
				</div>
				<div class="spacer" />
				<Icon name="unfold-more" />
				<div class="spacer" />
				<div class="count -outputs">
					<Icon name="arrow-down" />
					out
					<span class="value">{outputs.length}</span>
				</div>
			</div>
			{outputs.length > 0 ? (
				<Items class="outputs" items={outputs} style={`--items: ${outputs.length}`} />
			) : (
				<div class="outputs placeholder">No outputs</div>
			)}
		</div>
	);
});

const OperationLogs = observer(function OperationLogs({operation}: {operation: OperationModel}) {
	const containerRef = useRef<HTMLDivElement>(null);
	useVolley(containerRef);
	return <Logs innerRef={containerRef} class="OperationLogs" lines={operation.logs} syncBottom />;
});

export const OperationDetails = observer(function OperationDetails({
	operation,
	class: className,
}: {
	operation: OperationModel;
	class?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const profile = operation.profile;
	const processor = profile.processor();
	const pluginMeta = {...profile.pluginMeta, ...(processor?.plugin.meta || {description: 'Plugin not installed!'})};
	const started = operation.started();
	const ended = operation.ended();
	const duration = operation.duration();

	useVolley(containerRef);

	let classNames = 'OperationDetails ExtensionDetails';
	if (className) classNames += ` ${className}`;

	return (
		<Scrollable innerRef={containerRef} class={classNames}>
			<ul class="OperationMeta">
				<li class="title">
					<span class="title">Title</span>
					<span class="value">{operation.title() || 'undefined'}</span>
				</li>
				<li class="id">
					<span class="title">ID</span>
					<span class="value">{operation.id}</span>
				</li>
				<li class="state">
					<span class="title">State</span>
					<span class="value">{operation.state()}</span>
				</li>
				<li class="threadType">
					<span class="title">Thread type</span>
					<span class="value">{operation.threadTypes.join(', ')}</span>
				</li>
				<li class="started">
					<span class="title">Started</span>
					<span class="value" title={started ? new Date(started).toLocaleString() : undefined}>
						{started ? formatRelevantTime(started) : 'n/a'}
					</span>
				</li>
				<li class="ended">
					<span class="title">Ended</span>
					<span class="value" title={ended ? new Date(ended).toLocaleString() : undefined}>
						{ended ? formatRelevantTime(ended) : 'n/a'}
					</span>
				</li>
				<li class="duration">
					<span class="title">Duration</span>
					<span class="value">{duration ? formatDuration(duration) : 'n/a'}</span>
				</li>
			</ul>

			<div class="processor">
				<TitleBar>Processor</TitleBar>
				{processor ? (
					<ProcessorCard processor={processor} />
				) : (
					<Vacant>
						Processor <code>{profile.processorId}</code> is missing.
					</Vacant>
				)}
			</div>

			<div class="plugin">
				<TitleBar>Plugin</TitleBar>
				<PluginCard meta={pluginMeta} markMissing />
			</div>
		</Scrollable>
	);
});
