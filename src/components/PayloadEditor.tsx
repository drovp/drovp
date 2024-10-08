import {h, VNode} from 'preact';
import {eem, formatSize} from 'lib/utils';
import {useState, useMemo} from 'preact/hooks';
import {observer} from 'statin-preact';
import type {Operation} from 'models/operations';
import {Textarea} from 'components/Textarea';
import {Alert} from 'components/Alert';

export const PayloadEditor = observer(function PayloadEditor({operation}: {operation: Operation}) {
	const [error, setError] = useState<string | null>(null);
	const data = useMemo(() => {
		const {payload} = operation;
		const keys = new Set(Object.keys(payload));
		let inputsHidden = false;
		const data: any = {};
		const blobs = new Map<string, any>();
		const inputs: any[] = [];

		// Make `id` and `options` first
		for (const key of ['id', 'options']) {
			if (keys.delete(key)) data[key] = payload[key];
		}

		// Next the rest of the data, except `inputs`, those come last
		keys.delete('inputs');
		for (const key of keys) data[key] = payload[key];

		// Save blob content buffers into a map and swap them with placeholders
		for (const item of payload.inputs || []) {
			if (item.kind === 'blob') {
				const contentsId = `{${formatSize(item.contents.length)} blob placeholder}`;
				blobs.set(item.id, item.contents);
				inputs.push({...item, contents: contentsId});
			} else {
				inputs.push(item);
			}
		}

		if (inputs.length > 10) {
			inputsHidden = true;
			data.inputs = [
				`... ${inputs.length} inputs placeholder ...`,
				`If there's too many inputs, they are hidden in JSON editor, and re-added back to the actual data behind the scenes.`,
				`Editing this property has no effect.`,
			];
		} else {
			data.inputs = inputs;
		}

		return {initJson: JSON.stringify(data, null, 2), inputs, blobs, inputsHidden};
	}, []);
	const [json, setJson] = useState<string>(data.initJson);

	function handlePayloadChange(value: string) {
		setJson(value);
		try {
			const payload = JSON.parse(value);
			setError(null);

			if (data.inputsHidden) {
				payload.inputs = data.inputs;
			} else if (data.blobs.size && Array.isArray(payload.inputs)) {
				for (const input of payload.inputs) {
					if (typeof input === 'object' && input.id) input.contents = data.blobs.get(input.id);
				}
			}

			operation.payload = payload;
		} catch (error) {
			setError(eem(error));
		}
	}

	const alerts: VNode[] = [];

	if (error) {
		alerts.push(
			<Alert variant="danger" icon="warning">
				{error}
			</Alert>
		);
	}
	if (data.inputsHidden) {
		alerts.push(
			<Alert variant="info" icon="info">
				{data.inputs.length} inputs hidden for performance and editing sanity.
			</Alert>
		);
	}
	if (data.blobs.size > 0) {
		alerts.push(
			<Alert variant="info" icon="info">
				Content blobs are replaced with placeholders. Don't edit associated input ids or they won't be swapped
				back.
			</Alert>
		);
	}
	if (alerts.length === 0) {
		alerts.push(<Alert icon="warning">Modifying can break operations.</Alert>);
	}

	return (
		<div class="PayloadEditor">
			<Textarea
				variant={error ? 'danger' : undefined}
				resizable={false}
				autoResize={false}
				focusIndicator={false}
				onChange={handlePayloadChange}
				indentationString="  "
				value={json}
			/>
			{alerts}
		</div>
	);
});
