const Path = require('path');
const CP = require('child_process');
const OS = require('os');
const FSP = require('fs').promises;
const {promisify} = require('util');
const manifest = require('./package.json');
const {src, dest, series, parallel, watch: gulpWatch} = require('gulp');
const exec = promisify(CP.exec);

const isDevelopment = String(process.env.NODE_ENV).toLowerCase() !== 'production';

/**
 * -production: removes development only code branches and enables minification
 *              enabled by default when "package" task is run
 * -platform:   win, linux, mac (separate by comma)
 * -arch:       currently only x64
 * -target:     use comma to build multiple targets. supported:
 *              win: installer, portable
 *              mac: dmg
 *              linux: AppImage
 */
const argvDefaults = {
	production: !isDevelopment,
	platform: undefined,
	arch: undefined,
	target: undefined,
	userData: 'userData',
};
const argv = require('minimist')(process.argv.slice(2), {default: argvDefaults});

/**
 * Build config.
 */
const ENV = {
	NODE_ENV: argv.production ? 'production' : 'development',
};
if (!argv.production) ENV.DROVP_FORCED_USER_DATA_PATH = Path.join(process.cwd(), argv.userData);
const PATHS = {
	assets: ['src/windows/*/*.html', 'src/assets/**/*', `!**/*.icns`],
	build: 'build',
	out: 'out',
	scripts: 'src/**/*.ts(|x)',
	styles: 'src/**/*.sass',
	themesFile: Path.join(__dirname, 'src', 'config', 'themes.js'),
};

// Extract only stuff the application runtime cares about
const cleanManifest = (manifest) => ({
	name: manifest.name,
	productName: manifest.productName,
	description: manifest.description,
	version: manifest.version,
	binariesVersion: manifest.binariesVersion,
	electronVersion: manifest.electronVersion,
	date: manifest.date,
	homepage: manifest.homepage,
	repository: manifest.repository,
	discussions: manifest.discussions,
	bugs: manifest.bugs,
	author: manifest.author,
	main: manifest.main,
	licenses: manifest.licenses,
});

async function scripts() {
	const esbuild = require('esbuild');

	// Load manifest and create a plugin that intercepts it and cleans it up
	const rawManifestContents = await FSP.readFile('package.json', {encoding: 'utf8'});
	const manifest = cleanManifest(JSON.parse(rawManifestContents));
	const manifestContents = JSON.stringify(manifest, null, '\t');
	const cleanupManifestPlugin = {
		name: 'env',
		setup(build) {
			// Intercept manifest import path so esbuild doesn't attempt
			// to map them to a file system location. Tag them with the "manifest"
			// namespace to reserve them for this plugin.
			build.onResolve({filter: /^manifest$/}, (args) => ({
				path: args.path,
				namespace: 'manifest',
			}));

			// Load paths tagged with the "manifest" namespace and behave as if
			// they point to a JSON file containing the environment variables.
			build.onLoad({filter: /.*/, namespace: 'manifest'}, async () => ({
				contents: manifestContents,
				loader: 'json',
			}));
		},
	};

	const define = Object.keys(ENV).reduce(
		(map, key) => ({
			...map,
			[`process.env.${key}`]: typeof ENV[key] === 'string' ? `'${ENV[key].replaceAll('\\', '\\\\')}'` : ENV[key],
		}),
		{}
	);

	return esbuild.build({
		entryPoints: [
			'src/main.ts',
			'src/thread.ts',
			'src/update.ts',
			'src/dynamic/marked.ts',
			'src/dynamic/pluginTemplate.ts',
			'src/windows/main/index.tsx',
		],
		external: [
			'electron',
			'buffer',
			'util',
			'fs',
			'http',
			'https',
			'path',
			'child_process',
			'os',
			'module',
			'stream',
			'zlib',
			'assert',
		],
		plugins: [cleanupManifestPlugin],
		define: define,
		format: 'cjs',
		target: ['node14.16.0', 'es2018'],
		logLevel: 'warning',
		bundle: true,
		minify: ENV.NODE_ENV === 'production',
		// Sourcemaps are useless atm. All errors are reported from wrong places.
		// Might be electron dev tools getting confused or something.
		// sourcemap: ENV.NODE_ENV === 'production' ? false : 'inline',
		outdir: PATHS.build,
		outbase: 'src',
	});
}

