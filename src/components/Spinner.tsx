import {h} from 'preact';

export interface SpinnerProps {
	class?: string;
	variant?: Variant;
	paused?: boolean;
}

export function Spinner({class: className, variant, paused}: SpinnerProps) {
	let classNames = 'Spinner';
	if (variant) classNames += ` -${variant}`;
	if (paused) classNames += ' -paused';
	if (className) classNames += ` ${className}`;

	return <div className={classNames} />;
}
