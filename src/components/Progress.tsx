import {h, RenderableProps, ComponentChildren} from 'preact';
import {clamp} from 'lib/utils';

export type ProgressProps = RenderableProps<{
	class?: string;
	completed?: number;
	variant?: Variant;
	transparent?: boolean; // no background
	indeterminate?: boolean; // stripes over bar
	paused?: boolean; // indeterminate stripes stop moving
	labelLeft?: ComponentChildren;
	label?: ComponentChildren;
	labelRight?: ComponentChildren;
	tooltip?: string;
	onClick?: (event: MouseEvent) => void;
}>;

export function Progress({
	class: className,
	completed = 0,
	variant,
	transparent,
	indeterminate,
	paused,
	labelLeft,
	label,
	labelRight,
	tooltip,
	onClick,
}: ProgressProps) {
	let classNames = 'Progress';

	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (transparent) classNames += ' -transparent';
	if (indeterminate) classNames += ' -indeterminate';
	if (paused) classNames += ' -paused';
	if (onClick) classNames += ' -hoverable';

	// So that background doesn't peak through rounded corners
	if (completed > 0) classNames += ' -round-more-left';
	if (completed >= 1) classNames += ' -round-more-right';

	const hasLabels = labelLeft || label || labelRight;

	return (
		<div class={classNames} onClick={onClick} title={tooltip}>
			{hasLabels && (
				<div class="labels">
					{labelLeft && <div class="left">{labelLeft}</div>}
					{label && <div class="center">{label}</div>}
					{labelRight && <div class="right">{labelRight}</div>}
				</div>
			)}
			{completed != null && completed > 0 && (
				<div
					class="bar labels"
					style={{clipPath: `inset(0% ${clamp(0, 1 - completed, 1) * 100}% 0 0 round var(--border-radius))`}}
				>
					{labelLeft && <div class="left">{labelLeft}</div>}
					{label && <div class="center">{label}</div>}
					{labelRight && <div class="right">{labelRight}</div>}
				</div>
			)}
		</div>
	);
}
