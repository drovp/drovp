import {h} from 'preact';
import {useMemo, useEffect} from 'preact/hooks';
import {reaction} from 'statin';
import {Options} from 'components/Options';
import {OptionsSchema} from '@drovp/types';
import {createOptions, toJS} from 'models/options';

interface OptionsPromptProps {
	schema: OptionsSchema<any>;
	onPayload?: (options: any) => void;
	onSubmit?: () => void;
}

export function OptionsPrompt({schema, onPayload, onSubmit}: OptionsPromptProps) {
	const options = useMemo(() => createOptions(schema), [schema]);

	useEffect(() => reaction(() => onPayload?.(toJS(options))), []);

	function handleKeyDown(event: KeyboardEvent) {
		// Submit on enter for inputs, or ctrl+enter for text areas
		const isTextarea = (event.target as HTMLElement)?.tagName === 'TEXTAREA';
		if (event.key === 'Enter' && (!isTextarea || event.ctrlKey)) onSubmit?.();
	}

	return (
		<div class="OptionsPrompt" onKeyDown={handleKeyDown}>
			<Options schema={schema} options={options} />
		</div>
	);
}
