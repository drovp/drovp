import {h, RenderableProps} from 'preact';
import {useMemo} from 'preact/hooks';
import {action} from 'statin';
import {observer} from 'statin-preact';
import {SelectSignal} from 'models/options';
import * as I from '@drovp/types';
import {Select, SelectOption} from 'components/Select';
import {Dropdown} from 'components/Dropdown';

export type OptionSelectProps = RenderableProps<{
	id?: string;
	name?: string;
	signal: SelectSignal;
	schema: I.OptionSelect;
	disabled?: boolean;
}>;

export const OptionSelect = observer(function OptionSelect({id, name, signal, schema, disabled}: OptionSelectProps) {
	const {options, renderDropdown, isMulti} = useMemo(() => {
		const options = Array.isArray(schema.options)
			? schema.options.map((name) => [name, name] as const)
			: Object.entries(schema.options);
		const isMulti = Array.isArray(schema.default);
		const isNullable = schema.nullable === true || schema.default == null;
		const contentWidthEstimate =
			options.reduce((letters, [_, title]) => letters + `${`${title}` || 'disabled'}`.length, 0) +
			(options.length - 1) * 4;
		const renderDropdown = !isMulti && contentWidthEstimate > 40;

		if (renderDropdown && isNullable) options.unshift(['', '']);

		return {options, renderDropdown, isMulti};
	}, [schema]);

	if (renderDropdown) {
		return (
			<Dropdown
				id={id}
				name={name}
				value={(signal() || '') as string}
				onChange={(value) => action(() => signal(value))}
				disabled={disabled}
			>
				{options.map(([name, title]) => (
					<option value={name}>{title}</option>
				))}
			</Dropdown>
		);
	}

	// Account for schema changing from single to multi value
	let value: any = signal();
	if (isMulti && !Array.isArray(value)) value = [value];

	return (
		<Select
			value={value}
			onChange={(value) => action(() => signal(value))}
			checks
			max={schema.max}
			nullable={schema.nullable}
			disabled={disabled}
		>
			{options.map(([name, title]) => (
				<SelectOption value={name}>{`${title}` || 'disabled'}</SelectOption>
			))}
		</Select>
	);
});
