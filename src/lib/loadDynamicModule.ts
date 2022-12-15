import Path from 'path';
import {getAppPath} from 'lib/utils';
import type {toHTML} from 'dynamic/marked';
import type {compose} from 'dynamic/pluginTemplate';
import type {sanitize as DOMPurifySanitize} from 'dompurify';

const cache = new Map<string, any>();

/**
 * Utility to load big non-essential modules only when needed to not slow down
 * loading times. Also implements its own caching since we are clearing require
 * cache a lot in this app (each time plugins reload).
 */
export function loadDynamicModule(name: 'marked'): {toHTML: typeof toHTML; sanitize: typeof DOMPurifySanitize};
export function loadDynamicModule(name: 'pluginTemplate'): {compose: typeof compose};
export function loadDynamicModule(name: string) {
	if (cache.has(name)) return cache.get(name);

	const appPath = getAppPath();

	if (!appPath) throw new Error(`"appPath" is missing.`);

	// try/catch to silence esbuild
	try {
		const module = require(Path.join(appPath, 'dynamic', name));
		cache.set(name, module);
		return module;
	} catch (error) {
		throw error;
	}
}
