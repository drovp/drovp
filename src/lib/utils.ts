import manifest from 'manifest';
import Path from 'path';
import FS from 'fs';
import os from 'os';
import {reaction, action, Signal, Disposer} from 'statin';
import {SLIDE_OUT} from 'config/animations';
import {deletePath} from 'lib/fs';
import http from 'http';
import https from 'https';
import CP from 'child_process';

const FSP = FS.promises;

/**
 * Creates an event type with forced expected structure.
 * Makes creating targeted event handlers not pain in the ass.
 */
export type TargetedEvent<Target extends EventTarget = EventTarget, TypedEvent extends Event = Event> = Omit<
	TypedEvent,
	'currentTarget'
> & {
	readonly currentTarget: Target;
};

/**
 * Naive quick type guard. Casts `value` to `T` when `condition` is `true`.
 * ```ts
 * isOfType<MouseEvent>(event, 'clientX' in event)
 * ```
 */
export function isOfType<T>(value: any, condition: boolean): value is T {
	return condition;
}

/**
 * Simple & fast type checker & caster that can check multiple types at the same time.
 *
 * ```
 * isType<number | boolean>(5, Type.Number | Type.Boolean); // true
 * ```
 */
export function isType<T extends unknown>(value: any, flags: Type): value is T {
	if (value === null) return (Type.Null & flags) > 0;
	if (value === undefined) return (Type.Undefined & flags) > 0;
	const type = typeof value;
	if (type === 'boolean') return (Type.Boolean & flags) > 0;
	if (type === 'number') return Number.isNaN(value) ? (Type.NaN & flags) > 0 : (Type.Number & flags) > 0;
	if (type === 'string') return (Type.String & flags) > 0;
	if (type === 'function') return (Type.Function & flags) > 0;
	if (type === 'object') {
		if (Array.isArray(value)) return (Type.Array & flags) > 0;

		const toStringType = Object.prototype.toString.call(value);

		for (const type of SpecialObjectTypes) {
			if (toStringType === `[object ${type}]`) return (Type[type] & flags) > 0;
		}

		return (Type.Object & flags) > 0;
	}
	return false;
}

const SpecialObjectTypes: (keyof typeof Type)[] = ['RegExp', 'Date'];

export enum Type {
	Null = 1 << 0,
	Undefined = 1 << 1,
	Number = 1 << 2,
	NaN = 1 << 3,
	String = 1 << 4,
	Boolean = 1 << 5,
	Array = 1 << 6,
	Function = 1 << 7,
	Object = 1 << 8,
	RegExp = 1 << 9,
	Date = 1 << 10,
	Nuldef = Null | Undefined,
}

/**
 * Why do I have to do this? Why can't this just be on some renderer API?
 */

let APP_PATH: string | undefined;
export function setAppPath(path: string) {
	APP_PATH = path;
}
export function getAppPath() {
	if (!APP_PATH) throw new Error(`APP_PATH not available yet.`);
	return APP_PATH;
}

/**
 * Extracts error message from any error value.
 */
export function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

/**
 * Extension and mime utils.
 */
export function getExtensionType(path: string) {
	const extension = Path.extname(path).slice(1).toLowerCase();
	return extension === 'jpeg' ? 'jpg' : extension;
}

/**
 * Creates a promise, and extracts its controls to be used externally.
 */
export function makePromise<T extends any = void>(): [Promise<T>, (value: T) => void, (error: any) => void] {
	let resolve: (value: T) => void;
	let reject: (error: any) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return [promise, resolve!, reject!];
}

/**
 * Throttles a promise returning function so that it never runs in parallel.
 *
 * If called when previous in progress, it behaves depending on `pendingBehavior` param:
 *
 * - `wait`: (default) returns currently pending promise
 * - `queue`: it'll queue promise creating function to be called after
 *            current one is done, and return promise for that
 */
