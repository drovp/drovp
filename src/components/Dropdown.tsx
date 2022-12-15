import {h, RenderableProps, VNode} from 'preact';
import {TargetedEvent} from 'lib/utils';

export type DropdownProps = RenderableProps<{
	id?: string;
	name?: string;
	class?: string;
	value: string;
	variant?: Variant;
	disabled?: boolean;
	onChange: (value: string) => void;
	children: VNode<HTMLOptionElement>[];
}>;

/**
 * ```
 * <Dropdown
 *   value={'value'} // array of values will enable multiple mode
 *   onChange={newValue => config.set('prop', newValue)}
 *   >
 *   <option value="">none</option>
 *   <option value="foo">Foo</option>
 *   <option value="bar" disabled>Bar</option>
 * </Dropdown>
 * ```
 */
export function Dropdown({id, name, class: className, value, variant, disabled, onChange, children}: DropdownProps) {
	function handleChange(event: TargetedEvent<HTMLSelectElement>) {
		onChange(event.currentTarget.value as any);
	}

	// Select options
	for (const option of children) option.props.selected = value === option.props.value;

	let classNames = 'Dropdown';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<select class={classNames} id={id} name={name} disabled={disabled} onChange={handleChange}>
			{children}
		</select>
	);
}
