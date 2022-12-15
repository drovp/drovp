import {sep} from 'path';
import {h, ComponentChild} from 'preact';
import {useMemo} from 'preact/hooks';
import {Item} from 'models/items';
import type {Item as RawItemModel} from '@drovp/types';

type ItemTitleProps = {
	item: Item | RawItemModel;
	class?: string;
	compact?: boolean;
	tooltip?: false | string;
};

export function ItemTitle({item, class: className, compact, tooltip}: ItemTitleProps) {
	return useMemo(() => {
		let defaultTooltip: string | undefined;
		let content: ComponentChild[] = [];

		switch (item.kind) {
			case 'file':
			case 'directory':
				const pathParts = item.path.split(/[\/\\]/);
				const basename = pathParts.pop();
				const dirname = pathParts.reverse().join(sep);
				content.push(<div class="fixed">{basename}</div>);
				if (!compact) content.push(<div class="relative">{dirname}</div>);
				defaultTooltip = item.path;
				break;

			case 'string':
				content.push('"', <div class="fixed">{item.contents.slice(0, 200)}</div>, '"');
				defaultTooltip = `Text with ${item.contents.length} characters`;
				break;

			case 'url':
				content.push(<div class="fixed">{item.url}</div>);
				defaultTooltip = item.url;
				break;

			case 'blob':
				defaultTooltip = 'Binary blob';
				content.push('{', <em>{item.mime}</em>, '}');
				break;

			case 'error':
				defaultTooltip = 'Error';
				content.push(<div class="fixed">{item.message}</div>);
				break;

			case 'warning':
				defaultTooltip = 'Warning';
				content.push(<div class="fixed">{item.message}</div>);
				break;

			default:
				defaultTooltip = 'unknown item';
				content.push(<em>unknown</em>);
		}

		let classNames = 'ItemTitle RelativeTitle';
		if (className) classNames += ` ${className}`;

		return (
			<div className={classNames} title={tooltip === false ? undefined : tooltip || defaultTooltip}>
				{content}
			</div>
		);
	}, [item, className, compact]);
}