export function promiseThrottle<T extends unknown = void, A extends unknown[] = unknown[]>(
	fn: (...args: A) => Promise<T>,
	pendingBehavior: 'queue' | 'wait' = 'wait'
): () => Promise<T> {
	let currentPromise: Promise<T> | null = null;
	let queued: {
		promise: Promise<T>;
		args: A;
		resolve: (value: T) => void;
		reject: (error: unknown) => void;
	} | null = null;
	const queue = pendingBehavior === 'queue';

	async function call(...args: A): Promise<T> {
		if (currentPromise) {
			if (queue) {
				if (queued) {
					queued.args = args;
					return queued.promise;
				} else {
					const [promise, resolve, reject] = makePromise<T>();
					queued = {promise, resolve, reject, args};
					return promise;
				}
			} else {
				return currentPromise;
			}
		}

		try {
			currentPromise = fn(...args);
			return await currentPromise;
		} finally {
			while (queued) {
				const {reject, resolve, args} = queued;
				queued = null;
				try {
					currentPromise = fn(...args);
					resolve(await currentPromise);
				} catch (error) {
					reject(error);
				}
			}

			currentPromise = null;
		}
	}

	return call;
}

/**
 * Throttle / Debounce.
 */

type UnknownFn = (...args: any[]) => any;
export interface DTWrapper<T extends UnknownFn> {
	(...args: Parameters<T>): void;
	cancel: () => void;
	flush: () => void;
}

export function rafThrottle<T extends UnknownFn>(fn: T): DTWrapper<T> {
	let frameId: number | null = null;
	let args: any;
	let context: any;

	function call() {
		frameId = null;
		fn.apply(context, args);
		context = args = null;
	}

	function throttled(this: any) {
		context = this;
		args = arguments;
		if (frameId === null) frameId = requestAnimationFrame(call);
	}

	throttled.cancel = () => {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
	};

	throttled.flush = () => {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
			call();
		}
	};

	return throttled as DTWrapper<T>;
}

export function throttle<T extends UnknownFn>(fn: T, timeout: number = 100, noTrailing: boolean = false): DTWrapper<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null;
	let args: any;
	let context: any;
	let last: number = 0;

	function call() {
		fn.apply(context, args);
		last = Date.now();
		timeoutId = context = args = null;
	}

	function throttled(this: any) {
		let delta = Date.now() - last;
		context = this;
		args = arguments;
		if (delta >= timeout) {
			throttled.cancel();
			call();
		} else if (!noTrailing && timeoutId == null) {
			timeoutId = setTimeout(call, timeout - delta);
		}
	}

	throttled.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	throttled.flush = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
			call();
		}
	};

	return throttled as DTWrapper<T>;
}

export function debounce<T extends UnknownFn>(fn: T, timeout: number = 100): DTWrapper<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null;
	let args: any;
	let context: any;

	function call() {
		fn.apply(context, args);
		timeoutId = context = args = null;
	}

	function debounced(this: any) {
		context = this;
		args = arguments;
		if (timeoutId != null) clearTimeout(timeoutId);
		timeoutId = setTimeout(call, timeout);
	}

	debounced.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	debounced.flush = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
			call();
		}
	};

	return debounced as DTWrapper<T>;
}

/**
 * Generates a unique lowercase alphanumeric string of a specific size.
 */
export const uid = (size = 10) =>
	Array(size)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join('');

/**
 * Move array element from one position to the other by mutating the array.
 */
export function arrayMoveItem(array: any[], from: number, to: number) {
	const startIndex = from < 0 ? array.length + from : from;
	if (startIndex >= 0 && startIndex < array.length) {
		const endIndex = to < 0 ? array.length + to : to;
		const [item] = array.splice(from, 1);
		array.splice(endIndex, 0, item);
	}
}

/**
 * Deletes a single value from array in place.
 */
export function arrayDeleteValue<T extends unknown>(array: T[], value: T) {
	const index = array.indexOf(value);
	if (index > -1) array.splice(index, 1);
	return array;
}

/**
 * Deletes a single value that matches predicament from an array in place.
 */
export function arrayDelete<T extends unknown>(array: T[], predicament: (value: T) => boolean) {
	const index = array.findIndex(predicament);
	if (index > -1) array.splice(index, 1);
	return array;
}

/**
 * Event handler wrapper that stops all event's default action and propagation.
 */
export const prevented = (fn?: Function) => (event: Event) => {
	event.preventDefault();
	event.stopPropagation();
	if (fn) fn(event);
};

/**
 * Converts backslashes to forward slashes in paths.
 */
export const convertPathToPOSIX = (path: string): string => path.replace(/\\+/g, '/');

/**
 * Removes previously loaded node modules from cache, so that next `require()`
 * call reloads it.
 *
 * Only cleans CommonJS cache, as there is currently no mechanism to clean ESM.
 *
 * TODO: add ESM cache busting when available
 */
