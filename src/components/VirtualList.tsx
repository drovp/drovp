import {h, RenderableProps, RefObject, VNode} from 'preact';
import {useState, useRef, useLayoutEffect} from 'preact/hooks';
import {throttle, debounce} from 'lib/utils';
import {useCache, CACHE_IGNORE_KEY} from 'lib/hooks';
import {observeElementSize} from 'lib/elementSize';
import {Scrollable} from 'components/Scrollable';

const {min, ceil, floor} = Math;

export type VirtualListProps<T extends unknown> = RenderableProps<{
	class?: string;
	style?: string | {[key: string]: string};
	direction?: 'horizontal' | 'vertical';
	innerRef?: RefObject<HTMLDivElement>;
	items: T[];
	reversed?: boolean;
	/** Define to remember and restore scroll position. */
	scrollPositionId?: string;
	/** How many times more items ot render than is visible. */
	overProvision?: number;
	render: (item: T, index: number) => VNode;
}>;

export function VirtualList<T extends unknown = unknown>({
	items,
	render,
	class: className,
	style: passedStyle = '',
	direction = 'vertical',
	reversed,
	scrollPositionId,
	overProvision = 3,
	innerRef,
}: VirtualListProps<T>) {
	const containerRef = innerRef || useRef<HTMLDivElement>(null);
	// Initial dimensions are designed to initially render multiple items so that
	// we can retrieve the real dimensions and spacings.
	const isHorizontal = direction === 'horizontal';
	const [rawSpacing, setRawSpacing] = useState<number | null>(null);
	const [initScrollPosition, setInitScrollPosition] = useCache(scrollPositionId || CACHE_IGNORE_KEY, 0);
	const [scrollPosition, setScrollPosition] = useState(initScrollPosition);
	let [viewSizePx, setViewSizePx] = useState(10);
	if (viewSizePx < 1) viewSizePx = 1;
	const spacing = rawSpacing != null ? Math.max(rawSpacing, 1) : viewSizePx / 10;
	const visibleCount = ceil(viewSizePx / spacing);
	const renderCount = min(visibleCount * overProvision, items.length);
	const startIndex = min(
		floor(Math.max(0, scrollPosition - (renderCount / overProvision) * spacing) / spacing),
		items.length - renderCount
	);
	const startSpacing = `${Math.round(startIndex * spacing)}px`;
	const endSpacing = `${Math.round((items.length - startIndex - renderCount) * spacing)}px`;
	let style = `overflowX:${isHorizontal ? 'auto' : 'hidden'};overflowY:${
		isHorizontal ? 'hidden' : 'auto'
	};${passedStyle}`;

	const renderedItems: VNode[] = [];
	for (let i = startIndex; i < startIndex + renderCount; i++) {
		const item = items[reversed ? items.length - i - 1 : i];
		if (!item) throw new Error(`Missing item index ${i}.`);
		renderedItems.push(render(item, i));
	}

	useLayoutEffect(() => {
		const container = containerRef.current;

		if (!container) throw new Error();

		let isInitialized = false;
		const handleViewResize = throttle(() => {
			setViewSizePx(Math.max(container[isHorizontal ? 'clientWidth' : 'clientHeight'], 1));
		});
		const handleScroll = throttle(() => {
			const pos = container[isHorizontal ? 'scrollLeft' : 'scrollTop'];
			if (scrollPositionId) setInitScrollPosition(pos);
			setScrollPosition(pos);
		});
		const updateRawSpacing = () => {
			const item1 = container.children[1];
			const item2 = container.children[2];

			// Get spacing between items while ignoring spacers
			if (container.children.length >= 1 && item1 && item2) {
				const rect1 = item1.getBoundingClientRect();
				const rect2 = item2.getBoundingClientRect();
				setRawSpacing(isHorizontal ? rect2.left - rect1.left : rect2.top - rect1.top);
			}
		};
		const handleItemResize = throttle(updateRawSpacing);
		const handleChildrenMutation = debounce(() => {
			itemResizeDisposer();
			const firstRealChild = container.children[1];
			if (container.children.length >= 3 && firstRealChild) itemResizeDisposer.reconnect(firstRealChild);

			// Restore scroll position when requested
			if (!isInitialized && container && initScrollPosition !== 0) {
				isInitialized = true;
				container[isHorizontal ? 'scrollLeft' : 'scrollTop'] = initScrollPosition;
			}
		});

		const viewResizeDisposer = observeElementSize(container, handleViewResize);
		const itemResizeDisposer = observeElementSize(null, handleItemResize);
		const mutationObserver = new MutationObserver(handleChildrenMutation);

		mutationObserver.observe(container, {childList: true});
		container.addEventListener('scroll', handleScroll);

		// Initial initialization
		handleViewResize();
		updateRawSpacing();
		handleChildrenMutation();
		handleChildrenMutation.flush();

		return () => {
			handleViewResize.cancel();
			handleItemResize.cancel();
			viewResizeDisposer();
			itemResizeDisposer();
			mutationObserver.disconnect();
			container.removeEventListener('scroll', handleScroll);
		};
	}, []);

	return (
		<Scrollable class={className} style={style} direction={direction} innerRef={containerRef}>
			<div className="start-spacer" style={`${isHorizontal ? 'width' : 'height'}:${startSpacing}`}></div>
			{renderedItems}
			<div className="end-spacer" style={`${isHorizontal ? 'width' : 'height'}:${endSpacing}`}></div>
		</Scrollable>
	);
}
