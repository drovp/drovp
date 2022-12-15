/**
 * Functions to serialize various things into consistent data structures used
 * by the app.
 */
import Path from 'path';
import {Buffer} from 'buffer';
import {clipboard} from 'electron';
import FS, {promises as FSP} from 'fs';
import appManifest from 'manifest';
import {PLUGIN_KEYWORD, DEPENDENCY_KEYWORD} from 'config/constants';
import {eem, isType, Type, uid, getExtensionType, memoize} from 'lib/utils';
import {Item, ItemFile, ItemDirectory, ItemBlob, ItemString} from '@drovp/types';
import {ProfileExportData} from 'models/profiles';
import {decompressFromEncodedURIComponent, compressToEncodedURIComponent} from 'lz-string';

const PLUGIN_NAME_PREFIX = `${appManifest.name}-`;
const MANIFEST_FILE = 'package.json';
const LOCAL_EXCLUDES: (RegExp | string)[] = [/^\./, 'node_modules'];

// id: path to a plugin relative to the plugins directory (slashes normalized to POSIX)
interface SerializeMeta {
	id: string;
	isLocal?: boolean;
	installIdentifier?: string;
}

export type SerializedPlugin = PluginMeta & {
	id: string;
	source?: string;
	path: string;
	main: string;
	isExternal: boolean;
	isLocal: boolean;
	isPrivate: boolean;
	isPlugin: boolean; // module has one of the keywords that mark it as a plugin
};

export interface SerializationError {
	message: string;
	details?: string;
	code?: 'DUPLICATE';
	payload?: string;
}

/**
 * Validation checks.
 */

/**
 * A VERY lax URL match
 */
const isUrl = (input: string) => /^[a-z-]+:\/\/[^\n]+$/.exec(input) !== null;

/**
 * Checks if string is a valid ID that can be used for a processor/dependency/etc.
 */
export const isValidId = memoize((value: string) => idRegExp.exec(value) != null);
const idRegExp = /^[\w\-]+$/;

/**
 * Checks if string is a valid plugin name. (`foo`, `@scope/foo`)
 */
export const isValidPluginName = memoize((value: string) => pluginNameRegExp.exec(value) != null);
const pluginNameRegExp = /^(@[\w\-]+\/)?[\w\-]+$/;

/**
 * Extracts all available information from plugin ID.
 */
export const pluginNameMeta = memoize(function (rawName: string): PluginNameMeta {
	const {id, name, scope} = pluginNameGroupsRegExp.exec(rawName)?.groups || {};

	if (!id || !name) throw new Error(`Invalid plugin name "${rawName}"`);

	const isOfficial = scope === `@${appManifest.name}`;
	const startsWithPrefix = name.startsWith(PLUGIN_NAME_PREFIX);

	return {
		name: id,
		scope: scope,
		displayName:
			(!isOfficial && scope ? `${scope}/` : '') +
			(startsWithPrefix ? name.slice(PLUGIN_NAME_PREFIX.length) : name),
		isOfficial,
		isNonStandard: !isOfficial && !startsWithPrefix,
		npmUrl: `https://www.npmjs.com/package/${id}`,
	};
});

const pluginNameGroupsRegExp = /^(?<id>((?<scope>@[^ @\/]+)\/)?(?<name>[^ @\/]+))$/;

/**
 * Serializes plugin identifier into plugin name, scope, version, ...
 */
export const serializePluginIdentifier = memoize((value: string) => {
	const match = pluginIdentifierRegExp.exec(value);

	const id = match?.groups?.id;
	const scope = match?.groups?.scope;
	const name = match?.groups?.name;
	const version = match ? match.groups?.version || 'latest' : undefined;
	const isOfficial = scope === `@${appManifest.name}`;
	const startsWithPrefix = name?.startsWith(PLUGIN_NAME_PREFIX);

	return {
		installId: match == null ? value : `${id}@${version || 'latest'}`,
		scope,
		name: id,
		displayName: name
			? (!isOfficial && scope ? `${scope}/` : '') +
			  (startsWithPrefix ? name.slice(PLUGIN_NAME_PREFIX.length) : name)
			: value,
		version,
		isExternal: match == null,
		isOfficial,
		isNonStandard: !isOfficial && !startsWithPrefix,
	};
});
const pluginIdentifierRegExp = /^(?<id>((?<scope>@[\w\-]+)\/)?(?<name>[\w\-]+))(@(?<version>(\^|~)?[a-z0-9\-\.]+))?$/;

