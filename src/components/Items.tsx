import {shell, ipcRenderer} from 'electron';
import {h} from 'preact';
import {Ref} from 'preact/hooks';
import {observer} from 'statin-preact';
import {formatSize, prevented, reportIssue} from 'lib/utils';
import {ContextMenus} from 'lib/contextMenus';
import {Icon, ICONS, IconName} from 'components/Icon';
import {Action} from 'components/Actions';
import {VirtualList} from 'components/VirtualList';
import {useStore} from 'models/store';
import type {Item as ItemModel} from 'models/items';
import type {Item as RawItemModel} from '@drovp/types';
import {ItemTitle} from './ItemTitle';

export * from './ItemTitle';

export const Items = observer(function Items({
	innerRef,
	items,
	class: className,
	style,
	reversed,
	profileTitles,
}: {
	items: (() => (ItemModel | RawItemModel)[]) | (ItemModel | RawItemModel)[];
	innerRef?: Ref<HTMLDivElement | null>;
	class?: string;
	style?: string | {[key: string]: string};
	reversed?: boolean;
	profileTitles?: boolean;
}) {
	let classNames = 'Items';
	if (className) classNames += ` ${className}`;

	return (
		<VirtualList
			innerRef={innerRef}
			class={classNames}
			style={style}
			reversed={reversed}
			items={Array.isArray(items) ? items : items()}
			render={(item) => <Item key={item.id} item={item} profileTitle={profileTitles} />}
		/>
	);
});

