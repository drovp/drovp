import {h} from 'preact';
import {useState} from 'preact/hooks';
import {Nav, NavLink} from 'components/Nav';
import {ProfileImport} from './ProfileImport';
import {ProfileNew} from './ProfileNew';
import {ProfileGridPosition} from 'models/profiles';
import {useStore} from 'models/store';

interface ProfileCreatorProps {
	initialSection?: 'new' | 'import';
	categoryId?: string;
	position?: Partial<ProfileGridPosition>;
	onPayload: (payload: any) => void;
	onClose: (meta?: {canceled?: boolean}) => void;
}

export function ProfileCreator({
	initialSection,
	onClose,
	onPayload,
	categoryId: initialCategoryId,
	position,
}: ProfileCreatorProps) {
	const {settings} = useStore();
	const [section, setSection] = useState(initialSection || 'new');
	const hideTabs = initialCategoryId == null;
	const [categoryId, setCategoryId] = useState<string>(initialCategoryId || settings.profileCategory());

	return (
		<div class="ProfileCreator">
			<Nav>
				<NavLink
					to="new"
					activeMatch={section === 'new'}
					onClick={() => setSection('new')}
					tooltip="Create a new clean profile for a selected processor"
				>
					New
				</NavLink>
				<NavLink
					to="import"
					activeMatch={section === 'import'}
					onClick={() => setSection('import')}
					tooltip={`Import a profile from an import code`}
				>
					Import
				</NavLink>
			</Nav>
			{{
				new: () => (
					<ProfileNew
						hideTabs={hideTabs}
						categoryId={categoryId}
						onCategoryIdChange={setCategoryId}
						position={position}
						onPayload={onPayload}
						onClose={onClose}
					/>
				),
				import: () => (
					<ProfileImport
						hideTabs={hideTabs}
						categoryId={categoryId}
						onCategoryIdChange={setCategoryId}
						position={position}
						onPayload={onPayload}
						onClose={onClose}
					/>
				),
			}[section]()}
		</div>
	);
}
