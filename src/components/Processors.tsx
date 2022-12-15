import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {RouteProps} from 'poutr';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {useVolley} from 'lib/hooks';
import {Vacant} from 'components/Vacant';
import {ProcessorCard} from 'components/ProcessorCard';
import {Scrollable} from 'components/Scrollable';
import {ProcessorRoute} from './Processor';

export function ProcessorsRoute(props: RouteProps) {
	const {match} = props;
	const id = match.groups?.id;

	return id ? <ProcessorRoute {...props} /> : <Processors />;
}

const Processors = observer(function Processors() {
	const {processors, history} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const all = processors.sorted();

	useVolley(containerRef);

	return (
		<Scrollable class="CardsGrid Processors" innerRef={containerRef}>
			{all.length > 0 ? (
				all.map((processor) => <ProcessorCard processor={processor} />)
			) : (
				<Vacant
					title="No processors yet"
					actions={[{title: 'Go to registry', icon: 'plugins', action: () => history.push(`/registry`)}]}
				>
					Install some plugins!
				</Vacant>
			)}
		</Scrollable>
	);
});
