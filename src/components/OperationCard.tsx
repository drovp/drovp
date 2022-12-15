import {h, ComponentChild} from 'preact';
import {observer} from 'statin-preact';
import {prevented} from 'lib/utils';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';
import type {Operation} from 'models/operations';
import {useStore} from 'models/store';
import {ItemTitle} from 'components/Items';

interface OperationCardProps {
	operation: Operation;
	showProfileTitle?: boolean;
}

export const OperationCard = observer(({operation, showProfileTitle}: OperationCardProps) => {
	const {history} = useStore();
	const state = operation.state();
	const isDone = state === 'done';
	const isPending = state === 'pending';
	const isQueued = state === 'queued';
	const hasError = operation.hasError();
	const isBulk = operation.isBulk;
	const stage = operation.stage();
	const inputsCount = operation.payload?.inputs?.length ?? 0;
	const outputsCount = operation.outputs().length;
	const remaining = operation.remaining();
	const humanProgress = operation.humanProgress();

	let classNames = `OperationCard -${state}`;
	if (hasError) classNames += ' -danger';
	else if (isDone) classNames += ' -success';
	if (isBulk) classNames += ' -bulk';

	return (
		<button
			class={classNames}
			onClick={() =>
				history.push(`/operations/${operation.id}?from=${encodeURIComponent(history.location.href)}`)
			}
			data-context-menu="operation"
			data-context-menu-payload={operation.id}
		>
			<OperationProgress operation={operation} />

			<header>
				<OperationTitle operation={operation} compact />

				{stage && (
					<div class="stage" title={`Current stage: ${stage}`}>
						{stage}
					</div>
				)}

				{state === 'pending' && humanProgress ? (
					<div class="percent">{humanProgress}</div>
				) : (
					!stage && <div class="state">{hasError ? 'error' : state}</div>
				)}
			</header>

			<div class="meta">
				{showProfileTitle === true && (
					<div class="iconValue profile" title={operation.profile.title()}>
						<Icon name="profile" /> <span class="title">{operation.profile.title()}</span>
					</div>
				)}

				{inputsCount > 0 && outputsCount === 0 && (
					<div class="iconValue inputs" title={`${inputsCount} inputs`}>
						{inputsCount} <Icon name="input" />
					</div>
				)}

				{outputsCount > 0 && inputsCount === 0 && (
					<div class="iconValue outputs" title={`${outputsCount} outputs`}>
						<Icon name="output" /> {outputsCount}
					</div>
				)}

				{outputsCount > 0 && inputsCount > 0 && (
					<div class="iconValue inputsOutputs" title={`${inputsCount} inputs -> ${outputsCount} outputs`}>
						{inputsCount} <Icon name="operation" /> {outputsCount}
					</div>
				)}

				<div class="iconValue logsCount" title="Logs count">
					<Icon name="notes" /> {operation.logsCount()}
				</div>

				<div class="spacer" />

				{!isQueued && (
					<div class="iconValue duration" title="Duration">
						{operation.elapsed()}
					</div>
				)}

				{isPending && remaining && <Icon name="time" />}

				{isPending && remaining && (
					<div class="iconValue remaining" title="Remaining">
						{remaining}
					</div>
				)}
			</div>

			<div class="actions">
				{isPending ? (
					<Button
						variant="danger"
						transparent
						muted
						onClick={prevented(() => operation.stop())}
						tooltip="Stop"
					>
						<Icon name="stop" />
					</Button>
				) : isQueued ? (
					[
						<Button
							variant="info"
							transparent
							muted
							onClick={prevented(() => operation.start())}
							tooltip="Force start"
						>
							<Icon name="play" />
						</Button>,
						<Button
							variant="warning"
							transparent
							muted
							onClick={prevented(() => operation.delete())}
							tooltip="Delete"
						>
							<Icon name="trash" />
						</Button>,
					]
				) : (
					<Button
						variant="info"
						transparent
						muted
						onClick={prevented(() => operation.restart())}
						tooltip="Restart"
					>
						<Icon name="refresh" />
					</Button>
				)}
			</div>
		</button>
	);
});

const OperationProgress = observer(function OperationProgress({operation}: {operation: Operation}) {
	if (operation.state() !== 'pending') return null;

	const progress = operation.progress();
	const progressFraction = operation.progress() ?? 1;
	const isIndeterminate = progress == null;

	let classNames = 'progress';
	if (isIndeterminate) classNames += ' -indeterminate';

	return <div class={classNames} style={`width:${progressFraction * 100}%`} />;
});

export const OperationTitle = observer(function OperationTitle({
	operation,
	compact,
}: {
	operation: Operation;
	compact?: boolean;
}) {
	let classNames = 'OperationTitle';
	const operationTitle = operation.title();
	let tooltip = `ID: ${operation.id}`;
	const inputsCount = operation.inputs.length;

	if (!operationTitle && inputsCount === 1 && operation.inputs[0]) {
		return <ItemTitle class={classNames} item={operation.inputs[0]} compact={compact} tooltip={tooltip} />;
	}

	let content: ComponentChild[] = [];

	if (operationTitle) {
		tooltip += `\n${operationTitle}`;
		content.push(<div class="fixed">{operationTitle}</div>);
	} else if (inputsCount > 1) {
		tooltip = `\nBulk operation with ${inputsCount} inputs.`;
		content.push('[', <em>{inputsCount} inputs</em>, ']');
	} else {
		content.push(<em>{operation.id}</em>);
	}

	classNames += ` RelativeTitle`;

	return (
		<div className={classNames} title={tooltip}>
			{content}
		</div>
	);
});
