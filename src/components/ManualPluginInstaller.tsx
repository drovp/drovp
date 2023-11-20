import {h} from 'preact';
import {useState, useRef} from 'preact/hooks';
import {useVolley} from 'lib/hooks';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {Input} from 'components/Input';
import {Button} from 'components/Button';
import {RouteProps} from 'poutr';
import {PluginCards} from 'components/PluginCards';
import {Alert} from 'components/Alert';
import {TitleBar} from 'components/TitleBar';
import {Scrollable} from 'components/Scrollable';
import type {PluginsSnapshot} from 'models/plugins';

export function ManualPluginInstallerRoute({location}: RouteProps) {
	return <ManualPluginInstaller source={location.searchParams.get('source') || undefined} />;
}

export const ManualPluginInstaller = observer(function ExternalPluginInstaller({source}: {source?: string}) {
	const {staging, plugins} = useStore();
	const [value, setValue] = useState(source || '');
	const isInstalling = staging.matchStaging('plugins', 'install') != null;
	const valueIsEmpty = value.trim() === '';
	const isDisabled = staging.isStaging() || valueIsEmpty;
	const [pluginsSnapshot, setPluginsSnapshot] = useState<null | PluginsSnapshot>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const {freshPlugins} = pluginsSnapshot || {};

	useVolley(containerRef);

	function install() {
		setPluginsSnapshot(null);
		const resolveSnapshot = plugins.initSnapshot();
		plugins.installMaybe(value);
		setPluginsSnapshot(resolveSnapshot());
	}

	return (
		<div class="ManualPluginInstaller" ref={containerRef}>
			<div class="input">
				<div class="value">
					<Input
						type="path"
						placeholder="identifier, url, or path"
						value={value}
						onChange={setValue}
						onSubmit={install}
					/>
				</div>
				{valueIsEmpty && <Alert icon="info">Enter plugin identifier to install.</Alert>}
			</div>

			<Button class="install" variant="success" onClick={install} loading={isInstalling} disabled={isDisabled}>
				Install
			</Button>

			<hr />

			<Scrollable class="content">
				{freshPlugins && freshPlugins.length > 0 && (
					<div class="installedPlugins">
						<TitleBar>Installed plugins</TitleBar>
						<PluginCards plugins={freshPlugins} />
					</div>
				)}

				<div class="tutorial TextContent">
					<p>
						Allows installing plugins from any plugin identifier supported by npm. Can be one of following:
					</p>

					<dl>
						<dt>
							<code>[&lt;@scope&gt;/]&lt;name&gt;</code>
						</dt>
						<dd>
							<p>
								Installs <code>latest</code> version of the module. Example: <code>@drovp/encode</code>
							</p>
						</dd>

						<dt>
							<code>[&lt;@scope&gt;/]&lt;name&gt;@&lt;tag&gt;</code>
						</dt>
						<dd>
							<p>
								Installs a specific tag of the module, such as <code>latest</code>, <code>next</code>,
								... or whatever the module author configured. Example: <code>@drovp/encode@next</code>
							</p>
						</dd>

						<dt>
							<code>[&lt;@scope&gt;/]&lt;name&gt;@&lt;version&gt;</code>
						</dt>
						<dd>
							<p>
								Installs a specific version of the module. Example: <code>@drovp/encode@2.0.0</code>
							</p>
						</dd>

						<dt>
							<code>
								&lt;git-host&gt;:&lt;git-user&gt;/&lt;repo-name&gt;[#&lt;commit-ish&gt;|#semver:&lt;semver&gt;]
							</code>
						</dt>
						<dd>
							<p>
								A common git repository identifier. Example: <code>github:account/repo</code>
							</p>

							<p>
								Supported providers: <code>github</code>, <code>gitlab</code>, <code>bitbucket</code>
							</p>
							<p>
								If <code>#&lt;commit-ish&gt;</code> is provided, it will be used to clone exactly that
								commit. If the commit-ish has the format <code>#semver:&lt;semver&gt;</code>,{' '}
								<code>&lt;semver&gt;</code> can be any valid semver range or exact version, and npm will
								look for any tags or refs matching that range in the remote repository, much as it would
								for a registry dependency.
							</p>
							<p>
								Examples:
								<br />
								<code>gitlab:myusr/myproj#3770ba6</code> to install a specific commit
								<br />
								<code>gitlab:myusr/myproj#semver:^5.0</code> to install highest version 5
							</p>
						</dd>

						<dt>
							<code>&lt;git repo url&gt;</code>
						</dt>
						<dd>
							<p>
								Installs the package from the hosted git provider, cloning it with <code>git</code>.
							</p>
							<p>
								<code>
									&lt;protocol&gt;://[&lt;user&gt;[:&lt;password&gt;]@]&lt;hostname&gt;[:&lt;port&gt;][:][/]&lt;path&gt;[#&lt;commit-ish&gt;
									| #semver:&lt;semver&gt;]
								</code>
							</p>
							<p>
								<code>&lt;protocol&gt;</code> is one of <code>git</code>, <code>git+ssh</code>,{' '}
								<code>git+http</code>, <code>git+https</code>, or <code>git+file</code>.
							</p>
							<p>
								If <code>#&lt;commit-ish&gt;</code> is provided, it will be used to clone exactly that
								commit. If the commit-ish has the format <code>#semver:&lt;semver&gt;</code>,{' '}
								<code>&lt;semver&gt;</code> can be any valid semver range or exact version, and npm will
								look for any tags or refs matching that range in the remote repository, much as it would
								for a registry dependency.
							</p>
						</dd>

						<dt>
							<code>&lt;tarball url&gt;</code>
						</dt>
						<dd>
							A url, starting with <code>http://</code> or <code>https://</code>, leading to a tarball.
							Example: <code>https://github.com/drovp/run/tarball/2.0.1</code>
						</dd>

						<dt>
							<code>&lt;tarball file&gt;</code>
						</dt>
						<dd>
							An absolute path to a tarball file located on your machine. The file has to start with{' '}
							<code>.tar</code>, <code>.tar.gz</code>, or <code>.tgz</code> extension.
						</dd>

						<dt>
							<code>&lt;folder&gt;</code>
						</dt>
						<dd>An absolute path to a folder on your machine with a plugin inside.</dd>
					</dl>
				</div>
			</Scrollable>
		</div>
	);
});
