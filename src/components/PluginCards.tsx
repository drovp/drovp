import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {observer} from 'statin-preact';
import {useVolley} from 'lib/hooks';
import {isOfType} from 'lib/utils';
import {useStore} from 'models/store';
import {PluginHeader, PluginData} from './Plugin';

export interface PluginCardProps {
	meta: PluginData;
	section?: 'plugins' | 'registry';
	markInstalled?: boolean;
	markMissing?: boolean;
	onClick?: (path: string) => void;
}

export const PluginCard = observer(function PluginCard({
	meta,
	section,
	markInstalled,
	markMissing,
	onClick,
}: PluginCardProps) {
	const containerRef = useRef<HTMLButtonElement>(null);
	const {plugins, history} = useStore();
	const installed = plugins.byId().get(meta.name);
	const issuesCount = installed?.issues().length;

	section = section || (installed ? 'plugins' : 'registry');

	function openPluginPage(event: MouseEvent) {
		// Filter out clicks on inner buttons and anchors
		if (isOfType<HTMLElement>(event.target, event.target != null && 'closest' in event.target)) {
			if (event.target.closest('a, button') !== containerRef.current) return;
		}
		const path = `/${section}/${meta.name}`;
		history.push(path);
		onClick?.(path);
	}

	let classes = `PluginCard`;
	if (installed && markInstalled) classes += ' -installed';
	if (installed && installed.updateAvailable()) classes += ' -update-available';
	if (!installed && markMissing) classes += ' -missing';
	if (issuesCount) classes += ' -has-issues';

	return (
		<button
			ref={containerRef}
			class={classes}
			onClick={openPluginPage}
			data-context-menu="plugin"
			data-context-menu-payload={meta.name}
		>
			<PluginHeader compact data={meta} />
		</button>
	);
});

export interface PluginCardsProps {
	class?: string;
	plugins: PluginData[];
	section?: 'plugins' | 'registry';
	markInstalled?: boolean;
	markMissing?: boolean;
	onNav?: (path: string) => void;
}

export function PluginCards({
	class: className,
	plugins,
	section = 'plugins',
	markInstalled,
	markMissing,
	onNav,
}: PluginCardsProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	let classNames = 'PluginCards';
	if (className) classNames += ` ${className}`;

	return (
		<div class={classNames} ref={containerRef}>
			{plugins.map((meta) => (
				<PluginCard
					key={meta.name}
					meta={meta}
					section={section}
					markInstalled={markInstalled}
					markMissing={markMissing}
					onClick={onNav}
				/>
			))}
		</div>
	);
}