export function Item({
	item,
	profileTitle: displayProfileTitle,
}: {
	item: ItemModel | RawItemModel;
	profileTitle?: boolean;
}) {
	const {modals, history} = useStore();
	let classNames = `Item -${item.kind}`;
	const operation = 'operation' in item ? item.operation : null;
	const plugin = operation?.profile.plugin();

	function showContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		ContextMenus.show('item', event, item);
	}

	const itemTitle = (
		<h1>
			<ItemTitle item={item} tooltip={false} />
		</h1>
	);
	const profileTitle =
		displayProfileTitle && operation ? (
			<h2 class="profile-title" title="Profile name">
				{operation.profile.displayTitle()}
			</h2>
		) : undefined;
	const flair = item.flair ? (
		<span class={`flair -${item.flair.variant || 'info'}`} title={item.flair.description}>
			{item.flair.title}
		</span>
	) : null;
	const badge = item.badge ? (
		<Icon
			class="badge"
			variant={item.badge.variant || 'info'}
			name={item.badge.icon in ICONS ? (item.badge.icon as IconName) : 'info'}
			url={`${item.badge.icon}`.endsWith('.svg') ? item.badge.icon : undefined}
			tooltip={item.badge.title || undefined}
		/>
	) : null;

	if (item.kind === 'file') {
		if (item.exists) {
			classNames += ' -info';
			return (
				<button
					class={classNames}
					onContextMenu={showContextMenu}
					draggable
					onDragStart={prevented(() => ipcRenderer.invoke('start-drag', item.path))}
					onClick={() => shell.openPath(item.path)}
					title={`Open file:\n${item.path}`}
				>
					{itemTitle}
					{profileTitle}
					{badge}
					{flair}
					<span class="meta">
						<span class="kind">{item.type ? item.type : item.kind}</span>
						<span class="stats">, {formatSize(item.size)}</span>
					</span>
				</button>
			);
		} else {
			classNames += ' -disabled -warning';
			return (
				<article class={classNames} onContextMenu={showContextMenu} title={`Missing file:\n${item.path}`}>
					{itemTitle}
					{profileTitle}
					{badge}
					{flair}
					<span class="meta">
						<span class="kind">{item.kind}</span>
					</span>
				</article>
			);
		}
	}

	if (item.kind === 'directory') {
		if (item.exists) {
			classNames += ' -info';
			return (
				<button
					class={classNames}
					onContextMenu={showContextMenu}
					draggable
					onDragStart={prevented(() => ipcRenderer.invoke('start-drag', item.path))}
					onClick={() => shell.openPath(item.path)}
					title={`Open folder:\n${item.path}`}
				>
					{itemTitle}
					{profileTitle}
					{badge}
					{flair}
					<span class="meta">
						<span class="kind">{item.kind}</span>
					</span>
				</button>
			);
		} else {
			classNames += ' -disabled -warning';
			return (
				<article class={classNames} onContextMenu={showContextMenu} title={`Missing folder:\n${item.path}`}>
					{itemTitle}
					{profileTitle}
					{badge}
					{flair}
					<span class="meta">
						<span class="kind">{item.kind}</span>
					</span>
				</article>
			);
		}
	}

	if (item.kind === 'url') {
		classNames += ' -accent';
		return (
			<button
				class={classNames}
				draggable
				onDragStart={(event: DragEvent) => event.dataTransfer!.setData('text/plain', item.url)}
				onClick={() => shell.openExternal(item.url)}
				onContextMenu={showContextMenu}
				title={`Open URL:\n${item.url}`}
			>
				{itemTitle}
				{profileTitle}
				{badge}
				{flair}
				<span class="meta">
					<span class="kind">{item.kind}</span>
				</span>
			</button>
		);
	}

	if (item.kind === 'string') {
		classNames += ' -success';
		return (
			<button
				class={classNames}
				draggable
				onDragStart={(event: DragEvent) => event.dataTransfer?.setData('text/plain', item.contents)}
				onClick={() =>
					modals.alert({
						title: 'String item',
						message: `<code>${item.type}<code>, <strong>${item.contents.length}</strong> characters`,
						details: item.contents,
					})
				}
				onContextMenu={showContextMenu}
				title={item.contents.length > 200 ? `${item.contents.slice(0, 200)}…` : item.contents}
			>
				{itemTitle}
				{profileTitle}
				{badge}
				{flair}
				<span class="meta">
					<span class="kind">{item.kind}</span>
					<span class="stats" title={`${item.contents.length} characters`}>
						, {item.contents.length}ch
					</span>
				</span>
			</button>
		);
	}

	if (item.kind === 'blob') {
		return (
			<article class={classNames} onContextMenu={showContextMenu} title="Binary blob">
				{itemTitle}
				{profileTitle}
				{badge}
				{flair}
				<span class="meta">
					<span class="kind">{item.kind}</span>
					<span class="stats">, {formatSize(item.contents.length)}</span>
				</span>
			</article>
		);
	}

	const isError = item.kind === 'error';
	if (isError || item.kind === 'warning') {
		classNames += ` -${isError ? 'danger' : 'warning'}`;

		const showModal = () => {
			const actions: Action[] = [
				{
					title: 'To operation',
					iconRight: 'operation',
					action: () => history.push(`/operations/${item.operation.id}?section=logs`),
				},
			];

			const reportUrl = plugin?.reportIssueUrl;

			if (reportUrl) {
				actions.unshift({
					title: 'Report issue',
					icon: 'bug',
					action: () =>
						reportIssue(reportUrl, {
							title: item.message.split('\n')[0],
							body: `Hey, I got this error:\n\n\`\`\`\n${
								item.message
							}\n\`\`\`\n\nWith this payload:\n\n\`\`\`json\n${JSON.stringify(
								item.operation.payload,
								null,
								2
							)}\n\`\`\``,
						}),
				});
			}

			modals.alert({
				variant: isError ? 'danger' : 'warning',
				title: isError ? 'Operation error' : 'Operation warning',
				details: item.message,
				actions: actions,
			});
		};

		return (
			<button
				class={classNames}
				onContextMenu={showContextMenu}
				title={isError ? 'Error' : 'Warning'}
				onClick={showModal}
			>
				{itemTitle}
				{profileTitle}
				{badge}
				{flair}
				<span class="meta">
					<span class="kind">{item.kind}</span>
				</span>
			</button>
		);
	}

	const showModal = () =>
		modals.alert({
			title: 'Unknown item',
			details: typeof item === 'object' ? JSON.stringify(item) : `${item}`,
		});

	return (
		<button class={classNames} onContextMenu={showContextMenu} onClick={showModal}>
			{itemTitle}
			{profileTitle}
			{badge}
			{flair}
			<span class="meta">
				<span class="kind">unknown</span>
			</span>
		</button>
	);
}
