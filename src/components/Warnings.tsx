import manifest from 'manifest';
import {h} from 'preact';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {serializePluginIdentifier} from 'lib/serialize';
import {Checkbox} from 'components/Checkbox';
import {Icon} from 'components/Icon';
import {Pre} from 'components/Pre';
import {Scrollable} from 'components/Scrollable';

export const NonOfficialPluginInstallWarning = observer(function NonOfficialPluginInstallWarning({id}: {id: string}) {
	const {settings} = useStore();
	const meta = serializePluginIdentifier(id);

	return (
		<Scrollable class="Warning">
			<p>
				You are about to install{' '}
				<a
					href={`https://www.npmjs.com/package/${meta.name}`}
					title={`https://www.npmjs.com/package/${meta.name}`}
				>
					<b>
						<code>{meta.displayName}</code>
					</b>
				</a>
				, which is a non-official plugin.
			</p>

			<p>
				Plugins can be made and published by anyone, and due to the nature of the app, they can do pretty much
				everything they want to your system since the moment they are installed.
			</p>

			<p>
				The (
				<a href="https://www.npmjs.com" title="https://www.npmjs.com">
					npm registry
				</a>
				) has mechanisms to detect, report, and get rid of malware, but nothing is 100%, so you should exercise
				caution, and install only plugins you can trust.
			</p>

			<p>
				Signs of a shady plugin: low quality readme, published very recently by a new npm account with nothing
				else under its name, low installs, no source code available, ...
			</p>

			<p>
				Official Drovp plugins are always installed from the registry, marked with the <Icon name="logo" />{' '}
				icon, and their raw IDs start with <code>@{manifest.name}/</code>.
			</p>

			<div class="opt-out">
				<Checkbox
					id="warnNonOfficialInstall-opt-out-checkbox"
					checked={!settings.warnNonOfficialInstall()}
					onChange={(value) => settings.warnNonOfficialInstall(!value)}
				/>
				<label for="warnNonOfficialInstall-opt-out-checkbox">Don't show this again.</label>
			</div>
		</Scrollable>
	);
});

export const ExternalPluginInstallWarning = observer(function ExternalPluginInstallWarning({id}: {id: string}) {
	const {settings} = useStore();

	return (
		<Scrollable class="Warning">
			<p>You are about to install:</p>

			<Pre>{id}</Pre>

			<p>which is an external plugin source.</p>

			<p>
				Plugins can be made and published by anyone, and due to the nature of the app, they can do pretty much
				everything they want to your system since the moment they are installed.
			</p>

			<p>
				External sources pose an additional risk, as there is no mechanism to report and get rid of them as in
				the registry.
			</p>

			<div class="opt-out">
				<Checkbox
					id="warnExternalInstall-opt-out-checkbox"
					checked={!settings.warnExternalInstall()}
					onChange={(value) => settings.warnExternalInstall(!value)}
				/>
				<label for="warnExternalInstall-opt-out-checkbox">Don't show this again.</label>
			</div>
		</Scrollable>
	);
});
