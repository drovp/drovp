import {h, RenderableProps, VNode} from 'preact';
import {useState, useMemo, useRef, Ref, useEffect} from 'preact/hooks';
import {computed, action} from 'statin';
import {observer} from 'statin-preact';
import {eem, isOfType, uid, propPath} from 'lib/utils';
import {openContextMenu, ContextMenuItem} from 'lib/contextMenus';
import {
	AnyOptionSignal,
	AnyOptionsSignals,
	StringSignal,
	NumberSignal,
	BooleanSignal,
	SelectSignal,
	CategorySignal,
	ListSignal,
	NamespaceSignal,
	CollectionSignal,
	toJS,
	resetOptions,
} from 'models/options';
import {useStore} from 'models/store';
import * as I from '@drovp/types';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Pre} from 'components/Pre';
import {Checkbox} from 'components/Checkbox';
import {Input} from 'components/Input';
import {Color} from 'components/Color';
import {OptionSelect} from './OptionSelect';
import {OptionNumber} from './OptionNumber';
import {OptionString} from './OptionString';
import {OptionList} from './OptionList';
import {Nav, NavLink} from 'components/Nav';

interface OptionsProps {
	class?: string;
	namespace?: string; // Namespace ID's for inputs so they don't collide
	options: AnyOptionsSignals;
	schema: I.OptionsSchema<any>;
	innerRef?: Ref<HTMLDivElement | null>;
	menuItems?: ContextMenuItem[];
}

/**
 * Implementation:
 * Everything is flattened (namespaces, collections, ...). This allows nice
 * inwards page transition, and is rather simple to style. Only caveat is
 * that extra care has to be placed on keying the elements.
 */
