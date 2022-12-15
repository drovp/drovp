import {signal} from 'statin';
import {roundDecimals} from 'lib/utils';
import {ProfileGridPosition} from 'models/profiles';

/**
 * A signal that ensures position is normalized:
 * - decimals are rounded to 6 points
 * - left and width are not overflowing
 */
export function positionSignal(initial: ProfileGridPosition) {
	let row = 0;
	let left = 0;
	let width = 0;

	const pos = {} as ProfileGridPosition;
	Object.defineProperties(pos, {
		row: {
			enumerable: true,
			get() {
				return row;
			},
			set(value: number) {
				row = Math.max(0, value);
			},
		},
		left: {
			enumerable: true,
			get() {
				return left;
			},
			set(value: number) {
				left = roundDecimals(Math.max(0, Math.min(1, value)), 6);
			},
		},
		width: {
			enumerable: true,
			get() {
				return width;
			},
			set(value: number) {
				width = roundDecimals(Math.max(0.01, Math.min(1, value)), 6);
			},
		},
	});
	Object.assign(pos, initial);

	const sig = signal(pos);

	function getSet(): ProfileGridPosition;
	function getSet(value: Partial<ProfileGridPosition>): void;
	function getSet(value?: Partial<ProfileGridPosition>) {
		return arguments.length ? sig.edit((pos) => Object.assign(pos, value)) : sig();
	}
	getSet.edit = sig.edit;
	getSet.changed = sig.changed;
	getSet.toJSON = sig.toJSON;
	Object.defineProperties(getSet, {
		value: {
			get() {
				return pos;
			},
			set(data: Partial<ProfileGridPosition>) {
				Object.assign(pos, data);
			},
		},
	});

	return getSet as typeof getSet & {value: ProfileGridPosition};
}