export const clearModuleCache = () => {
	try {
		for (const key of Object.keys(require.cache)) {
			// DO NOT clear electron module cache, as it breaks requiring electron
			if (!key.startsWith('electron')) delete require.cache[key];
		}
	} catch {}
};

/**
 * Formats raw size number into human readable units.
 */
const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'];
export function formatSize(bytes: number): string {
	let i = 0;
	while (bytes >= 1000) {
		bytes /= 1024;
		i++;
	}
	return `${bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)}${sizeUnits[i]}`;
}

/**
 * Converts milliseconds into human readable duration string.
 */
export function formatDuration(total: number): string {
	total = Math.round(total);

	if (Math.abs(total) < 1000) return `${total}ms`;

	const isNegative = total < 0;
	let result = '';
	total = Math.abs(total);
	let millisecondsLeft = total;

	const hours = Math.floor(millisecondsLeft / (60 * 60 * 1000));
	if (hours > 0) {
		millisecondsLeft %= 60 * 60 * 1000;
		result = `${hours}h`;
	}

	const minutes = Math.floor(millisecondsLeft / (60 * 1000));
	if (minutes > 0) {
		millisecondsLeft %= 60 * 1000;
		result += result ? ` ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
	}

	const seconds = Math.floor(millisecondsLeft / 1000);
	let secondsString = result ? ` ${String(seconds).padStart(2, '0')}` : `${Math.round(seconds)}`;
	result += `${secondsString}s`;

	if (isNegative) result = `-${result}`;

	return result;
}

/**
 * Converts milliseconds into human readable single number duration.
 * Examples: `1 hour`, `3 days`, `2 weeks`, `5 months`, ...
 */
export function formatLongDuration(milliseconds: number) {
	const hours = Math.round(milliseconds / (60 * 60_000));
	if (hours >= 720) {
		const months = Math.round(hours / 720);
		return `${months} ${months > 1 ? 'months' : 'month'}`;
	}
	if (hours >= 168) {
		const weeks = Math.round(hours / 168);
		return `${weeks} ${weeks > 1 ? 'weeks' : 'week'}`;
	}
	if (hours >= 24) {
		const days = Math.round(hours / 24);
		return `${days} ${days > 1 ? 'days' : 'day'}`;
	}
	return `${hours} ${hours > 1 ? 'hours' : 'hour'}`;
}

/**
 * Coverts fraction into human readable percent value.
 */
export function formatPercent(fraction: number) {
	return `${Math.round(100 * fraction)}%`;
}

/**
 * Format time into string that displays only relevant date data.
 * If time happened this year, year won't be showed.
 * If time happened this day, the day and month won't be showed.
 */
export function formatRelevantTime(time: number | Date) {
	const date = typeof time === 'number' ? new Date(time) : time;
	const nowDate = new Date();
	const year = date.getFullYear();

	const options: Parameters<typeof Intl.DateTimeFormat>[1] = {hour: '2-digit', minute: '2-digit', second: '2-digit'};

	const isSameYear = nowDate.getFullYear() === year;
	const isSameDay = isSameYear && nowDate.getMonth() == date.getMonth() && nowDate.getDate() == date.getDate();
	const isSameWeek = weekIdentifier(nowDate) === weekIdentifier(date);

	// Not current day
	if (!isSameDay) {
		// Not current week
		if (!isSameWeek) {
			options.day = 'numeric';
			options.month = 'short';
		} else {
			options.weekday = 'short';
		}

		// Not current year
		if (!isSameYear) options.year = 'numeric';
	}

	return new Intl.DateTimeFormat(undefined, options).format(date);
}

function weekIdentifier(date: Date) {
	// Create a copy of this date object
	var target = new Date(date.valueOf());
	// Starting date point for our sequence
	var lastDayOfWeekZeroTimestamp = new Date('January 5, 1970 00:00:00').getTime() - 1;
	// Number of week from our starting date
	return Math.ceil((target.getTime() - lastDayOfWeekZeroTimestamp) / (24 * 3600 * 1000 * 7));
}

/**
 * Unified date format for the whole app.
 */
export const formatDate = (date: number | string) =>
	new Date(date).toLocaleString(undefined, {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	});

/**
 * Count number of decimal places in a number.
 */
export function countDecimals(num: number, limit = 20) {
	return `${num}`.split('.')[1]?.length || 0;
}

/**
 * Clamp number between specified limits.
 */
export function clamp(min: number, value: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

/**
 * Builds html class name from base and flag map:
 * ```
 * flagify('Foo', {bar: true, baz: false}); // => 'Foo -bar'
 * ```
 */
export function flagify(base: string, flags: Record<string, boolean>) {
	for (let key in flags) if (flags[key]) base += ` -${key}`;
	return base;
}

export class FetchJsonError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

/**
 * Automatically parses and validates response code.
 */
export async function fetchJsonResponse<T extends unknown = unknown>(
	url: string,
	init?: RequestInit & {timeout?: number}
): Promise<[T, Response]> {
	const parentSignal = init?.signal;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), init?.timeout || 10000);
	const clear = () => clearTimeout(timeoutId);

	if (parentSignal) {
		parentSignal.addEventListener('abort', () => {
			clear();
			controller.abort();
		});
	}

	let response: Response | undefined;
	try {
		response = await fetch(url, {...init, signal: controller.signal});
	} catch (error) {
		throw error;
	} finally {
		clear();
	}

	const body = await response.json();

	if (response.status !== 200) {
		throw new FetchJsonError(`${response.status}: ${body.error}\n${url}`, response.status);
	}

	return [body, response];
}

export async function fetchJson<T extends unknown = unknown>(
	url: string,
	init?: RequestInit & {timeout?: number}
): Promise<T> {
	return (await fetchJsonResponse<T>(url, init))[0];
}

/**
 * Inserts text in currently active input/textarea element at cursor.
 */
export function insertAtCursor(text: string, input: Element | null = document.activeElement) {
	if (!isOfType<HTMLInputElement | HTMLTextAreaElement>(input, input != null && 'selectionStart' in input)) {
		return;
	}
	const [start, end] = [input.selectionStart, input.selectionEnd];
	if (start != null && end != null) input.setRangeText(text, start, end, 'end');
}

/**
 * Fires an animation in delayed series on all passed elements.
 */
export function animationVolley(
	elements: Element[],
	{
		animation = SLIDE_OUT,
		easing = 'cubic-bezier(0.215, 0.61, 0.355, 1)',
		duration = 100, // Individual animation duration, the whole volley will last at most 2x this amount
		maxDelay = 40,
		fill = 'forwards',
	}: {
		animation?: Keyframe[];
		easing?: string;
		duration?: number;
		maxDelay?: number;
		fill?: 'backwards' | 'auto' | 'both' | 'forwards' | 'none';
	} = {}
): Promise<void> {
	const delay = Math.min(Math.round(duration / elements.length), maxDelay);
	let lastDelay = 0;

	// Queue animations
	for (let i = 0; i < elements.length; i++) {
		lastDelay = i * delay;
		elements[i]!.animate(animation, {duration, delay: lastDelay, easing, fill});
	}

	return new Promise<void>((resolve) => setTimeout(resolve, lastDelay + duration));
}

/**
 * Runs a volley of animations on all visible children of a container.
 */
export function animationVolleyVisible(
	container: Element,
	options: Parameters<typeof animationVolley>[1] = {}
): Promise<void> {
	return animationVolley(pickVisibleElements(container), options);
}

export function isElementVisible(element: Element) {
	const {top, bottom, left, right} = element.getBoundingClientRect();
	return bottom > 0 && top < window.innerHeight && right > 0 && left < window.innerWidth;
}

export function pickVisibleElements(container: Element, filter?: (element: Element) => boolean) {
	return [...container.children].filter((element) => isElementVisible(element) && (!filter || filter(element)));
}

export interface DownloadOptions {
	onProgress?: (progress: {completed: number; total?: number}) => void;
	onLog?: (message: string) => void;
	filename?: string;
	timeout?: number;
	signal?: AbortSignal;
}

/**
 * Download utility that follows redirects and extracts source filename.
 */
export async function download(sourceUrl: string | URL, destinationDirectory: string, options: DownloadOptions = {}) {
	const {onProgress, onLog, filename: forcedFilename, ...httpOptions} = options;
	const url = typeof sourceUrl === 'string' ? new URL(sourceUrl) : sourceUrl;
	const protocol = url.protocol === 'https:' ? https : http;

	// Ensure destination directory exists
	try {
		const stat = await FSP.stat(destinationDirectory);
		if (!stat.isDirectory()) throw new Error(`destination directory is not a directory: "${destinationDirectory}"`);
	} catch (error) {
		if ((error as any)?.code !== 'ENOENT') throw error;
		onLog?.(`creating destination directory: "${destinationDirectory}"`);
		await FSP.mkdir(destinationDirectory, {recursive: true});
	}

	return new Promise<string>(async (resolve, reject) => {
		try {
			const request = protocol.get(url.toString(), httpOptions, (response) => {
				// Follow redirects
				const location = response.headers.location;
				if (location) {
					onLog?.(`following redirect to: ${location}`);
					resolve(download(new URL(location, url), destinationDirectory, options));
					return;
				}

				if (response.statusCode !== 200) {
					reject(new Error(`${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				// Extract filename
				let headerFilename = response.headers['content-disposition']
					?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)?.[1]
					?.trim();

				// Unquote the header filename
				if (headerFilename && headerFilename[0] === '"' && headerFilename[headerFilename.length - 1] === '"') {
					headerFilename = headerFilename.slice(1, -1).trim();
					if (headerFilename) {
						onLog?.(`extracted filename from content-disposition header: ${headerFilename}`);
					}
				}

				const urlParts = url.pathname.split('/');
				const filename = headerFilename || urlParts[urlParts.length - 1]!;
				if (!headerFilename) onLog?.(`extracted filename from end of the url.pathname: ${filename}`);
				const destinationPath = Path.join(destinationDirectory, forcedFilename || filename);

				const total = Number(response.headers['content-length']) || undefined;
				onLog?.(`content-length: ${total || 'not-available'}`);
				let completed = 0;
				onLog?.(`creating write stream to: "${destinationPath}"`);
				const destination = FS.createWriteStream(destinationPath);

				response.on('data', (data) => {
					destination.write(data);
					completed += data.length;
					onProgress?.({completed, total});
				});

				response.on('error', (error) => {
					destination.close();
					reject(error);
				});

				response.on('end', async () => {
					destination.close();
					if (!response.complete) {
						onLog?.(`cleaning up unfinished download`);
						await deletePath(destinationPath); // cleanup
						reject(new Error('The connection was terminated.'));
					} else {
						resolve(filename);
					}
				});
			});

			request.on('error', async (error) => {
				reject(error);
			});
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Spawn & Exec.
 */

