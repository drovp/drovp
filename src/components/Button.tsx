import {h, RenderableProps, VNode} from 'preact';
import {TargetedEvent} from 'lib/utils';
import {Ref} from 'preact/hooks';
import {Spinner} from 'components/Spinner';

interface ButtonBaseProps {
	class?: string;
	variant?: Variant;
	block?: boolean;
	multiline?: boolean;
	semitransparent?: boolean;
	outline?: boolean;
	underline?: boolean;
	dashed?: boolean;
	transparent?: boolean;
	selected?: boolean;
	muted?: boolean; // muted color for non hover/active state
	loading?: boolean;
	large?: boolean;
	active?: boolean;
	disabled?: boolean;
	tooltip?: string;
}

export type ButtonPropsHref = RenderableProps<
	ButtonBaseProps & {
		innerRef?: Ref<HTMLAnchorElement | null>;
		href: string;
		onClick?: undefined;
		onMouseDown?: (event: TargetedEvent<HTMLAnchorElement, MouseEvent>) => void;
	}
>;

export type ButtonPropsClick = RenderableProps<
	ButtonBaseProps & {
		innerRef?: Ref<HTMLButtonElement | null>;
		href?: undefined;
		onClick?: (event: TargetedEvent<HTMLButtonElement, MouseEvent>) => void;
		onMouseDown?: (event: TargetedEvent<HTMLButtonElement, MouseEvent>) => void;
	}
>;

export function Button(props: ButtonPropsHref): VNode;
export function Button(props: ButtonPropsClick): VNode;
export function Button({
	class: className,
	variant,
	multiline,
	semitransparent,
	transparent,
	outline,
	underline,
	large,
	dashed,
	muted,
	children,
	loading,
	selected,
	innerRef,
	tooltip,
	onClick,
	href,
	active,
	disabled,
	...rest
}: ButtonPropsClick | ButtonPropsHref) {
	let classNames = 'Button';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (multiline) classNames += ' -multiline';
	if (semitransparent) classNames += ' -semitransparent';
	if (transparent) classNames += ' -transparent';
	if (muted) classNames += ' -muted';
	if (selected) classNames += ' -selected';
	if (loading) classNames += ' -loading';
	if (outline) classNames += ' -outline';
	if (underline) classNames += ' -underline';
	if (dashed) classNames += ' -dashed';
	if (active) classNames += ' -active';
	if (disabled) classNames += ' -disabled';
	if (large) classNames += ' -large';

	// Transform strings into spans so that we can flexbox the content properly
	// This wouldn't be necessary if browsers were able to fucking center the
	// fucking text flowing content... `vertical-align: middle` is a bad joke!
	if (children) {
		if (typeof children === 'string') {
			children = <span class="txt">{children.trim()}</span>;
		} else if (Array.isArray(children)) {
			for (let i = 0; i < children.length; i++) {
				const content = children[i];
				if (typeof content === 'string') children[i] = <span class="txt">{content.trim()}</span>;
			}
		}
	}

	function handleClick(event: MouseEvent) {
		if (href && disabled) {
			event.preventDefault();
			event.stopPropagation();
		}
		if (!disabled) onClick?.(event as any);
	}

	return href ? (
		<a
			{...(rest as any)}
			class={classNames}
			href={href}
			ref={innerRef as any}
			title={tooltip}
			onClick={handleClick}
		>
			{children}
			{loading && <Spinner class="loading" />}
		</a>
	) : (
		<button
			{...(rest as any)}
			onClick={handleClick}
			class={classNames}
			ref={innerRef as any}
			title={tooltip}
			disabled={disabled}
		>
			{children}
			{loading && <Spinner class="loader" />}
		</button>
	);
}
