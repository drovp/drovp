import {h, RenderableProps, VNode} from 'preact';
import {isOfType} from 'lib/utils';
import {action} from 'statin';
import {observer} from 'statin-preact';
import {ListSignal, StringSignal, SelectSignal, NumberSignal} from 'models/options';
import * as I from '@drovp/types';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {OptionString} from 'components/OptionString';
import {OptionNumber} from 'components/OptionNumber';
import {OptionSelect} from 'components/OptionSelect';
import {Input} from 'components/Input';

export type OptionListProps = RenderableProps<{
	signal: ListSignal;
	path: (string | number)[];
	optionsData: I.OptionsData;
	disabled?: boolean;
}>;

export const OptionList = observer(function OptionList({signal, path, disabled, optionsData}: OptionListProps) {
	const itemSchema = signal.schema.schema;
	const items = signal();

	let valueToControl: any;

	// String
	if (isOfType<I.OptionString>(itemSchema, itemSchema.type === 'string')) {
		valueToControl = (signal: StringSignal<I.OptionString>) => (
			<OptionString signal={signal} path={path} optionsData={optionsData} disabled={disabled} />
		);
	}

	// Number
	else if (isOfType<I.OptionNumber>(itemSchema, itemSchema.type === 'number')) {
		valueToControl = (signal: NumberSignal) => <OptionNumber signal={signal} disabled={disabled} />;
	}

	// Path
	else if (isOfType<I.OptionPath>(itemSchema, itemSchema.type === 'path')) {
		valueToControl = (signal: StringSignal<I.OptionPath>) => (
			<Input
				value={signal()}
				type="path"
				pathKind={itemSchema.kind}
				pathFilters={itemSchema.filters}
				onChange={(value) => action(() => signal(value))}
				disabled={disabled}
			/>
		);
	}

	// Select
	else if (isOfType<I.OptionSelect>(itemSchema, itemSchema.type === 'select')) {
		valueToControl = (signal: SelectSignal) => (
			<OptionSelect signal={signal as SelectSignal} schema={itemSchema} disabled={disabled} />
		);
	}

	const itemNodes: VNode[] = [];

	for (let i = 0; i < items.length; i++) {
		itemNodes.push(
			<li key={items[i]}>
				{valueToControl(items[i])}
				<Button variant="danger" transparent muted disabled={disabled} onClick={() => signal.delete(i)}>
					<Icon name="x" />
				</Button>
			</li>
		);
	}

	let classNames = `ListControl -${itemSchema.type}`;
	if (disabled) classNames += ` -disabled`;

	return (
		<div class={classNames}>
			{itemNodes.length > 0 && <ul>{itemNodes}</ul>}
			<div class="controls">
				<Button disabled={disabled} onClick={signal.add}>
					<Icon name="plus" /> Add
				</Button>
			</div>
		</div>
	);
});
