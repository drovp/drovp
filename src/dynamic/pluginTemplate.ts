import manifest from 'manifest';
import {PLUGIN_KEYWORD, DEPENDENCY_KEYWORD} from 'config/constants';

export interface CreatePluginTemplateProps {
	name: string;
	description: string;
	public: boolean;
	source: string;
	author: string;
	homepage: string;
	bugs: string;
	repository: string;
	indentation: string;
	typescript: boolean;
	processor: boolean;
	bulk: boolean;
	threadType: string;
	customThreadType: string;
	dependency: boolean;
}

export interface PluginTemplateFile {
	name: string;
	contents: string;
}

export interface PluginTemplate {
	files: PluginTemplateFile[];
	dependencies?: string[];
	devDependencies?: string[];
	postCreate?: string[];
}

function composeManifest(props: CreatePluginTemplateProps): PluginTemplateFile {
	const keywords: string[] = [];

	if (props.processor) keywords.push(PLUGIN_KEYWORD);
	else if (props.dependency) keywords.push(DEPENDENCY_KEYWORD);

	const data: {[key: string]: any} = {
		name: props.name,
		version: '1.0.0',
		description: props.description,
		// type: 'module', // https://github.com/drovp/drovp/issues/2
		main: 'index.js',
		keywords,
		author: props.author || undefined,
		license: 'MIT',
	};

	// Optional strings
	for (const name of ['homepage', 'bugs', 'repository'] as const) {
		const trimmed = props[name].trim();
		if (trimmed) data[name] = trimmed;
	}

	if (props.public) {
		// makes @scoped packages public (they are restricted by default)
		data.publishConfig = {access: 'public'};
	} else {
		data.private = true;
	}

	if (props.typescript) {
		data.main = 'dist/index.js';
		data.files = ['dist', '*.md'];
		data.scripts = {
			build: 'tsc',
			watch: 'tsc --watch',
			clean: 'rimraf dist',
			start: 'npm-run-all clean watch',
			preversion: 'npm-run-all clean build',
		};
	}

	const source = props.source.trim();

	if (props.public) {
		data.scripts = data.scripts || {};
		Object.assign(data.scripts, {
			'git-push': 'git push',
			'npm-publish': 'npm publish',
			postversion: 'npm-run-all git-push npm-publish',
		});
	} else if (source) {
		data.drovp = {source};
	}

	return {name: 'package.json', contents: JSON.stringify(data, null, 2)};
}