/**
 * Splits colon ids (processors, dependencies, ...) such as `foo:bar` into its parts.
 */
export const colonIdMeta = memoize(function (id: string): [string, string] {
	const parts = id.split(':');
	const [namespace, name] = parts;
	if (parts.length !== 2 || namespace == null || name == null || !isValidPluginName(namespace) || !isValidId(name)) {
		throw Error(`Invalid colon ID "${id}".`);
	}
	return [namespace, name];
});

/**
 * Unwraps code from markdown links, and import protocol urls.
 */
export function unwrapProfileImportCode(value: string) {
	// `[title](protocol-name://import/{code})`
	const markdownLinkData = /^\[[^\[\]]+\]\((.*)\)$/.exec(value)?.[1];
	if (markdownLinkData) value = markdownLinkData;

	// `protocol-name://import/{code}`
	const protocolImportHeader = `${appManifest.name}://import/`;
	if (value.indexOf(protocolImportHeader) === 0) value = value.slice(protocolImportHeader.length);

	return value;
}

/**
 * Decodes all possible profile import code or json into data.
 */
export function decodeProfileImportCode(value: string) {
	let json: string | undefined;
	try {
		value = value.trim();
		json = value[0] === '{' ? value : decompressFromEncodedURIComponent(value)?.trim();
	} catch {}

	// If this is null, lz-string failed to decompress the string
	if (json?.[0] !== '{') throw new Error(`Invalid import code.`);

	// Try to parse json
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch (error) {
		throw new Error(`Invalid import code: ${eem(error)}`);
	}

	return {data: data as ProfileExportData, json, code: compressToEncodedURIComponent(JSON.stringify(data))};
}

export function validateProfileImportData(data: unknown): data is ProfileExportData {
	const errors: string[] = [];

	if (!isType<{[key: string]: unknown}>(data, Type.Object)) {
		errors.push(`not an object`);
	} else {
		if (!isType(data.title, Type.Undefined | Type.String)) errors.push(`"title" must be a string or undefined`);
		if (isType<string>(data.processor, Type.String)) {
			try {
				colonIdMeta(data.processor);
			} catch {
				errors.push(`invalid "processor" format "${data.processor}"`);
			}
		} else {
			errors.push(`missing "processor"`);
		}
		if (!isType<string>(data.source, Type.String) || data.source.trim() === '') errors.push(`missing "origin"`);
		if (isType<string>(data.version, Type.String)) {
			if (!/^\d+\.\d+\.\d+$/.test(data.version)) errors.push(`invalid "version"`);
		} else {
			errors.push(`missing "version"`);
		}
		if (!isType(data.options, Type.Undefined | Type.Object)) {
			errors.push(`"options" must be undefined or an object`);
		}
	}

	if (errors.length > 0) throw new Error(`Invalid import data:\n- ${errors.join('\n- ')}`);

	return true;
}

/**
 * Serializes all plugins in a directory.
 */
