import {h} from 'preact';
import {action} from 'statin';
import {observer} from 'statin-preact';
import {useCache} from 'lib/hooks';
import {RouteProps, Redirect} from 'poutr';
import {ProfileRoute} from './Profile';
import {Tutorial} from 'components/Tutorial';
import {useStore} from 'models/store';
import {ProfileCards} from './ProfileCards';
import {Outputs} from './Outputs';
import {Tabs} from 'components/Tabs';

const junctionPath = '/profiles';

export function ProfilesJunction(props: RouteProps) {
	const {match, location, history} = props;
	let [lastUrl, setLastUrl] = useCache<string>('profiles.lastUrl', junctionPath);
	const isJunctionPath = location.path === junctionPath;

	// Click on the main nav button, needs to be triaged
	if (isJunctionPath) {
		const fromInside = history.from?.path.match(/^\/profiles(\/.*)?/) != null;
		if (!fromInside && lastUrl !== junctionPath) return <Redirect to={lastUrl} />;
	}

	setLastUrl(location.href);

	return match.groups?.id ? <ProfileRoute {...props} /> : <Profiles />;
}

const Profiles = observer(function Profiles() {
	const {profiles, outputs, settings, processors} = useStore();
	const {categories} = profiles;
	const allCategories = categories.all();
	const categoriesById = categories.byId();
	const activeCategoryId = categoriesById.has(settings.profileCategory())
		? settings.profileCategory()
		: allCategories[0]?.id || '';
	const activeCategory = categoriesById.get(activeCategoryId);
	const showTutorial = processors.all().length === 0 && profiles.all().length === 0;

	return (
		<div class="Profiles">
			{settings.showProfileTabs() && (
				<ProfileCategories
					activeId={activeCategoryId}
					onActivate={(id: string) => action(() => settings.profileCategory(id))}
				/>
			)}
			{!activeCategory || showTutorial ? (
				<Tutorial />
			) : (
				<ProfileCards key={activeCategoryId} category={activeCategory} />
			)}
			<Outputs
				title="Outputs"
				tooltip="Outputs of all profiles"
				outputs={outputs}
				heightRatio={settings.globalOutputsDrawerHeight()}
				onHeightRatioChange={settings.globalOutputsDrawerHeight}
				maxHeightRatio={0.8}
				profileTitles
				toOperationLinks={true}
			/>
		</div>
	);
});

export const ProfileCategories = observer(function ProfileCategories({
	activeId,
	onActivate,
	class: className,
}: {
	activeId: string;
	onActivate: (id: string) => void;
	class?: string;
}) {
	const {profiles, settings, app} = useStore();

	return (
		<Tabs
			class={className}
			tabs={profiles.categories.all().map((category) => ({id: category.id, title: category.title()}))}
			activeId={activeId}
			onActivate={onActivate}
			onLongDragEnter={onActivate}
			onMove={(from, to) => profiles.categories.move(from, to)}
			onAdd={(title, position) => profiles.categories.create({title, position})}
			onRename={(id, title) => action(() => profiles.categories.byId().get(id)?.title(title))}
			onDelete={profiles.categories.deleteMaybe}
			dragTarget={app.draggingMode() != null}
			contextMenuItems={[{label: 'Hide tabs', click: () => action(() => settings.showProfileTabs(false))}]}
			keepOne
		/>
	);
});
