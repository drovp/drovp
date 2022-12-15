import {h} from 'preact';
import {observer} from 'statin-preact';
import {prevented} from 'lib/utils';
import {BatchProgress} from 'components/BatchProgress';
import {Progress} from 'components/Progress';
import {OperationTitle} from 'components/OperationCard';
import {Profile} from 'models/profiles';
import {useStore} from 'models/store';

interface ProfileProgressProps {
	profile: Profile;
	compact?: boolean;
}

export const ProfileProgress = observer(({profile, compact}: ProfileProgressProps) => {
	const {worker, history, settings} = useStore();
	const batchTotal = profile.batch.items().length;
	const batchCompleted = profile.batch.index();
	const renderBatch = profile.batch.items().length > 0;

	const pendingOperations = profile.pending();
	const isIdle = pendingOperations.length === 0;
	const isPaused = worker.isPaused();

	let classNames = 'ProfileProgress';
	if (compact) classNames += ' -compact';
	if (isIdle) classNames += ' -idle';

	return (
		<div className={classNames}>
			{renderBatch && (
				<BatchProgress
					key="main"
					batch={profile.batch}
					label={isIdle && isPaused && settings.compact() ? 'paused' : undefined}
					tooltip="Batch progress (done/total/pending)."
				/>
			)}
			<div class="pending">
				{isIdle ? (
					<Progress
						key="nothing-pending"
						completed={0}
						label={
							compact && renderBatch
								? undefined
								: worker.isPaused()
								? 'paused'
								: batchCompleted < batchTotal
								? 'queued'
								: 'idle'
						}
					/>
				) : (
					pendingOperations.map((operation) => {
						const progress = operation.progress();
						return (
							<Progress
								key={operation.id}
								variant="info"
								completed={progress || 1}
								indeterminate={progress == null}
								label={compact ? undefined : <OperationTitle operation={operation} compact />}
								onClick={prevented(() => history.push(`/operations/${operation.id}`))}
							/>
						);
					})
				)}
			</div>
		</div>
	);
});