export const Options = observer(function Options({
	class: className,
	schema: optionsSchema,
	options,
	namespace,
	innerRef,
	menuItems,
}: OptionsProps) {
	const containerRef = innerRef || useRef<HTMLDivElement>(null);
	const optionsData = useMemo(() => computed(() => toJS(options)), [options])();
	const compact = useStore().settings.compact();
	const elements: VNode[] = [];

	function openOptionsMenu(event: MouseEvent, signal?: AnyOptionSignal) {
		event.preventDefault();
		event.stopPropagation();
		openContextMenu([
			signal
				? {
						label: `Reset option to default value`,
						click: signal.reset,
						sublabel: 'Or Shift+Click the title',
				  }
				: false,
			{label: 'Reset all to default', click: () => resetOptions(options)},
			...(menuItems ? [{type: 'separator' as const}, ...menuItems] : []),
		]);
	}

	function renderDivider(
		schema: Pick<I.OptionBase, 'title' | 'description'>,
		key: string,
		path: (string | number)[],
		value?: any,
		onContextMenu?: (event: MouseEvent) => void
	) {
		const description = computeStringProp('description', schema, value, optionsData, path);
		if (schema.title || description) {
			elements.push(
				<div class="OptionDivider -inverted-color-scheme" key={key} onContextMenu={onContextMenu}>
					<div class="content">
						{schema.title && <h1 class="title">{schema.title}</h1>}
						<Description class="description" description={description} />
					</div>
				</div>
			);
		}
	}

	function renderCategory(signal: CategorySignal, schema: I.OptionCategory, key: string) {
		const value = signal();
		const options = typeof schema.options === 'function' ? schema.options(optionsData) : schema.options;
		const optionsMap = Array.isArray(options)
			? options.reduce((map, name) => {
					map[name] = name;
					return map;
			  }, {} as {[key: string]: string})
			: options;
		elements.push(
			<div class="OptionCategory" key={key}>
				<Nav>
					{Object.keys(optionsMap).map((name) => (
						<NavLink
							to={name}
							activeMatch={value === name}
							onClick={(value) => action(() => signal(value))}
							tooltip={`${optionsMap[name]} (options category)`}
						>
							<span>{optionsMap[name]}</span>
						</NavLink>
					))}
				</Nav>
			</div>
		);
	}

	function renderOptions(
		optionsSchema: I.OptionsSchema,
		options: AnyOptionsSignals,
		parentPath?: (string | number)[],
		parentDisabled?: boolean,
		extraItemClass?: string
	) {
		for (let i = 0; i < optionsSchema.length; i++) {
			const schema = optionsSchema[i]! as I.OptionSchema<any>;
			const name = (schema as any).name || i;
			const path = parentPath ? [...parentPath, name] : [name];
			const dotPath = path.join('.');
			const value = propPath(optionsData, path);

			try {
				const isHidden = schema?.isHidden;
				if (typeof isHidden === 'function' ? isHidden?.(value as never, optionsData, path) : isHidden) continue;

				/**
				 * Decorative elements.
				 */

				// Divider
				if (isOfType<I.OptionDivider>(schema, schema.type === 'divider')) {
					renderDivider(schema, `divider-${dotPath}`, path);
					continue;
				}

				// Category
				if (isOfType<I.OptionCategory>(schema, schema.type === 'category')) {
					renderCategory(options[schema.name] as CategorySignal, schema, `category-${dotPath}`);
					continue;
				}

				/**
				 * Complex options.
				 */
				const isDisabled =
					parentDisabled ||
					(typeof schema.isDisabled === 'function'
						? schema.isDisabled?.(value as never, optionsData, path)
						: schema.isDisabled);
				const signal = options[name];
				let subtype: string | undefined = undefined;

				if (!signal) throw new Error(`Missing signal for option schema "${dotPath}"`);

				// Namespace
				if (isOfType<I.OptionNamespace>(schema, schema.type === 'namespace')) {
					renderDivider(schema, `namespace-divider-${dotPath}`, path, value, (event) =>
						openOptionsMenu(event, signal)
					);
					renderOptions(schema.schema, (signal as NamespaceSignal)(), path, isDisabled);
					continue;
				}

				// Collection
				if (isOfType<I.OptionCollection>(schema, schema.type === 'collection')) {
					const collectionSignal = signal as CollectionSignal;
					const optionGroups = collectionSignal();

					renderDivider(schema, `collection-divider-${dotPath}`, path, value, (event) =>
						openOptionsMenu(event, signal)
					);

					for (let i = 0; i < optionGroups.length; i++) {
						const optionsGroup = optionGroups[i]!;
						const itemPath = [...path, i];
						renderOptions(schema.schema, optionsGroup(), itemPath, isDisabled, '-collection-item');
						elements.push(
							<div class="collection-group-actions" key={`collection-item-actions-${itemPath.join('.')}`}>
								<hr />
								<Button variant="danger" transparent onClick={() => collectionSignal.delete(i)}>
									<Icon name="arrow-left-up" /> Delete {schema.itemTitle ? schema.itemTitle : 'group'}
								</Button>
							</div>
						);
					}

					elements.push(
						<Button
							key={`collection-actions-${dotPath}`}
							outline
							dashed
							class="add-collection-item"
							disabled={isDisabled}
							onClick={collectionSignal.add}
						>
							<Icon name="plus" />
							{`Add ${schema.itemTitle || ''}`}
						</Button>
					);
					continue;
				}

				/**
				 * Complex options are over, now we are only constructing control
				 * element to be passed to a simple Option component.
				 */
				const id = `${namespace ? `${namespace}-` : ''}option-${dotPath}`;
				let controlElement: VNode | undefined;

				// Boolean
				if (isOfType<I.OptionBoolean>(schema, schema.type === 'boolean')) {
					const s = signal as BooleanSignal;
					controlElement = (
						<Checkbox
							id={id}
							name={id}
							checked={s()}
							onChange={(value) => action(() => s(value))}
							disabled={isDisabled}
						/>
					);
				}

				// Number
				else if (isOfType<I.OptionNumber>(schema, schema.type === 'number')) {
					controlElement = (
						<OptionNumber id={id} name={id} signal={signal as NumberSignal} disabled={isDisabled} />
					);
				}

				// String
				else if (isOfType<I.OptionString>(schema, schema.type === 'string')) {
					controlElement = (
						<OptionString
							id={id}
							name={id}
							signal={signal as StringSignal<I.OptionString>}
							path={path}
							optionsData={optionsData}
							disabled={isDisabled}
						/>
					);
				}

				// Color
				else if (isOfType<I.OptionColor>(schema, schema.type === 'color')) {
					controlElement = (
						<Color
							id={id}
							name={id}
							value={value}
							onChange={(value) => action(() => signal(value))}
							disabled={isDisabled}
							formatSelection={schema.formatSelection}
						/>
					);
				}

				// Path
				else if (isOfType<I.OptionPath>(schema, schema.type === 'path')) {
					const s = signal as StringSignal<I.OptionPath>;
					controlElement = (
						<Input
							class="PathControl"
							type="path"
							id={id}
							name={id}
							pathKind={schema.kind}
							pathFilters={schema.filters}
							value={s()}
							onChange={(value) => action(() => s(value))}
							disabled={isDisabled}
							formatSelection={schema.formatSelection}
						/>
					);
				}

				// Select
				else if (isOfType<I.OptionSelect>(schema, schema.type === 'select')) {
					controlElement = (
						<OptionSelect
							id={id}
							name={id}
							signal={signal as SelectSignal}
							schema={schema}
							disabled={isDisabled}
						/>
					);
				}

				// List
				else if (isOfType<I.OptionList>(schema, schema.type === 'list')) {
					if (isOfType<I.OptionString>(schema.schema, schema.schema.type === 'string')) {
						subtype = `of-${schema.schema.rows && schema.schema.rows > 1 ? 'text' : 'string'}`;
					} else {
						subtype = `of-${schema.schema.type}`;
					}
					controlElement = (
						<OptionList
							signal={signal as ListSignal}
							path={path}
							optionsData={optionsData}
							disabled={isDisabled}
						/>
					);
				}

				const {hint, description} = computeStringProps(schema, value, optionsData, path);

				elements.push(
					<Option
						key={signal.id}
						id={id}
						signal={signal}
						title={schema.title ?? name}
						type={schema.type}
						subtype={subtype}
						extraClass={extraItemClass}
						hint={hint}
						isChanged={isSignalChanged(signal)}
						description={description}
						onContextMenu={(event) => openOptionsMenu(event, signal)}
						compact={compact}
					>
						{controlElement}
					</Option>
				);
			} catch (error) {
				elements.push(<OptionError key={uid()} dotPath={dotPath} error={error} />);
			}
		}

		return elements;
	}

	renderOptions(optionsSchema, options);

	if (process.env.NODE_ENV === 'development') {
		// Key integrity check:
		// - all elements must have a key
		// - all keys must be unique
		const map = new Map();
		for (const node of elements) {
			if (node.key == null) console.log('null key', node);
			if (map.has(node.key)) console.log('duplicate key', map.get(node.key), node);
			map.set(node.key, node);
		}
	}

	let classNames = 'Options';
	if (className) classNames += ` ${className}`;

	return (
		<div class={classNames} ref={containerRef}>
			{elements}
		</div>
	);
});

