import {h} from 'preact';
import {Markdown} from 'components/Markdown';

export function Instructions({instructions}: {instructions: string | undefined}) {
	return (
		<div class="Instructions TextContent">
			<Markdown contents={instructions || '*No instructions.*'} />
		</div>
	);
}
