import {h, render} from 'preact';
import {useState, useRef, Ref, MutableRef, useEffect, useMemo} from 'preact/hooks';
import {TargetedEvent, getBoundingRect, prevented, rafThrottle, isInsideElement} from 'lib/utils';
import {makeScroller, Scroller} from 'element-scroller';
import {useDraggingState} from 'lib/hooks';
import {openContextMenu, ContextMenuItem} from 'lib/contextMenus';
import {Icon} from 'components/Icon';
import {Scrollable} from 'components/Scrollable';
import {useStore} from 'models/store';

const longDragEnterWaiters = new Set<HTMLElement>();

export interface Tab {
	id: string;
	title: string;
}

export function Tabs({
	tabs,
	class: className,
	activeId,
	keepOne,
	onActivate,
	onRename,
	onMove,
	onAdd,
	onDelete,
	onLongDragEnter,
	dragTarget,
	onMouseUp,
	onDrop,
	contextMenuItems,
}: {
	tabs: Tab[];
	class?: string;
	activeId: string;
	keepOne?: boolean;
	onActivate: (id: string) => void;
	onRename?: (id: string, title: string) => void;
	onMove?: (from: number, to: number) => void;
	onAdd?: (title: string, index: number) => void;
	onDelete?: (id: string) => void;
	onLongDragEnter?: (id: string) => void;
	dragTarget?: boolean;
	onMouseUp?: (id: string) => void;
	onDrop?: (id: string, event: DragEvent) => void;
	contextMenuItems?: ContextMenuItem[];
}) {
	const {modals} = useStore();
	const [showList, setShowList] = useState(false);
	const [renderStartMover, setRenderStartMover] = useState(false);
	const [renderEndMover, setRenderEndMover] = useState(false);
	const isGlobalDragging = useDraggingState();
	const [isInternalDragging, setIsInternalDragging] = useState(false);
	const isDragging = isGlobalDragging || isInternalDragging;
	const tabsRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listAnchorRef = useRef<HTMLButtonElement>(null);
	const tabsScrollerRef = useRef<Scroller | null>(null);
	const contextScrollerRef = useRef<Scroller | null>(null);
	const allowDelete = !keepOne || tabs.length > 1;

	useEffect(() => {
		const activeElement = tabsRef.current?.querySelector('.-active');
		if (activeElement) (activeElement as any).scrollIntoViewIfNeeded?.();
	}, [activeId]);

	useEffect(() => {
		const tabsContainer = tabsRef.current;
		if (!tabsContainer) return;
		const scroller = makeScroller(tabsContainer, {handleWheel: true, flipWheel: true});
		tabsScrollerRef.current = scroller;
		return () => {
			scroller.dispose();
			tabsScrollerRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!isDragging) return;

		const container = (showList ? listRef.current : tabsRef.current)!;
		const positionProp = showList ? 'scrollTop' : 'scrollLeft';
		const posMax = showList
			? container.scrollHeight - container.clientHeight
			: container.scrollWidth - container.clientWidth;

		const decideMovers = () => {
			const position = container[positionProp];
			setRenderStartMover(position > 0);
			setRenderEndMover(position < posMax);
		};

		container.addEventListener('scroll', decideMovers);

		decideMovers();

		return () => {
			container.removeEventListener('scroll', decideMovers);
			setRenderStartMover(false);
			setRenderEndMover(false);
		};
	}, [isDragging, showList]);

	function handlePointerDown(event: TargetedEvent<HTMLElement, PointerEvent>) {
		if (event.button !== 0 || !onMove) return;
		let dragContext = getDragContext(event.target);
		if (!dragContext) return;
		event.preventDefault();
		event.stopPropagation();
		const {container, draggedElement, index: draggedIndex, tabElements, action} = dragContext;
		let targetIndex = draggedIndex;
		const containerRect = container.getBoundingClientRect();
		const isVertical = container.dataset.dragDirection === 'vertical';
		const scroll = {left: container.scrollLeft, top: container.scrollTop};
		const rects = tabElements.map((element) => getPositionContext(element, container, isVertical));
		const spacing = rects.length > 1 ? rects[1]!.start - rects[0]!.end : 0;
		const draggedRect = rects.find((rect) => rect.element === draggedElement)!;
		const initialX = event.x - containerRect.left + scroll.left;
		const initialY = event.y - containerRect.top + scroll.top;
		const initialPos = isVertical ? initialY : initialX;
		const cursor = {initialX, x: initialX, initialY, y: initialY, initialPos, pos: initialPos};
		let isClick = true;

		// Apply styles
		container.classList.add('-dragging');
		for (const element of tabElements) {
			if (element === draggedElement) {
				element.classList.add('-dragged');
				element.style.position = 'relative';
				element.style.zIndex = '2';
			} else {
				element.style.transition = 'transform 100ms ease-out';
			}
		}

		const handleScroll = () => {
			const deltaX = container.scrollLeft - scroll.left;
			const deltaY = container.scrollTop - scroll.top;
			scroll.top += deltaY;
			scroll.left += deltaX;
			cursor.y += deltaY;
			cursor.x += deltaX;
			cursor.pos = isVertical ? cursor.y : cursor.x;
			updateStyles();
		};

		const updateStyles = rafThrottle(() => {
			const translateFunction = `translate${isVertical ? 'Y' : 'X'}`;
			const cursorDelta = Math.round(cursor.pos - cursor.initialPos);

			// Dragged element simply mirrors cursor position
			draggedElement.style.transform = `${translateFunction}(${cursorDelta}px)`;

			// Find element that has at least half of its width covered by dragged element
			const draggedLeftEdge = draggedRect.start + cursorDelta;
			const draggedRightEdge = draggedLeftEdge + draggedRect.size;

			parent: for (let i = 0; i < rects.length; i++) {
				const {center} = rects[i]!;

				if (i < draggedIndex) {
					if (center >= draggedLeftEdge) {
						targetIndex = i;
						break;
					}
				} else {
					for (let i = rects.length - 1; i >= draggedIndex; i--) {
						const {center} = rects[i]!;
						if (center <= draggedRightEdge) {
							targetIndex = i;
							break parent;
						}
					}
					targetIndex = draggedIndex;
					break;
				}
			}

			// Shift element
			const shiftStart = Math.min(draggedIndex, targetIndex);
			const shiftEnd = Math.max(draggedIndex, targetIndex);

			for (let i = 0; i < rects.length; i++) {
				const {element} = rects[i]!;
				if (element === draggedElement) continue;
				const isBetween = i >= shiftStart && i <= shiftEnd;
				const shiftLeft = draggedIndex < targetIndex;
				element.style.transform = `${translateFunction}(${
					isBetween ? (draggedRect.size + spacing) * (shiftLeft ? -1 : 1) : 0
				}px)`;
			}
		});

		const handleMove = (event: PointerEvent) => {
			cursor.x = event.x - containerRect.left + scroll.left;
			cursor.y = event.y - containerRect.top + scroll.top;
			cursor.pos = isVertical ? cursor.y : cursor.x;

			// If mouse traveled too much between mouse down->up, don't consider this a click anymore
			if (isClick && Math.hypot(cursor.x - cursor.initialX, cursor.y - cursor.initialY) > 5) {
				isClick = false;
				setIsInternalDragging(true);
			}

			updateStyles();
		};

		const handleUp = (event: PointerEvent) => {
			container.classList.remove('-dragging');
			for (const element of tabElements) {
				if (element === draggedElement) element.classList.remove('-dragged');
				element.style.cssText = '';
			}

			setIsInternalDragging(false);
			removeEventListener('pointermove', handleMove);
			removeEventListener('pointerup', handleUp);
			removeEventListener('pointercancel', handleUp);
			container.removeEventListener('scroll', handleScroll);

			// Handle click action
			if (isClick) {
				if (action) {
					switch (action.type) {
						case 'activate':
							onActivate(action.id);
							break;
						case 'delete':
							onDelete?.(action.id);
							break;
					}
				}
			} else {
				const dragContext = getDragContext(event.target);
				if (dragContext) onMouseUp?.(dragContext.id);
			}

			// Handle move
			if (onMove && draggedIndex !== targetIndex) onMove(draggedIndex, targetIndex);
		};

		addEventListener('pointermove', handleMove);
		addEventListener('pointerup', handleUp);
		addEventListener('pointercancel', handleUp);
		container.addEventListener('scroll', handleScroll);
	}

	function handleButtonDragEnter(event: TargetedEvent<HTMLButtonElement, DragEvent>) {
		const element = event.currentTarget;
		if (longDragEnterWaiters.has(element)) return;
		const dragContext = getDragContext(element);

		if (!dragContext) return;

		const cancel = () => {
			clearTimeout(timeoutId);
			element.removeEventListener('dragleave', handleLeave);
			longDragEnterWaiters.delete(element);
		};
		const trigger = () => {
			cancel();
			onLongDragEnter?.(dragContext.id);
		};
		const handleLeave = (event: DragEvent) => {
			if (!isInsideElement(element, event)) cancel();
		};
		let timeoutId = setTimeout(trigger, 300);
		longDragEnterWaiters.add(element);
		element.addEventListener('dragleave', handleLeave);
	}

	function handleDrop(event: DragEvent) {
		const dragContext = getDragContext(event.currentTarget);
		if (!dragContext) return;
		onDrop?.(dragContext.id, event);
	}

	async function addTab(index: number) {
		const result = await modals.prompt({title: 'New tab title'});
		if (!result.canceled) onAdd?.(result.payload, index);
	}

	async function renameTab(tab: Tab) {
		const result = await modals.prompt({title: 'New tab title'}, {default: tab.title});
		if (!result.canceled) onRename?.(tab.id, result.payload);
	}

	function handleContextMenu(event: MouseEvent) {
		const items: ContextMenuItem[] = [];

		const dragContext = getDragContext(event.target);
		if (dragContext) {
			const tab = tabs.find((tab) => tab.id === dragContext.id);
			if (!tab) return;

			if (onRename) items.push({label: 'Rename tab', click: () => renameTab(tab)});
			if (onDelete && allowDelete) items.push({label: 'Delete tab', click: () => onDelete(tab.id)});
			if (onAdd) {
				if (items.length > 0) items.push({type: 'separator'});
				items.push({label: 'Add tab', click: () => addTab(dragContext.index)});
			}
		} else {
			if (onAdd) items.push({label: 'Add tab', click: () => addTab(tabs.length)});
		}

		if (contextMenuItems) {
			if (items.length > 0) items.push({type: 'separator'});
			items.push(...contextMenuItems);
		}

		if (items.length === 0) return;

		event.preventDefault();
		event.stopPropagation();

		openContextMenu(items);
	}

	function handleAdd(event: MouseEvent) {
		addTab(tabs.length);
		event.preventDefault();
	}

	function handleShowList(event: MouseEvent) {
		setShowList(!showList);
		event.preventDefault();
	}

	function handleMoveInit(event: TargetedEvent<HTMLDivElement>) {
		const target = event.currentTarget;
		const container = target.parentElement!.querySelector<HTMLDivElement>('.buttons');
		if (!container) throw new Error(`Missing container, can't auto-move.`);
		const isVertical = container.dataset.dragDirection === 'vertical';
		const pixelsPerSecond = 300 * (target.dataset.direction === 'end' ? 1 : -1);
		const maxScroll = isVertical
			? container.scrollHeight - container.clientHeight
			: container.scrollWidth - container.clientWidth;
		const scroller = isVertical ? contextScrollerRef.current : tabsScrollerRef.current;

		if (!scroller) return;

		const cleanup = () => {
			scroller.stop();
			window.removeEventListener('drop', cleanup);
			window.removeEventListener('mouseup', cleanup);
			target.removeEventListener('dragleave', cleanup);
			target.removeEventListener('mouseleave', cleanup);
			container.removeEventListener('scroll', detectEnd);
		};

		const detectEnd = () => {
			const position = isVertical ? container.scrollTop : container.scrollLeft;
			if (position === 0 || position >= maxScroll) cleanup();
		};

		window.addEventListener('drop', cleanup);
		window.addEventListener('mouseup', cleanup);
		target.addEventListener('dragleave', cleanup);
		target.addEventListener('mouseleave', cleanup);
		container.addEventListener('scroll', detectEnd);
		scroller.glide(isVertical ? {top: pixelsPerSecond} : {left: pixelsPerSecond});
	}

	let classNames = 'Tabs';
	if (className) classNames += ` ${className}`;
	if (dragTarget) classNames += ` -dragTarget`;

	return (
		<div class={classNames} onContextMenu={handleContextMenu}>
			<div class="tabs">
				<Scrollable
					direction="horizontal"
					class="buttons"
					innerRef={tabsRef}
					onPointerDown={handlePointerDown}
					onTouchStart={prevented()}
				>
					{tabs.map((tab, index) => (
						<button
							key={tab.id}
							class={`TabsButton${tab.id === activeId ? ' -active' : ''}`}
							data-tab-index={index}
							data-id={tab.id}
							data-click-action="activate"
							title={tab.title}
							onDragEnter={handleButtonDragEnter}
							onDrop={handleDrop}
							onClick={(event) => event.preventDefault()}
						>
							{tab.title}
						</button>
					))}
				</Scrollable>
				{renderStartMover && (
					<div
						key="mover-start"
						class="mover"
						data-direction="start"
						onDragEnter={handleMoveInit}
						onMouseEnter={handleMoveInit}
					/>
				)}
				{renderEndMover && (
					<div
						key="mover-end"
						class="mover"
						data-direction="end"
						onDragEnter={handleMoveInit}
						onMouseEnter={handleMoveInit}
					/>
				)}
			</div>
			<div class="controls">
				{onAdd && (
					<button class="TabsButton add" onClick={handleAdd} title="Add tab">
						<Icon name="plus" />
					</button>
				)}
				<div class="spacer" />
				<button
					ref={listAnchorRef}
					class={`TabsButton showList${showList ? ' -active' : ''}`}
					onClick={handleShowList}
					title="Show list of tabs"
				>
					<Icon name={showList ? 'chevron-up' : 'chevron-down'} />
				</button>
			</div>
			{showList && (
				<List
					listRef={listRef}
					anchorRef={listAnchorRef}
					scrollerRef={contextScrollerRef}
					tabs={tabs}
					handlePointerDown={handlePointerDown}
					handleContextMenu={handleContextMenu}
					activeId={activeId}
					onDelete={onDelete}
					allowDelete={allowDelete}
					addTab={addTab}
					onStartMover={renderStartMover ? handleMoveInit : undefined}
					onEndMover={renderEndMover ? handleMoveInit : undefined}
					onClose={() => setShowList(false)}
				/>
			)}
		</div>
	);
}

