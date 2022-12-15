import {h, render} from 'preact';
import {useEffect, useRef} from 'preact/hooks';
import {TargetedEvent, clamp} from 'lib/utils';
import {Action} from 'components/Actions';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';

interface ToastData {
	message: string;
	variant?: Variant;
	action?: Action;
	duration?: number;
}

const animationOptions = {
	duration: 200,
	easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
	fill: 'forwards' as const,
};

export function makeToast(data: ToastData) {
	const container = document.createElement('div');
	container.className = `Toast -inverted-color-scheme${data.variant ? ` -${data.variant}` : ''}`;

	async function close() {
		await container.animate(
			{transform: [`translateY(0px)`, `translateY(-50px)`], opacity: [1, 0]},
			animationOptions
		).finished;
		render(null, container);
		container.remove();
	}

	render(<Toast data={data} onClose={close} />, container);

	document.body.appendChild(container);
	container.animate({transform: [`translateY(100px)`, `translateY(0px)`], opacity: [0, 0, 1]}, animationOptions);
}

function Toast({
	data: {message, variant, action, duration = 4000},
	onClose,
}: {
	data: ToastData;
	duration?: number;
	onClose: () => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	function handleAction(event: TargetedEvent<HTMLButtonElement, MouseEvent>) {
		action?.action(event);
		onClose();
	}

	useEffect(() => {
		const containerElement = containerRef.current!;
		const progressElement = progressRef.current!;
		let hideAt = 0;
		let pausedAt: number | false = false;
		let lastProgress = 0;
		let rafId: number | undefined;
		let hideTimeoutId: ReturnType<typeof setTimeout> | undefined;

		function resume() {
			const hideIn = duration - duration * (pausedAt || 0);
			hideAt = Date.now() + hideIn;
			hideTimeoutId = setTimeout(() => onCloseRef.current(), hideIn);
			pausedAt = false;
			progressRenderLoop();
		}

		function pause() {
			cancelRenderLoop();
			if (hideTimeoutId) clearTimeout(hideTimeoutId);
			pausedAt = lastProgress;
		}

		function progressRenderLoop() {
			const progress = clamp(0, pausedAt !== false ? pausedAt : 1 - (hideAt - Date.now()) / duration, 1);

			if (progress !== lastProgress) {
				lastProgress = progress;
				progressElement.style.setProperty('--progress', `${progress * 100}%`);
			}

			rafId = requestAnimationFrame(progressRenderLoop);
		}

		function cancelRenderLoop() {
			if (rafId) cancelAnimationFrame(rafId);
		}

		resume();

		containerElement.addEventListener('mouseenter', pause);
		containerElement.addEventListener('mouseleave', resume);

		return () => {
			cancelRenderLoop();
			pause();
			containerElement.removeEventListener('mouseenter', pause);
			containerElement.removeEventListener('mouseleave', resume);
		};
	}, []);

	return (
		<div class="toast" ref={containerRef}>
			<div class="progress" ref={progressRef} />
			<div class="message">{message}</div>
			<div class="actions">
				{action && (
					<Button
						transparent
						variant={action.variant || variant}
						onClick={handleAction}
						tooltip={action.tooltip}
					>
						{action.icon && [<Icon name={action.icon} />, ' ']}
						{action.title}
					</Button>
				)}
				<Button transparent variant={variant} onClick={onClose} tooltip="Close">
					<Icon name="x" />
				</Button>
			</div>
		</div>
	);
}
