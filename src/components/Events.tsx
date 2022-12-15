import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {isOfType, animationVolleyVisible} from 'lib/utils';
import {useVolley} from 'lib/hooks';
import {RouteProps} from 'poutr';
import {Event} from './Event';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';
import {VirtualList} from 'components/VirtualList';
import {Select, SelectOption} from 'components/Select';
import {EventVariant, Event as EventModel} from 'models/events';

const filters: any[] = ['info', 'success', 'warning', 'danger'];

export const EventsRoute = observer(function EventsRoute(props: RouteProps) {
	const {history, location} = props;
	const filterProp = location.searchParams.get('filter') || 'all';
	const group = isOfType<EventVariant>(filterProp, filters.includes(filterProp)) ? filterProp : undefined;
	const {events} = useStore();
	const itemsContainerRef = useRef<HTMLDivElement>(null);

	let items: EventModel[];
	if (group) items = events.byType[group]();
	else items = events.all();

	useVolley(itemsContainerRef);

	async function clear() {
		if (itemsContainerRef.current) await animationVolleyVisible(itemsContainerRef.current);
		if (group) events.deleteType(group);
		else events.deleteAll();
	}

	function filter(group: string) {
		if (isOfType<EventVariant>(group, filters.includes(group))) {
			history.push(`/events?filter=${group}`);
		} else {
			history.push('/events');
		}
	}

	return (
		<div class="Events">
			<div class="controls">
				<Select transparent value={group || 'all'} onChange={filter}>
					<SelectOption value="all" tooltip="All events">
						<b>{events.all().length}</b> all
					</SelectOption>
					<SelectOption value="info" variant="info" tooltip="Informations">
						<b>{events.byType.info().length}</b> info
					</SelectOption>
					<SelectOption value="success" variant="success" tooltip="Success">
						<b>{events.byType.success().length}</b> success
					</SelectOption>
					<SelectOption value="warning" variant="warning" tooltip="Warnings">
						<b>{events.byType.warning().length}</b> warning
					</SelectOption>
					<SelectOption value="danger" variant="danger" tooltip="Errors">
						<b>{events.byType.danger().length}</b> error
					</SelectOption>
				</Select>
				<Button transparent muted variant="danger" onClick={clear}>
					<Icon name="clear-all" /> Clear
				</Button>
			</div>
			<VirtualList
				class="events"
				innerRef={itemsContainerRef}
				items={items}
				render={(event) => <Event key={event.id} event={event} />}
			/>
		</div>
	);
});
