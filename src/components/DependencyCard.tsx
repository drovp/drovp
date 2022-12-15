import {h} from 'preact';
import {observer} from 'statin-preact';
import {prevented} from 'lib/utils';
import {colonIdMeta} from 'lib/serialize';
import {useStore} from 'models/store';
import {Icon, IconName} from 'components/Icon';
import {Spinner} from 'components/Spinner';
import {Button} from 'components/Button';

interface DependencyCadProps {
	id: string;
}

export const DependencyCard = observer(function DependencyCard({id}: DependencyCadProps) {
	const {dependencies, history, plugins, operations} = useStore();
	const [pluginId] = colonIdMeta(id);
	const dependency = dependencies.byId().get(id);
	const name = dependency ? dependency.name : id;
	const dependentsCount = dependency?.dependents().length || 0;
	const plugin = pluginId != null ? plugins.byId().get(pluginId) : null;
	const isPluginInstalled = plugin != null;
	const state = dependency?.state();
	const isLoading = state === 'loading';
	const loadError = dependency?.loadError();
	const version = dependency?.version();
	const configError = dependency?.configError;
	const notFound = dependency == null;

	let iconName: IconName | 'spinner' = 'circle-check';
	let variant = 'success';
	let subtitle = version || 'Ready';
	let message = 'Ready';
	let disableButtons = operations.pending().length > 0;

	if (configError) {
		iconName = 'warning';
		variant = 'danger';
		subtitle = 'Misconfigured';
		message = `Dependency has configuration errors.`;
	} else if (!isPluginInstalled) {
		iconName = 'warning';
		variant = 'danger';
		subtitle = 'Plugin missing';
		message = `Plugin "${pluginId}" which should provide this dependency is not installed.`;
	} else if (notFound) {
		iconName = 'warning';
		variant = 'danger';
		subtitle = 'Missing';
		message = `Plugin "${pluginId}" doesn't provide this dependency`;
	} else if (state === 'installing' || isLoading) {
		iconName = 'spinner';
		variant = 'info';
		subtitle = isLoading ? 'Loading' : 'Installing';
		message = isLoading ? 'Loading dependency' : 'Installing dependency';
		disableButtons = true;
	} else if (state === 'missing' || state === 'uninitialized') {
		if (dependentsCount > 0) {
			iconName = 'warning';
			variant = 'danger';
			subtitle = loadError ? 'Load error' : 'Missing';
			message = loadError ? `Error ocurred when loading dependency` : `Dependency is missing, try reloading it`;
		} else {
			iconName = 'circle';
			variant = 'info';
			subtitle = state === 'missing' ? 'Missing' : 'Uninitialized';
			message =
				state === 'missing'
					? `Dependency is not installed or its loading has failed, but nothing depends on it, so it's fine.`
					: `Dependency wasn't loaded because nothing depends on it.`;
		}
	}

	const goToDependency = () => history.push(`/dependencies/${encodeURIComponent(id)}`);
	const goToInstructions = () => history.push(`/dependencies/${encodeURIComponent(id)}?section=instructions`);

	let classNames = `Card DependencyCard`;
	if (variant) classNames += ` -${variant}`;

	return (
		<button
			class={classNames}
			onClick={goToDependency}
			data-context-menu="dependency"
			data-context-menu-payload={id}
			title={`ID: ${id}\n${dependentsCount} dependent processors\n${message}`}
		>
			<header>
				<h1>{name}</h1>
				<h2>{subtitle}</h2>
			</header>
			<div class="meta state">{iconName === 'spinner' ? <Spinner /> : <Icon name={iconName} />}</div>
			<div class="meta dependents">{dependentsCount} <Icon name="processor" /></div>
			<div class="actions">
				{dependency && (
					<Button
						semitransparent
						variant="success"
						loading={iconName === 'spinner'}
						disabled={disableButtons}
						onClick={prevented(() => dependency.load())}
						tooltip="Reload"
					>
						<Icon name="refresh" />
					</Button>
				)}
				{dependency &&
					(dependency.hasInstaller() ? (
						<Button
							semitransparent
							variant="success"
							disabled={disableButtons}
							onClick={prevented(() => dependencies.install(id))}
							tooltip="Reinstall/Update"
						>
							<Icon name="install" />
						</Button>
					) : dependency.hasInstructions() ? (
						<Button
							semitransparent
							variant="success"
							onClick={prevented(goToInstructions)}
							tooltip="See instructions"
						>
							<Icon name="info" />
						</Button>
					) : undefined)}
			</div>
		</button>
	);
});
