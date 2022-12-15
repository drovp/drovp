import {Type, isType} from 'lib/utils';
import {OpenWindowOptions} from '@drovp/types';

const variants = new Set<'info' | 'success' | 'warning' | 'danger'>(['info', 'success', 'warning', 'danger']);
export function isVariant(value: any): value is Variant {
	return variants.has(value);
}

export function isOpenWindowOptions(value: any): value is OpenWindowOptions {
	const errors: string[] = [];

	if (!isType(value.path, Type.String)) errors.push(`"path" must be a string.`);
	if (!isType(value.title, Type.String | Type.Undefined)) errors.push(`"title" must be a string or undefined.`);
	if (!isType(value.width, Type.Number | Type.Undefined)) errors.push(`"width" must be a number or undefined.`);
	if (!isType(value.height, Type.Number | Type.Undefined)) errors.push(`"height" must be a number or undefined.`);
	if (!isType(value.minWidth, Type.Number | Type.Undefined)) errors.push(`"minWidth" must be a number or undefined.`);
	if (!isType(value.minHeight, Type.Number | Type.Undefined))
		errors.push(`"minHeight" must be a number or undefined.`);

	if (errors.length > 0) {
		throw new Error(`Invalid OpenWindowOptions:${errors.map((message) => `\n- ${message}`).join('')}`);
	}

	return true;
}
