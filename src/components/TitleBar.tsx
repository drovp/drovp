import {h, RenderableProps} from 'preact';
import {Help} from 'components/Icon';

type TitleBarProps = RenderableProps<{
	class?: string;
	variant?: Variant;
	value?: string;
	tooltip?: string;
	help?: string;
}>;

export function TitleBar({class: className, variant, tooltip, children, value, help}: TitleBarProps) {
	let classNames = 'TitleBar';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<div class={classNames}>
			<span class="title" title={tooltip}>
				{children}
			</span>
			{value && (
				<span class="value" title={value}>
					<span>{value}</span>
				</span>
			)}
			{help && (
				<span class="help">
					<Help tooltip={help} />
				</span>
			)}
		</div>
	);
}
