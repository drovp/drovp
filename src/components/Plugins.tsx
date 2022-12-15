import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {RouteProps, Redirect} from 'poutr';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {useVolley, useCache} from 'lib/hooks';
import {Vacant} from 'components/Vacant';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Tag} from 'components/Tag';
import {Scrollable} from 'components/Scrollable';
import {PluginRoute} from './Plugin';
import {PluginCards} from './PluginCards';

const defaultPath = '/plugins';

export function PluginsRoute(props: RouteProps) {
	const {match, location, history} = props;
	let [lastUrl, setLastUrl] = useCache<string>('plugins.lastUrl', defaultPath);
	const id = match.groups?.id;

	// Click on the main nav button, needs to be triaged
	if (location.path === defaultPath && !id) {
		// If request is coming from within this section, go to default page.
		// If it's coming from other sections, use the last cached url we were on.
		const fromInside = history.from?.path.indexOf(defaultPath) === 0;
		const nextUrl = fromInside ? defaultPath : lastUrl;
		if (nextUrl !== location.path) return <Redirect to={nextUrl} />;
	}

	setLastUrl(location.href);

	return id ? <PluginRoute {...props} /> : <Plugins />;
}

const Plugins = observer(function Plugins() {
	const {plugins, staging} = useStore();
	const contentRef = useRef<HTMLDivElement>(null);
	const all = plugins.ordered();
	const updatesAvailable = plugins.updatesAvailable();

	useVolley(contentRef);

	return (
		<div className="Plugins">
			<div class="controls">
				<Button
					variant="info"
					semitransparent
					loading={plugins.checkingForUpdates()}
					onClick={() => plugins.checkForUpdates()}
					tooltip="Check all plugins for updates"
				>
					<Icon name="update-check" />
					{updatesAvailable === 0 && 'Check'}
				</Button>
				{updatesAvailable > 0 && (
					<Button
						variant="success"
						semitransparent
						disabled={staging.isStaging()}
						loading={staging.matchStaging('plugins', 'install') != null}
						onClick={() => plugins.updateMaybe()}
						tooltip="Update all plugins with available updates"
					>
						<Icon name="update" /> Update <Tag>{updatesAvailable}</Tag>
					</Button>
				)}
				<div class="spacer" />
				<Button
					semitransparent
					disabled={staging.isStaging()}
					onClick={() => plugins.reload()}
					tooltip="Reload plugins (F5)"
				>
					<Icon name="refresh" /> Reload
				</Button>
			</div>
			<Scrollable class="content" innerRef={contentRef}>
				{all.length === 0 ? (
					<Vacant title="No plugins installed yet" />
				) : (
					<PluginCards section="plugins" plugins={all.map((plugin) => ({...plugin.meta, id: plugin.name}))} />
				)}
			</Scrollable>
		</div>
	);
});
