import {signal, toJS as statinToJS, createAction} from 'statin';
import {isOfType, arrayMoveItem, isType, Type, uid, propPath} from 'lib/utils';
import {UnionToIntersection} from 'type-fest';
import {
	OptionBoolean,
	OptionString,
	OptionColor,
	OptionPath,
	OptionNumber,
	OptionSelect,
	OptionList,
	OptionNamespace,
	OptionCollection,
	OptionDivider,
	OptionCategory,
	OptionSerializable,
	OptionsLaxSchema,
	OptionsSchema,
	OptionsData,
} from '@drovp/types';

export type OptionFromPrimitive<T extends string | number | boolean | {[key: string]: string | number | boolean}> =
	T extends string
		? OptionString
		: T extends number
		? OptionNumber
		: T extends boolean
		? OptionBoolean
		: T extends {[key: string]: unknown}
		? OptionNamespace
		: never;

export type SignalFromOption<T extends OptionSerializable> = T extends OptionBoolean
	? BooleanSignal
	: T extends OptionString
	? StringSignal<OptionString>
	: T extends OptionColor
	? StringSignal<OptionColor>
	: T extends OptionPath
	? StringSignal<OptionPath>
	: T extends OptionNumber
	? NumberSignal<T>
	: T extends OptionSelect
	? SelectSignal<T>
	: T extends OptionCategory
	? CategorySignal<T>
	: T extends OptionList
	? ListSignal<T>
	: T extends OptionNamespace
	? NamespaceSignal<T>
	: T extends OptionCollection
	? CollectionSignal<T>
	: never;

export type OptionsSignals<T extends OptionsData, K = keyof T> = UnionToIntersection<
	K extends string ? {[_ in K]: SignalFromPrimitive<T[K]>} : never
>;
export type AnyOptionSignal =
	| BooleanSignal
	| StringSignal
	| NumberSignal
	| SelectSignal
	| CategorySignal
	| ListSignal
	| NamespaceSignal
	| CollectionSignal;
export type AnyOptionsSignals = Record<string, AnyOptionSignal>;

export type SignalFromPrimitive<T extends any> = T extends OptionsData
	? OptionSignal<OptionsSignals<T>>
	: T extends (infer R)[]
	? OptionSignal<SignalFromPrimitive<R>[]>
	: OptionSignal<T>;

export interface OptionSignal<T, S extends OptionSerializable = OptionSerializable> {
	(): T;
	(value: any): void;
	id: string;
	edit: (editor: (value: T) => void) => void;
	reset: () => void;
	toJSON: () => T;
	schema: S;
	value: T;
	changed: () => void;
}

/**
 * Validators.
 * API: return new value to be assigned, or throw error with reason as a message.
 * There is some sanitization going on. For example passing a string "5" into a
 * number validator will return a number.
 */

const isArray = Array.isArray;
const stringify = (value: any) => JSON.stringify(value, null, 2);

function validateBoolean(value: unknown): boolean {
	if (value == null || typeof value === 'object') throw new Error('Invalid value.');
	const stringified = `${value}`;
	return stringified === 'true' || stringified === '1';
}

export interface ValidateStringOptions {
	min?: number; // min string length
	max?: number; // max string length
	options?: string[];
}

function validateString(value: unknown, options?: ValidateStringOptions): string {
	if (value == null) throw new Error('Invalid value.');
	let string = `${value}`;
	if (options?.min != null && string.length < options.min) throw new Error(`Min length: ${options.min}`);
	if (options?.max != null && string.length > options.max) throw new Error(`Max length: ${options.max}`);
	if (options?.options) validateOption(value, {options: options.options});
	return string;
}

export interface ValidateNumberOptions {
	min?: number;
	max?: number;
	step?: number;
	steps?: number[];
}

