import {h, RefObject} from 'preact';
import {useRef, useState} from 'preact/hooks';
import {insertAtCursor, TargetedEvent} from 'lib/utils';

export interface TextareaProps {
	id?: string;
	name?: string;
	placeholder?: string;
	value?: string | number;
	spellcheck?: boolean;
	class?: string;
	variant?: Variant;
	transparent?: boolean;
	resizable?: boolean;
	focusIndicator?: boolean;
	min?: number;
	max?: number;
	rows?: number;
	indentationString?: string;
	/**
	 * Textarea resizes itself to accommodate text inside up to the
	 * --max-auto-size CSS value.
	 */
	autoResize?: boolean;
	onChange?: (value: string) => void;
	onClick?: (event: TargetedEvent<HTMLTextAreaElement, PointerEvent>) => void;
	onKeyDown?: (event: TargetedEvent<HTMLTextAreaElement, KeyboardEvent>) => void;
	disabled?: boolean;
	readonly?: boolean;
	innerRef?: RefObject<HTMLTextAreaElement>;
}

export function Textarea({
	id,
	name,
	placeholder,
	class: className,
	value,
	spellcheck,
	variant,
	resizable = true,
	focusIndicator = true,
	min,
	max,
	rows = 3,
	autoResize = true,
	indentationString = '\t',
	transparent,
	onChange,
	disabled,
	innerRef,
	...rest
}: TextareaProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const textareaRef = innerRef || useRef<HTMLTextAreaElement>(null);
	const [minHeight, setMinHeight] = useState(0);

	function handleInput(event: TargetedEvent<HTMLTextAreaElement, Event>) {
		onChange?.(event.currentTarget.value);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.shiftKey || event.altKey || event.ctrlKey) return;
		if (event.key === 'Tab') {
			insertAtCursor(indentationString);
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function initResize(event: TargetedEvent<HTMLDivElement, PointerEvent>) {
		const textarea = textareaRef.current;

		if (!textarea) return;
		event.preventDefault();
		event.stopPropagation();

		const initHeight = textarea.getBoundingClientRect().height;
		const initY = event.clientY;

		function move(event: PointerEvent) {
			setMinHeight(Math.max(0, initHeight + event.clientY - initY));
		}

		const abort = new AbortController();
		addEventListener('pointermove', move, {signal: abort.signal});
		addEventListener('pointerup', () => abort.abort(), {signal: abort.signal});
		addEventListener('pointercancel', () => abort.abort(), {signal: abort.signal});
	}

	function handleDoubleClick() {
		// Select all text if it is just one continuous word
		if (`${value}`.trim().match(/^\w+$/)) textareaRef.current?.select();
	}

	let classNames = `Textarea`;
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (transparent) classNames += ' -transparent';
	if (focusIndicator) classNames += ' -focus-indicator';

	return (
		<div ref={containerRef} class={classNames} style={`--rows:${rows};--min-height:${minHeight}px`}>
			<textarea
				{...rest}
				id={id}
				name={name}
				placeholder={placeholder}
				ref={textareaRef}
				minLength={min}
				maxLength={max}
				spellcheck={spellcheck === true}
				onInput={handleInput}
				// onFocus={handleFocus}
				disabled={disabled}
				onKeyDown={(event) => {
					handleKeyDown(event);
					rest.onKeyDown?.(event);
				}}
				value={value}
				onDblClick={handleDoubleClick}
			/>
			{resizable && <div class="resize-handle" onPointerDown={initResize} />}
		</div>
	);
}
