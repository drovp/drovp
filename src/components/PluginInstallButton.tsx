import {h, RenderableProps, VNode} from 'preact';
import {observer} from 'statin-preact';
import {useStore} from 'models/store';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';
import {Progress} from 'components/Progress';

const stagingActionMessage = {
	install: 'installing',
	uninstall: 'uninstalling',
	update: 'updating',
	setup: 'setting up',
	load: 'loading',
	create: 'creating',
	mocking: 'mocking',
};

export const PluginInstallButton = observer(function PluginInstallButton({id}: RenderableProps<{id: string}>) {
	const store = useStore();
	const {plugins, settings, staging} = store;
	const installed = plugins.byId().get(id);
	const isLocal = installed?.isLocal ?? false;
	const isExternal = installed?.isExternal ?? false;
	const externalSource = installed?.source;
	const isStaging = staging.isStaging();
	const isDisabled = isStaging || installed?.hasPendingOperations();
	const checkingForUpdates = installed?.isCheckingForUpdates();

	let classNames = 'PluginInstallButton';
	if (isDisabled) classNames += ' -disabled';
	if (isLocal) classNames += ' -local';

	const children: VNode[] = [];

	const makeUninstallButton = () => (
		<Button
			class="uninstall"
			variant="danger"
			disabled={isDisabled}
			semitransparent
			onClick={() => installed?.uninstallPrompt()}
			tooltip={
				isDisabled
					? isStaging
						? `Can't uninstall while staging`
						: `Can't uninstall while one of plugin's processors has pending operations`
					: isLocal
					? 'Delete'
					: 'Uninstall'
			}
		>
			<Icon name="trash" />
		</Button>
	);

	const matchedPluginStaging = staging.matchStaging(
		'plugins',
		undefined,
		(descriptor) => 'ids' in descriptor && descriptor.ids.includes(id)
	);

	if (matchedPluginStaging) {
		children.push(
			<Progress
				completed={1}
				indeterminate
				variant={matchedPluginStaging.action === 'uninstall' ? 'danger' : 'success'}
				label={stagingActionMessage[matchedPluginStaging.action]}
			/>
		);
	} else if (isExternal) {
		if (externalSource)
			children.push(
				<Button
					class="install"
					variant="success"
					semitransparent
					disabled={isDisabled}
					onClick={() => plugins.install(externalSource)}
					tooltip={`Reinstall external plugin from source:\n${externalSource}`}
				>
					<Icon name="install" /> Reinstall
				</Button>
			);
		children.push(makeUninstallButton());
	} else if (isLocal) {
		children.push(
			<Button
				class="edit"
				variant="info"
				semitransparent
				disabled={isDisabled}
				onClick={() => installed?.openInEditor()}
				tooltip={`Open in editor: ${settings.editCommand()}\nThis command can be configured in settings.`}
			>
				<Icon name="edit" />
			</Button>,
			makeUninstallButton()
		);
	} else if (!installed) {
		children.push(
			<Button
				class="install"
				variant="success"
				disabled={isDisabled}
				onClick={() => plugins.installMaybe(id)}
				tooltip={`Install plugin ${id}`}
			>
				<Icon name="install" /> Install
			</Button>
		);
	} else if (installed.updateAvailable()) {
		children.push(
			<Button
				class="update"
				variant="success"
				disabled={isDisabled}
				onClick={installed.updateMaybe}
				tooltip={`Update to ${installed.updateAvailable()}`}
			>
				<Icon name="update" />
			</Button>,
			makeUninstallButton()
		);
	} else {
		children.push(
			<Button
				class="check-for-updates"
				variant="info"
				onClick={() => installed.checkForUpdates()}
				loading={checkingForUpdates}
				disabled={isDisabled || checkingForUpdates}
				semitransparent
				tooltip="Check for updates"
			>
				<Icon name="update-check" />
			</Button>,
			makeUninstallButton()
		);
	}

	return <div class={classNames}>{children}</div>;
});
