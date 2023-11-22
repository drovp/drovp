import {h} from 'preact';
import {useState, useMemo, useEffect, useLayoutEffect, useRef} from 'preact/hooks';
import {
	eem,
	extractRepositoryData,
	ChangelogResponse,
	getChangelog,
	formatDate,
	animationVolleyVisible,
} from 'lib/utils';
import {Vacant} from 'components/Vacant';
import {Spinner} from 'components/Spinner';
import {Markdown} from 'components/Markdown';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';

export function Changelog({repository, currentVersion}: {repository?: RegistryRepository; currentVersion?: string}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const repoData = useMemo(() => (repository ? extractRepositoryData(repository) : null), [repository]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<{message: string; details?: string} | null>(null);
	const [changelog, setChangelog] = useState<ChangelogResponse | null>(null);
	const [page, setPage] = useState(1);

	useEffect(() => {
		if (repoData) {
			setIsLoading(true);
			setError(null);
			getChangelog(repoData, {page})
				.then(setChangelog)
				.catch((error) => setError({message: `Error fetching changelog:`, details: eem(error)}))
				.finally(() => setIsLoading(false));
		} else {
			setError({
				message: `Can't locate plugin's repository, because the repository field in plugin's manifest file is invalid:`,
				details: repository ? JSON.stringify(repository, null, 2) : `${repository}`,
			});
		}
	}, [repoData, page]);

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (container)
			animationVolleyVisible(container, {
				animation: [
					{transform: 'translateX(100px)', opacity: 0},
					{transform: 'translateX(0px)', opacity: 1},
				],
				fill: 'backwards' as const,
			});
	}, [changelog]);

	return (
		<div ref={containerRef} class="Changelog">
			{isLoading ? (
				<Spinner />
			) : error ? (
				<Vacant variant="danger" title="Error" details={error.details}>
					{error.message}
				</Vacant>
			) : changelog ? (
				changelog.items.length > 0 ? (
					changelog.items.map((item) => {
						const tag = item.tag_name[0] === 'v' ? item.tag_name.slice(1) : item.tag_name;
						const isCurrentVersion = currentVersion === tag;

						return (
							<article class={isCurrentVersion ? '-current' : undefined}>
								<header title={isCurrentVersion ? `Current version` : undefined}>
									<hgroup>
										<h1>
											{item.tag_name === item.title || tag === item.title
												? item.title
												: `${tag}: ${item.title}`}
										</h1>
										{isCurrentVersion && <Icon name="tag" />}
										<h2 title={item.published_at}>{formatDate(item.published_at)}</h2>
									</hgroup>
								</header>
								<Markdown class="body TextContent" contents={item.body || ''} />
							</article>
						);
					})
				) : (
					<Vacant title="Empty">
						Changelog is either empty, or plugin is not using github's releases to publish its changelogs.
					</Vacant>
				)
			) : (
				<Vacant title="Unsupported">
					Plugin doesn't seem to be using github's releases to publish its changelogs.
				</Vacant>
			)}
			{(page > 1 || changelog?.hasNextPage) && (
				<div class="pagination">
					{page > 2 && (
						<Button class="start" transparent onClick={() => setPage(1)}>
							<Icon name="to-start" />
						</Button>
					)}
					{page > 1 && (
						<Button class="prev" transparent onClick={() => setPage(page - 1)}>
							<Icon name="chevron-left" />
						</Button>
					)}
					{changelog?.hasNextPage && (
						<Button class="next" transparent onClick={() => setPage(page + 1)}>
							<Icon name="chevron-right" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