function composeReadme(props: CreatePluginTemplateProps): PluginTemplateFile {
	const ts = props.typescript ? (str: string, alt = '') => str : (str: string, alt = '') => alt;
	const contents = `# ${props.name}

${props.description}${ts(`

## Dev environment

Pre-configured npm scripts and commands to use for development and distribution:

### npm start

Cleans up previous build, and starts a continuous building of TS files on changes.

### npm version [&lt;newversion&gt; | major | minor | patch]

Use for releasing a new version. Thanks to version hooks, calling this command will:

1. Clean up old distribution files.
1. Build new distribution files.
1. Bump the \`package.json\` version.
1. Create a version commit.${
		!props.public
			? ''
			: `
1. Push to remote.
1. Publish to npm.`
	}

### npm run build

Just builds the TS files.
`)}
`;
	return {name: 'README.md', contents};
}

function composeTsconfig(props: CreatePluginTemplateProps): PluginTemplateFile {
	const config = {
		compilerOptions: {
			module: 'commonjs',
			moduleResolution: 'node',
			removeComments: true,
			baseUrl: 'src',
			paths: {'*': ['*']},
			outDir: 'dist',
			lib: ['DOM', 'DOM.Iterable', 'ESNext'],
			newLine: 'LF',
			strict: true,
			noUncheckedIndexedAccess: true,
			noUnusedLocals: true,
			target: 'es2019',
			types: ['node'],
			sourceMap: false,
		},
		include: ['src'],
	};

	return {name: 'tsconfig.json', contents: JSON.stringify(config, null, props.indentation)};
}

function composeMainFile(props: CreatePluginTemplateProps): PluginTemplateFile {
	const dependency = props.dependency ? (str: string) => str : (str: string) => '';
	const processor = props.processor ? (str: string) => str : (str: string) => '';
	const processorAndDependency = props.processor && props.dependency ? (str: string) => str : (str: string) => '';
	const displayName = (props.name.split('/')[1] || props.name).replace(RegExp(`^${manifest.name}-`), '');

	// prettier-ignore
	let mainContents = '';

	if (props.typescript) {
		const imports: string[] = ['Plugin'];
		if (props.processor) imports.push('PayloadData', 'OptionsSchema', 'makeAcceptsFlags');
		if (props.dependency) imports.push('LoadUtils', 'DependencyData', 'InstallUtils');
		mainContents = `import {${imports.join(', ')}} from '@drovp/types';${dependency(`

/**
 * ============================================================
 * Dependency boilerplate.
 * ============================================================
 */

/**
 * Async function to load or check the dependency is installed.
 * It has to return dependency payload or true if dependency is installed,
 * and false otherwise. It can also throw wit ha message of what is wrong.
 */
async function loadDependency(utils: LoadUtils): Promise<DependencyData> {
	// load logic
	return {version: '0.0.1', payload: 'dependencyPayload'};
}

/**
 * Async function that installs the dependency.
 * It doesn't have to return anything, since the \`loadDependency()\` above
 * is used to determine if it succeeded after it's done.
 * It can throw an error with a message to inform the user of what went wrong.
 */
async function installDependency(utils: InstallUtils) {
	// install logic
}`)}${processor(`

/**
 * ============================================================
 * Processor boilerplate.
 * ============================================================
 */

// Expected options object
type Options = {
	foo: boolean;
	bar: string;
};

// Options schema for the Options type above
const optionsSchema: OptionsSchema<Options> = [
	{name: 'foo', type: 'boolean', title: 'Foo'},
	{name: 'bar', type: 'string', title: 'Bar'},
];

// Accept everything! Read documentation on how to fine tune.
const acceptsFlags = makeAcceptsFlags<Options>()({
	files: true,
	directories: true,
	urls: true,
	strings: true,
	blobs: true,
});

// The final payload type based on options and accept flags defined above.
// Needs to be exported so that it can be used by the processor.
export type Payload = PayloadData<Options, typeof acceptsFlags>;`)}

