import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useIsDraggedOver} from 'lib/hooks';
import {observer} from 'statin-preact';
import {Icon} from 'components/Icon';
import {Scrollable} from 'components/Scrollable';
import {useStore} from 'models/store';
import type {Profile} from 'models/profiles';

export function ProfilesList({
	class: className,
	profiles,
	onNav,
}: {
	class?: string;
	profiles: Profile[];
	onNav?: (path: string) => void;
}) {
	let classNames = 'ProfilesList';
	if (className) classNames += ` ${className}`;

	return (
		<Scrollable class={classNames}>
			{profiles.map((profile) => (
				<ProfilesListItem key={profile.id} profile={profile} onClick={onNav} />
			))}
		</Scrollable>
	);
}

const ProfilesListItem = observer(function ProfilesListItem({
	profile,
	onClick,
}: {
	profile: Profile;
	onClick?: (path: string) => void;
}) {
	const {history} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const progress = profile.progress();
	const isEmployed = progress != null && progress < 1;
	const isDraggedOver = useIsDraggedOver(containerRef);

	function handleClick() {
		const path = `/profiles/${profile.id}`;
		history.push(path);
		onClick?.(path);
	}

	function handleDelete() {
		const duration = 100;
		containerRef.current?.animate(
			[
				{transform: 'translateX(0)', opacity: 1},
				{transform: 'translateX(-50px)', opacity: 0},
			],
			{duration, fill: 'forwards'}
		);
		setTimeout(profile.delete, duration);
	}

	let gotoLinkClassNames = 'goto';
	if (isDraggedOver) gotoLinkClassNames += ' -dragged-over';

	return (
		<article ref={containerRef}>
			<button
				class={gotoLinkClassNames}
				onClick={handleClick}
				title={profile.displayTitle()}
				onDrop={profile.handleDrop}
			>
				<span class="title">{profile.displayTitle()}</span>
				{isEmployed && <span class="progress" style={`--progress: ${progress}`} />}
				<Icon name="arrow-right" />
			</button>
			<button
				class="delete"
				onClick={handleDelete}
				title={
					profile.hasPendingOperations()
						? `Profile has pending operations so it can't be deleted`
						: 'Delete profile'
				}
				disabled={profile.hasPendingOperations()}
			>
				<Icon name="trash" />
			</button>
		</article>
	);
});
