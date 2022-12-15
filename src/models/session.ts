import {createOptions, OptionsSignals} from 'models/options';

const defaults = {outputsCategory: 'all'};
type OptionsData = typeof defaults;
export const schema = [
	{
		name: 'outputsCategory' as const,
		type: 'string' as const,
		default: defaults.outputsCategory,
	},
];

export type Session = OptionsSignals<OptionsData>;

export function createSession(initial?: any) {
	return createOptions<OptionsData>(schema, initial);
}