function styles() {
	const sassGlob = require('gulp-sass-glob');
	const postcss = require('gulp-postcss');

	const sass = require('gulp-dart-sass');
	const sassOptions = {
		includePaths: ['src'],
	};

	// Delete themes file from require cache so that it gets reloaded
	delete require.cache[PATHS.themesFile];

	/** @type any[] */
	const postCssPlugins = [];

	if (ENV.NODE_ENV === 'production') postCssPlugins.push(require('postcss-prune-var')());
	postCssPlugins.push(require('postcss-preset-env')({stage: 0, browsers: 'chrome 89'}));
	postCssPlugins.push(require('postcss-declarations')(require(PATHS.themesFile)));
	if (ENV.NODE_ENV === 'production') postCssPlugins.push(require('cssnano')({preset: 'default'}));

	return src('src/windows/*/*.sass', {base: 'src'})
		.pipe(sassGlob())
		.pipe(sass(sassOptions).on('error', sass.logError))
		.pipe(postcss(postCssPlugins))
		.pipe(dest(PATHS.build));
}

function cleanBuild() {
	return require('del')(PATHS.build);
}

function cleanOut() {
	return require('del')(PATHS.out);
}

function assets() {
	const editJson = require('gulp-json-editor');
	return src('package.json')
		.pipe(
			editJson({
				date: new Date().toISOString(),
				devDependencies: undefined,
				dependencies: undefined,
				scripts: undefined,
				config: undefined,
			})
		)
		.pipe(src(PATHS.assets, {base: 'src'}))
		.pipe(dest(PATHS.build));
}

async function watch() {
	const {spawn} = require('child_process');

	// Set paths that should be used from now on
	let appRoot;
	let appExecutable;

	switch (process.platform) {
		case 'win32':
			appRoot = Path.join(process.cwd(), PATHS.out, `win-unpacked`);
			appExecutable = Path.join(appRoot, `${manifest.productName}.exe`);
			PATHS.build = Path.join(appRoot, 'resources', 'app');
			break;

		case 'linux':
			appRoot = Path.join(process.cwd(), PATHS.out, `linux-unpacked`);
			appExecutable = Path.join(appRoot, manifest.name);
			PATHS.build = Path.join(appRoot, 'resources', 'app');
			break;

		default:
			throw new Error(`Development environment not set up for ${process.platform}.`);
	}

	try {
		await FSP.stat(appExecutable);
	} catch (error) {
		console.log(`App executable missing:`, appExecutable);
	}

	// Styles
	gulpWatch([PATHS.styles, PATHS.themesFile], styles);

	// Assets
	// @ts-ignore
	const assetsWatcher = gulpWatch(PATHS.assets, {events: ['add', 'change']}, assets);
	assetsWatcher.on('unlink', (path) => {
		require('del')(String(path).replace(/^src/, PATHS.build));
	});

	// Scripts
	gulpWatch(PATHS.scripts, scripts);

	// Start the app
	let app;

	console.log('starting the app...');
	start();

	function start() {
		app = spawn(appExecutable, {shell: true, cwd: appRoot});

		app.stdout.on('data', (data) => console.log(data.toString()));
		app.stderr.on('data', (data) => console.error(data.toString()));
		app.on('close', (code) => {
			console.log(`app exited with code ${code}, restarting...`);
			start();
		});
	}
}

async function packageDev() {
	const currentArch = process.arch;
	if (isValidArch(currentArch)) {
		await _package('dir', currentArch);
	} else {
		throw new Error(`Current arch "${currentArch}" is not supported.`);
	}
}

/**
 * Packages app into requested or default targets for CURRENT platform.
 * Building for platforms other than current is not supported.
 */
