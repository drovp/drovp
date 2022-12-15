import {h} from 'preact';
import {observer} from 'statin-preact';
import {useStore} from 'models/store';
import {Spinner} from 'components/Spinner';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';

export const AppCard = observer(function AppCard() {
	const {app, staging, operations} = useStore();
	const isCheckingForUpdates = app.isCheckingForUpdates();
	const version = app.version;
	const availableUpdate = app.updateAvailable();
	const latestVersion = app.latestVersion();
	const isStaging = staging.isStaging();
	const isUpdating = app.isUpdating();
	const isPending = operations.isPending();

	let classNames = 'Card VersionCard AppCard';
	if (availableUpdate) classNames += ` -success`;

	return (
		<article class={classNames} title={`The app itself`}>
			<header>
				<h1>App</h1>
			</header>
			<div class="meta">
				{isUpdating ? (
					<div class="versions">
						<Spinner />
						<div class="version">installing</div>
					</div>
				) : (
					<div class="versions">
						<div class="name">current:</div>
						<div class="version">{version}</div>
						<div class="name">latest:</div>
						<div class="version">{latestVersion || 'n/a'}</div>
					</div>
				)}
			</div>
			<div class="actions">
				{availableUpdate ? (
					<Button
						variant="success"
						disabled={isStaging || isCheckingForUpdates || isPending}
						onClick={() => app.update()}
						tooltip={isPending ? `Operations are pending` : `Update to ${availableUpdate}`}
					>
						<Icon name="install" />
						<span>Update</span>
					</Button>
				) : (
					<Button
						disabled={isCheckingForUpdates}
						onClick={() => app.checkForUpdates(true)}
						tooltip={`Check for updates`}
						loading={isCheckingForUpdates}
					>
						<Icon name="update-check" />
						<span>Check</span>
					</Button>
				)}
			</div>
		</article>
	);
});
