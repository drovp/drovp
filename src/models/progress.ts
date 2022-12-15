import type {Progress, ProgressData} from '@drovp/types';
export {Progress, ProgressData} from '@drovp/types';

export function createProgress(onUpdate: (progress: ProgressData) => void, initialData?: ProgressData): Progress {
	let data: ProgressData = initialData || {};

	const progress = ((
		completedParam?: ProgressData | null | undefined | number,
		totalParam?: number | null,
		indeterminateParam?: number | null
	) => {
		let oldCompleted = data.completed;
		let oldTotal = data.total;
		let oldIndeterminate = data.indeterminate;

		data = {};

		let completed: unknown;
		let total: unknown;
		let indeterminate: unknown;

		if (completedParam != null && typeof completedParam === 'object') {
			completed = completedParam.completed;
			total = completedParam.total;
			indeterminate = completedParam.indeterminate;
		} else {
			completed = completedParam;
			total = totalParam;
			indeterminate = indeterminateParam;
		}

		data.completed = typeof completed === 'number' ? completed : undefined;
		data.total = typeof total === 'number' ? total : undefined;
		data.indeterminate = typeof indeterminate === 'boolean' ? indeterminate : false;

		if (data.completed !== oldCompleted || data.total !== oldTotal || data.indeterminate !== oldIndeterminate) {
			oldCompleted = data.completed;
			oldTotal = data.total;
			oldIndeterminate = data.indeterminate;
			onUpdate(data);
		}
	}) as Progress;

	Object.defineProperties(progress, {
		data: {
			get: () => data,
			set: (value: ProgressData | null | undefined) => progress(value),
		},
		completed: {
			get: () => data.completed,
			set: (value: number) => progress(value, data.total, data.indeterminate),
		},
		total: {
			get: () => data.completed,
			set: (value: number) => progress(data.completed || 0, value, data.indeterminate),
		},
		indeterminate: {
			get: () => data.indeterminate,
			set: (value: boolean) => progress(data.completed, data.total, value),
		},
		// Just unbinds the onUpdate
		destroy: {value: () => (onUpdate = () => {})},
		toJSON: {value: () => data},
	});

	return progress as Progress;
}
