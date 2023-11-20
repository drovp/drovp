import {h, RenderableProps} from 'preact';
import {useMemo} from 'preact/hooks';
import {useLocation} from 'poutr';

export type NavOptions = RenderableProps<{
	class?: string;
	align?: 'left' | 'right' | 'center';
	variant?: Variant;
	style?: 'bar' | 'underline' | 'tabs';
}>;

export function Nav({class: className, align = 'center', variant, style = 'bar', children}: NavOptions) {
	let classNames = `Nav -${style} -${align}`;
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	return <nav class={classNames}>{children}</nav>;
}

export type NavLinkOptions = RenderableProps<{
	to: string;
	class?: string;
	mode?: 'push' | 'replace';
	activeMatch?: RegExp | boolean;
	variant?: Variant;
	tooltip?: string;
	onClick?: (to: string) => void;
	[key: string]: any;
}>;

export function NavLink({
	to,
	class: className,
	activeMatch,
	variant,
	mode = 'push',
	children,
	tooltip,
	onClick,
	...rest
}: NavLinkOptions) {
	const [{path, search}, _, history] = useLocation();
	const compareSearch = to.includes('?');
	let classNames = useMemo(() => `NavLink -to-${to.replace(/^\//, '').replace(/[^a-z0-9]+/g, '-')}`, [to]);

	function handleClick(event: Event) {
		event.preventDefault();
		if (onClick) onClick(to);
		else history[mode](to);
	}

	const isExact = activeMatch === true || (compareSearch ? `${path}${search}` : path) === to;

	if (variant) classNames += ` -${variant}`;
	if (className) classNames += ` ${className}`;
	if (isExact || (typeof activeMatch === 'object' && activeMatch.exec(path))) classNames += ' -active';
	if (isExact) classNames += ' -exact';

	return (
		<button class={classNames} onClick={handleClick} title={tooltip} {...rest}>
			<div class="bold-reserve">{children}</div>
			<div class="content">{children}</div>
		</button>
	);
}

export function NavLinkRelativePart({children}: RenderableProps<{}>) {
	return <span class="relative">{children}</span>;
}

export function NavSpacer() {
	return <span class="NavSpacer"></span>;
}