export async function plugins(
	pluginsDirectory: string,
	options: {onError?: (error: SerializationError) => any; onWarning?: (warning: SerializationError) => any} = {}
): Promise<SerializedPlugin[]> {
	const manifestPath = Path.join(pluginsDirectory, MANIFEST_FILE);
	const plugins: SerializedPlugin[] = [];
	let folders: SerializeMeta[] = [];

	// Get the list of local plugins (plugins in root of the `pluginsDirectory`),
	// skipping ignored entries.
	try {
		for (const file of await FSP.readdir(pluginsDirectory, {withFileTypes: true})) {
			if (!file.isDirectory() || shouldExclude(file)) continue;

			// Expand scoped modules
			if (file.name[0] === '@') {
				const nestedFiles = await FSP.readdir(Path.join(pluginsDirectory, file.name), {withFileTypes: true});
				for (const nestedFile of nestedFiles) {
					if (!nestedFile.isDirectory() || shouldExclude(nestedFile)) continue;
					folders.push({id: Path.join(file.name, nestedFile.name), isLocal: true});
				}
			} else {
				folders.push({id: file.name, isLocal: true});
			}
		}
	} catch (error) {
		options.onError?.(error as SerializationError);
		return plugins;
	}

	// Add modules from root `package.json:dependencies`.
	try {
		const {dependencies} = JSON.parse(await FSP.readFile(manifestPath, {encoding: 'utf8'}));
		if (typeof dependencies === 'object') {
			for (const [name, version] of Object.entries<string>(dependencies)) {
				folders.push({id: Path.join('node_modules', name), installIdentifier: version});
			}
		}
	} catch (error) {}

	// Serialize plugins
	for (const folder of folders) {
		try {
			const path = Path.join(pluginsDirectory, folder.id);

			// Try loading the manifest
			let rawManifest: Manifest;
			try {
				rawManifest = JSON.parse(await FSP.readFile(Path.join(path, MANIFEST_FILE), {encoding: 'utf8'}));
			} catch (err) {
				throw new Error(`Missing or invalid manifest file.`);
			}

			if (!rawManifest || !rawManifest.name || !rawManifest.version) {
				throw new Error(`Invalid manifest file (missing name, or version field).`);
			}

			// Check if plugin is already serialized once.
			// This can happen if user has a local development version of a plugin
			// and also installs the same plugin from registry.
			const conflictingPlugin = plugins.find((plugin) => plugin.name === rawManifest.name);
			if (conflictingPlugin) {
				options.onWarning?.({
					message: `Skipping serialization of plugin <code>${rawManifest.name}</code> from:\n<pre><code>"${path}"</code></pre>\nbecause a plugin with the same name has already been serialized from:\n<pre><code>"${conflictingPlugin.path}"</code></pre>\nYou probably have both local and registry versions of the same plugin installed, or maybe you've copy &amp; pasted another local plugin, and forgot to change its <code>package.json</code> name.`,
					code: 'DUPLICATE',
					payload: rawManifest.name,
				});
				continue;
			}

			const isExternal = !!folder.installIdentifier?.includes(':');
			const forcedSource = rawManifest.drovp?.source;
			const data: SerializedPlugin = {
				...rawManifest,
				...pluginNameMeta(rawManifest.name),
				id: folder.id,
				isExternal,
				isLocal: !!folder.isLocal,
				source: folder.isLocal
					? forcedSource
					: isExternal
					? forcedSource || folder.installIdentifier
					: rawManifest.name,
				path: path,
				isPlugin:
					rawManifest.main != null &&
					(Boolean(rawManifest.keywords?.includes(PLUGIN_KEYWORD)) ||
						Boolean(rawManifest.keywords?.includes(DEPENDENCY_KEYWORD))),
				isPrivate: !!rawManifest.private,
			};

			// Remove npmUrl if private or external
			if (rawManifest.private || isExternal) delete data.npmUrl;

			// Try loading readme if missing in manifest (local plugins)
			if (!data.readme) {
				try {
					for (let file of await FSP.readdir(path)) {
						if (file.toLowerCase() === 'readme.md') {
							try {
								data.readme = await FSP.readFile(Path.join(path, file), {encoding: 'utf8'});
							} catch {}
							break;
						}
					}
				} catch {}
			}

			plugins.push(data);
		} catch (error) {
			options.onError?.({
				message: `Plugin "${folder.id}" serialization error`,
				details: eem(error),
			});
		}
	}

	return plugins;
}

function shouldExclude(file: FS.Dirent) {
	for (const exclude of LOCAL_EXCLUDES) {
		if (typeof exclude === 'string' ? file.name.toLowerCase() === exclude.toLowerCase() : exclude.exec(file.name)) {
			return true;
		}
	}
	return false;
}

/**
 * Serializes a file.
 */
export async function file(path: string): Promise<ItemFile | ItemDirectory> {
	const stat = await FSP.stat(path);
	const extensionType = getExtensionType(path);

	return stat.isDirectory()
		? {
				id: uid(),
				created: Date.now(),
				kind: 'directory',
				exists: true,
				path,
		  }
		: {
				id: uid(),
				created: Date.now(),
				kind: 'file',
				path,
				exists: true,
				size: stat.size,
				type: extensionType || Path.basename(path),
		  };
}

/**
 * Serializes a single DataTransferItem.
 */
export async function dataTransferItem(
	item: DataTransferItem
): Promise<ItemBlob | ItemString | ItemFile | ItemDirectory | null> {
	// These values are only available at this moment, so lets save them
	// before we start awaiting promises.
	let itemKind = item.kind; // ! ^
	let itemType = item.type; // ! ^

	/**
	 * File.
	 */
	if (itemKind === 'file') {
		const fileItem = item.getAsFile() as File;
console.log(fileItem);
		// Is blob
		if (!fileItem.path && fileItem.type && fileItem.size > 0) {
			return {
				id: uid(),
				created: Date.now(),
				kind: 'blob',
				mime: fileItem.type,
				contents: Buffer.from(await fileItem.arrayBuffer()),
			};
		}

		// Filter out non files after this point
		if (!fileItem.path) return null;

		// Is potentially a directory (man this API SUCKS!)
		if (!fileItem.type && fileItem.size % 4096 == 0) {
			return file(fileItem.path);
		}

		// This should be a normal file now (have I mentioned how much this API SUCKS?!)
		const extensionType = getExtensionType(fileItem.path);
		return {
			id: uid(),
			created: Date.now(),
			kind: 'file',
			path: fileItem.path,
			size: fileItem.size,
			exists: true,
			type: extensionType || Path.basename(fileItem.path),
		};
	}

	/**
	 * String.
	 */
	if (itemKind === 'string') {
		const contents = (await new Promise((resolve) => item.getAsString(resolve))) as string;
		return {id: uid(), created: Date.now(), kind: 'string', type: itemType, contents};
	}

	return null;
}

