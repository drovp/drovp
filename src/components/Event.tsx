import {h} from 'preact';
import {useRef, useMemo, useLayoutEffect} from 'preact/hooks';
import {stripHtml} from 'lib/utils';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Event as EventModel} from 'models/events';

export function Event({event}: {event: EventModel}) {
	const {message, variant, icon, title, created} = event;
	const containerRef = useRef<any>();
	const strippedMessage = useMemo(() => (message ? stripHtml(message) : message), [message]);

	function handleClose(mouseEvent: PointerEvent) {
		mouseEvent.preventDefault();
		mouseEvent.stopPropagation();

		const duration = 100;
		const container = containerRef.current;
		container.animate(
			{
				transform: ['translateX(0)', 'translateX(-50px)'],
				opacity: [1, 0],
				marginBottom: ['0px', `-${container.clientHeight}px`],
			},
			{duration, fill: 'forwards'}
		);
		setTimeout(event.delete, duration);
	}

	// Animate in new events
	useLayoutEffect(() => {
		if (created && created > Date.now() - 100) {
			containerRef.current.animate(
				{transform: ['translateX(50px)', 'translateX(0)'], opacity: [0, 1]},
				{duration: 100, fill: 'forwards'}
			);
		}
	}, []);

	let classNames = 'Event';
	if (variant) classNames += ` -${variant}`;

	return (
		<button ref={containerRef} class={classNames} onClick={event.open}>
			<div class="stripe">{icon && <Icon name={icon} />}</div>
			<header>
				<div className="title">{title || <em>missing title</em>}</div>
				{strippedMessage && <div class="message">{strippedMessage}</div>}
			</header>
			<Button class="delete" transparent variant={variant} onClick={handleClose} tooltip="Delete event">
				<Icon name="x" />
			</Button>
		</button>
	);
}
