import Path from 'path';
import {spawn, eem, uid} from 'lib/utils';
import {promises as FSP} from 'fs';
import {deletePath, exists} from 'lib/fs';
import {Extract, ExtractListDetailItem, ExtractOptions} from '@drovp/types';

const IS_WIN = process.platform === 'win32';
const ZA_PATH = Path.join(process.resourcesPath, 'bin', IS_WIN ? '7za.exe' : '7za');
const progressRegExp = /^[^\w]*(?<percent>\d+(\.\d+)?)%/;

async function extractFn(
	archivePath: string,
	destinationPath: string,
	options?: ExtractOptions & {listDetails?: false}
): Promise<string[]>;
async function extractFn(archivePath: string, options?: ExtractOptions & {listDetails?: false}): Promise<string[]>;
async function extractFn(
	archivePath: string,
	destinationPath: string,
	options?: ExtractOptions & {listDetails: true}
): Promise<ExtractListDetailItem[]>;
async function extractFn(
	archivePath: string,
	options?: ExtractOptions & {listDetails: true}
): Promise<ExtractListDetailItem[]>;
async function extractFn(
	archivePath: string,
	destinationOrOptions?: string | ExtractOptions,
	options?: ExtractOptions
): Promise<string[] | ExtractListDetailItem[]> {
	// Normalize params
	let destination: string | undefined;
	if (destinationOrOptions) {
		switch (typeof destinationOrOptions) {
			case 'object':
				options = destinationOrOptions as ExtractOptions;
				destination = undefined;
				break;
			case 'string':
				destination = destinationOrOptions;
				break;
		}
	}

	const {listDetails, overwrite, onProgress, onLog} = options || {};

	if (destination) {
		// Ensure destination exists
		try {
			const stat = await FSP.stat(destination);
			if (!stat.isDirectory()) throw new Error(`destination is not a directory: "${destination}"`);
		} catch (error) {
			if ((error as any)?.code !== 'ENOENT') throw error;
			onLog?.(`creating destination directory: "${destination}"`);
			await FSP.mkdir(destination, {recursive: true});
		}
	} else {
		// Use archives own directory as destination
		destination = Path.dirname(archivePath);
		onLog?.(`using archive's directory as destination: "${destination}"`);
	}

	onLog?.(`using 7za to extract: "${ZA_PATH}"`);

	const tmpDestination = Path.join(destination, `extract-tmp-${uid()}`);
	let stderr = '';
	const stdErrMaxSize = 10000;
	const handleStdout = (data: Buffer) => {
		if (onProgress) {
			const line = data.toString().trim();
			const match = progressRegExp.exec(line);
			if (match) {
				const percent = parseFloat(match.groups?.percent!);
				onProgress({completed: percent / 100, total: 1});
			}
		}
	};
	const handleStderr = (data: Buffer) => {
		stderr += data.toString();
		if (stderr.length > stdErrMaxSize) {
			stderr = `last ${stdErrMaxSize} chars of stderr:\n${stderr.slice(-stdErrMaxSize)}`;
		}
	};
	const cleanup = async () => {
		try {
			await deletePath(tmpDestination);
		} catch {}
	};

	// Extract the archive
	try {
		onLog?.(`creating temporary path: "${tmpDestination}"`);
		await FSP.mkdir(tmpDestination, {recursive: true});
		const args = ['x', '-y', '-mmt1', '-bb0', '-bsp1', `-o${tmpDestination}`, archivePath];
		onLog?.(`extracting the archive with args:\n${args.join(' ')}`);
		await spawn(ZA_PATH, args, {onStdout: handleStdout, onStderr: handleStderr});
	} catch (error) {
		await cleanup();
		throw new Error(`${eem(error)}\n\n${stderr}`);
	}

	let files = await FSP.readdir(tmpDestination);

	// Special handling for tars
	const firstFile = files[0];
	if (files.length === 1 && firstFile && firstFile.slice(-4).toLowerCase() === '.tar') {
		onLog?.(`extracting from tar: "${firstFile}"`);
		try {
			const tarPath = Path.join(tmpDestination, firstFile);
			await extractFn(tarPath, {...options, listDetails: false});
			await deletePath(tarPath);
			files = await FSP.readdir(tmpDestination);
		} catch (error) {
			await cleanup();
			throw error;
		}
	}

	// Listing & moving
	onLog?.(`listing and moving extracted files ->\nfrom: "${tmpDestination}"\n  to: "${destination}"`);
	const fileDetails: ExtractListDetailItem[] = [];
	try {
		for (const file of files) {
			const tmpPath = Path.join(tmpDestination, file);
			const dstPath = Path.join(destination, file);
			if (await exists(dstPath)) {
				if (overwrite) {
					await deletePath(dstPath);
				} else {
					throw new Error(
						`Can't move "${tmpPath}" to "${dstPath}". File already exists and overwrite is disabled.`
					);
				}
			}
			await FSP.rename(tmpPath, dstPath);
			if (listDetails) fileDetails.push(await getFileDetail(file, dstPath));
		}
	} catch (error) {
		throw error;
	} finally {
		await cleanup();
	}

	return listDetails ? fileDetails : files;
}

export const extract: Extract = extractFn;

async function getFileDetail(name: string, path: string): Promise<ExtractListDetailItem> {
	const stat = await FSP.stat(path);
	return {
		path,
		name,
		size: stat.size,
		isFile: stat.isFile(),
		isDirectory: stat.isDirectory(),
	};
}
