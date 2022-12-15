import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {RouteProps} from 'poutr';
import {useStore} from 'models/store';
import {observer} from 'statin-preact';
import {useVolley} from 'lib/hooks';
import {Vacant} from 'components/Vacant';
import {Scrollable} from 'components/Scrollable';
import {DependencyCard} from './DependencyCard';
import {DependencyRoute} from './Dependency';

export function DependenciesRoute(props: RouteProps) {
	const {match} = props;
	const id = match.groups?.id;

	return id ? <DependencyRoute {...props} /> : <Dependencies />;
}

const Dependencies = observer(function Dependencies() {
	const {dependencies} = useStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const all = dependencies.sorted();

	useVolley(containerRef);

	return (
		<Scrollable class="CardsGrid Dependencies" innerRef={containerRef}>
			{all.length > 0 ? (
				all.map((dependency) => <DependencyCard id={dependency.id} />)
			) : (
				<Vacant title="No dependencies installed">None of your plugins provides any dependencies.</Vacant>
			)}
		</Scrollable>
	);
});
