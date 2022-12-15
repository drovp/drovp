import {render, ComponentChildren} from 'preact';
import {clipboard} from 'electron';
import {isOfType, TargetedEvent} from 'lib/utils';

interface InfoParticleOptions {
	variant?: Variant;
	duration?: number;
}

const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

export async function infoParticle(contents: ComponentChildren, options?: InfoParticleOptions): Promise<void>;
export async function infoParticle(
	contents: ComponentChildren,
	target: HTMLElement | MouseEvent,
	options?: InfoParticleOptions
): Promise<void>;
export async function infoParticle(
	contents: ComponentChildren,
	target?: HTMLElement | MouseEvent | InfoParticleOptions,
	options: InfoParticleOptions = {}
): Promise<void> {
	let left = window.innerWidth / 2;
	let top = window.innerHeight / 2;

	if (isOfType<HTMLElement>(target, target != null && (target as any).ownerDocument === document)) {
		const rect = target.getBoundingClientRect();
		left = Math.round(rect.left + rect.width / 2);
		top = Math.round(rect.top + rect.height / 2);
	} else if (isOfType<MouseEvent>(target, target != null && typeof (target as any)?.clientY === 'number')) {
		left = target.clientX;
		top = target.clientY;
	} else {
		options = target as InfoParticleOptions;
		target = undefined;
	}

	const {variant, duration = 600} = options || {};

	let classNames = 'InfoParticle';
	if (variant) classNames += ` -${variant}`;

	const element = Object.assign(document.createElement('div'), {className: classNames});

	render(contents, element);

	document.body.appendChild(element);
	const centerTransform = `translate(${left}px, ${top}px) translate(-50%, -50%)`;
	const keyframes = {
		transform: [
			`${centerTransform} scale(.8)`,
			`${centerTransform} translateY(-100%) scale(1)`,
			`${centerTransform} translateY(-200%) scale(1.2)`,
		],
		opacity: [1, 1, 1, 0],
	};

	element.animate(keyframes, {
		duration: duration,
		easing: 'cubic-bezier(0, 1, 1, 0.2)',
		fill: 'forwards',
	});
	await wait(duration);
	element.remove();
}

export function createCopyParticle(text: string) {
	return (event: TargetedEvent<HTMLElement, MouseEvent>) => {
		clipboard.writeText(text);
		infoParticle('COPIED', event.currentTarget);
	};
}