function validateNumber(value: unknown, options?: ValidateNumberOptions): number {
	const asString = `${value}`.trim();
	if (!/^-?\d+(\.\d+)?$/.exec(asString)) throw new Error('Not a number.');
	let number = parseFloat(asString);
	if (options?.steps) {
		if (!options.steps.includes(number)) throw new Error(`Number is not one of the allowed steps.`);
		return number;
	}
	if (options?.step != null) {
		// We need to get rid of the floating point noise
		const remainder = number % options.step;
		if (remainder > 0.00000000001 && options.step - Math.abs(remainder) > 0.00000000001) {
			throw new Error(`Not an increment of ${options.step}.`);
		}
	}
	if (options?.min != null && number < options.min) throw new Error('Too small.');
	if (options?.max != null && number > options.max) throw new Error('Too big.');
	return number;
}

function validateInteger(value: unknown, options?: ValidateNumberOptions): number {
	if (!/^-?\d+(\.\d+)?$/.exec(`${value}`.trim())) throw new Error('Not an integer.');
	return validateNumber(value, options);
}

function validateOption<T extends any>(value: T, {options}: {options: any[]}): T {
	if (!options.includes(value))
		throw new Error(`Value "${value}" is not one of: ${options.join(', ').slice(0, 100)}.`);
	return value;
}

function validateOptions<T extends any | any[]>(values: T, {options, max}: {options: any[]; max?: number}): T {
	if (!Array.isArray(values)) throw new Error(`Value has to be an array.`);
	if (max && values.length > max) throw new Error(`Array has more than ${max} elements.`);
	for (const item of values) validateOption(item, {options});
	return values;
}

/**
 * The difference between this and statin's built in `toJS()` is that this one
 * also serializes temporary values. For persistency/exports of data, you
 * should still use the built in one.
 */
export function toJS(value: any) {
	serializeTemporaryValues = true;
	const result = statinToJS(value);
	serializeTemporaryValues = false;
	return result;
}

let serializeTemporaryValues = false;

/**
 * Creates a signal that validates a new value and throws when it doesn't pass.
 *
 * Initial assignment will never throw, and will instead fall back to the
 * default value defined by schema. This is so we can easily just throw saved
 * values into options creator and let them automatically sanitize.
 */
export function optionSignal<T extends unknown, S extends OptionSerializable>(
	schema: S,
	options: {
		normalize: (value: unknown, resetting?: boolean) => T;
		reset: (defaultValue: T) => T;
		default: T;
		toJSON?: (value: T) => any;
		allowToFail?: boolean;
	},
	initial: unknown
): OptionSignal<T, S>;
export function optionSignal<T extends unknown, S extends OptionSerializable>(
	schema: S,
	options: {
		normalize: (value: unknown, resetting?: boolean) => T | undefined;
		reset: (defaultValue: T | undefined) => T | undefined;
		toJSON?: (value: T | undefined) => any;
		allowToFail?: boolean;
	},
	initial: unknown
): OptionSignal<T | undefined, S>;
export function optionSignal<T extends unknown, S extends OptionSerializable>(
	schema: S,
	{
		normalize,
		reset,
		default: defaultValue,
		toJSON,
		allowToFail,
	}: {
		normalize: (value: unknown, resetting?: boolean) => T;
		reset: (defaultValue: T | undefined) => T | undefined;
		default?: T;
		toJSON?: (value: T | undefined) => any;
		allowToFail?: boolean;
	},
	initial: unknown
): OptionSignal<T | undefined, S> {
	if (schema.default != null) defaultValue = schema.default as any;
	if (initial === undefined) initial = defaultValue;

	let initialValue: T | undefined;

	if (allowToFail) {
		initialValue = normalize(initial);
	} else {
		// Initial assignment can't fail so that it can revert to default
		try {
			initialValue = normalize(initial);
		} catch {
			initialValue = reset(defaultValue);
		}
	}

	const getSet = signal<T | undefined>(initialValue);

	function wrappedGetSet(): T;
	function wrappedGetSet(value: unknown): void;
	function wrappedGetSet(value?: unknown) {
		if (arguments.length) {
			getSet(normalize(value));
		} else return getSet();
	}

	wrappedGetSet.id = uid(); // intended to be used in element keys
	wrappedGetSet.schema = schema;
	wrappedGetSet.edit = getSet.edit;
	wrappedGetSet.reset = createAction(() => {
		/**
		 * We update ID, and ensure the signal is being sent even when value
		 * didn't change. The reason is that UI elements keep their own internal
		 * state for input value and if it doesn't match signal value they
		 * render error indicators. The code below ensures not only that the
		 * reset updates views, but also that the associated components get
		 * recreated, and flush their internal state.
		 */
		wrappedGetSet.id = uid();
		getSet.value = reset(defaultValue);
		getSet.changed();
	});
	wrappedGetSet.toJSON = toJSON ? () => toJSON(getSet()) : () => getSet();
	wrappedGetSet.changed = getSet.changed;

	Object.defineProperty(wrappedGetSet, 'value', {
		get: () => getSet.value,
		set: (value: T) => {
			getSet.value = value;
		},
	});

	return wrappedGetSet as OptionSignal<T, S>;
}

