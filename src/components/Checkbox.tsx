import {h, RenderableProps} from 'preact';
import {useMemo} from 'preact/hooks';
import {uid} from 'lib/utils';
import {Icon} from 'components/Icon';

export type CheckboxProps = RenderableProps<{
	id?: string;
	name?: string;
	class?: string;
	checked: boolean;
	variant?: Variant;
	onChange?: (checked: boolean) => void;
	disabled?: boolean;
}>;

export function Checkbox({id, name, class: className, checked, variant, onChange, disabled}: CheckboxProps) {
	id = useMemo(() => id || uid(), [id]);

	function handleChange(event: Event) {
		if (event.target instanceof HTMLInputElement) onChange?.(event.target.checked);
	}

	let classNames = 'Checkbox';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (checked) classNames += ' -checked';
	if (disabled) classNames += ' -disabled';

	return (
		<div class={classNames}>
			<input id={id} type="checkbox" name={name} checked={checked} onChange={handleChange} disabled={disabled} />
			<label for={id} class="checkbox">
				<Icon name="check" />
			</label>
		</div>
	);
}
