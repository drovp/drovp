import {h, RenderableProps} from 'preact';

type TitleBarProps = RenderableProps<{
	class?: string;
	variant?: Variant;
	value?: string;
	tooltip?: string;
}>;

export function TitleBar({class: className, variant, tooltip, children, value}: TitleBarProps) {
	let classNames = 'TitleBar';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<div class={classNames}>
			<span class="title" title={tooltip}>{children}</span>
			{value && <span class="value" title={value}>{value}</span>}
		</div>
	);
}
