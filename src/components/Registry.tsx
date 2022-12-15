import {h} from 'preact';
import {useState, useRef, useLayoutEffect} from 'preact/hooks';
import {useCache, useCachedState} from 'lib/hooks';
import {registry, SearchResult} from 'lib/registry';
import {eem} from 'lib/utils';
import {Spinner} from 'components/Spinner';
import {RouteProps, Redirect} from 'poutr';
import {Icon} from 'components/Icon';
import {Pagination} from 'components/Pagination';
import {Vacant} from 'components/Vacant';
import {Scrollable} from 'components/Scrollable';
import {PluginCards} from './PluginCards';
import {PluginRoute} from './Plugin';

const defaultPath = '/registry';

export function RegistryRoute(props: RouteProps) {
	const {match, location, history} = props;
	let [lastUrl, setLastUrl] = useCache<string>('registry.lastUrl', defaultPath);
	const id = match.groups?.id;

	// Click on the main nav button, needs to be triaged
	if (location.path === defaultPath && !id) {
		// If request is coming from within this section, go to default page.
		// If it's coming from other sections, use the last cached url we were on.
		const fromInside = history.from?.path.indexOf(defaultPath) === 0;
		const nextUrl = fromInside ? defaultPath : lastUrl;
		if (nextUrl !== location.path) return <Redirect to={nextUrl} />;
	}

	setLastUrl(location.href);

	return id ? <PluginRoute {...props} /> : <Registry {...props} />;
}

interface Search {
	value: string;
	page: number;
}

interface Response {
	error?: string;
	result?: SearchResult;
}

const ITEMS_PER_PAGE = 12;
const composeCacheId = (value: string, page: number) => `registrySearchResults.${value}.${page}`;

function Registry({location, history}: RouteProps) {
	const [search, setSearch] = useCache<Search>('registrySearch', {value: '', page: 0});
	const value = location.searchParams.get('search')?.trim() ?? search.value;
	let page = Number(location.searchParams.get('page')) ?? search.page;
	const cacheId = composeCacheId(value, page);
	const [response, setResponse] = useCachedState<Response | null>(cacheId, null);
	const [inputValue, setInputValue] = useState<string>(value);
	const [isLoading, setIsLoading] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const error = response?.error;
	const result = response?.result;

	/**
	 * Fills cache with requested query.
	 */
	useLayoutEffect(() => {
		// Skip on cached result
		if (!response || response.error) query(value, page);
		else setIsLoading(false);
	}, [cacheId]);

	async function query(search: string, page: number) {
		const abortController = abortControllerRef.current;
		if (abortController) abortController.abort();

		setSearch({value: search, page});
		setResponse(null);
		setIsLoading(true);

		try {
			abortControllerRef.current = new AbortController();
			const result = await registry.search(
				{query: search, size: ITEMS_PER_PAGE, page},
				{signal: abortControllerRef.current.signal}
			);
			abortControllerRef.current = null;
			setResponse({result});
		} catch (error) {
			setResponse({error: eem(error)});
		}

		setIsLoading(false);
	}

	function handleSearch() {
		// Reset scrollbar
		resultsRef.current?.scrollTo({top: 0});

		// If value changed, reset page
		if (inputValue !== value) page = 0;

		// In case of same search, re-query the results
		const newCacheId = composeCacheId(inputValue, page);
		if (newCacheId === cacheId) query(inputValue, page);
		else history.push(`/registry?search=${inputValue}&page=${page}`);
	}

	function handleCancel() {
		setInputValue('');
		setSearch({value: '', page: 0});
		history.push('/registry');
	}

	function handleSetPage(newPage: number) {
		page = newPage;
		handleSearch();
	}

	return (
		<section class="Registry">
			<div class="search-bar" onClick={() => inputRef.current?.focus()}>
				<input
					ref={inputRef}
					placeholder="Search"
					value={inputValue}
					onInput={(event) => setInputValue(event.currentTarget.value)}
					onKeyDown={(event) => {
						event.key === 'Enter' && handleSearch();
						event.key === 'Escape' && handleCancel();
					}}
				/>
				{value && (
					<button class="cancel" onClick={handleCancel}>
						<Icon name="x" />
					</button>
				)}
				<button class="search" onClick={handleSearch}>
					<Icon name="search" />
				</button>
			</div>

			<Scrollable class={`results ${isLoading ? '-loading' : ''}`} innerRef={resultsRef}>
				{isLoading ? (
					<Spinner />
				) : error ? (
					<Vacant
						title={error}
						variant="danger"
						actions={[{title: 'Try again', icon: 'refresh', transparent: true, action: handleSearch}]}
					/>
				) : result && result.plugins.length > 0 ? (
					<PluginCards section="registry" plugins={result.plugins} markInstalled />
				) : (
					<Vacant
						title="No results"
						actions={[{title: 'Refresh', icon: 'refresh', transparent: true, action: handleSearch}]}
					>
						{`Query "`}
						<strong>{value}</strong>
						{`" returned 0 results.`}
					</Vacant>
				)}
			</Scrollable>

			{result && (
				<Pagination
					page={page}
					total={Math.floor(result.total / ITEMS_PER_PAGE)}
					onChange={handleSetPage}
					disabled={isLoading}
				/>
			)}
		</section>
	);
}
