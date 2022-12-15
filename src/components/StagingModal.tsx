import {h} from 'preact';
import {useRef, useEffect} from 'preact/hooks';
import {createAction} from 'statin';
import {observer} from 'statin-preact';
import {Staging} from 'models/staging';
import {Modal} from 'models/modals';
import {Icon} from 'components/Icon';
import {Progress} from 'components/Progress';
import {Logs} from 'components/Logs';
import {Alert} from 'components/Alert';
import {Tag} from 'components/Tag';
import {Button} from 'components/Button';

export const StagingModal = observer(function StagingModal({modal, staging}: {modal: Modal; staging: Staging}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isDone = staging.isDone();
	const hasError = staging.hasError();
	const title = staging.title();
	const expandLogs = staging.expandLogs();
	const variant = isDone ? (hasError ? 'danger' : 'success') : 'info';

	if (modal.variant.value !== variant) modal.variant?.(variant);

	useEffect(
		() =>
			staging.subscribe(
				createAction(() => {
					modal.cancellable(true);
					if (staging.hasError()) staging.expandLogs(true);
					else if (!staging.expandLogs()) modal.close();
				})
			),
		[]
	);

	return (
		<div class={`StagingModal -${variant}`} ref={containerRef}>
			<header>
				<h1 title={title}>{title || <em>missing staging title</em>}</h1>
				<Button semitransparent variant="danger" disabled={!isDone} onClick={() => modal.close()}>
					Close
					<Icon name="x" />
				</Button>
			</header>

			<StagingProgress staging={staging} variant={variant} />

			<div class="logs -primary">
				<div class="controls">
					<LogsCounter staging={staging} />
					<Button semitransparent onClick={() => staging.expandLogs(!staging.expandLogs())}>
						<span>Show logs</span>
						<Icon name={expandLogs ? 'chevron-up' : 'chevron-down'} />
					</Button>
				</div>

				{expandLogs && (
					<Logs syncBottom lines={staging.logs}>
						{hasError && (
							<Alert variant="danger">
								Error happened during staging. Depending on its nature, it might be non-critical, and
								the concerned component could still be usable.
							</Alert>
						)}
					</Logs>
				)}
			</div>
		</div>
	);
});

const LogsCounter = observer(function LogsCounter({staging}: {staging: Staging}) {
	const logs = staging.logs().length;
	const errors = staging.errors().length;

	return (
		<div class="counter">
			<div class="type">
				<span class="title">Logs</span>
				<Tag>{logs}</Tag>
			</div>
			{errors > 0 && (
				<div class="type -danger">
					<span class="title">Errors</span>
					<Tag>{errors}</Tag>
				</div>
			)}
		</div>
	);
});

const StagingProgress = observer(function StagingProgress({variant, staging}: {variant?: Variant; staging: Staging}) {
	const isDone = staging.isDone();
	const progress = staging.progressData();
	const hasError = staging.hasError();

	return (
		<Progress
			variant={variant}
			completed={
				!isDone && progress?.total && typeof progress?.completed === 'number'
					? progress.completed / progress.total
					: 1
			}
			label={isDone ? (hasError ? 'error' : 'done') : staging.stageName()}
			indeterminate={!isDone && (progress?.indeterminate || progress?.total == null)}
		/>
	);
});
