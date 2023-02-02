import {h} from 'preact';
import {useRef, useState, useMemo} from 'preact/hooks';
import {toJS} from 'statin';
import {makePromise, idModifiers, uid} from 'lib/utils';
import {Store} from 'models/store';
import {Profile} from 'models/profiles';
import {createOptions} from 'models/options';
import {Options} from 'components/Options';
import {OptionsSchema, Item} from '@drovp/types';
import {useScrollPosition} from 'lib/hooks';
import {Nav, NavLink} from 'components/Nav';
import {Icon} from 'components/Icon';
import {Items} from 'components/Items';
import {Vacant} from 'components/Vacant';
import {Scrollable} from 'components/Scrollable';
import {ProfileInstructions} from 'components/Profile';

export interface OptionsTweakerData {
	options: Record<string, any>;
	modifiers: string;
}

export function showOptionsTweaker(store: Store, items: Item[], profile: Profile) {
	const schema = profile.processor()?.optionsSchema;

	if (!schema) {
		throw new Error(
			`Can't tweak options for this profile. It's processor is either missing, or it doesn't have any options to tweak.`
		);
	}

	const options = createOptions(schema, profile.optionsData());
	const [promise, resolve] = makePromise<OptionsTweakerData | false>();
	const modifiers = profile.processorModifiers();
	const modifiersHelp =
		modifiers.length === 0
			? undefined
			: `Available modifiers to hold while pressing the Confirm button:\n${modifiers
					.map(([name, description]) => `${name}: ${description}`)
					.join('\n')}`;

	store.modals.create({
		content: <OptionsTweaker items={items} profile={profile} schema={schema} options={options} />,
		sideActions: [
			{
				icon: 'x',
				title: 'Cancel',
				tooltip: 'Cancel drop',
				variant: 'danger',
				action: () => resolve(false),
			},
		],
		actions: [
			{
				icon: 'check',
				title: 'Confirm',
				tooltip: `Drop inputs into the profile with these options`,
				help: modifiersHelp,
				variant: 'success',
				action: (event) =>
					resolve({
						options: toJS(options),
						modifiers: idModifiers(event),
					}),
			},
		],
	});

	return promise;
}

function OptionsTweaker({
	items,
	profile,
	schema,
	options,
}: {
	items: Item[];
	profile: Profile;
	schema: OptionsSchema;
	options: Record<string, any>;
}) {
	const [section, setSection] = useState('options');
	const processor = profile.processor();
	const instructions = processor?.instructions || processor?.plugin.readme;
	const mountId = useMemo(() => uid(), []);

	return (
		<Scrollable class="OptionsTweaker">
			<Nav>
				<NavLink to="inputs" onClick={setSection} activeMatch={section === 'inputs'} tooltip="Inputs">
					<Icon name="input" /> Inputs
				</NavLink>
				<NavLink to="options" onClick={setSection} activeMatch={section === 'options'} tooltip="Options">
					<Icon name="cog" /> Options
				</NavLink>
				<NavLink
					to="instructions"
					onClick={setSection}
					activeMatch={section === 'instructions'}
					tooltip="Instructions"
				>
					<Icon name="info" /> Instructions
				</NavLink>
			</Nav>
			{section === 'inputs' ? (
				<TweakerInputs mountId={mountId} items={items} />
			) : section === 'instructions' ? (
				<ProfileInstructions mountId={mountId} instructions={instructions} />
			) : (
				<TweakerOptions mountId={mountId} schema={schema} options={options} />
			)}
		</Scrollable>
	);
}

const TweakerOptions = function TweakerOptions({
	schema,
	options,
	mountId,
}: {
	schema: OptionsSchema;
	options: Record<string, any>;
	mountId: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useScrollPosition(`TweakerOptions.${mountId}`, containerRef);

	return (
		<Scrollable innerRef={containerRef} class="TweakerOptions">
			<Options namespace="tweaker" schema={schema} options={options} />
		</Scrollable>
	);
};
const TweakerInputs = function TweakerInputs({items, mountId}: {items: Item[]; mountId: string}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useScrollPosition(`TweakerInputs.${mountId}`, containerRef);

	return items.length > 0 ? (
		<Items innerRef={containerRef} class="TweakerInputs" items={items} />
	) : (
		<Vacant>No inputs</Vacant>
	);
};
