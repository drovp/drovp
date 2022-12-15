import {h, Fragment} from 'preact';
import {RouteProps} from 'poutr';
import {useState, useRef} from 'preact/hooks';
import {useScrollPosition} from 'lib/hooks';
import {Button} from 'components/Button';
import {Tag} from 'components/Tag';
import {Icon, ICONS, IconName} from 'components/Icon';
import {Nav, NavLink} from 'components/Nav';
import {Select, SelectOption} from 'components/Select';
import {Scrollable} from 'components/Scrollable';

const makeFlags = (flags?: string, base: Record<string, any> = {}) =>
	(flags || '')
		.split(',')
		.filter((x) => !!x)
		.reduce((acc, flag) => {
			acc[flag.trim()] = true;
			return acc;
		}, base);

export function UITestsRoute({history, location}: RouteProps) {
	const scrollableRef = useRef<HTMLDivElement>(null);
	const section = location.searchParams.get('section') ?? 'colors';

	useScrollPosition(`UITests.${section}`, scrollableRef);

	return (
		<div class="UITests">
			<Nav>
				<NavLink to="/uitests?section=colors">Colors</NavLink>
				<NavLink to="/uitests?section=buttons">Buttons</NavLink>
				<NavLink to="/uitests?section=selects">Selects</NavLink>
				<NavLink to="/uitests?section=icons">Icons</NavLink>
			</Nav>
			<Scrollable class="section" innerRef={scrollableRef}>
				{section === 'colors' ? (
					<Palette />
				) : section === 'buttons' ? (
					<Buttons />
				) : section === 'selects' ? (
					<Selects />
				) : section === 'icons' ? (
					<Icons />
				) : (
					'unknown section'
				)}
			</Scrollable>
		</div>
	);
}

function Palette() {
	const levels = '0,50,100,200,300,400,500,600,700,800,900,950,1000'.split(',');
	const variants = 'grey,accent,success,info,warning,danger'.split(',');

	return (
		<div class="Palette">
			<div class="colors">
				<div style="background: var(--darken-900)" title="--darken-900" />
				<div style="background: var(--darken-700)" title="--darken-700" />
				<div style="background: var(--darken)" title="--darken" />
				<div style="background: var(--darken-300)" title="--darken-300" />
				<div style="background: var(--darken-100)" title="--darken-100" />
			</div>
			<div class="colors">
				<div style="background: var(--lighten-900)" title="--lighten-900" />
				<div style="background: var(--lighten-700)" title="--lighten-700" />
				<div style="background: var(--lighten)" title="--lighten" />
				<div style="background: var(--lighten-300)" title="--lighten-300" />
				<div style="background: var(--lighten-100)" title="--lighten-100" />
			</div>
			<div class="colors" style="margin-bottom: 1rem">
				<div style="background: var(--muted-900)" title="--muted-900" />
				<div style="background: var(--muted-700)" title="--muted-700" />
				<div style="background: var(--muted)" title="--muted" />
				<div style="background: var(--muted-300)" title="--muted-300" />
				<div style="background: var(--muted-100)" title="--muted-100" />
			</div>

			{variants.map((variant) => (
				<div class="colors -levels">
					{levels.map((level) => (
						<div
							class={level === '500' ? '-space-around' : undefined}
							style={`background: var(--${variant}-${level})`}
							title={`--${variant}-${level}`}
						>
							{level === '500' ? 'Tt' : ''}
						</div>
					))}
				</div>
			))}

			{variants.map((variant) => (
				<div class="colors -levels">
					{levels.map((level) => (
						<div
							class={level === '500' ? '-space-around' : undefined}
							style={`color: var(--${variant}-${level}, transparent)`}
							title={`--${variant}-${level}`}
						>
							Text
						</div>
					))}
				</div>
			))}

			{variants.map((variant) => (
				<div class="colors -levels">
					{['500', '400', '300', '200', '100'].map((level) => (
						<div style={`background: var(--${variant}-o${level})`}></div>
					))}
					{['500', '400', '300', '200', '100'].map((level) => (
						<div style={`color: var(--${variant}-o${level})`}>Text</div>
					))}
				</div>
			))}
		</div>
	);
}