/**
 * Validated signals for each option type.
 *
 * Regarding implementations of latter signals, hey, it's either `as any` or
 * I'm jumping off a bridge, ... this is really not fun to implement safely.
 * Or maybe I just suck :(.
 */

export type BooleanSignal<S extends OptionBoolean = OptionBoolean> = OptionSignal<boolean, S>;
export function boolean<S extends OptionBoolean>(schema: S, initial: unknown): BooleanSignal<S> {
	return optionSignal(
		schema,
		{normalize: validateBoolean, reset: (defaultValue) => defaultValue, default: false},
		initial
	);
}

export type NumberSignal<S extends OptionNumber = OptionNumber> = OptionSignal<
	S extends {nullable: true} ? number | undefined : number,
	S
>;
export function number<S extends OptionNumber>(schema: S, initial: unknown): NumberSignal<S> {
	const options = schema.steps
		? {steps: schema.steps}
		: {
				min: schema.softMin ? undefined : schema.min,
				max: schema.softMax ? undefined : schema.max,
				step: schema.step,
		  };
	const validator = schema.kind === 'float' ? validateNumber : validateInteger;
	return optionSignal(
		schema,
		{
			normalize: (value) => (!value && `${value}` !== '0' && schema.nullable ? null : validator(value, options)),
			reset: (defaultValue) => defaultValue,
		},
		initial
	) as any;
}

export type StringSignal<S extends OptionString | OptionPath | OptionColor = OptionString | OptionPath | OptionColor> =
	OptionSignal<string, S>;
export function string<S extends OptionString | OptionPath | OptionColor>(
	schema: S,
	initial: unknown
): StringSignal<S> {
	return optionSignal(
		schema,
		{
			normalize: (value) => validateString(value, schema.type === 'string' ? schema : undefined),
			reset: (defaultValue) => defaultValue,
			default: '',
		},
		initial
	);
}

export type SelectSignal<S extends OptionSelect = OptionSelect> = OptionSignal<
	S extends {nullable: true}
		? S extends {default: string[]}
			? undefined | string[]
			: undefined | string
		: S extends {default: string[]}
		? string[]
		: string,
	S
>;
export function select<S extends OptionSelect>(schema: S, initial: unknown): SelectSignal<S> {
	const options = isArray(schema.options) ? schema.options : Object.keys(schema.options);
	const validatorOptions = {options, maxValues: schema.max};
	const isMulti = Array.isArray(schema.default);
	return optionSignal(
		schema,
		{
			normalize: (value) =>
				isMulti
					? validateOptions(value, validatorOptions)
					: !value && schema.nullable
					? null
					: (validateOption(value, validatorOptions) as any),
			reset: (defaultValue) => defaultValue,
		},
		initial
	) as any;
}

export type CategorySignal<S extends OptionCategory = OptionCategory> = OptionSignal<string, S>;
export function category<S extends OptionCategory>(schema: S): CategorySignal<S> {
	const options = isArray(schema.options) ? schema.options : Object.keys(schema.options);
	return optionSignal(
		schema,
		{
			normalize: (value: unknown) => validateString(value) as any,
			reset: () => options[0],
			toJSON: (value) => (serializeTemporaryValues ? value : undefined),
		},
		options[0]
	);
}

