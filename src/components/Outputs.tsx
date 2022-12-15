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

export const Outputs = observer(function Outputs({
	title,
	tooltip,
	outputs,
	profileTitles,
	onHeightRatioChange,
	heightRatio,
	maxHeightRatio,
}: {
	title: string;
	tooltip?: string;
	outputs: OutputsInterface;
	heightRatio: number;
	onHeightRatioChange: (value: number) => void;
	maxHeightRatio: number;
	profileTitles?: boolean;
}) {
	const {session, app} = useStore();
	const [isDragged, setIsDragged] = useState(false);
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

		// Ignore double clicks and not primary button
		if (event.detail === 2 || event.button !== 0 || !container || !parentContainer) return;

		event.preventDefault();
		event.stopPropagation();

		const initialDocumentCursor = document.documentElement.style.cursor;
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
			document.documentElement.style.cursor = initialDocumentCursor;
			setIsDragged(false);
		}

		// Set temporary global cursor so it doesn't flash while moving
		document.documentElement.style.cursor = `ns-resize`;
		setIsDragged(true);
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
	if (isDragged) classNames += ' -dragged';

	return (
		<div class={classNames} ref={containerRef} style={`--height: ${heightRatio}`} data-volley-ignore>
			{!renderItems && !app.draggingMode() && (
				<div class="dragger" onMouseDown={initiateResize} title={tooltip}>
					<span>
						<Icon name="chevron-up" /> {title} <Icon name="chevron-up" />
					</span>
				</div>
			)}

			<div class="content">
				{renderFilterBar && (
					<div class="controls" title={tooltip}>
						<div class="dragger" onMouseDown={initiateResize} />
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

						<Button class="clear" transparent muted variant="danger" onClick={clear}>
							<Icon name="clear-all" /> Clear
						</Button>
					</div>
				)}

				{renderItems && <Items reversed profileTitles={profileTitles} items={items} />}
			</div>
		</div>
	);
});
