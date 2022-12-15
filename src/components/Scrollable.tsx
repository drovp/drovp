import {h, RenderableProps, JSX} from 'preact';
import {useEffect, useRef, Ref} from 'preact/hooks';
import {observeElementSize} from 'lib/elementSize';

export type ScrollableProps = Omit<
	JSX.IntrinsicElements['div'] &
		RenderableProps<{
			class?: string;
			auto?: boolean;
			direction?: 'horizontal' | 'vertical';
			style?: string;
			innerRef?: Ref<HTMLDivElement | null>;
			dangerouslySetInnerHTML?: {__html: string};
		}>,
	'ref'
>;

export function Scrollable({
	children,
	innerRef,
	class: className,
	style,
	auto,
	direction = 'vertical',
	dangerouslySetInnerHTML,
	...rest
}: ScrollableProps) {
	const ref = innerRef || useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;

		const isVertical = direction !== 'horizontal';
		const container = ref.current;

		let wasAtTop: boolean | null = null;
		let wasAtBottom: boolean | null = null;
		let wasScrollable: boolean | null = null;
		const leeway = 6;

		function check() {
			// These are all naive checks and un-reliable values due to all the
			// quirks around scrolling properties and dimensions. But they should
			// work for majority of use cases.
			const scrollStartMax = isVertical
				? container.scrollHeight - container.clientHeight
				: container.scrollWidth - container.clientWidth;
			const isScrollable = scrollStartMax > leeway;
			const isAtStart = !isScrollable || container[isVertical ? 'scrollTop' : 'scrollLeft'] < leeway;
			const isAtEnd =
				!isScrollable || container[isVertical ? 'scrollTop' : 'scrollLeft'] >= scrollStartMax - leeway;

			if (isScrollable !== wasScrollable) {
				container.classList[isScrollable ? 'add' : 'remove']('-scrollable');
				wasScrollable = isScrollable;
			}
			if (isAtStart !== wasAtTop) {
				container.classList[isAtStart ? 'remove' : 'add'](`-overflow-${isVertical ? 'top' : 'left'}`);
				wasAtTop = isAtStart;
			}
			if (isAtEnd !== wasAtBottom) {
				container.classList[isAtEnd ? 'remove' : 'add'](`-overflow-${isVertical ? 'bottom' : 'right'}`);
				wasAtBottom = isAtEnd;
			}
		}

		// Initial set on load
		check();

		// Set on scroll & resize
		const disposeElementResizeObserver = observeElementSize(ref.current, check);
		container.addEventListener('scroll', check);

		return () => {
			disposeElementResizeObserver();
			container.removeEventListener('scroll', check);
		};
	}, [ref, ref.current]);

	let classNames = `Scrollable -${direction}`;
	if (className) classNames += ` ${className}`;
	if (auto) classNames += ` -auto`;

	return (
		<div {...rest} class={classNames} ref={ref} style={style} dangerouslySetInnerHTML={dangerouslySetInnerHTML}>
			{dangerouslySetInnerHTML ? undefined : children}
		</div>
	);
}