export interface ListSignal<S extends OptionList = OptionList>
	extends OptionSignal<S['schema'] extends OptionNumber ? NumberSignal[] : StringSignal[], S> {
	add: (options?: any) => void;
	delete: (index: number) => void;
	move: (sourceIndex: number, destinationIndex: number) => void;
}
export function list<T extends OptionList>(schema: T, initial: unknown): ListSignal<T> {
	const itemSchema = schema.schema;
	const itemSignalCreator = (schema: any, value: any) => {
		switch (itemSchema.type) {
			case 'number':
				return number(schema, value);
			case 'string':
			case 'path':
				return string(schema, value);
			case 'select':
				return select(schema, value);
			default:
				throw new Error(`Unsupported select item schema type "${itemSchema.type}".`);
		}
	};
	const signalValues = (values: unknown[]) => values.map((value: unknown) => itemSignalCreator(itemSchema, value));
	const getSet = optionSignal(
		schema,
		{
			normalize: (values: unknown) => {
				if (!isArray(values)) throw new Error('Not an array.');
				return signalValues(values);
			},
			reset: () => (schema.default ? signalValues(schema.default) : []),
		},
		initial
	) as any;

	getSet.add = createAction(() => {
		getSet.edit((list: any[]) => list.push(itemSignalCreator(itemSchema, itemSchema.default)));
	});
	getSet.delete = createAction((index: number) => getSet.edit((list: any[]) => list.splice(index, 1)));
	getSet.move = createAction((from: number, to: number) =>
		getSet.edit((list: any[]) => arrayMoveItem(list, from, to))
	);

	return getSet;
}

// UNSAFE! signal value is untyped, as it'd require schema to data to signals conversion which I'm too
// lazy to type since it is not necessary
export type NamespaceSignal<S extends OptionNamespace = OptionNamespace> = OptionSignal<any, S>;
export function namespace<S extends OptionNamespace>(
	schema: S,
	initial?: any,
	parentPath?: (string | number)[]
): NamespaceSignal<S> {
	// This is a signal just so that all options are consistently signals and have a `.reset()`
	// method, which makes implementing "reset to defaults" button easy.
	// Sanitizer never returns null since in this case it has to either work, or throw.
	const path = parentPath ? [...parentPath, schema.name] : [schema.name];
	const objectToOptions = (initial: unknown) => createOptions(schema.schema, initial, path);
	return optionSignal(
		{default: {}} as any,
		{normalize: objectToOptions, reset: objectToOptions, allowToFail: true},
		initial
	) as any;
}

// UNSAFE! same reason as NamespaceSignal above
export interface CollectionSignal<S extends OptionCollection = OptionCollection> extends OptionSignal<any[], S> {
	add: (options?: any) => void;
	delete: (index: number) => void;
	move: (sourceIndex: number, destinationIndex: number) => void;
}
export function collection<T extends OptionCollection>(
	schema: T,
	initial: unknown,
	parentPath?: (string | number)[]
): CollectionSignal<T> {
	const namespaceSchema = {schema: schema.schema} as OptionNamespace;
	const path = parentPath ? [...parentPath, schema.name] : [schema.name];
	const getSet = optionSignal(
		schema,
		{normalize, reset: (defaultValue) => signalValues(defaultValue), default: []},
		initial
	) as CollectionSignal<T>;

	function signalValues(values: unknown[]) {
		return values.map((value, index) => namespace(namespaceSchema, value, [...path, index]));
	}

	function normalize(values: unknown) {
		if (!isArray(values)) throw new Error('Not an array.');
		return signalValues(values);
	}

	getSet.add = createAction(() =>
		getSet.edit((collection) =>
			collection.push(namespace(namespaceSchema, undefined, [...path, collection.length]) as any)
		)
	);
	getSet.delete = createAction((index: number) => getSet.edit((values) => values.splice(index, 1)));
	getSet.move = createAction((from: number, to: number) =>
		getSet.edit((collection) => arrayMoveItem(collection, from, to))
	);

	return getSet;
}

/**
 * Lax to schema conversion.
 */

