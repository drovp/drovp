import {ipcRenderer} from 'electron';
import {h, RenderableProps, VNode, JSX} from 'preact';
import {useRef, Ref} from 'preact/hooks';
import {DialogFileFilter} from '@drovp/types';
import {TargetedEvent, countDecimals, clamp} from 'lib/utils';
import {Icon} from 'components/Icon';

export type StringProps = RenderableProps<{
	id?: string;
	name?: string;
	type?: 'text' | 'number' | 'path';
	placeholder?: string | number;
	value?: string | number;
	class?: string;
	tooltip?: string;
	variant?: Variant;
	cols?: number;
	spellcheck?: boolean;

	// Number props
	min?: number;
	max?: number;
	step?: number;

	// Path props
	defaultPath?: string;
	pathKind?: 'file' | 'directory';
	pathFilters?: DialogFileFilter[];

	onChange?: (value: string) => void;
	onSubmit?: (event: KeyboardEvent) => void;
	onClick?: (event: TargetedEvent<HTMLInputElement>) => void;
	disabled?: boolean;
	readonly?: boolean;
	innerRef?: Ref<HTMLInputElement | null>;
	formatSelection?: (newValue: string, oldValue: string) => string;
}>;

export function Input({
	id,
	name,
	type = 'text',
	placeholder,
	class: className,
	tooltip,
	value,
	variant,
	min,
	max,
	step,
	cols,
	defaultPath,
	pathKind,
	pathFilters,
	onChange,
	onSubmit,
	formatSelection,
	disabled,
	spellcheck,
	innerRef,
	...rest
}: StringProps) {
	const inputRef = innerRef || useRef<HTMLInputElement>(null);
	const valueRef = useRef<string | null>(null);
	let buttons: VNode[] = [];
	let htmlType: string = type;
	let htmlAttrs: JSX.HTMLAttributes<HTMLInputElement> | undefined;

	function handleInput(event: TargetedEvent<HTMLInputElement, Event>) {
		const value = event.currentTarget.value;
		valueRef.current = value;
		onChange?.(value);
	}

	function handleKeyDown(event: TargetedEvent<HTMLInputElement, KeyboardEvent>) {
		if (event.key === 'Enter') onSubmit?.(event);
		else if (type === 'number') handleNumberInputKeyDown(event, {min, max, step});
	}

	// Set variant to danger when value doesn't adhere to min/max/step options
	switch (type) {
		case 'number': {
			const numberValue = parseFloat(valueRef.current ?? `${value}`);
			if (Number.isFinite(numberValue)) {
				if (
					(max != null && numberValue > max) ||
					(min != null && numberValue < min) ||
					(step != null && Math.abs((numberValue / step) % 1) > 0.00000001)
				) {
					variant = 'danger';
				}
			}
			htmlAttrs = {min, max, step: step ?? 'any'};
			break;
		}
		case 'path': {
			htmlType = 'text';
			const openFile = async () => {
				const properties = [
					'showHiddenFiles',
					'createDirectory',
					pathKind === 'directory' ? 'openDirectory' : 'openFile',
				];

				const {canceled, filePaths} = (await ipcRenderer.invoke('show-open-dialog', {
					defaultPath: inputRef.current?.value,
					filters: pathFilters,
					properties,
				})) as Electron.OpenDialogReturnValue;
				const firstPath = filePaths[0];
				if (!canceled && firstPath) {
					onChange?.(formatSelection ? formatSelection(firstPath, `${value}`) : firstPath);
				}
			};

			buttons.push(
				<button onClick={openFile} title="Select path">
					<Icon name="folder" />
				</button>
			);
			break;
		}
		default:
			htmlAttrs = {minLength: min, maxLength: max, spellcheck};
	}

	function handleDoubleClick() {
		// Select all text if it is just one continuous word
		if (`${value}`.trim().match(/^\w+$/)) inputRef.current?.select();
	}

	let classNames = `Input -${type}`;
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (disabled) classNames += ` -disabled`;

	const inputSize = cols ? cols : max != null ? Math.max(step ? `${step}`.length : 0, `${max}`.length) : false;

	return (
		<div class={classNames} style={inputSize ? `--cols:${inputSize}` : undefined} title={tooltip}>
			<input
				{...rest}
				onKeyDown={handleKeyDown}
				placeholder={`${placeholder ?? ''}`}
				ref={inputRef}
				onInput={handleInput}
				id={id}
				name={name}
				type={htmlType}
				{...htmlAttrs}
				disabled={disabled}
				value={value == null ? '' : value}
				onDblClick={handleDoubleClick}
			/>
			{buttons}
			<div class="bg" />
		</div>
	);
}

/**
 * Handles keydown for number based input elements that enables
 * value incrementing/decrementing with Up/Down keyboard arrows.
 *
 * Modifiers:
 * shift      - 10
 * ctrl+shift - 100
 * alt        - 0.1
 * ctrl+alt   - 0.01
 */
function handleNumberInputKeyDown(
	event: TargetedEvent<HTMLInputElement, KeyboardEvent>,
	{min = -Infinity, max = Infinity, step}: {min?: number; max?: number; step?: number} = {}
) {
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

	const target = event.currentTarget;
	const targetValue = target.value.trim();
	const baseAmount = step ?? 1;
	const allowFractions = step !== null;

	if (/^\d+(\.\d+)?$/.exec(targetValue) == null) return;

	const value = !targetValue ? 0 : parseFloat(targetValue);

	if (Number.isFinite(value)) {
		event.preventDefault();

		let amount: number;
		if (event.ctrlKey && event.shiftKey) amount = baseAmount * 100;
		else if (allowFractions && (event.ctrlKey || event.metaKey) && event.altKey) amount = baseAmount * 0.01;
		else if (event.shiftKey) amount = baseAmount * 10;
		else if (allowFractions && event.altKey) amount = baseAmount * 0.1;
		else amount = baseAmount;

		const decimalRounder = Math.pow(10, Math.max(countDecimals(value), countDecimals(amount)));
		const add = event.key === 'ArrowDown' ? -amount : amount;

		// This gets rid of the floating point imprecision noise
		target.value = String(clamp(min, Math.round((value + add) * decimalRounder) / decimalRounder, max));

		target.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
	}
}
