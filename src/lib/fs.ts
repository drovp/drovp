import {promises as FSP, Stats} from 'fs';
import Path from 'path';

/**
 * Checks if path exists, with optional type check function.
 */
export async function exists(path: string, check?: (stat: Stats) => boolean): Promise<boolean> {
	let stat: Stats | undefined;
	try {
		stat = await FSP.stat(path);
	} catch {}

	return stat ? (check ? check(stat) : true) : false;
}

/**
 * Create a new file, or override an existing one.
 * Creates destination directory if it doesn't exist yet.
 */
export async function outputFile(
	path: string,
	data: string | Uint8Array,
	options?: Parameters<typeof FSP.writeFile>[2]
) {
	path = Path.resolve(path);
	const createFile = () => FSP.writeFile(path, data, options);

	try {
		await createFile();
	} catch (error) {
		// Unknown error
		if ((error as any)?.code !== 'ENOENT') throw error;

		// Folder doesn't exist, lets create it
		const mode = typeof options === 'object' ? options?.mode : undefined;
		await FSP.mkdir(Path.dirname(path), {recursive: true, mode});
		await createFile();
	}
}

/**
 * Delete any filesystem path (file or directory) recursively.
 */
export async function deletePath(path: string) {
	await FSP.rm(path, {force: true, recursive: true});
}

/**
 * Delete a directory, but only when it's empty.
 */
export async function deleteDirectoryWhenEmpty(path: string) {
	try {
		if ((await FSP.readdir(path)).length === 0) await deletePath(path);
	} catch (error) {
		if ((error as any)?.code !== 'ENOENT') throw error;
	}
}

/**
 * Write data as a json file.
 * Creates destination directory if it doesn't exist yet.
 */
export async function outputJson(
	path: string,
	data: any,
	options?: {
		encoding?: BufferEncoding | null;
		mode?: string | number;
		flag?: string | number;
		space?: string | number;
	}
) {
	return outputFile(path, JSON.stringify(data, null, options?.space), options);
}

/**
 * Read file and parse it as JSON.
 */
export async function readJson(path: string) {
	return JSON.parse(await FSP.readFile(path, {encoding: 'utf8'}));
}

/**
 * Deletes anything at path and creates an empty directory in its place.
 */
export async function prepareEmptyDirectory(path: string) {
	try {
		const stat = await FSP.stat(path);
		if (stat.isDirectory()) {
			// If path is a directory, we delete everything inside individually
			// due to an issue on windows, where doing recursive directory
			// delete and re-creation causes errors if directory's parent is
			// open in explorer...
			for (const file of await FSP.readdir(path)) {
				await FSP.rm(Path.join(path, file), {recursive: true, force: true});
			}
		} else {
			await FSP.rm(path, {recursive: true, force: true});
			await FSP.mkdir(path, {recursive: true});
		}
	} catch (error) {
		if ((error as any)?.code !== 'ENOENT') throw error;
		await FSP.mkdir(path, {recursive: true});
	}
}
