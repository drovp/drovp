import {h, RenderableProps} from 'preact';

export type TagProps = RenderableProps<{
	class?: string;
	variant?: Variant;
	tooltip?: string;
}>;

export function Tag({class: className, tooltip, variant, children}: TagProps) {
	let classNames = 'Tag';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	return (
		<div class={classNames} title={tooltip}>
			{children}
		</div>
	);
}
