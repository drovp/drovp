/** @type {any} */
const Color = require('colorjs.io').default;

/**
 * @param {Object} options - The shape is the same as SpecialType above
 * @param {string} options.name
 * @param {[number, number, number]} [options.l] [min, center, max]
 * @param {number | [number, number, number]} [options.c] [min, center, max]
 * @param {number | [number, number, number]} [options.h] [min, center, max]
 * @param {[number, number, number]} [options.levels] [min, max, step]
 * @param {boolean} [options.flipZ]
 */
function themeVariant({name, l = [0, 50, 100], c = 0, h = 0, levels = [0, 1000, 50], flipZ = false}) {
	const vars = {};
	const color = new Color('lch', [0, 0, 0]);
	/** @type {[number, number, number]} */
	const L = Array.isArray(l) ? l : [0, l, 100];
	/** @type {[number, number, number]} */
	const C = Array.isArray(c) ? c : [c, c, c];
	/** @type {[number, number, number]} */
	const H = Array.isArray(h) ? h : [h, h, h];
	const [minLevel, maxLevel, step] = levels;

	vars[`--${name}`] = `var(--${name}-500)`;

	const getLevelValue = (level, [min, center, max]) => {
		const centerProgress = (level - 500) / Math.abs((level < 500 ? minLevel : maxLevel) - 500);
		const value =
			centerProgress < 0 ? min + (center - min) * (1 + centerProgress) : center + (max - center) * centerProgress;
		return Math.round(value * 100) / 100;
	};

	// Color levels
	for (let level = minLevel; level <= maxLevel; level += step) {
		const zLevel = flipZ ? maxLevel - level : level;
		color.lch.l = getLevelValue(level, L);
		color.lch.c = getLevelValue(level, C);
		color.lch.h = getLevelValue(level, H);
		vars[`--${name}-${level}`] = color.to('srgb').toString({format: 'hex'});
		vars[`--${name}-z${level}`] = `var(--${name}-${zLevel})`;
	}

	// Opacity levels
	color.lch.c = C[1];
	color.lch.l = 50;

	for (let i = 1; i <= 5; i++) {
		color.alpha = i / 10;
		vars[`--${name}-o${i * 100}`] = color.to('srgb').toString({format: 'hex'});
	}

	return vars;
}

module.exports = {
	lightTheme: {
		'--brand': '#a767fa',
		'--fg': 'var(--grey-100)',
		'--variant-fg': 'var(--grey-1000)',
		'--bg': 'var(--grey-850)',
		'--bg-darker': 'var(--grey-750)',
		'--curtain': '#fff8',
		'--highlight': '#fff4',
		'--shadow': '#0003',
		'--top-o100': '#0001',
		'--bottom-o300': '#fff4',

		'--lighten-900': '#fff',
		'--lighten-700': '#fffb',
		'--lighten-500': '#fff8',
		'--lighten-300': '#fff6',
		'--lighten-100': '#fff4',
		'--lighten': 'var(--lighten-500)',

		'--darken-900': '#0003',
		'--darken-700': '#0002',
		'--darken-500': '#0001',
		'--darken-300': '#00000009',
		'--darken-100': '#00000008',
		'--darken': 'var(--darken-500)',

		'--muted-900': 'rgba(0, 0, 0, .9)',
		'--muted-700': 'rgba(0, 0, 0, .7)',
		'--muted-500': 'rgba(0, 0, 0, .5)',
		'--muted-400': 'rgba(0, 0, 0, .4)',
		'--muted-300': 'rgba(0, 0, 0, .3)',
		'--muted-200': 'rgba(0, 0, 0, .2)',
		'--muted-100': 'rgba(0, 0, 0, .1)',
		'--muted-50': 'rgba(0, 0, 0, .05)',
		'--muted': 'var(--muted-500)',

		...themeVariant({name: 'grey', flipZ: true}),
		...themeVariant({name: 'accent', h: 300, c: [10, 40, 40], flipZ: true}),
		...themeVariant({name: 'success', h: 130, c: [10, 40, 40], flipZ: true}),
		...themeVariant({name: 'info', h: 240, c: [10, 40, 40], flipZ: true}),
		...themeVariant({name: 'warning', h: 80, c: [10, 40, 40], flipZ: true}),
		...themeVariant({name: 'danger', h: 25, c: [10, 40, 40], flipZ: true}),
	},
	darkTheme: {
		'--brand': '#B882FF',
		'--fg': 'var(--grey-900)',
		'--variant-fg': 'var(--grey-1000)',
		'--bg': 'var(--grey-150)',
		'--bg-darker': 'var(--grey-50)',
		'--curtain': '#0008',
		'--highlight': '#ffffff0f',
		'--shadow': '#000a',
		'--top-o100': '#fff1',
		'--bottom-o300': '#0004',

		'--lighten-900': '#ffffff22',
		'--lighten-700': '#ffffff15',
		'--lighten-500': '#ffffff11',
		'--lighten-300': '#ffffff09',
		'--lighten-100': '#ffffff07',
		'--lighten': 'var(--lighten-500)',

		'--darken-900': '#00000066',
		'--darken-700': '#00000055',
		'--darken-500': '#00000044',
		'--darken-300': '#0000002a',
		'--darken-100': '#00000011',
		'--darken': 'var(--darken-500)',

		'--muted-900': 'rgba(255, 255, 255, .9)',
		'--muted-700': 'rgba(255, 255, 255, .7)',
		'--muted-500': 'rgba(255, 255, 255, .5)',
		'--muted-400': 'rgba(255, 255, 255, .4)',
		'--muted-300': 'rgba(255, 255, 255, .3)',
		'--muted-200': 'rgba(255, 255, 255, .2)',
		'--muted-100': 'rgba(255, 255, 255, .1)',
		'--muted-50': 'rgba(255, 255, 255, .05)',
		'--muted': 'var(--muted-500)',

		...themeVariant({name: 'grey'}),
		...themeVariant({name: 'accent', h: 300, c: [0, 40, 40]}),
		...themeVariant({name: 'success', h: 130, c: [0, 40, 40]}),
		...themeVariant({name: 'info', h: 260, c: [0, 40, 40]}),
		...themeVariant({name: 'warning', h: 70, c: [0, 40, 40]}),
		...themeVariant({name: 'danger', h: 26, c: [0, 40, 40]}),
	},
};