export type OptionProps = RenderableProps<{
	id: string;
	signal: AnyOptionSignal;
	title: string | false;
	type: string;
	subtype?: string;
	extraClass?: string;
	isChanged?: boolean;
	hint?: string;
	description?: string;
	onContextMenu?: (event: MouseEvent) => void;
	compact?: boolean;
}>;

export function Option({
	id,
	signal,
	title,
	type,
	subtype,
	extraClass,
	hint,
	isChanged,
	description,
	children,
	onContextMenu,
	compact = false,
}: OptionProps) {
	let classNames = `Option -${type}`;
	if (subtype) classNames += ` -${subtype}`;
	if (extraClass) classNames += ` ${extraClass}`;
	if (isChanged) classNames += ` -changed -info`;
	const [showHelpState, setShowHelp] = useState(false);
	const showDescriptionToggle = description != null && compact;
	const showHelp = compact ? showHelpState : true;

	function handleClick(event: MouseEvent) {
		if (event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			signal.reset?.();
		}
	}

	return (
		<div class={classNames} onContextMenu={onContextMenu}>
			{title && (
				<label class="title" for={id} title={title} onClick={handleClick}>
					<span class="text">{title}</span>
					{isChanged && (
						<button title="Reset to default value" onClick={signal.reset}>
							<Icon name="refresh" />
						</button>
					)}
					{showDescriptionToggle && (
						<button
							class={showHelp ? '-active' : undefined}
							title="Toggle description"
							onClick={() => setShowHelp(!showHelp)}
						>
							<Icon name={showHelp ? 'info-up' : 'info-down'} />
						</button>
					)}
				</label>
			)}
			{children}
			{hint != null && <Hint value={hint} />}
			{showHelp && (
				<Description
					class="description"
					description={description}
					initialReveal={showDescriptionToggle}
					onCrop={() => setShowHelp(false)}
				/>
			)}
		</div>
	);
}

