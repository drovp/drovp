import {h, RenderableProps, VNode} from 'preact';
import {isOfType} from 'lib/utils';
import {Icon} from 'components/Icon';

export type SelectPropsBase = RenderableProps<{
	id?: string;
	class?: string;
	value: string | number | (string | number)[] | null;
	max?: number;
	variant?: Variant;
	transparent?: boolean;
	disabled?: boolean;
	nullable?: boolean;
	checks?: boolean; // display checkboxes
	onChange: (value: any) => void;
	children: VNode<HTMLOptionElement> | VNode<HTMLOptionElement>[];
}>;

export type SelectPropsString = Omit<SelectPropsBase, 'value' | 'onChange'> & {
	value: string;
	onChange: (value: string) => void;
};

export type SelectPropsNumber = Omit<SelectPropsBase, 'value' | 'onChange'> & {
	value: number;
	onChange: (value: number) => void;
};

export type SelectPropsStringNullable = Omit<SelectPropsBase, 'value' | 'onChange' | 'nullable'> & {
	value: string | number | null;
	nullable: true;
	onChange: (value: string | number | null) => void;
};

export type SelectPropsArray = Omit<SelectPropsBase, 'value' | 'onChange' | 'nullable'> & {
	value: (string | number)[];
	onChange: (value: (string | number)[]) => void;
};

/**
 * ```
 * <Select
 *   value={'value'} // array of values will enable multiple mode
 *   onChange={newValue => config.set('prop', newValue)}
 *   >
 *   <SelectOption value="">none</SelectOption>
 *   <SelectOption value="foo">Foo</SelectOption>
 *   <SelectOption value="bar" disabled>Bar</SelectOption>
 * </Select>
 * ```
 */
export function Select(props: SelectPropsString): VNode<{}>;
export function Select(props: SelectPropsNumber): VNode<{}>;
export function Select(props: SelectPropsStringNullable): VNode<{}>;
export function Select(props: SelectPropsArray): VNode<{}>;
export function Select({
	id,
	class: className,
	value,
	max,
	variant,
	transparent,
	disabled,
	nullable,
	checks,
	onChange,
	children,
}: SelectPropsBase) {
	const isMulti = Array.isArray(value);
	const disableUnselected = isMulti && max != null && max <= value!.length;

	children = Array.isArray(children) ? children : [children];

	function handleMouseOrKeyDown(event: MouseEvent | KeyboardEvent) {
		if (disabled) return;

		const target = event.target;

		if (!isOfType<HTMLElement>(target, target != null && 'closest' in target)) return;

		const button = target.closest<HTMLButtonElement>('button[data-value]:not(:disabled)');

		if (!button) return;
		if (event instanceof MouseEvent && event.button !== 0) return;
		if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;

		event.preventDefault();

		let newValue: null | number | string | (string | number)[] = button.dataset.value || '';

		newValue = button.dataset.type === 'number' ? parseFloat(newValue) : `${newValue}`;

		if (Array.isArray(value)) {
			newValue = value.includes(newValue) ? value.filter((x) => x !== newValue) : [...value, newValue];
			if (max != null && newValue.length > max) return;
		} else if (nullable && newValue === value) {
			newValue = null;
		}

		onChange(newValue);
	}

	let classNames = 'Select';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (isMulti) classNames += ' -multi';
	if (transparent) classNames += ' -transparent';
	if (disabled) classNames += ' -disabled';

	return (
		<div class={classNames} onClick={handleMouseOrKeyDown} onKeyDown={handleMouseOrKeyDown}>
			{(children as VNode<SelectOptionProps>[]).map((option, index) => {
				if (option?.type !== SelectOption) {
					throw new Error(`Select only accepts SelectOption components as children.`);
				}

				let buttonChildren = option.props.children;
				let selected = Array.isArray(value)
					? value.indexOf(option.props.value) > -1
					: option.props.value === value;
				const isDisabled = option.props.disabled || disabled || (!selected && disableUnselected);

				// Transform strings into spans so that we can flexbox the content properly
				// This wouldn't be necessary if browsers were able to fucking center the
				// fucking text flowing content... `vertical-align: middle` is a bad joke!
				if (buttonChildren) {
					if (typeof buttonChildren === 'string') {
						buttonChildren = <span class="txt">{buttonChildren.trim()}</span>;
					} else if (Array.isArray(buttonChildren)) {
						for (let i = 0; i < buttonChildren.length; i++) {
							const content = buttonChildren[i];
							if (typeof content === 'string')
								buttonChildren[i] = <span class="txt">{content.trim()}</span>;
						}
					}
				}

				let className = 'SelectOption';
				if (option.props.class) className += ` ${option.props.class}`;
				if (selected) className += ' -selected';
				if (option.props.variant) className += ` -${option.props.variant}`;

				return (
					<button
						id={index === 0 && id ? id : undefined}
						class={className}
						data-value={option.props.value}
						data-type={typeof option.props.value}
						disabled={isDisabled}
						title={option.props.tooltip}
					>
						{isMulti && checks && (
							<span class="check">
								<Icon name="check" />
							</span>
						)}
						{option.props.children}
					</button>
				);
			})}
		</div>
	);
}

export type SelectOptionProps = RenderableProps<{
	class?: string;
	value: string | number;
	disabled?: boolean;
	variant?: Variant;
	tooltip?: string;
}>;

export const SelectOption = (props: SelectOptionProps) => null;