export default (plugin: Plugin) => {${dependency(`
	/**
	 * Registers a dependency.
	 *
	 * Dependency doesn't have to install something itself, it can instead
	 * just provide instructions to the user via the \`instructions\` property.
	 *
	 * Read docs for more info.
	 */
	plugin.registerDependency('${displayName}', {
		load: loadDependency,
		install: installDependency,
	});`)}${processorAndDependency(`\n`)}${processor(`
	/**
	 * Registers an item processor for users to create profiles (drop zones) for.
	 *
	 * Name is a plugin-scoped processor name identifier which should never change,
	 * or it'll break all of the user's profiles created for it. If plugin adds
	 * only one processor, convention is to name it same way as plugin, just
	 * without the \`${manifest.name}-\` prefix.
	 *
	 * These are just some of the config options in their simplest forms.
	 * Read documentation to learn about more advanced configuration possibilities.
	 */
	plugin.registerProcessor<Payload>('${displayName}', {
		main: 'dist/processor.js',
		description: 'Description.',
		accepts: acceptsFlags,${
			!props.bulk
				? ''
				: `
		bulk: true,`
		}
		threadType: '${props.threadType === 'custom' ? props.customThreadType : props.threadType}',
		options: optionsSchema
	});`)}
};`;
	} else {
		mainContents = `module.exports = (plugin) => {
${dependency(`
	/**
	 * ============================================================
	 * Dependency boilerplate.
	 * ============================================================
	 */

	/**
	 * Async function to load or check the dependency is installed.
	 * It has to return dependency payload or true if dependency is installed,
	 * and false otherwise. It can also throw wit ha message of what is wrong.
	 */
	async function loadDependency(utils) {
		// load logic
		return 'dependencyPayload';
	}

	/**
	 * Async function that installs the dependency.
	 * It doesn't have to return anything, since the \`loadDependency()\` above
	 * is used to determine if it succeeded after it's done.
	 * It can throw an error with a message to inform the user of what went wrong.
	 */
	async function installDependency(utils) {
		// install logic
	}

	plugin.registerDependency('${displayName}', {
		load: loadDependency,
		install: installDependency,
	});
`)}${processor(`
	/**
	 * Adds an item processor for users to create profiles (drop zones) for.
	 *
	 * Name is a plugin-scoped processor name identifier which should never change,
	 * or it'll break all of the user's profiles created for it. If plugin adds
	 * only one processor, convention is to name it same way as plugin, just
	 * without the \`${manifest.name}-\` prefix.
	 *
	 * These are just some of the config options in their simplest forms.
	 * Read documentation to learn about more advanced configuration possibilities.
	 */
	plugin.registerProcessor('${displayName}', {
		main: 'processor.js',
		description: '${props.description}',
		// Accept everything! Read documentation to fine tune.
		accepts: {
			files: true,
			directories: true,
			urls: true,
			strings: true,
			blobs: true,
		},${
			!props.bulk
				? ''
				: `
		bulk: true,`
		}
		threadType: '${props.threadType === 'custom' ? props.customThreadType : props.threadType}',
		/**
		 * A basic key:defaultValue map of processor's profile options.
		 *
		 * If your processor doesn't need options, delete this property.
		 *
		 * Read options schema documentation on how to create advanced options
		 * with more control over the values, UI elements used, and validation.
		 */
		options: {
			foo: false,
			bar: 'string',
			baz: 5,
		}
	});
`)}
};
`;
	}

	return {
		name: props.typescript ? 'src/index.ts' : 'index.js',
		contents: mainContents.replaceAll('\t', props.indentation),
	};
}

function composeProcessor(props: CreatePluginTemplateProps): PluginTemplateFile {
	const ts = props.typescript ? (str: string, alt = '') => str : (str: string, alt = '') => alt;
	const inputTutorial = `	/**
	 * \`input\` can be anything processor allowed in its \`accepts\` flags.
	 *
	 * Here is how this object looks like if it's a...
	 */

	// file
	if (input.kind === 'file') {
		input.type; // string -> 'jpg' (lowercase extension)
		input.path; // string
		input.size; // number
	}

	// directory
	if (input.kind === 'directory') {
		input.path; // string
	}

	// binary blob
	if (input.kind === 'blob') {
		input.mime; // string -> 'image/jpeg'
		input.contents; // Buffer
	}

	// url
	if (input.kind === 'url') {
		input.url; // string
	}

	// string
	if (input.kind === 'string') {
		input.contents; // string
	}`;
	// prettier-ignore
	let mainContents = `${ts(
`import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';

// Potential processor dependency payloads must be defined manually
interface Dependencies {
	['drovp-ffmpeg:ffmpeg']: string;
	ffmpeg: string;
}

export default async (payload: Payload, utils: ProcessorUtils<Dependencies>) => {`,
`module.exports = async (payload, utils) => {`
)}
	/**
	 * \`payload\`: data about operation that needs to be processed.
	 *
	 * It has these properties:
	 *
	 * - \`payload.id\`: Operation id string.
	 *
	 * - \`payload.inputs\`: An array of input items to be processed.
	 *
	 * - \`payload.input\`: Reference to the 1st item in the \`payload.inputs\` array.
	 *   Useful for processors that don't accept bulks, and always process only 1 item.
	 *
	 * - \`payload.options\`: Object with options of a profile (drop zone) into
	 *   which item(s) were dragged into.
	 *
	 * - \`payload[???]\`: Any other property that processor's operation preparator
	 *   decided to also include.
	 */
	const {${props.bulk ? 'inputs' : 'input'}, options} = payload;