function Hint({value}: {value: string}) {
	const containerRef = useRef<HTMLSpanElement>(null);
	const [minWidth, setMinWidth] = useState<string>('auto');

	useEffect(() => {
		const container = containerRef.current;
		if (container) setMinWidth(`${container.clientWidth}px`);
	}, [value]);

	return <span ref={containerRef} class="Hint" style={{minWidth}} dangerouslySetInnerHTML={{__html: `${value}`}} />;
}

export const OptionError = observer(function OptionError({dotPath, error}: {dotPath: string; error: any}) {
	return (
		<div class={`OptionError -option-${dotPath}`}>
			<h1>Option "{dotPath}" schema error</h1>
			<Pre>{eem(error, true)}</Pre>
		</div>
	);
});

function Description({
	class: className,
	description,
	cutoff = 280,
	initialReveal = false,
	onReveal,
	onCrop,
}: {
	class?: string;
	description?: string;
	cutoff?: number;
	initialReveal?: boolean;
	onReveal?: () => void;
	onCrop?: () => void;
}) {
	const displayToggle = useMemo(() => {
		if (!description) return false;
		if (description.length > cutoff) return true;
		if ((description.match(/\<br|\<\/p\>|\<\\li\>/g) || []).length > 3) return true;
	}, [description]);
	const [reveal, setReveal] = useState(initialReveal);

	let containerClassNames = 'OptionDescription';
	if (className) containerClassNames += ` ${className}`;
	if (displayToggle && !reveal) containerClassNames += ' -confined';
	if (reveal) containerClassNames += ' -enabled';

	function handleToggle() {
		setReveal(!reveal);
		if (reveal) onCrop?.();
		else onReveal?.();
	}

	return description ? (
		<div class={containerClassNames}>
			<div class="description TextContent" dangerouslySetInnerHTML={{__html: `${description}`}} />
			{displayToggle && (
				<button tabIndex={-1} class="toggle" onClick={handleToggle}>
					{reveal ? ['Show less ', <b>-</b>] : ['Show more ', <b>+</b>]}
				</button>
			)}
		</div>
	) : null;
}

export function computeStringProps(
	schema: {[key: string]: any},
	value: any,
	optionsData: any,
	path: (string | number)[]
): {hint?: string; description?: string} {
	return {
		hint: computeStringProp('hint', schema, value, optionsData, path),
		description: computeStringProp('description', schema, value, optionsData, path),
	};
}

export function computeStringProp(
	prop: string,
	schema: {[key: string]: any},
	value: any,
	optionsData: any,
	path: (string | number)[]
): string | undefined {
	if (typeof schema[prop] === 'string') return schema[prop] ?? undefined;
	if (typeof schema[prop] === 'function') {
		const toText = schema[prop] as any;
		return toText(value, optionsData, path) ?? undefined;
	}
}

function isSignalChanged(signal: AnyOptionSignal) {
	switch (signal.schema.type) {
		case 'namespace':
			return false;
		case 'list':
			const defaultList = signal.schema.default || [];
			const valueList = signal.value.map((signal: any) => signal.value);
			return defaultList.length !== valueList.length || defaultList.join(',') !== valueList.join(',');
		default:
			return (
				(Array.isArray(signal.schema.default) ? signal.schema.default.join(',') : signal.schema.default) !==
				(Array.isArray(signal.value) ? signal.value.join(',') : signal.value)
			);
	}
}
