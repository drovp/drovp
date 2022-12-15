import {h, RenderableProps} from 'preact';
import {Scrollable} from 'components/Scrollable';

export type PreProps = RenderableProps<{
	class?: string;
	variant?: Variant;
}>;

export function Pre({class: className = '', variant, children}: PreProps) {
	return (
		<Scrollable class={`Pre ${className}${variant ? ` -${variant}` : ''}`}>
			<pre>
				<code>{children}</code>
			</pre>
		</Scrollable>
	);
}