interface SubprocessOptions {
	resolve: (data?: any) => void;
	reject: (reason?: any) => void;
	onStdout?: (data: Buffer) => void;
	onStderr?: (data: Buffer) => void;
	maxBufferSize?: number;
}

export interface Subprocess extends Promise<{stdout?: Buffer; stderr?: Buffer}> {
	process: CP.ChildProcess;
}

function _wrapProcess(
	cp: CP.ChildProcess,
	{resolve, reject, onStdout, onStderr, maxBufferSize = 1024 * 1024}: SubprocessOptions
): CP.ChildProcess {
	let stdout: undefined | Buffer;
	let stderr: undefined | Buffer;

	cp.on('close', (code) => {
		if (code === 0) resolve({stdout, stderr});
		else reject(new Error(`Process exited with code ${code}.`));
	});

	cp.on('error', reject);

	cp.stdout?.on('data', (data: Buffer) => {
		stdout = stdout ? Buffer.concat([stdout, data]) : data;
		if (maxBufferSize && stdout.length) stdout = stdout.slice(-maxBufferSize);
		onStdout?.(data);
	});
	cp.stderr?.on('data', (data: Buffer) => {
		stderr = stderr ? Buffer.concat([stderr, data]) : data;
		if (maxBufferSize && stderr.length) stderr = stderr.slice(-maxBufferSize);
		onStderr?.(data);
	});

	return cp;
}

