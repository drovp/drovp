import {h, RenderableProps, VNode} from 'preact';
import {useRef, useState, useEffect} from 'preact/hooks';
import {reaction, action} from 'statin';
import {observer} from 'statin-preact';
import {SetOptional} from 'type-fest';
import {useScrollPosition, useVolley, useElementSize} from 'lib/hooks';
import {TargetedEvent, clamp, roundDecimals} from 'lib/utils';
import {Spinner} from 'components/Spinner';
import {Icon} from 'components/Icon';
import {Scrollable} from 'components/Scrollable';
import {useStore} from 'models/store';
import {
	Profile,
	Category,
	getCardWidthFraction,
	ProfileGridPosition,
	isProfileDraggingMeta,
	normalizeProfilePosition,
	gridPrecision,
} from 'models/profiles';
import {ProfileWrapper} from './Profile';

const occupiedColumns = new Set<number>();

type ProfileCardProps = RenderableProps<{
	profile: Profile;
	style?: string;
	clickable?: boolean;
}>;

export const ProfileCard = observer(function ProfileCard({profile, style, clickable}: ProfileCardProps) {
	const {history, settings} = useStore();
	const completed = profile.batch.completed();
	const errors = profile.batch.errors();
	const title = profile.title();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;

		// Visualize newly created profiles
		if (container && Date.now() - profile.createdAt < 1000) {
			container.animate(
				[
					{backgroundColor: getComputedStyle(container).getPropertyValue('--info-o500')},
					{backgroundColor: 'transparent'},
				],
				{duration: 1300}
			);
		}
	}, []);

	return (
		<ProfileWrapper
			innerRef={containerRef}
			class="ProfileCard"
			profile={profile}
			onClick={clickable === false ? undefined : () => history.push(`/profiles/${profile.id}`)}
			draggable
			compact={settings.compact()}
			style={style}
		>
			<header>
				<h1 class={title ? 'title' : 'placeholder'}>{profile.displayTitle()}</h1>
				{profile.isAdding() && (
					<div class="adding">
						<Spinner /> <span class="count">{profile.added()}</span>
					</div>
				)}
			</header>
			<div class="meta">
				<span class={`completed${completed > 0 ? ' -active' : ''}`} title="Completed successfully">
					<span class="value">{completed}</span>
					<span class="title">completed</span>
				</span>
				<span class={`errors${errors > 0 ? ' -active' : ''}`} title="Completed with errors">
					<div class="value">{errors}</div>
					<div class="title">errors</div>
				</span>
			</div>
		</ProfileWrapper>
	);
});

interface ProfileDropData {
	profileId: string;
	isBetween: boolean;
	position: ProfileGridPosition;
}

