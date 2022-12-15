import {productName, homepage} from 'manifest';
import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useVolley} from 'lib/hooks';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';
import {Scrollable} from 'components/Scrollable';
import {useStore} from 'models/store';

export function Tutorial() {
	const {modals} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const hostname = new URL(homepage).hostname;

	useVolley(containerRef);

	return (
		<Scrollable class="Tutorial TextContent" innerRef={containerRef}>
			<h1>
				<Icon name="logo" /> {productName} tutorial
			</h1>
			<h2>
				<Icon name="profile" /> Profiles
			</h2>
			<p>
				Profile are a configured drop zones for processors, into which you can drag &amp; drop files, links,
				strings, or whatever processor accepts. These will be turned into operations and processed by the
				profile's processor according to the profile's configuration.
			</p>
			<h2>
				<Icon name="processor" /> Processors
			</h2>
			<p>
				Processors accept items from profiles and perform operations on them based on the profile's
				configuration. You can get processors by installing plugins.
			</p>
			<h2>
				<Icon name="plugins" /> Plugins
			</h2>
			<p>
				Plugins extend {productName} with processors and dependencies. You can get them by browsing the registry
				and installing what you need.
			</p>
			<p>
				<Button semitransparent class="to-registry" href="route://registry">
					Go to registry <Icon name="arrow-right" />
				</Button>
			</p>
			<h2>
				<Icon name="import" /> Importing/Exporting profiles
			</h2>
			<p>
				Apart of manual installation and configuration of plugins &amp; profiles, you can also import them from
				other people that shared their import codes.
			</p>
			<p>
				You can import a profile by either clicking the <b>Import profile</b> button below and pasting an import
				code into it, or clicking on an import link someone else has provided.
			</p>
			<p>
				<Button
					semitransparent
					class="import-profile"
					onClick={() => modals.createProfile({initialSection: 'import'})}
				>
					<Icon name="import" /> Import profile
				</Button>
			</p>
			<h2>
				<Icon name="edit" /> Creating plugins
			</h2>
			<p>
				Plugins are modules published to <a href="https://www.npmjs.com/">npmjs.com</a> registry with specific
				keywords identifying them as {productName} plugins.
			</p>
			<p>
				To create a plugin, go to <a href="route://settings">Settings</a> and at the bottom, turn on the{' '}
				<b>Developer mode</b>. This will enable various development features around the app, but mainly it will
				expose a <a href="route://new-plugin">New plugin</a> page in the <a href="route://plugins">Plugins</a>{' '}
				section, which can be used to generate, setup, load, and start editing a new plugin boilerplate.
			</p>
			<p>
				Guides on creating plugins as well as {productName} API documentation can be found at{' '}
				<a href={`${homepage}/docs`}>{`${hostname}/docs`}</a>.
			</p>
		</Scrollable>
	);
}