/**
 * Spawn async wrapper with logging.
 */

export type SpawnOptions = CP.SpawnOptions & Omit<SubprocessOptions, 'id' | 'resolve' | 'reject'>;

export function spawn(
	command: string,
	args: string[],
	{onStdout, onStderr, maxBufferSize, ...spawnOptions}: SpawnOptions = {}
) {
	let process: CP.ChildProcess;
	const promise = new Promise<{stdout?: Buffer; stderr?: Buffer}>((resolve, reject) => {
		process = _wrapProcess(CP.spawn(command, args, spawnOptions), {
			resolve,
			reject,
			onStdout,
			onStderr,
			maxBufferSize,
		});
	}) as Subprocess;

	promise.process = process!;

	return promise;
}

/**
 * Exec async wrapper with logging.
 */

export type ExecOptions = CP.ExecOptions & Omit<SubprocessOptions, 'id' | 'resolve' | 'reject'>;

export function exec(command: string, {onStdout, onStderr, maxBufferSize, ...execOptions}: ExecOptions = {}) {
	let process: CP.ChildProcess;
	const promise = new Promise<{stdout?: Buffer; stderr?: Buffer}>((resolve, reject) => {
		process = _wrapProcess(CP.exec(command, execOptions), {
			resolve,
			reject,
			onStdout,
			onStderr,
			maxBufferSize,
		});
		process = CP.exec(command, execOptions);
	}) as Subprocess;

	promise.process = process!;

	return promise;
}