function Buttons() {
	const [disabled, setDisabled] = useState(false);
	const [loading, setLoading] = useState(false);
	const variants = [undefined, ...'accent,success,info,warning,danger'.split(',')] as (undefined | Variant)[];

	const makeButtons = (flags?: string) =>
		variants.map((variant) => (
			<Button {...makeFlags(flags, {disabled, loading})} variant={variant}>
				{(variant || 'undefined').slice(0, 3)}
				<Tag>0</Tag>
			</Button>
		));

	return (
		<div class="UITestsSection">
			<h1>
				Button
				<Button semitransparent selected={disabled} onClick={() => setDisabled((value) => !value)}>
					disabled
				</Button>
				<Button semitransparent selected={loading} onClick={() => setLoading((value) => !value)}>
					loading
				</Button>
			</h1>
			<div>{makeButtons()}</div>
			<h2>muted</h2>
			<div>{makeButtons('muted')}</div>
			<h2>outline</h2>
			<div>{makeButtons('outline')}</div>
			<h2>outline dashed</h2>
			<div>{makeButtons('outline,dashed')}</div>
			<h2>outline muted</h2>
			<div>{makeButtons('outline,muted')}</div>
			<h2>semitransparent</h2>
			<div>{makeButtons('semitransparent')}</div>
			<h2>semitransparent muted</h2>
			<div>{makeButtons('semitransparent,muted')}</div>
			<h2>transparent</h2>
			<div>{makeButtons('transparent')}</div>
			<h2>transparent muted</h2>
			<div>{makeButtons('transparent,muted')}</div>
			<h2>underline</h2>
			<div>{makeButtons('underline')}</div>
			<h2>underline muted</h2>
			<div>{makeButtons('underline,muted')}</div>
		</div>
	);
}

function Selects() {
	const [disabled, setDisabled] = useState(false);
	const [showTags, setShowTags] = useState(true);
	const makeSelects = (flags?: string) =>
		[undefined, 'success'].map((variant) => (
			<SelectsCollection flags={makeFlags(flags, {disabled})} variant={variant} tags={showTags} />
		));

	return (
		<div class="UITestsSection">
			<h1>
				Select
				<Button semitransparent selected={disabled} onClick={() => setDisabled((value) => !value)}>
					disabled
				</Button>
				<Button semitransparent selected={showTags} onClick={() => setShowTags((value) => !value)}>
					tags
				</Button>
			</h1>
			<div>{makeSelects()}</div>
			<h2>transparent</h2>
			<div>{makeSelects('transparent')}</div>
		</div>
	);
}

function SelectsCollection({variant, flags, tags = false}: {variant?: string; flags: any; tags?: boolean}) {
	const [value1, setValue1] = useState('1');
	const [value2, setValue2] = useState('1');
	const [value3, setValue3] = useState(['1']);
	const [value4, setValue4] = useState(['1']);

	return (
		<Fragment>
			<div class="groupWrap">
				<Select {...flags} checks variant={variant} value={value1} onChange={setValue1}>
					<SelectOption value="1">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="2">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="3">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
				</Select>
				<Select {...flags} checks variant={variant} value={value2} onChange={setValue2}>
					<SelectOption value="1">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="accent" variant="accent">
						acc {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="success" variant="success">
						suc {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="info" variant="info">
						inf {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="warning" variant="warning">
						war {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="danger" variant="danger">
						dan {tags && <Tag>0</Tag>}
					</SelectOption>
				</Select>
			</div>
			<div class="groupWrap">
				<Select {...flags} checks variant={variant} value={value3} onChange={setValue3}>
					<SelectOption value="1">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="2">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="3">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
				</Select>
				<Select {...flags} checks variant={variant} value={value4} onChange={setValue4}>
					<SelectOption value="1">
						{(variant || 'undefined').slice(0, 3)} {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="accent" variant="accent">
						acc {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="success" variant="success">
						suc {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="info" variant="info">
						inf {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="warning" variant="warning">
						war {tags && <Tag>0</Tag>}
					</SelectOption>
					<SelectOption value="danger" variant="danger">
						dan {tags && <Tag>0</Tag>}
					</SelectOption>
				</Select>
			</div>
		</Fragment>
	);
}

function Icons() {
	return (
		<div class="UITestIcons">
			{(Object.keys(ICONS) as IconName[]).map((name) => (
				<Icon name={name} tooltip={name} />
			))}
		</div>
	);
}
