import {h, RenderableProps, Fragment} from 'preact';
import {useState, useRef, useEffect} from 'preact/hooks';
import {reaction, action} from 'statin';
import {NumberSignal} from 'models/options';
import {eem} from 'lib/utils';
import {Slider} from 'components/Slider';
import {Input} from 'components/Input';

export type OptionNumberProps = RenderableProps<{
	id?: string;
	name?: string;
	signal: NumberSignal;
	disabled?: boolean;
}>;

const normalizeInputValue = (value: any) => (!value && value !== 0 ? '' : `${value}`);

export function OptionNumber({id, name, signal, disabled}: OptionNumberProps) {
	let {min, max, step, steps, nullable, cols} = signal.schema;
	const value: number | undefined = steps ? steps.indexOf(signal.value) : signal.value;
	const [inputValue, setInputValue] = useState<string>(normalizeInputValue(value));
	const [error, setError] = useState<string | undefined>(undefined);
	const variant = error ? 'danger' : undefined;
	const inputRef = useRef<HTMLInputElement>(null);

	if (steps != null) {
		min = 0;
		max = steps.length - 1;
		step = 1;
	}

	function handleChange(value: number | string) {
		action(() => {
			const inputValue = normalizeInputValue(value);
			setInputValue(inputValue);
			try {
				const signalValue = inputValue.trim();
				signal(steps ? (steps[value as any] as number) : nullable && signalValue === '' ? null : signalValue);
				setError(undefined);
			} catch (error) {
				setError(eem(error));
			}
		});
	}

	// Update input value on signal changes without subscribing this component
	// to the signal. This way, we can keep internal potentially erroneous state,
	// and react to external signal changes at the same time.
	useEffect(
		() =>
			reaction(
				() => (steps ? `${steps.indexOf(signal() as any)}` : normalizeInputValue(signal())),
				(newValue: string) => {
					setInputValue(newValue);
					setError(undefined);
				}
			),
		[signal]
	);

	if (min != null && max != null && step != null) {
		return (
			<Fragment>
				<Slider
					id={id}
					variant={variant}
					name={name}
					min={min}
					max={max}
					step={step}
					value={value || 0}
					onChange={handleChange}
					disabled={disabled}
					tooltip={error}
				/>
				{!steps && (
					<Input
						innerRef={inputRef}
						variant={variant}
						type="number"
						value={inputValue}
						onChange={handleChange}
						disabled={disabled}
						tooltip={error}
					/>
				)}
			</Fragment>
		);
	}

	return (
		<Input
			innerRef={inputRef}
			id={id}
			name={name}
			type="number"
			cols={cols}
			variant={variant}
			value={inputValue}
			onChange={handleChange}
			disabled={disabled}
		/>
	);
}