/**
 * Sets up updates checking interval.
 */
export function createUpdatesChecker(
	intervalSignal: Signal<number>,
	lastTimeSignal: Signal<number>,
	checker: () => any
): Disposer {
	let updateIntervalId: NodeJS.Timeout | null = null;
	const msInHour = 60 * 60_000;
	const disposeReaction = reaction(
		() => intervalSignal(),
		debounce((interval: number) => {
			if (updateIntervalId != null) clearInterval(updateIntervalId);
			const updatesCheckInterval = interval * msInHour;

			// Guard against too short intervals
			if (updatesCheckInterval < msInHour) return;

			const checkForUpdatesMaybe = async () => {
				if (lastTimeSignal() + updatesCheckInterval > Date.now()) return;
				const result = await checker();

				// If we don't save successful checks, the app will re-check on next
				// re-launch, which makes the indicators stay up between re-launches.
				if (!result) action(() => lastTimeSignal(Date.now()));
			};

			checkForUpdatesMaybe();

			// We decide every hour whether it is time to check for an update.
			// This is a workaround for setTimeout overflowing on values larger
			// than 25 days, causing instant infinite loops.
			updateIntervalId = setInterval(checkForUpdatesMaybe, msInHour);
		}, 1000),
		{immediate: true}
	);

	return () => {
		disposeReaction();
		if (updateIntervalId != null) clearInterval(updateIntervalId);
	};
}

/**
 * Normalize path: resolve, normalize, remove trailing slashes.
 */
export function normalizePath(path: string) {
	return Path.normalize(Path.resolve(path)).replace(/[\\\/]+$/, '');
}

/**
 * Check for input elements (input, textarea, ...).
 */
export function isTextInputElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'TEXTAREA') return !value.readOnly;
	if (value.nodeName === 'INPUT') {
		if (value.type === 'checkbox') return false;
		if (value.type === 'radio') return false;
		if (value.type === 'range') return false;
		return !value.readOnly;
	}
	return false;
}

/**
 * Check for input elements that need mouse dragging functionality to operate.
 */
export function isDragRequiringElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'TEXTAREA') return !value.readOnly;
	if (value.nodeName === 'INPUT') {
		if (value.type === 'checkbox') return false;
		if (value.type === 'radio') return false;
		return !value.readOnly;
	}
	return false;
}

/**
 * Check for interactive elements (buttons, input, textarea, ...).
 */
export function isInteractiveElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'BUTTON') return !value.disabled;
	return isTextInputElement(value);
}

/**
 * Uppercase first letter in a string.
 */
export const ucFirst = (str: string) => `${str[0]?.toUpperCase()}${str.slice(1)}`;

/**
 * Returns value from an object located at path.
 *
 * ```
 * const obj = {
 *   a: ['foo', 'bar']
 *   b: {
 *     c: 5
 *   }
 * };
 * propPath(obj, 'a.1'); // 'bar'
 * propPath(obj, ['a', 1]); // 'bar'
 * propPath(obj, 'b.c'); // 5
 * ```
 */
export function propPath(obj: any, path: string | (string | number)[]) {
	if (typeof path === 'string') path = path.split(/(?<!\\)\./).map((prop) => prop.replace(/\\./, '.'));

	let cursor = obj;

	for (let i = 0; i < path.length; i++) {
		if (cursor != null && typeof cursor === 'object') cursor = cursor[path[i]!];
		else return undefined;
	}

	return cursor;
}

/**
 * Count occurrences of a string within a string.
 */
export function occurrences(needle: string, haystack: string, allowOverlapping = false) {
	if (needle.length <= 0) return haystack.length + 1;

	let count = 0;
	let pos = 0;
	let step = allowOverlapping ? 1 : needle.length;

	while (true) {
		pos = haystack.indexOf(needle, pos);
		if (pos >= 0) {
			++count;
			pos += step;
		} else break;
	}

	return count;
}

