import {h} from 'preact';
import {useRef} from 'preact/hooks';
import {useVolley} from 'lib/hooks';
import {RouteProps} from 'poutr';
import {Options} from 'components/Options';
import {Button} from 'components/Button';
import {Icon} from 'components/Icon';
import {Scrollable} from 'components/Scrollable';
import {useStore} from 'models/store';
import {resetOptions} from 'models/options';
import {schema} from 'models/settings';

export const SettingsRoute = function Settings(props: RouteProps) {
	const {settings} = useStore();
	const optionsRef = useRef<HTMLDivElement>(null);

	useVolley(optionsRef);

	// I don't know why I have to `as any` this.
	// According to TS `Options<OptionsSchema> !== Options<OptionsSchema>` for some reason...
	return (
		<Scrollable class="Settings">
			<Options schema={schema} options={settings as any} innerRef={optionsRef} />
			<div class="controls">
				<Button transparent onClick={() => resetOptions(settings)}>
					<Icon name="refresh" /> Reset to defaults
				</Button>
			</div>
		</Scrollable>
	);
};