async function package() {
	/**
	 * array of [arch, target] tuples
	 * @type [Target, Arch][]
	 * */
	const packages = [];
	const os = osFromPlatform();

	// Force production environment
	ENV.NODE_ENV = 'production';
	ENV.FORCED_USER_DATA_PATH = false;

	// Ensure out exists
	await FSP.mkdir(PATHS.out, {recursive: true});

	// Decide what targets & archs need to be packaged
	/** @type {Target[]} */
	let targets = [];
	/** @type {Arch[]} */
	let archs = [];
	/** @type {string[]} */
	const argvTargets =
		argv.target
			?.split(',')
			.map((x) => x.trim())
			.filter((x) => !!x) || [];
	/** @type {string[]} */
	const argvArchs =
		argv.arch
			?.split(',')
			.map((x) => x.trim())
			.filter((x) => !!x) || [];

	for (const target of argvTargets) {
		if (isValidTarget(target)) targets.push(target);
		else throw new Error(`"${target}" is not a valid target for current platform.`);
	}

	for (const arch of argvArchs) {
		if (isValidArch(arch)) archs.push(arch);
		else throw new Error(`"${arch}" is not a valid arch for current platform.`);
	}

	// Populate defaults
	switch (os) {
		case 'win':
			if (archs.length === 0) archs.push('x64');
			if (targets.length === 0) targets.push('nsis', 'portable');
			break;

		case 'linux':
			if (archs.length === 0) archs.push('x64');
			if (targets.length === 0) targets.push('AppImage');
			break;

		case 'mac':
			if (archs.length === 0) archs.push('x64', 'arm64');
			if (targets.length === 0) targets.push('dmg');
			break;
	}

	for (const target of targets) {
		for (const arch of archs) packages.push([target, arch]);
	}

	// Build core
	console.log(`Building core...`);
	await runTask(build);

	// Package core app files
	console.log(`Packaging core...`);
	await archive(await listFiles(PATHS.build), Path.join(PATHS.out, `${manifest.productName}-core.7z`), '7z');

	// Package
	for (const [target, arch] of packages) {
		await _package(target, arch);

		// 7zip dmg contents
		if (target === 'dmg') {
			const contentsFolderPath = Path.join(PATHS.out, 'mac', `${manifest.productName}.app`, 'Contents');
			const packgeName = `${manifest.productName}-contents-${os}-${arch}.7z`;
			const resultArchivePath = Path.join(PATHS.out, packgeName);
			console.log(`Packaging dmg contents: ${packgeName}`);
			await archive(contentsFolderPath, resultArchivePath, '7z');
		}
	}
}

/**
 * @param {Target} target
 * @param {Arch} arch Supported: win: x64, linux+mac: x64, arm64
 */
async function _package(target, arch = 'x64') {
	const os = osFromPlatform();
	const builder = require('electron-builder');
	const Platform = builder.Platform[{win: 'WINDOWS', linux: 'LINUX', mac: 'MAC'}[os]];
	const binariesRoot = `bin/${os}/${arch}`;
	let extraFiles = undefined;

	const logMessage = `Packaging: ${os} ${target} ${arch}`;
	const underline = logMessage
		.split('')
		.map((x) => '-')
		.join('');
	console.log(`${logMessage}\n${underline}`);

	// I don't even know how electron-builder's native portable mode is
	// intended to work. Playing with it produced some weird package that
	// extracted itself to tmp, and deleted itself on exit... ?
	// So I use zip instead, and portability logic is implemented internally
	// through checking if userData folder exists under app root.
	if (target === 'portable') {
		if (os !== 'win') throw new Error(`Portable target is only supported on windows.`);
		const noopPath = Path.join('userData', 'noop');
		await FSP.mkdir('userData', {recursive: true});
		await FSP.writeFile(noopPath, '');
		extraFiles = {
			from: 'userData',
			to: 'userData',
			filter: ['noop'],
		};
		target = 'zip';
	}

	// Ensure binaries are marked as executable
	for (const file of await FSP.readdir(binariesRoot)) {
		await FSP.chmod(Path.join(binariesRoot, file), '777');
	}

	const result = await builder.build({
		targets: Platform.createTarget(target),
		config: {
			appId: `app.${manifest.name}`,
			productName: manifest.productName,
			artifactName: `${manifest.productName}-${arch}.\${ext}`,
			copyright: `Copyright © ${new Date().getFullYear()} ${manifest.productName}`,
			directories: {
				app: PATHS.build,
				output: PATHS.out,
			},
			extraResources: {
				from: binariesRoot,
				to: 'bin',
				filter: ['**/*'],
			},
			extraFiles,
			publish: [], // disables auto-publishing in github actions
			nsis: {
				uninstallDisplayName: manifest.productName,
			},
			win: {
				publish: [], // disables auto-publishing in github actions
				target: [{target, arch}],
				icon: 'src/assets/logo.png',
			},
			linux: {
				publish: [], // disables auto-publishing in github actions
				target: [{target, arch}],
				icon: 'src/assets/logo.png',
			},
			mac: {
				publish: [], // disables auto-publishing in github actions
				target: [
					{target, arch},
					{target: 'zip', arch},
				],
				category: 'public.app-category.developer-tools',
				icon: 'src/assets/app.icns',
				darkModeSupport: true,
			},
			asar: false,
			protocols: [{name: manifest.productName, schemes: [manifest.name]}],
		},
	});

	console.log('result', result);
}

