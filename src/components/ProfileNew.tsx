import {h} from 'preact';
import {useRef, useMemo, useState} from 'preact/hooks';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {useVolley} from 'lib/hooks';
import {Icon} from 'components/Icon';
import {Vacant} from 'components/Vacant';
import {PluginDisplayName} from 'components/PluginDisplayName';
import {Button} from 'components/Button';
import {Tabs} from 'components/Tabs';
import {Scrollable} from 'components/Scrollable';
import {ProfileGridPosition} from 'models/profiles';

interface ProfileNewProps {
	pluginId?: string | null;
	initialSection?: 'new' | 'import';
	position?: Partial<ProfileGridPosition>;
	categoryId?: string;
	hideTabs?: boolean;
	onPayload: (payload: any) => void;
	onClose: (meta?: {canceled?: boolean}) => void;
	onCategoryIdChange?: (id: string) => void;
}

export const ProfileNew = observer(function ProfileNew({
	pluginId,
	categoryId: initialCategoryId,
	onCategoryIdChange,
	position,
	onClose,
	onPayload,
	hideTabs: hideTabsRequested,
}: ProfileNewProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const {processors, history, profiles, settings} = useStore();
	const hideTabs = hideTabsRequested || initialCategoryId != null;
	const [categoryId, setCategoryId] = useState<string>(initialCategoryId || settings.profileCategory());
	let allProcessors = processors.sorted();
	const cancel = () => onClose({canceled: true});
	const processorsToDisplay = useMemo(() => {
		return allProcessors.filter((processor) => !pluginId || processor.plugin.name === pluginId);
	}, [allProcessors, pluginId]);

	function createProfile(processorId: string) {
		const processor = processors.byId().get(processorId);
		if (!processor || !categoryId) return;
		const profile = processor.createAndGoToProfile({position, categoryId});
		onPayload(profile);
		onClose();
	}

	function goToRegistry() {
		history.push(`/registry`);
		cancel();
	}

	function handleCategoryIdChange(id: string) {
		setCategoryId(id);
		onCategoryIdChange?.(id);
	}

	useVolley(contentRef);

	return (
		<div class="ProfileNew">
			{!hideTabs && settings.showProfileTabs() && (
				<Tabs
					class="category"
					tabs={profiles.categories.all().map((category) => ({id: category.id, title: category.title()}))}
					activeId={categoryId}
					onActivate={handleCategoryIdChange}
					onDelete={profiles.categories.delete}
					keepOne
				/>
			)}
			<Scrollable class="content" innerRef={contentRef}>
				{!categoryId ? (
					<Vacant title="No category">There is no category to slot the profile in. Create one first.</Vacant>
				) : processorsToDisplay.length === 0 ? (
					<Vacant
						title="No processors yet"
						actions={[{title: 'Go to registry', icon: 'plugins', action: goToRegistry}]}
					>
						Install some plugins!
					</Vacant>
				) : (
					processorsToDisplay.map((processor) => (
						<button
							onClick={() => createProfile(processor.id)}
							title={`Processor: ${processor.name}\nPlugin: ${processor.plugin.name}`}
						>
							<header>
								<h1>{processor.name}</h1>
								<PluginDisplayName
									id={processor.plugin.name}
									isExternal={processor.plugin.isExternal}
								/>
							</header>
							<section>
								{processor.description && <p>{processor.description}</p>}
								<Icon name="arrow-right" />
							</section>
						</button>
					))
				)}
			</Scrollable>
			<div class="actions">
				<Button class="cancel" large variant="danger" onClick={cancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
});