/**
 * Just so we can use scrollable fades.
 */
function List({
	tabs,
	listRef,
	anchorRef,
	scrollerRef,
	handlePointerDown,
	handleContextMenu,
	activeId,
	onDelete,
	allowDelete,
	onStartMover,
	onEndMover,
	addTab,
	onClose,
	spacing = 2,
}: {
	listRef: Ref<HTMLDivElement | null>;
	anchorRef: Ref<HTMLButtonElement | null>;
	scrollerRef: MutableRef<Scroller | null>;
	tabs: Tab[];
	handlePointerDown: (event: TargetedEvent<HTMLElement, PointerEvent>) => void;
	handleContextMenu: (event: TargetedEvent<HTMLElement, MouseEvent>) => void;
	activeId: string;
	onDelete?: (id: string) => void;
	allowDelete: boolean;
	spacing?: number;
	onStartMover?: (event: TargetedEvent<HTMLDivElement>) => void;
	onEndMover?: (event: TargetedEvent<HTMLDivElement>) => void;
	addTab: (position: number) => void;
	onClose: () => void;
}) {
	const boatRef = useRef<HTMLDivElement>(null);
	const container = useMemo(() => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		return container;
	}, []);

	useEffect(() => {
		const prevList = listRef.current;

		render(
			<div class="TabsListContextMenu">
				<div class="closer" onClick={onClose} />
				<div class="list" ref={boatRef}>
					<Scrollable
						direction="vertical"
						class="buttons"
						innerRef={listRef}
						data-drag-direction="vertical"
						onPointerDown={handlePointerDown}
						onTouchStart={prevented()}
						onContextMenu={handleContextMenu}
					>
						{tabs.map((tab, index) => (
							<button
								key={tab.id}
								class={`TabsButton activate${tab.id === activeId ? ' -active' : ''}`}
								data-tab-index={index}
								data-id={tab.id}
								data-click-action="activate"
								onClick={(event) => event.preventDefault()}
								title={tab.title}
							>
								<span class="title">{tab.title}</span>
								{onDelete && allowDelete && (
									<button
										class="delete"
										onPointerDown={prevented()}
										onTouchStart={prevented()}
										onClick={prevented(() => onDelete(tab.id))}
										title="Delete tab"
									>
										<Icon name="x" />
									</button>
								)}
							</button>
						))}
						<button
							class="TabsButton add"
							onClick={prevented(() => {
								onClose();
								addTab(tabs.length);
							})}
							title="Add tab"
						>
							<Icon name="plus" />
						</button>
					</Scrollable>
					{onStartMover && (
						<div
							key="mover-start"
							class="mover"
							data-direction="start"
							onDragEnter={onStartMover}
							onMouseEnter={onStartMover}
						/>
					)}
					{onEndMover && (
						<div
							key="mover-end"
							class="mover"
							data-direction="end"
							onDragEnter={onEndMover}
							onMouseEnter={onEndMover}
						/>
					)}
				</div>
			</div>,
			container
		);

		const currentList = listRef.current;
		if (prevList !== currentList) {
			scrollerRef.current?.dispose();
			scrollerRef.current = currentList ? makeScroller(currentList) : null;
		}
	}, [NaN]);

	useEffect(() => {
		// Position the list
		const anchor = anchorRef.current;
		const boat = boatRef.current;
		if (anchor && boat) {
			const anchorRect = anchor.getBoundingClientRect();
			const boatRect = anchor.getBoundingClientRect();
			const windowCenterX = window.innerWidth / 2;
			const windowCenterY = window.innerHeight / 2;
			const anchorCenterX = anchorRect.left + anchorRect.width / 2;
			const anchorCenterY = anchorRect.top + anchorRect.height / 2;

			if (anchorCenterX < windowCenterX) {
				boat.style.left = `${Math.min(window.innerWidth - boatRect.width, anchorRect.left)}px`;
			} else {
				boat.style.right = `${Math.min(
					window.innerWidth - boatRect.width,
					window.innerWidth - anchorRect.right
				)}px`;
			}

			if (anchorCenterY < windowCenterY) {
				boat.style.top = `${Math.min(window.innerHeight - boatRect.height, anchorRect.bottom + spacing)}px`;
			} else {
				boat.style.bottom = `${Math.min(
					window.innerHeight - boatRect.height,
					window.innerHeight - anchorRect.bottom + spacing
				)}px`;
			}
		}

		return () => {
			scrollerRef.current?.dispose();
			scrollerRef.current = null;
			render(null, container);
			container.remove();
		};
	}, []);

	return null;
}

