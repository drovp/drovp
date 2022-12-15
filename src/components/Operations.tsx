import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useCache, useVolley} from 'lib/hooks';
import {observer} from 'statin-preact';
import {OperationCard} from './OperationCard';
import {VirtualList} from 'components/VirtualList';
import {OperationRoute} from 'components/Operation';
import {Select, SelectOption} from 'components/Select';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Vacant} from 'components/Vacant';
import {Outputs} from 'components/Outputs';
import {RouteProps, Redirect} from 'poutr';
import {useStore} from 'models/store';
import type {Operation as OperationModel} from 'models/operations';

const junctionPath = '/operations';

export function OperationsJunction(props: RouteProps) {
	const {match, location, history} = props;
	let [lastUrl, setLastUrl] = useCache<string>('operations.lastUrl', junctionPath);
	const isJunctionPath = location.path === junctionPath;

	// Click on the main nav button, needs to be triaged
	if (isJunctionPath) {
		const fromInside = history.from?.path.match(/^\/operations(\/.*)?/) != null;
		if (!fromInside && lastUrl !== junctionPath) return <Redirect to={lastUrl} />;
	}

	setLastUrl(location.href);

	return match.groups?.id ? <OperationRoute {...props} /> : <OperationsRoute {...props} />;
}

export function OperationsRoute(props: RouteProps) {
	const {location, history} = props;
	const sectionRaw = location.searchParams.get('section');
	const {operations, outputs, settings} = useStore();
	const section = sectionRaw === 'errors' ? sectionRaw : 'all';

	return (
		<main class="OperationsRoute">
			<OperationsSection
				allSignal={operations.all}
				errorsSignal={operations.errors}
				section={section}
				onSection={(section) => history.push(`?section=${section}`)}
				onClearQueue={() => operations.clearQueue()}
				onClearHistory={() => operations.clearHistory()}
				showProfileTitle={true}
			/>

			<Outputs
				title="Outputs"
				tooltip="Outputs of all profiles"
				outputs={outputs}
				heightRatio={settings.globalOutputsDrawerHeight()}
				onHeightRatioChange={settings.globalOutputsDrawerHeight}
				maxHeightRatio={0.8}
				profileTitles
			/>
		</main>
	);
}

export const OperationsSection = observer(function OperationsSection({
	allSignal,
	errorsSignal,
	section,
	onSection,
	onClearQueue,
	onClearHistory,
	showProfileTitle,
}: {
	allSignal: () => OperationModel[];
	errorsSignal: () => OperationModel[];
	section: string;
	onSection: (section: string) => void;
	onClearQueue?: () => void;
	onClearHistory?: () => void;
	showProfileTitle?: boolean;
}) {
	const operations = allSignal();
	const errors = errorsSignal();
	const containerRef = useRef<HTMLDivElement>(null);

	useVolley(containerRef);

	return (
		<div ref={containerRef} class="OperationsSection">
			<div class="controls">
				<Select transparent value={section} onChange={onSection}>
					<SelectOption value="all" tooltip="All operations">
						<b>{operations.length}</b>
						<span>all</span>
					</SelectOption>
					<SelectOption value="errors" variant="danger" tooltip="Errors only">
						<b>{errors.length}</b>
						<span>errors</span>
					</SelectOption>
				</Select>
				{onClearQueue && (
					<Button transparent muted variant="danger" onClick={onClearQueue} tooltip="Clear queue">
						<Icon name="clear-all" /> Queue
					</Button>
				)}
				{onClearHistory && (
					<Button transparent muted variant="danger" onClick={onClearHistory} tooltip="Clear history">
						<Icon name="clear-all" /> History
					</Button>
				)}
			</div>

			{operations.length === 0 ? (
				<Vacant>Empty</Vacant>
			) : (
				<VirtualList
					key={section}
					class="Operations"
					items={section === 'errors' ? errors : operations}
					reversed
					render={(operation) => (
						<OperationCard key={operation.id} operation={operation} showProfileTitle={showProfileTitle} />
					)}
				/>
			)}
		</div>
	);
});
