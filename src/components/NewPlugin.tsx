import {h} from 'preact';
import manifest from 'manifest';
import {useState, useRef, useMemo, useEffect} from 'preact/hooks';
import {useStore} from 'models/store';
import {reaction, toJS} from 'statin';
import {useVolley} from 'lib/hooks';
import {PLUGIN_KEYWORD, DEPENDENCY_KEYWORD} from 'config/constants';
import {registry} from 'lib/registry';
import {createOptions} from 'models/options';
import {makeOptionsSchema} from '@drovp/types';
import {RouteProps, useHistory} from 'poutr';
import {Icon} from 'components/Icon';
import {Alert} from 'components/Alert';
import {Button} from 'components/Button';
import {Options} from 'components/Options';
import {Scrollable} from 'components/Scrollable';

const defaults = {
	name: '',
	description: '',
	author: '',
	public: false,
	source: '',
	typescript: false,
	indentation: '	' as '	' | '  ' | '    ',
	processor: false,
	bulk: false,
	threadType: 'cpu' as 'cpu' | 'gpu' | 'download' | 'upload' | 'io' | 'custom',
	customThreadType: '',
	dependency: false,
};
type OptionsData = typeof defaults;

export function NewPlugin({location, history}: RouteProps) {
	const {plugins, staging} = useStore();
	const {push: to} = useHistory();
	const {values, optionsSchema} = useMemo(() => {
		function isValidNpmModuleName(value: string) {
			return value.length <= 214 && value.match(/^(@[a-z0-9-\._]+\/)?[a-z0-9-\._]+$/) != null;
		}

		function isValidPublicName(value: string) {
			const requiredPrefix = `${manifest.name}-`;
			const parts = value.split('/');
			return (
				isValidNpmModuleName(value) &&
				value.length > requiredPrefix.length &&
				(parts.length > 1
					? parts[0] === `@${manifest.name}` || parts[1]!.indexOf(`${manifest.name}-`) === 0
					: value.indexOf(`${manifest.name}-`) === 0)
			);
		}

		function nameValidator(name: string, options: any) {
			const errors: string[] = [];
			if (name.trim().length === 0) errors.push(`Name can't be empty.`);
			else {
				if (!isValidNpmModuleName(name))
					errors.push('Invalid npm module name format.\nHas to match: ^(@[a-z0-9-]+/)?[a-z0-9-]+$');
				if (options?.public && !isValidPublicName(name))
					errors.push(`Public plugins should be prefixed with <strong>${manifest.name}-</strong>.`);
			}
			if (plugins.byId().has(name)) errors.push(`Plugin "${name}" is already installed.`);
			if (errors.length > 0) throw new Error(errors.join('<br>'));
			return true;
		}

		async function asyncNameValidator(name: string, options: any) {
			let isTaken = false;

			if (name.length > 0 && options?.public && isValidPublicName(name)) {
				try {
					const version = await registry.latestVersion(name);
					isTaken = typeof version === 'string';
				} catch {}
			}

			if (isTaken) {
				throw new Error(`Plugin name is taken: <a href="https://www.npmjs.com/package/${name}">${name}</a>`);
			}

			return true;
		}

		const optionsSchema = makeOptionsSchema<OptionsData>()([
			{
				type: 'divider',
				title: 'Manifest',
			},
			{
				name: 'name',
				type: 'string',
				default: defaults.name,
				title: 'Name',
				hint: '<code>a-z,0-9,-</code>',
				validator: nameValidator,
				asyncValidator: asyncNameValidator,
				validationDependencies: ['public'],
			},
			{
				name: 'description',
				type: 'string',
				default: defaults.description,
				rows: 1,
				title: 'Description',
			},
			{
				name: 'author',
				type: 'string',
				default: defaults.author,
				title: 'Author',
				description: `Can be nothing, your nickname, or a more complex string like:<br>
				<code>John Doe &lt;john.doe@mail.com&gt; (https://example.com)</code>`,
			},
			{
				name: 'public',
				type: 'boolean',
				default: defaults.public,
				title: 'Public',
				description:
					'Do you intend to publish to npm so that others can discover, install, and use this as well?',
			},
			{
				name: 'homepage',
				type: 'string',
				title: 'Homepage URL',
				description: `URL to plugin's homepage. Usually a URL to repository. Example:<br><code>https://github.com/account/pluginname</code>`,
				isHidden: (_, options) => !options.public,
			},
			{
				name: 'bugs',
				type: 'string',
				title: 'Bugs URL',
				description: `URL for reporting bugs. Usually a URL to issue tracker. Example:<br><code>https://github.com/account/pluginname/issues</code>`,
				isHidden: (_, options) => !options.public,
			},
			{
				name: 'repository',
				type: 'string',
				title: 'Repository',
				description: `URL or an identifier to your git/svn repository. Examples:<br>
				<code>github:account/pluginname</code>,
				<code>gist:11081aaa281</code>,
				<code>gitlab:user/repo</code>
				`,
				isHidden: (_, options) => !options.public,
			},
			{
				name: 'source',
				type: 'string',
				default: defaults.source,
				title: 'Custom source',
				description: `If you intend to distribute this in other ways than through npm, you can use this field to specify external source that should be used in generated import codes. It can be any format documented in <a href="route://manual-installer">manual installer</a>.`,
				isHidden: (_, options) => options.public,
			},

			{
				type: 'divider',
				title: 'Project Config',
			},
			{
				name: 'typescript',
				type: 'boolean',
				default: defaults.typescript,
				title: 'Typescript',
			},
			{
				name: 'indentation',
				type: 'select',
				options: {
					'	': 'tabs',
					'  ': '2 spaces',
					'    ': '4 spaces',
				},
				default: defaults.indentation,
				title: 'Code indentation',
			},

			{
				type: 'divider',
				title: 'Processor boilerplate',
			},
			{
				name: 'processor',
				type: 'boolean',
				default: defaults.processor,
				title: 'Include',
			},
			{
				name: 'bulk',
				type: 'boolean',
				default: defaults.bulk,
				title: 'Bulk items',
				description: `Decides whether to split multiple dragged in items into individual operations, or bulk them into one. This can also be a function that determines bulking dynamically on drop by drop basis. Read <a href="https://drovp.app/docs/plugin#bulk">bulk documentation</a> for more details.`,
				isHidden: (_, options) => !options.processor,
			},
			{
				name: 'threadType',
				type: 'select',
				options: ['cpu', 'gpu', 'download', 'upload', 'io', 'custom'],
				default: defaults.threadType,
				title: 'Thread type',
				description: `Place your processor into the appropriate thread pool. This helps the app to correctly parallelize operations based on user's needs. This can also be a function that determines thread type dynamically on operation by operation basis. Read <a href="https://drovp.app/docs/plugin#threadtype">threadType documentation</a> for more details.`,
				isHidden: (_, options) => !options.processor,
			},
			{
				name: 'customThreadType',
				type: 'string',
				default: defaults.customThreadType,
				min: 1,
				title: 'Thread type name',
				description: `Name your custom thread pool.`,
				isHidden: (_, options) => !options.processor || options.threadType !== 'custom',
			},

			{
				type: 'divider',
				title: 'Dependency boilerplate',
				description: `Dependencies are binaries or other setups processors require to be installed or performed before they can do their thing. Processors can also depend on dependencies from other plugins. <a href="https://www.npmjs.com/search?q=keywords%3A${manifest.name}dependency">Browse available public dependencies on npmjs.com</a>`,
			},
			{
				name: 'dependency',
				type: 'boolean',
				default: defaults.dependency,
				title: 'Include',
			},
		]);

		return {optionsSchema, values: createOptions<OptionsData>(optionsSchema)};
	}, []);
	const [errors, setErrors] = useState<string[]>([]);
	const optionsContainerRef = useRef<HTMLDivElement>(null);

	useEffect(
		() =>
			reaction(() => {
				const errors: string[] = [];

				const name = values.name();
				if (name.length === 0) errors.push(`"name" can't be empty`);
				if (plugins.byId().has(name)) errors.push(`Plugin with name "${name}" is already installed.`);
				if (!values.processor() && !values.dependency()) {
					errors.push(`This plugin won't do anything. Add a processor or a dependency.`);
				}
				if (values.threadType() === 'custom' && !values.customThreadType()) {
					errors.push(`Custom load type name is empty.`);
				}
				if (staging.isStaging() && !staging.matchStaging('plugins', 'create')) {
					errors.push(`Other staging in progress.`);
				}

				setErrors(errors);
			}),
		[]
	);

	useVolley(optionsContainerRef);

	async function create() {
		try {
			const props = toJS(values);
			if (await plugins.create(props)) to(`/plugins/${props.name}`);
		} catch {}
	}

	const showDependencyKeywordWarning = values.public() && values.dependency() && !values.processor();

	// This is a nightmare to type safely, so `as any` it is
	return (
		<Scrollable class="NewPlugin">
			<header>
				<h1>Plugin boilerplate generator</h1>
				<p>
					This is just a quick way to generate, initialize, and start working on a new local/development
					plugin. See <a href="https://drovp.app/docs">documentation</a> for more in depth configuration
					possibilities.
				</p>
			</header>
			<Options innerRef={optionsContainerRef} schema={optionsSchema} options={values as any} />
			{(errors.length > 0 || showDependencyKeywordWarning) && (
				<div class="errors">
					{errors.map((message) => (
						<Alert variant="danger">{message}</Alert>
					))}
					{showDependencyKeywordWarning && (
						<Alert variant="warning">
							You've selected a public plugin with dependency and no processor. <br /> This means its{' '}
							<code>`package.json`</code> will have the <code>`{DEPENDENCY_KEYWORD}`</code> instead of the{' '}
							<code>`{PLUGIN_KEYWORD}`</code> keyword, marking it as plugin that only provides
							dependencies. This will make it hidden in the in-app registry search results, and only
							installable by being required by processors of other plugins.
						</Alert>
					)}
				</div>
			)}
			<div class="actions">
				<Button
					class="create"
					variant="success"
					disabled={staging.isStaging() || errors.length > 0}
					onClick={create}
				>
					<Icon name="check" /> Create
				</Button>
			</div>
		</Scrollable>
	);
}
