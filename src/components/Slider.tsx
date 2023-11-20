import {h, RenderableProps} from 'preact';
import {throttle} from 'lib/utils';
import {useMemo, useRef} from 'preact/hooks';

export type SliderProps = RenderableProps<{
	id?: string;
	name?: string;
	value: number;
	class?: string;
	min: number;
	max: number;
	step: number;
	variant?: Variant;
	disabled?: boolean;
	tooltip?: string;
	onChange: (value: number) => void;
}>;

export function Slider({
	class: className = '',
	id,
	name,
	value,
	min,
	max,
	step,
	variant,
	disabled,
	tooltip,
	onChange,
}: SliderProps) {
	const onChangeRef = useRef<SliderProps['onChange']>(onChange);
	onChangeRef.current = onChange;
	let classNames = `Slider ${className}`;
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (disabled) classNames += ` -disabled`;

	const handleInput = useMemo(
		() =>
			throttle(function handleInput(event: h.JSX.TargetedEvent<HTMLInputElement, Event>) {
				if (event.target instanceof HTMLInputElement) onChangeRef.current(Number(event.target?.value));
			}, 33),
		[]
	);

	return (
		<input
			id={id}
			name={name}
			onInput={handleInput}
			class={classNames}
			type="range"
			min={min}
			max={max}
			step={step}
			value={value}
			disabled={disabled}
			title={tooltip}
		/>
	);
}