/**
 * Creates a filter that filters out duplicate, null, and uri items.
 * URIs are filtered out because we are creating them manually from strings that
 * match URLs RegExp as a separate 'url' kind item.
 */
function createInvalidItemFilter() {
	const contents = new Set<string>();
	return function invalidItemsFilter(item: Item | null): item is Item {
		if (item == null || (item.kind === 'string' && (item.type === 'text/uri-list' || contents.has(item.contents))))
			return false;
		if (item.kind === 'string') contents.add(item.contents);
		return true;
	};
}

function plainStringFilter(item: Item): item is ItemString {
	return item.kind === 'string' && item.type === 'text/plain';
}

function addUrls(items: Item[]): Item[] {
	// Create `url` item from every string item containing a url
	for (const item of items.filter(plainStringFilter)) {
		const contents = item.contents.trim();
		if (isUrl(contents)) items.push({id: uid(), created: Date.now(), kind: 'url', url: contents});
	}

	return items;
}

/**
 * Serializes items from DataTransfer.
 */
export async function dataTransfer(drop?: DataTransfer | null): Promise<Item[]> {
	if (!drop) return [];

	const promises: Promise<Item | null>[] = [];

	// Serialize `dataTransfer.items`
	for (const item of drop.items) promises.push(dataTransferItem(item));
	const items: Item[] = (await Promise.all(promises)).filter(createInvalidItemFilter());

	return addUrls(items);
}

/**
 * Serializes electron clipboard into items.
 * No support for filesystem pointers due to: https://github.com/electron/electron/issues/9035
 */
export async function electronClipboard(): Promise<Item[]> {
	const formats = clipboard.availableFormats();
	const items: Item[] = [];

	// Strings
	if (formats.includes('text/plain')) {
		items.push({
			id: uid(),
			created: Date.now(),
			kind: 'string',
			type: 'text/plain',
			contents: clipboard.readText(),
		});
		addUrls(items);
	}

	// HTML strings
	if (formats.includes('text/html')) {
		items.push({
			id: uid(),
			created: Date.now(),
			kind: 'string',
			type: 'text/plain',
			contents: clipboard.readHTML(),
		});
	}

	// Image blobs
	if (formats.findIndex((format) => format.indexOf('image/') === 0) > -1) {
		items.push({
			id: uid(),
			created: Date.now(),
			kind: 'blob',
			mime: 'image/png',
			contents: clipboard.readImage().toPNG(),
		});
	}

	// Solutions for filesystem pointers below are lame since they allow only
	// retrieving 1 file path even when multiple files are in clipboard.
	// Better to have this disabled than to provide crippled experience that people
	// need to debug while using.
	/*
	// Windows filesystem pointer
	const windowsRawFilePath = clipboard.read('FileNameW');
	if (windowsRawFilePath) {
		const filePath = windowsRawFilePath.replace(new RegExp(String.fromCharCode(0), 'g'), '');
		items.push(await file(filePath));
	}

	// MacOS filesystem pointer
	const macFilePath = clipboard.read('public.file-url').replace('file://', '');
	if (macFilePath) {
		items.push(await file(macFilePath));
	}
*/

	return items;
}

/**
 * Load or serialize instructions string or a file.
 */
export function instructions(instructions: string | undefined, pluginPath: string) {
	if (instructions && instructions?.slice(-3) === '.md') {
		const instructionsPath = Path.join(pluginPath, instructions);

		try {
			return FS.readFileSync(instructionsPath, {encoding: 'utf8'});
		} catch (error) {
			return `Couldn't load instructions file: \`${instructionsPath}\`\n\nError:\n\n\`\`\`\n${eem(
				error
			)}\n\`\`\``;
		}
	}

	return typeof instructions === 'string' ? instructions : undefined;
}