${props.bulk
? `	for (const input of inputs) {
${inputTutorial.replaceAll('\t', '\t\t')}
	}`
: inputTutorial}

	/**
	 * For logs, you can use all \`console.*\` methods available in node.js.
	 * Log messages are displayed in operation's logs section.
	 *
	 * Example:
	 *
	 * \`\`\`
	 * console.time('foo');
	 * console.log('foo', {bar: 'baz'}); // log one or multiple values
	 * console.timeEnd('foo');
	 * \`\`\`
	 *
	 * Note: \`console.error('something')\` will apart of logging also produce
	 * an error output. It's the same as calling:
	 *
	 * \`\`\`
	 * console.log('something');
	 * output.error('something');
	 * \`\`\`
	 */
	if (options.foo) console.log(\`foo enabled\`);

	/**
	 * \`utils\` provide an interface to tell drovp about operation's
	 * stage, progress, logs, errors, and outputs.
	 *
	 * They also contain paths to dependencies processor relies on.
	 */
	const {dependencies, stage, progress, output} = utils;

	/**
	 * Dependencies is a map of dependency name and its payload, which is usually
	 * a path to its binaries.
	 *
	 * For example, if this processor depends on an internal dependency \`foo\`,
	 * and external \`drovp/ffmpeg:ffmpeg\`, the map wil look like this:
	 *
	 * \`\`\`
	 * dependencies['asd:foo']; // \`foo\` payload
	 * dependencies.foo; // alias
	 *
	 * dependencies['drovp-ffmpeg:ffmpeg']; // path to ffmpeg binary
	 * dependencies.ffmpeg; // alias
	 * \`\`\`
	 */
	 dependencies['drovp-ffmpeg:ffmpeg']; // path to ffmpeg binary
	 dependencies.ffmpeg; // alias

	/**
	 * Stage is just a short name for what is currently going on. You don't have
	 * to use it, it's just to provide some additional info to users.
	 *
	 * For example, if your operation downloads and extracts a file, you'd set it
	 * to \`downloading\`, display progress for that, than \`extracting\`, and
	 * display progress for that.
	 *
	 * Each time \`stage()\` is called, operation progress is reset.
	 */
	stage('test-stage');

	/**
	 * Progress.
	 * Setting any of these values will update operation progress.
	 * Updating is already throttled under the hood, so you don't have to bother
	 * with that and report to your hearts content.
	 *
	 * Example:
	 *
	 * \`\`\`
	 * progress.total = 1;
	 * progress.completed = 0.1;
	 *
	 * // Alternative 1:
	 * progress(completed, total?);
	 *
	 * // Alternative 2:
	 * progress({completed, total?});
	 * \`\`\`
	 *
	 * \`total\` is optional, and if missing, user will see an indeterminate
	 * progress bar.
	 *
	 * You can still report \`completed\` and use \`progressFormatter\` processor
	 * config to tell Drovp how it should display it to the user.
	 */
	progress.total = 100;
	progress.completed = 1;

	/**
	 * Each operation can send one or multiple outputs back to the app.
	 *
	 * Example:
	 *
	 * \`\`\`
	 * output.file('path/to/new/file');
	 * output.directory('path/to/new/directory');
	 * output.url('https://example.com');
	 * output.string('example');
	 * output.error('example');
	 * output.error(new Error('example'));
	 * \`\`\`
	 *
	 * \`output.string()\` is intended for things like tokens, keywords, etc,
	 * anything that could potentially be consumed by other processors. If you
	 * just want to display a message, use \`console.log()\`.
	 */
	output.string('test-output');
};
`;

	return {name: props.typescript ? 'src/processor.ts' : 'processor.js', contents: mainContents};
}

function composeGitignore(props: CreatePluginTemplateProps): PluginTemplateFile {
	const items = ['node_modules'];

	if (props.typescript) items.push('dist');
	items.push('package-lock.json');

	return {name: '.gitignore', contents: `${items.join('\n')}\n`};
}

export function compose(props: CreatePluginTemplateProps): PluginTemplate {
	const files: PluginTemplateFile[] = [];

	/**
	 * Git ignore file.
	 */
	files.push(composeGitignore(props));

	/**
	 * Manifest.
	 */
	files.push(composeManifest(props));

	/**
	 * Typescript config.
	 */
	if (props.typescript) files.push(composeTsconfig(props));

	/**
	 * Readme.
	 */
	files.push(composeReadme(props));

	/**
	 * Main file.
	 */
	files.push(composeMainFile(props));

	/**
	 * Processor files.
	 */
	if (props.processor) files.push(composeProcessor(props));

	return {
		files,
		dependencies: props.typescript ? [`@${manifest.name}/types`] : undefined,
		devDependencies: props.typescript
			? ['typescript', 'tslib', 'npm-run-all', 'rimraf']
			: props.public
			? ['npm-run-all']
			: undefined,
		postCreate: props.typescript ? ['build'] : undefined,
	};
}
