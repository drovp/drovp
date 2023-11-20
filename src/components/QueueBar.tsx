import {h} from 'preact';
import {useEffect, useRef} from 'preact/hooks';
import {reaction} from 'statin';
import {observer} from 'statin-preact';
import {throttle} from 'lib/utils';
import {useStore} from 'models/store';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Tag} from 'components/Tag';

export const QueueBar = observer(function QueueBar() {
	const {worker, operations, profiles} = useStore();
	const isPaused = worker.isPaused();
	const progressRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		return reaction(
			() => profiles.progress(),
			throttle((progress: number) => {
				if (progressRef.current) {
					progressRef.current.style.width = progress > 0 && progress <= 1 ? `${progress * 100}%` : '0';
				}
			}, 100)
		);
	}, []);

	let classNames = 'QueueBar';

	return (
		<div class={classNames}>
			<div class="progress" ref={progressRef} />
			<Button
				class="pause-resume"
				semitransparent
				variant={isPaused ? 'success' : 'info'}
				onClick={() => worker.toggle()}
				tooltip="Pause/Resume queue (won't pause pending operations)"
			>
				<Icon name={isPaused ? 'play' : 'pause'} />
				<span class="title">{isPaused ? 'Resume' : 'Pause'}</span>
			</Button>
			<Button
				semitransparent
				variant="danger"
				onClick={() => worker.stop()}
				tooltip="Kill pending operations and pause the queue"
			>
				<Icon name="stop" />
				<span class="title">Stop</span>
			</Button>
			<Button semitransparent variant="warning" onClick={() => operations.clearQueue()} tooltip="Clear queue">
				<Icon name="clear-all" />
				<span class="title">Queue</span>
				<Tag>{operations.queued().length}</Tag>
			</Button>
			<Button
				semitransparent
				variant="warning"
				muted
				onClick={() => operations.clearHistory()}
				tooltip="Clear history of all profiles"
			>
				<Icon name="clear-all" />
				<span class="title">History</span>
				<Tag>{operations.historySize()}</Tag>
			</Button>
		</div>
	);
});