function primitiveToOptionSchema<T extends string | number | boolean | {[key: string]: string | number | boolean}>(
	name: string,
	value: unknown
): OptionFromPrimitive<T> {
	const type = typeof value;
	let schema: any;
	if (isOfType<boolean>(value, type === 'boolean')) {
		schema = {name, type: 'boolean', default: value} as OptionBoolean;
	} else if (isOfType<string>(value, type === 'string')) {
		schema = {name, type: 'string', default: value} as OptionString;
	} else if (isOfType<number>(value, type === 'number')) {
		schema = {name, type: 'number', default: value} as OptionNumber;
	} else if (isOfType<{[key: string]: number | string | boolean}>(value, value != null && type === 'object')) {
		schema = {name, type: 'namespace', schema: optionsSchemaFromLax(value)} as OptionNamespace;
	}

	if (schema != null) return schema;

	throw new Error(`Invalid lax option "${name}" schema: ${JSON.stringify(schema, null, 2)}`);
}

export function optionsSchemaFromLax<T extends OptionsLaxSchema>(laxSchema: T): OptionsSchema {
	const schema: OptionsSchema = [];
	for (const [name, value] of Object.entries(laxSchema)) schema.push(primitiveToOptionSchema(name, value));
	return schema;
}

/**
 * Creates custom signal from option schema config.
 */
