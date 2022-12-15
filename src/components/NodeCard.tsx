import {h} from 'preact';
import {observer} from 'statin-preact';
import {useStore} from 'models/store';
import {Spinner} from 'components/Spinner';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';

export const NodeCard = observer(function NodeCard() {
	const {node, staging, operations} = useStore();
	const nodeUpdateAvailable = node.updateAvailable();
	const isStaging = staging.isStaging();
	const isReady = node.isReady();
	const isInstalling = node.isInstalling();
	const isPending = operations.isPending();
	const isCheckingForUpdates = node.isCheckingForUpdates();

	let classNames = 'Card VersionCard NodeCard';
	if (isInstalling) classNames += ' -info';
	else if (nodeUpdateAvailable) classNames += ' -success';
	else if (!isReady) classNames += ' -danger';

	return (
		<article class={classNames} title={`Node.js dependency\nFramework required to execute processors`}>
			<header>
				<h1>Node.js</h1>
				<h2>{isReady ? 'Ready' : 'Error'}</h2>
			</header>
			<div class="meta">
				{isInstalling ? (
					<div class="versions">
						<Spinner />
						<div class="version">installing</div>
					</div>
				) : (
					<div class="versions">
						<div class="name">current:</div>
						<div class="version">{node.version() || 'missing'}</div>
						<div class="name">latest:</div>
						<div class="version">{node.availableVersion() || 'n/a'}</div>
					</div>
				)}
			</div>
			<div class="actions">
				{nodeUpdateAvailable || !isReady ? (
					<Button
						variant="success"
						disabled={isStaging || isCheckingForUpdates || isPending}
						onClick={() => node.install()}
						tooltip={
							isPending
								? `Operations are pending`
								: isReady
								? `Update to ${nodeUpdateAvailable}`
								: `Reinstall Node.js`
						}
					>
						<Icon name="install" />
						<span>{isReady ? `Update` : `Reinstall`}</span>
					</Button>
				) : (
					<Button
						disabled={isStaging || isCheckingForUpdates}
						onClick={() => node.checkForUpdates()}
						tooltip="Check for updates"
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
