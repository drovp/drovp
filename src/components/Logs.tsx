import {h, RenderableProps} from 'preact';
import {useEffect, useRef, Ref} from 'preact/hooks';
import {observer} from 'statin-preact';
import {reaction} from 'statin';
import {throttle} from 'lib/utils';
import {Scrollable} from 'components/Scrollable';

type LogsData = string | string[] | null | undefined;

export type LogsProps = RenderableProps<{
	lines: LogsData | (() => LogsData);
	syncBottom?: boolean;
	class?: string;
	variant?: Variant;
	innerRef?: Ref<HTMLDivElement | null>;
}>;

export const Logs = observer(function Log({
	lines: signal,
	syncBottom,
	variant,
	class: className,
	children,
	innerRef,
}: LogsProps) {
	const logsRef = useRef<HTMLDivElement>(null);
	const preRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		const container = logsRef.current;
		const pre = preRef.current;

		if (!container || !pre) return;

		const update = throttle((log: LogsData) => {
			let content = log;
			if (!content) content = '';
			else if (Array.isArray(content)) content = content.join('\n');
			const wasAtBottom = container.scrollTop + 20 > container.scrollHeight - container.clientHeight;
			if (content) pre.textContent = content;
			else pre.innerHTML = '<em class="empty">empty</em>';
			if (syncBottom && wasAtBottom) container.scrollTo({top: container.scrollHeight, left: 0});
		}, 250);

		return reaction(() => (typeof signal === 'function' ? signal() : signal), update, {immediate: true});
	}, [signal]);

	let classNames = 'Logs';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<div ref={innerRef} class={classNames}>
			<Scrollable class="logs" auto innerRef={logsRef}>
				<pre ref={preRef} />
				{children && <div class="children">{children}</div>}
			</Scrollable>
		</div>
	);
});