const listItemSchemaTypes = ['string', 'path', 'number', 'select'];
const pathKinds = [undefined, 'file', 'directory'];
const numberKinds = [undefined, 'integer', 'float'];
function signalFromOptionSchema<T extends OptionSerializable>(schema: T, initial?: unknown): SignalFromOption<T> {
	if (!isType(schema, Type.Object)) throw new Error(`Invalid option schema.`);
	if (!isType(schema.type, Type.String)) throw new Error(`"type" must be a string`);
	if (!isType(schema.title, Type.Nuldef | Type.String) && schema.title !== false)
		throw new Error(`"title" must be a string or false`);
	if (!isType(schema.hint, Type.Nuldef | Type.String | Type.Function))
		throw new Error(`"hint" must be a string or a function`);
	if (!isType(schema.description, Type.Nuldef | Type.String | Type.Function))
		throw new Error(`"description" must be a string or a function`);
	if (!isType(schema.isDisabled, Type.Nuldef | Type.Boolean | Type.Function))
		throw new Error(`"isDisabled" must be a function or a boolean`);
	if (!isType(schema.isHidden, Type.Nuldef | Type.Boolean | Type.Function))
		throw new Error(`"isHidden" must be a function or a boolean`);

	// String
	if (isOfType<OptionString>(schema, schema.type === 'string')) {
		if (!isType(schema.default, Type.String | Type.Nuldef)) throw new Error(`"default" must be a string`);
		if (!schema.default) schema.default = '';
		for (const prop of ['cols', 'rows', 'min', 'max', 'asyncValidatorDebounce']) {
			if (!isType((schema as any)[prop], Type.Nuldef | Type.Number))
				throw new Error(`"${prop}" must be a number`);
		}
		for (const prop of ['validator', 'asyncValidator']) {
			if (!isType((schema as any)[prop], Type.Nuldef | Type.Function))
				throw new Error(`"${prop}" must be a function`);
		}
		return string(schema, initial) as unknown as SignalFromOption<T>;
	}

	// Color
	if (isOfType<OptionColor>(schema, schema.type === 'color')) {
		if (!isType(schema.default, Type.String | Type.Nuldef)) throw new Error(`"default" must be a string`);
		if (!schema.default) schema.default = '';
		return string(schema, initial) as unknown as SignalFromOption<T>;
	}

	// Path
	if (isOfType<OptionPath>(schema, schema.type === 'path')) {
		if (!isType(schema.default, Type.String | Type.Nuldef)) throw new Error(`"default" must be a string`);
		if (!schema.default) schema.default = '';
		if (!pathKinds.includes(schema.kind))
			throw new Error(`"kind" must be one of "${pathKinds.filter((i) => !!i).join('", "')}"`);
		if (!isType(schema.filters, Type.Nuldef | Type.Array)) throw new Error(`filters must be an array`);
		return string(schema, initial) as unknown as SignalFromOption<T>;
	}

	// Boolean
	if (isOfType<OptionBoolean>(schema, schema.type === 'boolean')) {
		if (!isType(schema.default, Type.Boolean | Type.Undefined)) throw new Error(`"default" must be a boolean`);
		if (!schema.default) schema.default = false;
		return boolean(schema, initial) as unknown as SignalFromOption<T>;
	}

	// Number
	if (isOfType<OptionNumber>(schema, schema.type === 'number')) {
		if (!isType(schema.default, Type.Number | Type.Nuldef))
			throw new Error(`"default" must be a number or null/undefined`);
		if (schema.default === undefined) schema.default = null;

		if (!numberKinds.includes(schema.kind)) throw new Error(`"kind" must be one of ${numberKinds.join('", "')}`);

		if (!isType(schema.nullable, Type.Boolean | Type.Undefined))
			throw new Error(`"nullable" must be a boolean or undefined`);

		const nullable = schema.nullable ?? schema.default == null;
		if (!nullable && !isType(schema.default, Type.Number)) {
			throw new Error(`"default" value is required if "nullable" is disabled`);
		}

		for (const prop of ['min', 'max', 'step']) {
			if (!isType((schema as any)[prop], Type.Nuldef | Type.Number))
				throw new Error(`"${prop}" must be a number`);
		}

		for (const prop of ['softMin', 'softMax']) {
			if (!isType((schema as any)[prop], Type.Nuldef | Type.Boolean))
				throw new Error(`"${prop}" must be a boolean`);
		}

		schema.nullable = nullable;

		return number(schema, initial) as unknown as SignalFromOption<T>;
	}

	// Select
	if (isOfType<OptionSelect>(schema, schema.type === 'select')) {
		if (!isType(schema.default, Type.String | Type.Number | Type.Array | Type.Nuldef))
			throw new Error(`"default" must be a string or an array of strings`);
		if (schema.default === undefined) schema.default = null;

		if (isType<any[]>(schema.options, Type.Array)) {
			if (schema.options.length === 0) throw new Error(`"options" array can't be empty`);
			if (schema.options.findIndex((value: any) => typeof value !== 'string' && typeof value !== 'number') > -1) {
				throw new Error(`"options" array can only contain strings or numbers`);
			}
		} else if (!isType(schema.options, Type.Object)) {
			throw new Error(`"options" can only be an array of strings, or "{name: "Title"}" map`);
		}

		if (!isType(schema.nullable, Type.Boolean | Type.Nuldef))
			throw new Error(`"nullable" must be a boolean or null/undefined`);

		if (schema.nullable == null) {
			schema.nullable = schema.default == null;
		} else if (schema.nullable === false && schema.default == null) {
			throw new Error(`"default" value is required if "nullable" is disabled`);
		}

		for (const prop of ['min', 'max']) {
			if (!isType((schema as any)[prop], Type.Nuldef | Type.Number))
				throw new Error(`"${prop}" must be a number`);
		}

		return select(schema, initial) as SignalFromOption<T>;
	}

	// Category
	if (isOfType<OptionCategory>(schema, schema.type === 'category')) {
		if (!isType(schema.default, Type.String)) throw new Error(`"default" must be a string`);
		if (isType<any[]>(schema.options, Type.Array)) {
			if (schema.options.length === 0) throw new Error(`"options" array can't be empty`);
			if (schema.options.findIndex((value: any) => typeof value !== 'string') > -1) {
				throw new Error(`"options" array can only contain strings`);
			}
		} else if (!isType(schema.options, Type.Object | Type.Function)) {
			throw new Error(
				`"options" can only be an array of strings, "{name: "Title"}" map, or a function that returns one of those`
			);
		}
		return category(schema) as SignalFromOption<T>;
	}

	// List
	if (isOfType<OptionList>(schema, schema.type === 'list')) {
		if (listItemSchemaTypes.indexOf(schema.schema.type) === -1) {
			throw new Error(`item schema type must be one of "${listItemSchemaTypes.join('", "')}"`);
		}
		if (!isType(schema.default, Type.Array | Type.Undefined))
			throw new Error(`default value must be an array or undefined`);

		if (!schema.default) schema.default = [];

		return list(schema, initial) as SignalFromOption<T>;
	}

	// Namespace
	if (isOfType<OptionNamespace>(schema, schema.type === 'namespace')) {
		if (!isType(schema.schema, Type.Array)) throw new Error(`"${schema.name}.schema" must be an array`);
		return namespace(schema, initial) as SignalFromOption<T>;
	}

	// Collection
	if (isOfType<OptionCollection>(schema, schema.type === 'collection')) {
		if (!isType(schema.schema, Type.Array)) throw new Error(`"${schema.name}.schema" must be an array`);
		return collection(schema, initial) as SignalFromOption<T>;
	}

	// @ts-ignore
	throw new Error(`unknown schema type "${schema.type}"`);
}

