import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useVolley} from 'lib/hooks';
import {observer} from 'statin-preact';
import {OperationCard} from './OperationCard';
import {VirtualList} from 'components/VirtualList';
import {Select, SelectOption} from 'components/Select';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Vacant} from 'components/Vacant';
import {Outputs} from 'components/Outputs';
import {RouteProps, Redirect} from 'poutr';
import {useStore} from 'models/store';
import type {Operation as OperationModel} from 'models/operations';

export function OperationsJunction(props: RouteProps) {
	const {match} = props;
	const store = useStore();
	const id = match?.groups?.id;

	if (id) {
		const operation = store.operations.byId.value.get(id);
		if (!operation) {
			return <Vacant title={`Operation "${id}" is missing.`} />;
		}
		const profile = operation.profile;
		if (!profile || !store.profiles.byId.value.has(profile.id)) {
			return <Vacant title={`Operation "${id}" profile has been deleted.`} />;
		}
		const operationsSection = props.location.searchParams.get('section');
		const operationsSectionParam = operationsSection ? `&operationSection=${operationsSection}` : '';
		return <Redirect to={`/profiles/${profile.id}?section=operations&id=${id}${operationsSectionParam}`} />;
	}

	return <OperationsRoute {...props} />;
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
	section?: string;
	onSection: (section: string) => void;
	onClearQueue?: () => void;
	onClearHistory?: () => void;
	showProfileTitle?: boolean;
}) {
	const operations = allSignal();
	const errors = errorsSignal();
	const containerRef = useRef<HTMLDivElement>(null);
	section = section == 'errors' ? 'errors' : 'all';

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