/**
 * Open issue in project's issue url, with extra handling for common services
 * that pre-fills issue title and body.
 */
export function reportIssue(
	url: string,
	{title, body, includeVersions = true}: {title?: string; body?: string; includeVersions?: boolean} = {}
) {
	const githubMatch = /(?<repo>https:\/\/github.com\/[^\/]+\/[^\/]+)/i.exec(url);
	if (githubMatch) {
		const reportUrl = new URL(`${githubMatch.groups!.repo!}/issues/new`);

		if (title) reportUrl.searchParams.set('title', title);

		const arch = process.arch;
		let fullBody = includeVersions
			? `**OS:** ${os.version()} ${os.release()}\n**App:** ${manifest.version} ${arch}\n\n`
			: '';
		if (body) fullBody = `${fullBody}${body}`;
		if (fullBody) reportUrl.searchParams.set('body', fullBody);

		url = reportUrl.href;
	}

	// Can't import it at the top, or it ends up in thread.js file (since it's
	// ignored in esbuild config, it'll just be left as a require), and breaks
	// every thread spawn in production.
	require('electron').shell.openExternal(url);
}

/**
 * Strips html tags from string.
 */
export function stripHtml(value: string) {
	// Cache conversion element
	// @ts-ignore
	const div = global.___stripHtmlConversionDiv || (global.___stripHtmlConversionDiv = document.createElement('div'));
	div.innerHTML = value;
	return div.textContent;
}

/**
 * Returns an ID of a passed event's modifiers combination.
 *
 * Example: `Alt+Shift`
 *
 * Modifiers are always PascalCased and in alphabetical order.
 */
export function idModifiers(event: Event) {
	return getModifiers(event).join('+');
}

function getModifiers(event: Event) {
	const modifiers: string[] = [];
	for (const name of ['alt', 'ctrl', 'meta', 'shift']) {
		if (event[`${name}Key` as unknown as keyof Event]) modifiers.push(name[0]!.toUpperCase() + name.slice(1));
	}
	return modifiers;
}

export function idKey(event: KeyboardEvent) {
	const parts = getModifiers(event);
	const key = event.key === 'Control' ? 'Ctrl' : event.key;
	if (!parts.includes(key)) parts.push(key);
	return parts.join('+');
}

/**
 * Checks if value is a window object.
 */
export function isWindow(value: any): value is Window {
	return value != null && value.window === value && value.document != null && value.setInterval != null;
}

/**
 * Returns element's position object with `left`, `top`, `bottom`, `right`,
 * `width`, and `height` properties indicating the position and dimensions
 * of element on a page, or relative to other element.
 *
 * In contrast, `getBoundingClientRect()` returns position relative to viewport.
 */
export function getBoundingRect(element: HTMLElement, container?: HTMLElement | null) {
	container = container || element.ownerDocument?.documentElement;

	if (!container) throw new Error(`Couldn't find element document.`);

	const containerBox = container.getBoundingClientRect();
	const elementBox = element.getBoundingClientRect();
	const left = elementBox.left - containerBox.left;
	const top = elementBox.top - containerBox.top;

	return {
		left,
		top,
		width: elementBox.width,
		height: elementBox.height,
		right: left + elementBox.width,
		bottom: top + elementBox.height,
	};
}

/**
 * Memoize a single arg function output and bypass its execution for subsequent calls.
 */
export function memoize<A extends any, R extends any>(fn: (arg: A) => R): (arg: A) => R {
	const cache = new Map<A, {isError: true; result: any} | {isError?: never; result: R}>();

	function memoized(arg: A) {
		const cached = cache.get(arg);

		if (cached) {
			if (cached.isError) throw cached.result;
			return cached.result;
		}

		try {
			const result = fn(arg);
			cache.set(arg, {result});
			return result;
		} catch (error) {
			cache.set(arg, {isError: true, result: error});
			throw error;
		}
	}

	return memoized;
}

/**
 * Walks parentElement chain until it finds an element with requested data attribute.
 * Returns dataset attribute value.
 */
export function findDatasetAncestor(element: HTMLElement, attributeName: string): HTMLElement | undefined {
	let parent: HTMLElement | undefined | null = element;
	while (parent) {
		if (parent.dataset?.[attributeName]) return parent;
		parent = parent.parentElement;
	}
}

/**
 * Round floating number to a fixed decimal size.
 *
 * ```
 * roundDecimals(1.3333333333, 2); // 1.33
 * ```
 */