function getPositionContext(element: HTMLElement, container: HTMLElement, isVertical?: boolean) {
	const rect = getBoundingRect(element, container);
	const scrollAdjust = isVertical ? container.scrollTop : container.scrollLeft;
	const size = isVertical ? rect.height : rect.width;
	const start = (isVertical ? rect.top : rect.left) + scrollAdjust;
	return {...rect, element, start, size, end: start + size, center: start + Math.round(size / 2)};
}

interface DragContext {
	container: HTMLElement;
	tabElements: HTMLElement[];
	draggedElement: HTMLElement;
	index: number;
	id: string;
	action: {type: string; id: string} | false;
}

function getDragContext(eventTarget: any): DragContext | null {
	// Get closest element with data set
	let cursor: any = eventTarget;
	let draggedElement: HTMLElement | undefined;
	let button: HTMLButtonElement | undefined;
	while (cursor) {
		if (!button && cursor?.dataset?.clickAction) button = cursor;
		if (cursor?.dataset?.tabIndex) {
			draggedElement = cursor;
			// Button can be inside a tab, can be a tab itself, but can't have
			// a tab inside, so we terminate when tab is recognized.
			break;
		} else {
			cursor = cursor?.parentElement;
		}
	}

	if (!draggedElement) return null;
	const index = parseInt(`${draggedElement.dataset.tabIndex}`, 10);
	if (!Number.isFinite(index)) return null;
	const container = draggedElement.parentElement;
	if (!container) return null;
	const tabElements = [...container.children].filter(
		(element) => (element as any).dataset?.tabIndex != null
	) as HTMLElement[];

	const clickAction = cursor?.dataset?.clickAction;
	const id: string | undefined = cursor?.dataset?.id;

	if (!id) return null;

	return {
		container,
		tabElements,
		draggedElement,
		index,
		id,
		action: clickAction && id ? {type: clickAction, id} : false,
	};
}