/**
 * Creates options signal map from schema and initial values.
 *
 * ```ts
 * const options = createOptions([{name: 'foo', type: 'boolean', default: false}], {foo: true});
 * options.foo(); // true
 * ```
 */
export function createOptions<T extends OptionsData | undefined = undefined>(
	schema: OptionsSchema<any>,
	initial?: any,
	parentPath?: (string | number)[]
): T extends OptionsData ? OptionsSignals<T> : AnyOptionsSignals {
	const optionsMap: Record<string, OptionSignal<any>> = {};
	const optionNames = new Set<string>();

	for (let i = 0; i < schema.length; i++) {
		const schemaItem = schema[i]!;
		if (!isOfType<OptionDivider>(schemaItem, schemaItem.type === 'divider')) {
			try {
				if (optionNames.has(schemaItem.name)) throw new Error(`duplicate option name`);
				optionNames.add(schemaItem.name);
				if (typeof schemaItem.name !== 'string') throw new Error('property "name" must be a string');
				optionsMap[schemaItem.name] = signalFromOptionSchema(schemaItem, initial?.[schemaItem.name]);
			} catch (_error) {
				const error = _error as any;
				if (error.isOptionSchemaError) throw error;
				const dotPath = (parentPath ? [...parentPath, schemaItem.name] : [schemaItem.name]).join('.');
				error.message = `option "${dotPath}" schema error: ${error.message}\n${stringify(schemaItem)}`;
				error.isOptionSchemaError = true;
				throw error;
			}
		}
	}

	return optionsMap as any;
}

export const resetOptions = createAction((options: Record<string, OptionSignal<any>>) => {
	for (let [name, option] of Object.entries(options)) {
		try {
			option.reset();
		} catch (error) {
			console.error(`Resetting option "${name}" error:`, error);
		}
	}
});

const includesJSLiteral = (value?: unknown) => `${value}`.includes('${') === true;

export function listStringValues(data: any, schema?: OptionsSchema, path: (string | number)[] = []) {
	const values: {name: string; value?: any; isSuspicious: boolean}[] = [];

	if (!schema) return values;

	for (const option of schema) {
		const currentPath: string[] = [...path, (option as any).name];

		if (option.type === 'string' || option.type === 'path') {
			const value = propPath(data, currentPath);
			values.push({name: currentPath.join('.'), value, isSuspicious: includesJSLiteral(value)});
		}

		if (option.type === 'list' && option.schema.type === 'string') {
			const listValues = propPath(data, currentPath);
			if (Array.isArray(listValues)) {
				for (let i = 0; i < listValues.length; i++) {
					const itemPath = [...currentPath, i];
					const value = propPath(data, itemPath);
					values.push({name: itemPath.join('.'), value, isSuspicious: includesJSLiteral(value)});
				}
			}
		}

		if (option.type === 'namespace') values.push(...listStringValues(data, option.schema, currentPath));

		if (option.type === 'collection') {
			const collectionItems = propPath(data, currentPath);
			if (Array.isArray(collectionItems)) {
				for (let i = 0; i < collectionItems.length; i++) {
					const itemPath = [...currentPath, i];
					values.push(...listStringValues(data, option.schema, itemPath));
				}
			}
		}
	}

	return values;
}
