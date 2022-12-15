import {h, RenderableProps} from 'preact';
import {useRef, useEffect} from 'preact/hooks';
import {reaction} from 'statin';
import {throttle, clamp} from 'lib/utils';
import {observeElementSize} from 'lib/elementSize';
import {useStore} from 'models/store';
import {Batch, BatchItem} from 'models/profiles';

// Returns width of the drawn area
function render(
	ctx: CanvasRenderingContext2D,
	batch: BatchItem[],
	width: number,
	height: number,
	colors: {successColor: string; errorColor: string}
) {
	const step = width / batch.length;
	let pos = 0;
	// First, fill the whole bar with the most expected success color.
	ctx.fillStyle = colors.successColor;
	ctx.fillRect(0, 0, width, height);

	// Than fill in the errors and gaps.
	ctx.fillStyle = colors.errorColor;
	for (let i = 0; i < batch.length; i++) {
		if (batch[i] === BatchItem.pending) {
			// 1st pending item means all subsequent ones are pending as well
			// so lets just clear the rest and break.
			ctx.clearRect(pos, 0, width - pos, height);
			break;
		} else if (batch[i] === BatchItem.error) {
			ctx.fillRect(pos, 0, step, height);
		}
		pos += step;
	}
}

type BatchProgressProps = RenderableProps<{
	class?: string;
	batch: Batch;
	tooltip?: string;
	label?: string;
}>;

export function BatchProgress({class: className, batch, tooltip, label}: BatchProgressProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const {settings} = useStore();
	const itemsCount = batch.items().length;
	const completedCount = batch.index();
	const completed = completedCount / itemsCount;
	const isDone = completedCount === itemsCount;
	const isIdle = itemsCount === 0;

	useEffect(() => {
		const canvas = canvasRef.current;

		if (!canvas) return;

		const getColors = () => {
			const computedStyle = getComputedStyle(canvas);
			return {
				successColor: computedStyle.getPropertyValue('--success-500'),
				errorColor: computedStyle.getPropertyValue('--danger-500'),
			};
		};
		let colors = getColors();
		let width: number | undefined;
		let height: number | undefined;
		let isRoundingLeft = false;
		let isRoundingRight = false;
		const ctx = canvas.getContext('2d')!;

		const requestRender = throttle(() => {
			if (!width || !height) return;

			render(ctx, batch.items(), width, height, colors);

			// Increases container border-radius on sides so it doesn't look bad
			// under filled progress bar on light themes.
			const container = containerRef.current;

			if (!container) return;

			const progress = batch.progress();
			const progressWidth = progress ? progress * width : 0;

			if (progressWidth > 2) {
				if (!isRoundingLeft) {
					container.classList.add('-round-more-left');
					isRoundingLeft = true;
				}
			} else if (isRoundingLeft) {
				container.classList.remove('-round-more-left');
				isRoundingLeft = false;
			}

			if (width - progressWidth < 2) {
				if (!isRoundingRight) {
					container.classList.add('-round-more-right');
					isRoundingRight = true;
				}
			} else if (isRoundingRight) {
				container.classList.remove('-round-more-right');
				isRoundingRight = false;
			}
		}, 34);

		const disposeThemeReaction = reaction(
			() => settings.theme(),
			() => {
				colors = getColors();
				requestRender();
			}
		);

		const disposeCanvasObserver = observeElementSize(canvas, (box) => {
			canvas.width = width = box[0] * 2;
			canvas.height = height = box[1] * 2;
			requestRender();
		});

		const disposeBatchReaction = reaction(() => batch.items(), requestRender, {immediate: true});

		return () => {
			disposeCanvasObserver();
			disposeThemeReaction();
			disposeBatchReaction();
		};
	}, [batch]);

	let classNames = 'BatchProgress Progress';
	if (className) classNames += ` ${className}`;
	if (isIdle) classNames += ' -idle';

	return (
		<div class={classNames} title={tooltip} ref={containerRef}>
			<div class="labels">
				{!isDone && <div class="left">{completedCount}</div>}
				<div class="center">{label || (isIdle ? 'idle' : itemsCount)}</div>
				{!isDone && <div class="right">{itemsCount - completedCount}</div>}
			</div>
			<div
				class="bar labels"
				style={{clipPath: `inset(0% ${clamp(0, 1 - completed, 1) * 100}% 0 0 round var(--border-radius))`}}
			>
				<canvas ref={canvasRef} />
				{!isDone && <div class="left">{completedCount}</div>}
				<div class="center">{label || (isIdle ? 'idle' : itemsCount)}</div>
				{!isDone && <div class="right">{itemsCount - completedCount}</div>}
			</div>
		</div>
	);
}
