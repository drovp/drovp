import {h} from 'preact';
import {useMemo} from 'preact/hooks';
import {TargetedEvent, throttle} from 'lib/utils';
import {useRef, Ref} from 'preact/hooks';
import {Input} from './Input';

export interface ColorProps {
	id?: string;
	name?: string;
	class?: string;
	value?: string;
	onChange?: (value: string) => void;
	variant?: Variant;
	disabled?: boolean;
	innerRef?: Ref<HTMLInputElement>;
	formatSelection?: (newValue: string, oldValue: string) => string;
}

export function Color({
	id,
	name,
	class: className,
	value,
	variant,
	onChange,
	disabled,
	innerRef,
	formatSelection,
}: ColorProps) {
	value = value || '';
	const inputRef = innerRef || useRef<HTMLInputElement>(null);
	const handleChange = (value: string) => onChange?.(value);
	const onChangeRef = useRef(onChange);
	const throttledChange = useMemo(
		() =>
			throttle((value: string, oldValue: string) => {
				onChangeRef.current?.(formatSelection ? formatSelection(value, oldValue) : value);
			}, 60),
		[]
	);
	const handlePickerChange = (event: TargetedEvent<HTMLInputElement>) =>
		throttledChange(event.currentTarget.value, value!);

	let classNames = `Color`;
	if (className) classNames += ` ${className}`;
	if (disabled) classNames += ` -disabled`;

	// To silence browser errors when input type color gets value different than #rrggbb
	const colorInputSafeValue = value[0] === '#' && value.length === 7 ? value : '#ffffff';

	return (
		<div class={classNames}>
			<Input
				id={id}
				name={name}
				value={value}
				cols={10}
				variant={variant}
				onChange={handleChange}
				innerRef={inputRef}
			/>
			<div class="picker">
				<div class="color" style={`background:${value}`} />
				<input type="color" value={colorInputSafeValue} onInput={handlePickerChange} />
			</div>
		</div>
	);
}