/**
 * Package binaries.
 */
async function binaries() {
	await FSP.mkdir(PATHS.out, {recursive: true});
	const combos = [
		['win', 'x64'],
		['mac', 'x64'],
		['mac', 'arm64'],
	];

	for (const [os, arch] of combos) {
		const outputPath = Path.join(PATHS.out, `${manifest.productName}-binaries-${os}-${arch}.7z`);
		await archive(`bin/${os}/${arch}/*`, outputPath, '7z');
	}
}

/**
 * Check that all packages are built.
 */
async function check() {
	const files = [
		// Mac
		`${manifest.productName}-arm64.dmg`,
		`${manifest.productName}-x64.dmg`,
		`${manifest.productName}-contents-mac-arm64.7z`,
		`${manifest.productName}-contents-mac-x64.7z`,
		// Linux
		`${manifest.productName}-x64.AppImage`,
		// Windows
		`${manifest.productName}-x64.exe`,
		`${manifest.productName}-x64.zip`,
		// Can be build on any platform
		`${manifest.productName}-core.7z`,
		`${manifest.productName}-binaries-mac-arm64.7z`,
		`${manifest.productName}-binaries-mac-x64.7z`,
		`${manifest.productName}-binaries-win-x64.7z`,
	];

	// Check local
	for (const file of files) {
		try {
			await FSP.access(Path.join('packages', file));
		} catch {
			console.error(`Missing: ${file}`);
		}
	}
}

const build = series(cleanBuild, parallel(assets, styles, scripts));

exports.clean = cleanBuild;
exports.scripts = scripts;
exports.styles = styles;
exports.assets = assets;
exports.watch = watch;
exports.build = build;
exports.check = check;
exports.binaries = binaries;
exports.package = package;
exports.default = series(build, cleanOut, packageDev, watch);

/**
 * Helpers.
 */

/** @typedef {'win' | 'linux' | 'mac'} OS */
/** @typedef {'nsis' | 'zip' | 'AppImage' | 'dmg' | 'portable' | 'dir'} Target */
/** @typedef {'x64' | 'arm64'} Arch */

/**
 * Run any gulp task manually.
 */
function runTask(task) {
	return new Promise((resolve, reject) => {
		series(task)((error, result) => {
			if (error) reject(error);
			else resolve(result);
		});
	});
}

/**
 * @type {(name: string) => name is Target}
 */
function isValidTarget(name) {
	switch (process.platform) {
		case 'win32':
			return ['nsis', 'portable', 'dir'].includes(name);
		case 'linux':
			return ['AppImage', 'dir'].includes(name);
		case 'darwin':
			return ['dmg', 'dir'].includes(name);
	}
	return false;
}

/**
 * @type {(name: string) => name is Arch}
 */
function isValidArch(name) {
	switch (process.platform) {
		case 'win32':
			return ['x64'].includes(name);
		case 'linux':
			return ['x64'].includes(name);
		case 'darwin':
			return ['x64', 'arm64'].includes(name);
	}
	return false;
}

/** @type {(platform?: string) => OS} */
const osFromPlatform = (platform = process.platform) => ({win32: 'win', linux: 'linux', darwin: 'mac'}[platform]);

/**
 * List full paths to files inside a directory.
 */
async function listFiles(directoryPath) {
	const files = await FSP.readdir(directoryPath);
	return files.map((file) => Path.join(directoryPath, file));
}

/**
 * Zip folder or a file;
 *
 * ```
 * await archive('path/to/dir/or/file/to/zip', 'path/to/output/archive.zip');
 * await archive('path/to/dir/contents/*', 'archive.zip');
 * await archive('path/to/file.ext', 'archive.zip');
 * await archive(['multiple.exe', 'files.png'], 'archive.zip');
 * ```
 */
async function archive(input, outputPath, format = 'zip') {
	await FSP.rm(outputPath, {recursive: true, force: true});
	const inputs = (Array.isArray(input) ? input : [input]).map((path) => Path.resolve(path));
	const binPath = `./bin/${osFromPlatform(process.platform)}/x64/7za${process.platform === 'win32' ? '.exe' : ''}`;
	await exec(`"${binPath}" a -t${format} -mx9 -snl "${outputPath}" ${inputs.map((input) => `"${input}"`).join(' ')}`);
}
