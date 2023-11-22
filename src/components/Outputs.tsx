import {h} from 'preact';
import {useRef, useState, useEffect} from 'preact/hooks';
import {action} from 'statin';
import {observer} from 'statin-preact';
import {clamp, rafThrottle, animationVolleyVisible} from 'lib/utils';
import {useStore} from 'models/store';
import {Items} from 'components/Items';
import {Select, SelectOption} from 'components/Select';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {OutputsInterface} from 'models/items';

type DragSource = 'spacer' | 'handle' | 'teaser';

function isDragSource(value: any): value is DragSource {
	return ['spacer', 'handle', 'teaser'].includes(value);
}

export const Outputs = observer(function Outputs({
	title,
	tooltip,
	outputs,
	profileTitles,
	onHeightRatioChange,
	heightRatio,
	maxHeightRatio,
	toOperationLinks,
}: {
	title: string;
	tooltip?: string;
	outputs: OutputsInterface;
	heightRatio: number;
	onHeightRatioChange: (value: number) => void;
	maxHeightRatio: number;
	profileTitles?: boolean;
	toOperationLinks?: boolean;
}) {
	const {session, app} = useStore();
	const [draggedBy, setDraggedBy] = useState<DragSource | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const itemsRef = useRef<HTMLDivElement>(null);
	const [renderFilterBar, setRenderFilterBar] = useState(false);
	const [renderItems, setRenderItems] = useState(false);
	const category = session.outputsCategory();
	const data = outputs.data();

	function updateRenderingFlags(containerHeight: number) {
		setRenderFilterBar(containerHeight > 2);
		setRenderItems(containerHeight > 60);
	}

	function initiateResize(event: MouseEvent) {
		const container = containerRef.current;
		const parentContainer = container?.parentElement;
		const dragSource = (event.currentTarget as HTMLElement)?.dataset?.dragSource;

		// Ignore double clicks and not primary button
		if (!isDragSource(dragSource) || event.detail === 2 || event.button !== 0 || !container || !parentContainer) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const cursorOverlay = document.createElement('div');
		Object.assign(cursorOverlay.style, {position: 'fixed', inset: 0, zIndex: 10000, cursor: 'ns-resize'});
		document.body.appendChild(cursorOverlay);

		const initialY = event.clientY;
		const initialHeight = container.offsetHeight;
		const maxHeight = parentContainer.offsetHeight;
		const controlBarHeight = container.querySelector<HTMLDivElement>('.controls')?.offsetHeight || 25;
		let newHeightRatio = heightRatio;
		const update = rafThrottle(() => container.style.setProperty('--height', `${newHeightRatio}`));

		function handleMouseMove(event: MouseEvent) {
			const deltaY = initialY - event.clientY;
			const newHeight = initialHeight + deltaY;
			newHeightRatio = clamp(0, newHeight / maxHeight, maxHeightRatio);

			updateRenderingFlags(newHeight);

			// For performance reasons, we update CSS variable on animation frame,
			// and only change the setting on mouseUp below.
			update();
		}

		function handleMouseUp() {
			window.removeEventListener('mouseup', handleMouseUp);
			window.removeEventListener('mousemove', handleMouseMove);

			// If final height is too small to reveal anything, just force it to 0
			if (maxHeight * newHeightRatio <= controlBarHeight * 0.8) {
				newHeightRatio = 0;
				update();
			}

			onHeightRatioChange(newHeightRatio);
			cursorOverlay.remove();
			setDraggedBy(null);
		}

		setDraggedBy(dragSource);
		window.addEventListener('mouseup', handleMouseUp);
		window.addEventListener('mousemove', handleMouseMove);
	}

	async function clear() {
		if (itemsRef.current) await animationVolleyVisible(itemsRef.current);
		outputs.clearHistory();
	}

	useEffect(() => {
		if (containerRef.current) updateRenderingFlags(containerRef.current.offsetHeight);
	}, []);

	let items =
		category === 'files'
			? data.files
			: category === 'urls'
			? data.urls
			: category === 'strings'
			? data.strings
			: category === 'errors'
			? data.errors
			: data.all;

	let classNames = 'Outputs';
	if (draggedBy) classNames += ' -dragged';
	if (draggedBy === 'handle') classNames += ' -force-show-drag-handle';

	return (
		<div class={classNames} ref={containerRef} style={`--height: ${heightRatio}`} data-volley-ignore>
			{!renderItems && !app.draggingMode() && (
				<div class="tease" data-drag-source="teaser" onMouseDown={initiateResize} title={tooltip}>
					<Icon name="chevron-up" /> {title} <Icon name="chevron-up" />
				</div>
			)}

			<div class="content">
				{renderFilterBar && (
					<div class="controls" title={tooltip}>
						<Select
							class="filters"
							transparent
							value={category}
							onChange={(value: string) => action(() => session.outputsCategory(value))}
						>
							<SelectOption value="all" tooltip="All">
								<b>{data.all.length}</b>
								<span class="name">all</span>
							</SelectOption>
							<SelectOption variant="info" value="files" tooltip="Files">
								<b>{data.files.length}</b>
								<span class="name">files</span>
							</SelectOption>
							<SelectOption variant="accent" value="urls" tooltip="URLs">
								<b>{data.urls.length}</b>
								<span class="name">urls</span>
							</SelectOption>
							<SelectOption variant="success" value="strings" tooltip="Strings">
								<b>{data.strings.length}</b>
								<span class="name">strings</span>
							</SelectOption>
							<SelectOption variant="danger" value="errors" tooltip="Errors">
								<b>{data.errors.length}</b>
								<span class="name">errors</span>
							</SelectOption>
						</Select>

						<div class="spacer" data-drag-source="spacer" onMouseDown={initiateResize} />

						<Button class="clear" semitransparent muted variant="danger" onClick={clear}>
							<Icon name="clear-all" /> Clear
						</Button>

						<div class="handle" data-drag-source="handle" onMouseDown={initiateResize}></div>
					</div>
				)}

				{renderItems && (
					<Items reversed profileTitles={profileTitles} items={items} toOperationLinks={toOperationLinks} />
				)}
			</div>
		</div>
	);
});