export function roundDecimals(num: number, size: number) {
	const power = Math.pow(10, size);
	return Math.round(num * power) / power;
}

/**
 * Check if position is indie an element.
 */
export function isInsideElement(element: HTMLElement, {x, y}: {x: number; y: number}) {
	const {left, top, right, bottom} = element.getBoundingClientRect();
	/**
	 * We sacrifice 1px from each side to be more robust, otherwise there is a
	 * lot of false positives.
	 */
	return x > Math.round(left) && x < Math.round(right) && y > Math.round(top) && y < Math.round(bottom);
}

export function getPointToPointDistance(ax: number, ay: number, bx: number, by: number) {
	return Math.sqrt(Math.pow(bx - ax, 2) + Math.pow(by - ay, 2));
}

/**
 * Get distance between a point and a line on 1D plane.
 */
export function get1DPointToLineDistance(point: number, lineX: number, lineWidth: number) {
	if (point < lineX) return lineX - point;
	const lineEnd = lineX + lineWidth;
	if (point > lineEnd) return point - lineEnd;
	return 0;
}

/**
 * Extracts provider and id of a repository from package.json repository property.
 */
export function extractRepositoryData(data: RegistryRepository): RepositoryData | null {
	if (typeof data === 'string') {
		const groups = /^((?<provider>[\w\-]+):)?(?<id>[\w\-\.]+\/[\w\-\.]+)$/.exec(data)?.groups;
		return groups ? {provider: groups.provider?.toLowerCase() || 'github', id: groups.id!} : null;
	}

	const groups = /\/\/(?<provider>[\w\-\.]+)\/(?<id>[\w\-\.]+\/[\w\-\.]+)$/.exec(data.url)?.groups;
	if (groups) {
		const providerParts = groups.provider!.split('.');
		const id = groups.id!;
		const sanitizedId = ['.git', '.svn'].includes(id.slice(-4)) ? id.slice(0, -4) : id;
		return {
			provider: providerParts[providerParts.length - 2] || groups.provider!,
			id: sanitizedId,
		};
	}

	return null;
}

export interface RepositoryData {
	provider: string;
	id: string;
}

/**
 * Retrieves repository changelog. Currently only supports github releases.
 */
export async function getChangelog(
	repository: RepositoryData,
	{page = 1, perPage = 10} = {}
): Promise<ChangelogResponse | null> {
	if (repository.provider === 'github') {
		const [releases, response] = await fetchJsonResponse<GithubRelease[]>(
			`https://api.github.com/repos/${repository.id}/releases?per_page=${perPage}&page=${page}`,
			{headers: {accept: 'application/vnd.github.v3+json'}}
		);
		return {
			hasNextPage: !!response.headers.get('link')?.includes('rel="next"'),
			items: releases.map((release) => ({title: release.name || release.tag_name, ...release})),
		};
	}

	return null;
}

export interface ChangelogResponse {
	hasNextPage: boolean;
	items: ChangelogItem[];
}

export interface ChangelogItem {
	title: string;
	tag_name: string;
	created_at: string;
	published_at: string;
	body: string;
}

export interface GithubRelease {
	tag_name: string;
	name: string;
	created_at: string;
	published_at: string;
	body: string;
}

/**
 * Takes in an options object, and returns a new one containing only properties
 * that differ from defaults.
 *
 * Empty arrays are dropped.
 *
 * Returns undefined in case there is no difference.
 */
export function getOptionsDifference<T extends unknown>(options: T, defaults: unknown): Partial<T> | undefined {
	if (!options || typeof options !== 'object') return options === defaults ? undefined : options;

	if (Array.isArray(options)) {
		if (options.length === 0) return undefined;
		const newArray = Array.isArray(defaults) ? options.filter((item, index) => item !== defaults[index]) : options;
		return newArray.length > 0 ? (newArray as unknown as Partial<T>) : undefined;
	}

	if (!defaults || typeof defaults !== 'object') return JSON.parse(JSON.stringify(options));

	const result: Record<string, unknown> = {};
	let newPropsCount = 0;

	for (const [name, value] of Object.entries(options as any)) {
		const newValue = getOptionsDifference(value, (defaults as any)[name]);
		if (newValue !== undefined) {
			result[name] = newValue;
			newPropsCount++;
		}
	}

	return newPropsCount > 0 ? (result as Partial<T>) : undefined;
}
