import {h, RenderableProps} from 'preact';
import {useState, useMemo, useEffect, useRef} from 'preact/hooks';
import {reaction, action} from 'statin';
import {eem, debounce, propPath} from 'lib/utils';
import {StringSignal} from 'models/options';
import {OptionsData, OptionString} from '@drovp/types';
import {Input} from 'components/Input';
import {Textarea} from 'components/Textarea';
import {Spinner} from 'components/Spinner';

export type OptionStringProps = RenderableProps<{
	id?: string;
	name?: string;
	path: (string | number)[];
	signal: StringSignal<OptionString<any>>;
	optionsData: OptionsData;
	disabled?: boolean;
}>;

export function OptionString({id, name, signal, path, optionsData, disabled}: OptionStringProps) {
	const schema = signal.schema;
	if (schema.type === 'string') {
		var rows = schema.rows;
		var min = schema.min;
		var max = schema.max;
		var cols = schema.cols;
	}
	const [inputValue, setInputValue] = useState<string>(signal.value || '');
	const [syncError, setSyncError] = useState<string | null>(null);
	const [asyncError, setAsyncError] = useState<string | null>(null);
	const [isValidating, setIsValidating] = useState<boolean>(false);
	const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	const isInvalid = (syncError || asyncError) != null;
	const variant = isInvalid ? 'danger' : undefined;
	const asyncValidator = useMemo(
		() =>
			debounce(async (value: any, optionsData: any) => {
				if (!schema.asyncValidator) return;

				setIsValidating(true);
				setAsyncError(null);

				let isValid = true;
				let errorMessage: string | undefined;

				try {
					isValid = await schema.asyncValidator(value, optionsData, path);
				} catch (error) {
					errorMessage = eem(error);
				}

				if (errorMessage || !isValid) setAsyncError(errorMessage || `Invalid value.`);

				setIsValidating(false);
			}, schema.asyncValidatorDebounce ?? 500),
		[signal]
	);
	const asyncDependencies = useMemo(
		() =>
			schema.validationDependencies
				? schema.validationDependencies.map((name) =>
						propPath(optionsData, Array.isArray(name) ? name : [name])
				  )
				: [],
		schema.validationDependencies ? [optionsData] : []
	);

	function handleChange(newValue: string) {
		action(() => {
			setInputValue(newValue);

			let isValid = true;
			let errorMessage: string | undefined;

			setSyncError(null);

			try {
				isValid = schema.validator == null || schema.validator(newValue, optionsData, path);
				if (isValid) signal(newValue);
			} catch (error) {
				errorMessage = eem(error);
			}

			if (errorMessage || !isValid) setSyncError(errorMessage || `Invalid value.`);

			asyncValidator(newValue, optionsData);
		});
	}

	// Validate on load, or when validation dependencies change
	useEffect(() => {
		handleChange(inputValue);
	}, [signal, ...asyncDependencies]);

	// Update input value on signal changes without subscribing this component
	// to the signal. This way, we can keep internal potentially erroneous state,
	// and react to external signal changes at the same time.
	useEffect(
		() =>
			reaction(
				() => signal(),
				(newValue: string) => {
					setInputValue(newValue);
					setSyncError(null);
					setAsyncError(null);
				}
			),
		[signal]
	);

	// Select and focus element when requested
	useEffect(() => {
		const input = inputRef.current;
		if (schema.preselect && input) {
			input.select();
			input.focus();
		}
	}, []);

	const notifications = (syncError || isValidating || asyncError) && (
		<ul class="notes">
			{syncError && <li dangerouslySetInnerHTML={{__html: syncError}} />}
			{isValidating && (
				<li>
					<Spinner /> validating
				</li>
			)}
			{asyncError && <li dangerouslySetInnerHTML={{__html: asyncError}} />}
		</ul>
	);

	let classNames = `StringControl`;
	if (isInvalid) classNames += ' -error';

	if (rows != null) {
		classNames += ' -text';
		return (
			<div class={classNames}>
				<Textarea
					innerRef={inputRef as any}
					id={id}
					name={name}
					variant={variant}
					value={inputValue}
					rows={rows}
					min={min}
					max={max}
					onChange={handleChange}
					disabled={disabled}
				/>
				{notifications}
			</div>
		);
	}

	classNames += ' -string';

	const inputSize = max || cols;

	return (
		<div class={classNames} style={inputSize ? `max-width:${inputSize * 0.8}em` : undefined}>
			<Input
				innerRef={inputRef as any}
				id={id}
				name={name}
				variant={variant}
				value={inputValue}
				min={min}
				max={max}
				onChange={handleChange}
				disabled={disabled}
			/>
			{notifications}
		</div>
	);
}
