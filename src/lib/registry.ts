import manifest from 'manifest';
import {fetchJson} from 'lib/utils';
import {pluginNameMeta} from 'lib/serialize';

// Registry response has an additional date property with last release date
export type PluginRegistryMeta = Omit<PluginMeta, 'date' | 'main'> & {date: string};

export interface PackageResponse {
	['dist-tags']: {latest: string};
	versions: {[key: string]: Manifest};
	time: {[key: string]: string};
	readme: string;
}

export interface SearchResponseItem extends ManifestBase {
	date: string; // 2020-04-20T09:47:59.999Z
	links?: {
		npm?: string;
		homepage?: string;
		repository?: string;
		bugs?: string;
	};
	publisher: RegistryUser;
}

export interface SearchResponse {
	objects: {
		package: SearchResponseItem;
		score: {
			final: number;
			detail: {quality: number; popularity: number; maintenance: number};
		};
		searchScore: number;
	}[];
	time: string; // Thu Jul 09 2020 16:06:13 GMT+0000 (UTC)
	total: number;
}

export interface SearchParams {
	query: string;
	page: number;
	size: number;
	officialOnly?: boolean;
}

export interface SearchResult {
	total: number;
	plugins: PluginRegistryMeta[];
}

export class Registry {
	url: string;

	constructor(url: string) {
		this.url = url;
	}

	protected async request(url: string, fetchOptions: Parameters<typeof fetch>[1]) {
		return await fetchJson(url, fetchOptions);
	}

	async search(
		{query, page, size, officialOnly}: SearchParams,
		fetchOptions?: Parameters<typeof fetch>[1]
	): Promise<SearchResult> {
		const from = size * page;
		let text = `${officialOnly ? `@${manifest.name} ` : ''}${query} keywords:${manifest.name}plugin`;
		const url = new URL(`${this.url}/-/v1/search`);
		url.searchParams.set('text', `${text}`);
		url.searchParams.set('from', `${from}`);
		url.searchParams.set('size', `${size}`);
		url.searchParams.set('popularity', '1.0');
		url.searchParams.set('maintenance', '0.0');
		url.searchParams.set('quality', '0.0');
		const body = (await this.request(url.href, fetchOptions)) as SearchResponse;

		return {
			total: body.total,
			plugins: body.objects.map((object) => ({
				...object.package,
				...pluginNameMeta(object.package.name),
				homepage: object.package?.links?.homepage,
				bugs: object.package?.links?.bugs,
			})),
		};
	}

	async meta(pluginName: string, fetchOptions?: Parameters<typeof fetch>[1]): Promise<PluginRegistryMeta> {
		const body = (await this.request(`${this.url}/${pluginName}`, fetchOptions)) as PackageResponse;
		const latestVersion = body['dist-tags'].latest;
		return {
			...body.versions[latestVersion],
			...pluginNameMeta(body.versions[latestVersion]!.name),
			version: latestVersion,
			readme: body.readme,
			date: body.time[latestVersion]!,
		};
	}

	async latestVersion(pluginName: string, fetchOptions?: Parameters<typeof fetch>[1]): Promise<string> {
		return ((await this.request(`${this.url}/${pluginName}/latest`, fetchOptions)) as Manifest).version;
	}
}

export const registry = new Registry('https://registry.npmjs.org');