export const ProfileCards = observer(function ProfileCards({category}: {category: Category}) {
	const {settings, app, modals, profiles} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const itemHeight = settings.compact() ? '8em' : '9em';
	const rows = category.rows();
	const profilesGridColumns = settings.profilesGridColumns();
	const columnFraction = roundDecimals(1 / profilesGridColumns, 6);
	const minCardWidth = 100;
	const minCardFraction = getCardWidthFraction(profilesGridColumns, minCardWidth);
	const defaultCardFraction = Math.min(getCardWidthFraction(profilesGridColumns), 0.333333);
	const [draggingMode, setDraggingMode] = useState<string | null>(null);
	const isProfileDragged = draggingMode === 'profile';
	const draggingMeta = isProfileDragged ? app.draggingMeta() : null;
	const [isResizing, setIsResizing] = useState(false);
	const [profileDropData, setProfileDropData] = useState<ProfileDropData | null>(null);

	// This is necessary to work around https://crbug.com/445641
	useEffect(
		() =>
			reaction(() => {
				const draggingMode = app.draggingMode();
				setTimeout(() => setDraggingMode(draggingMode), 2);
			}),
		[]
	);

	useElementSize(containerRef);
	useScrollPosition(`ProfileCards.${category.id}`, containerRef);
	useVolley(containerRef);

	function initResize(
		event: TargetedEvent<HTMLDivElement, MouseEvent>,
		profile: Profile,
		side: 'left' | 'right',
		prev: Profile | undefined,
		next: Profile | undefined
	) {
		const container = containerRef.current;
		const handle = event.currentTarget;
		if (!container) return;
		const position = profile.position.value;
		const containerRect = container.getBoundingClientRect();
		const columnWidth = containerRect.width / profilesGridColumns;
		const getColumn = (clientX: number) => Math.round(clientX / columnWidth);
		const prevPos = prev?.position();
		const prevEndColumn = Math.round((prevPos ? prevPos.left + prevPos.width : 0) / columnFraction);
		const startColumn = Math.round(position.left / columnFraction);
		const endColumn = Math.round((position.left + position.width) / columnFraction);
		const nextStartColumn = Math.round((next?.position().left ?? 1) / columnFraction);
		const minWidthColumns = Math.round(minCardWidth / columnWidth);

		setIsResizing(true);

		function handleMove(event: MouseEvent) {
			action(() => {
				if (side === 'right') {
					const column = clamp(startColumn + minWidthColumns, getColumn(event.x), nextStartColumn);
					const newValue = column * columnFraction - profile.position.value.left;
					if (profile.position.value.width !== newValue) {
						profile.position.edit((position) => (position.width = newValue));
					}
				} else {
					const column = clamp(prevEndColumn, getColumn(event.x), endColumn - minWidthColumns);
					const newValue = column * columnFraction;
					if (profile.position.value.left !== newValue) {
						profile.position.edit((position) => {
							const right = position.left + position.width;
							position.left = newValue;
							position.width = right - newValue;
						});
					}
				}
			});
		}

		function handleUp() {
			setIsResizing(false);
			document.documentElement.style.cursor = '';
			handle.classList.remove('-active');
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);
		}

		document.documentElement.style.cursor = 'ew-resize';
		handle.classList.add('-active');
		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);
	}

	function handleDragEnter(
		event: TargetedEvent<HTMLDivElement, DragEvent>,
		positionLoose: SetOptional<ProfileGridPosition, 'width'>,
		isBetween = false
	) {
		profiles.resetDraggedOver();
		const container = containerRef.current;
		if (!container || !isProfileDraggingMeta(draggingMeta)) return;
		const columnWidth = container.clientWidth / profilesGridColumns;
		const {offsetX, profileId, width} = draggingMeta;
		const offsetSize = Math.max(0, Math.ceil(offsetX / columnWidth) - 1) * columnFraction;
		const position = {...positionLoose, left: positionLoose.left - offsetSize, width};
		let slot: ProfileGridPosition | undefined;

		if (isBetween) {
			slot = normalizeProfilePosition(position);
		} else {
			slot = category.reslotInRow(position, {
				ignoreProfileId: profileId,
				refit: true,
				minWidth: minCardFraction,
				nearestGapOnly: true,
				nearestGapMaxDistance: position.width / 2,
			});
		}

		if (!slot) {
			setProfileDropData(null);
			return;
		}

		const indicator = {profileId, isBetween, position: slot};
		setProfileDropData(indicator);

		const placeholder = event.currentTarget;
		const handleLeave = () => {
			setProfileDropData((old) => (old === indicator ? null : old));
			placeholder.removeEventListener('dragleave', handleLeave);
			document.removeEventListener('dragend', handleLeave);
		};
		placeholder.addEventListener('dragleave', handleLeave);
		document.addEventListener('dragend', handleLeave);
	}

	function handleDrop(event: DragEvent) {
		if (!profileDropData) return;
		const {profileId, position, isBetween} = profileDropData;
		const profile = profiles.byId().get(profileId);
		if (!profile) return;
		action(() => {
			profile.categoryId(category.id);
			if (isBetween) category.insertRowAt(position.row);
			profile.position(position);
		});
		setProfileDropData(null);
	}

	// Construct rows
	const cards: VNode[] = [];
	const helpers: VNode[] = [];

	function makeCreateButton(slot: ProfileGridPosition, key: string) {
		return (
			<button
				key={key}
				class="createButton"
				style={`
					top: calc(${itemHeight} * ${slot.row} + 1px);
					left: calc(${slot.left * 100}% + 1px);
					width: calc(${slot.width * 100}% - 2px);
					height: calc(${itemHeight} - 2px);
				`}
				onClick={() => modals.createProfile({categoryId: category.id, position: slot})}
				title="Create or import a new profile into this slot"
			>
				<Icon name="plus" />
			</button>
		);
	}

	for (let r = 0; r < rows.length; r++) {
		const row = rows[r]!;

		occupiedColumns.clear();

		if (!draggingMode && !isResizing) {
			if (row.length === 0) {
				// Remove row button
				helpers.push(
					<button
						key={`row-${r}-remove`}
						data-volley-ignore
						class="rowButton -remove"
						style={`top:calc(${itemHeight} * ${r})`}
						onClick={() => category.deleteRow(r)}
						title="Remove row below"
					>
						<Icon name="trash" />
					</button>
				);
			} else if (r === 0) {
				// Add row button
				helpers.push(
					<button
						key={`row-${r}-add`}
						data-volley-ignore
						class="rowButton -add"
						style={`top:0`}
						onClick={() => category.insertRowAt(r)}
						title="Add row here"
					>
						<Icon name="plus" />
					</button>
				);
			}
		}

		// If there are no items in row, or there is a space at the start
		// display a create button there.
		const firstCardPosition = row[0]?.position();
		if (
			!draggingMode &&
			!isResizing &&
			(!firstCardPosition || firstCardPosition.left - minCardFraction > -gridPrecision)
		) {
			helpers.push(
				makeCreateButton(
					{
						row: r,
						left: 0,
						width: firstCardPosition
							? Math.max(minCardFraction, Math.min(defaultCardFraction, firstCardPosition.left))
							: defaultCardFraction,
					},
					`${r}-first-create`
				)
			);
		}

		// Row cards
		for (let p = 0; p < row.length; p++) {
			const profile = row[p]!;
			const prev = row[p - 1];
			const next = row[p + 1];
			const pos = profile.position();
			const nextPos = next?.position();

			// Keep track of occupied columns
			if (draggingMeta?.profileId !== profile.id) {
				const startColumn = Math.round(pos.left / columnFraction);
				const endColumn = Math.round((pos.left + pos.width) / columnFraction);
				for (let i = startColumn; i < endColumn; i++) occupiedColumns.add(i);
			}

			// Resize handles
			if (!draggingMode) {
				helpers.push(
					<div
						key={`${r}-${p}-left-handle`}
						data-volley-ignore
						class="hResizeHandle -left"
						style={`
							left:${pos.left * 100}%;
							top:calc(${itemHeight} * ${r});
							height:${itemHeight};
						`}
						onMouseDown={(event) => initResize(event, profile, 'left', prev, next)}
					/>,
					<div
						key={`${r}-${p}-right-handle`}
						data-volley-ignore
						class="hResizeHandle -right"
						style={`
							left:${(pos.left + pos.width) * 100}%;
							top:calc(${itemHeight} * ${r});
							height:${itemHeight};
						`}
						onMouseDown={(event) => initResize(event, profile, 'right', prev, next)}
					/>
				);
			}

			// Actual card
			cards.push(
				<ProfileCard
					key={profile.id}
					profile={profile}
					clickable={!isResizing}
					style={`
						left:calc(${pos.left * 100}% + 1px);
						top:calc(${itemHeight} * ${r} + 1px);
						width:calc(${pos.width * 100}% - 2px);
						height:calc(${itemHeight} - 2px);
					`}
				/>
			);

			// Create profile button
			if (!draggingMode && !isResizing) {
				const span = profile.columnSpan();
				const right = columnFraction * span.end;
				const nextLeft = nextPos?.left ?? 1;
				const nextAvailableWidth = nextLeft - right;
				if (nextAvailableWidth - minCardFraction > -gridPrecision) {
					helpers.push(
						makeCreateButton(
							{row: r, left: right, width: Math.min(nextAvailableWidth, defaultCardFraction)},
							`${r}-${p}-create`
						)
					);
				}
			}
		}

		// Render droppable zones for profile dragging
		if (isProfileDragged) {
			for (let i = 0; i < profilesGridColumns; i++) {
				if (!occupiedColumns.has(i)) {
					helpers.push(
						<div
							class="dropPlaceholder"
							style={`
							left:${i * columnFraction * 100}%;
							top:calc(${itemHeight} * ${r});
							width:${columnFraction * 100}%;
							height:${itemHeight};
						`}
							onDragEnter={(event) => handleDragEnter(event, {row: r, left: i * columnFraction})}
							onDrop={handleDrop}
						/>
					);
				}
			}
			for (let i = 0; i < profilesGridColumns; i++) {
				helpers.push(
					<div
						class="dropPlaceholder"
						style={`
						z-index: 4;
						left:${i * columnFraction * 100}%;
						top:calc(${itemHeight} * ${r} - ${itemHeight} / 8);
						width:${columnFraction * 100}%;
						height:calc(${itemHeight} / 4);
					`}
						onDragEnter={(event) => handleDragEnter(event, {row: r, left: i * columnFraction}, true)}
						onDrop={handleDrop}
					/>
				);
			}
		}

		// Add row button
		if (r < rows.length - 1 && !draggingMode && !isResizing) {
			helpers.push(
				<button
					key={`row-${rows.length}-add`}
					data-volley-ignore
					class="rowButton -add"
					style={`top:calc(${itemHeight} * ${r + 1})`}
					onClick={() => category.insertRowAt(r + 1)}
					title="Add row"
				>
					<Icon name="plus" />
				</button>
			);
		}
	}

	// Last row with one create button
	if (!draggingMode && !isResizing) {
		helpers.push(
			makeCreateButton({row: rows.length, left: 0, width: defaultCardFraction}, `${rows.length}-empty-create`)
		);
	}

	// Final spacer
	helpers.push(
		<div
			data-volley-ignore
			style={`position:absolute;left:0;top:calc(${itemHeight} * ${rows.length + 1});width:100%;height:2px`}
		/>
	);

	if (isProfileDragged) {
		// Last empty rows of profile drop targets
		for (let i = 0; i < 6; i++) {
			const r = i + rows.length;

			for (let c = 0; c < profilesGridColumns; c++) {
				helpers.push(
					<div
						class="dropPlaceholder"
						style={`
							left:${c * columnFraction * 100}%;
							top:calc(${itemHeight} * ${r});
							width:${columnFraction * 100}%;
							height:${itemHeight};
						`}
						onDragEnter={(event) => handleDragEnter(event, {row: r, left: c * columnFraction})}
						onDrop={handleDrop}
					/>
				);
			}
		}

		// Dragged profile drop position indicator
		if (profileDropData) {
			const {
				isBetween,
				position: {row, left, width},
			} = profileDropData;
			helpers.push(
				<div
					class="dropIndicator"
					style={`
					left:calc(${left * 100}% + 1px);
					top:calc((${itemHeight} * ${row}) - (${itemHeight} * ${isBetween ? 0.125 : 0}) + 1px);
					width:calc(${width * 100}% - 2px);
					height:calc((${itemHeight} / ${isBetween ? 4 : 1}) - 2px);
				`}
				/>
			);
		}
	}

	return (
		<Scrollable class="ProfileCards" innerRef={containerRef}>
			{cards}
			{helpers}
		</Scrollable>
	);
});
