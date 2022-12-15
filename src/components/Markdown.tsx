import {h, RenderableProps} from 'preact';
import {useMemo} from 'preact/hooks';
import {isOfType} from 'lib/utils';
import {loadDynamicModule} from 'lib/loadDynamicModule';

export type MarkdownProps = RenderableProps<{
	class?: string;
	contents: string | null | undefined;
}>;

const cache = new Map<string, string>();

export function Markdown({class: className, contents}: MarkdownProps) {
	const readmeHtml = useMemo<string>(() => {
		if (typeof contents === 'string') {
			const cached = cache.get(contents);
			if (cached != null) return cached;

			const {toHTML, sanitize} = loadDynamicModule('marked');
			const result = sanitize(toHTML(contents, {breaks: true})) || '';

			cache.set(contents, result);

			return result;
		}

		return '';
	}, [contents]);

	// Prevent non-http(s) links from hijacking app navigation
	function handleOnClick(event: MouseEvent) {
		const target = event.target;
		if (isOfType<HTMLAnchorElement>(target, (target as any)?.nodeName === 'A')) {
			const href = target.getAttribute('href') ?? '';

			if (!href.match(/^https?:\/\/.*/)) {
				event.preventDefault();
				event.stopPropagation();
			}

			// Scroll to id
			if (href[0] === '#') {
				const scrollTarget = document.querySelector<HTMLElement>(href);
				if (scrollTarget) scrollTarget.scrollIntoView({behavior: 'smooth'});
			}
		}
	}

	let classNames = 'TextContent Markdown';
	if (className) classNames += ` ${className}`;

	return <div class={classNames} onClick={handleOnClick} dangerouslySetInnerHTML={{__html: readmeHtml}} />;
}
