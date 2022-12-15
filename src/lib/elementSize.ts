type MaybeHTMLElement = Element & Partial<HTMLElement>;
interface Change {
	element: MaybeHTMLElement;
	offset: [number, number];
	client: [number, number];
}
type ElementResizeCallback = (box: [number, number]) => void;
type ElementChangeCallback = (change: Change) => void;

interface Disposer {
	(): void;
	reconnect: (newElement: Element) => void;
}

let commitId: NodeJS.Timeout | null = null;
const changedElements = new Set<MaybeHTMLElement>();
const elementChangeCallbacks = new Map<MaybeHTMLElement, Set<ElementChangeCallback>>();
const observer = new ResizeObserver((entries) => {
	for (const entry of entries) changedElements.add(entry.target);
	// Request commit
	if (commitId === null) commitId = setTimeout(commit, 34);
});

function registerResizeCallback(element: MaybeHTMLElement, callback: ElementChangeCallback) {
	let callbacks = elementChangeCallbacks.get(element) || new Set<ElementChangeCallback>();
	if (!elementChangeCallbacks.has(element)) {
		elementChangeCallbacks.set(element, callbacks);
		observer.observe(element);
	}
	callbacks.add(callback);
}
function unregisterResizeCallback(element: MaybeHTMLElement, callback: ElementChangeCallback) {
	let callbacks = elementChangeCallbacks.get(element);
	if (!callbacks) return;
	callbacks.delete(callback);

	// Cleanup
	if (callbacks.size === 0) {
		elementChangeCallbacks.delete(element);
		observer.unobserve(element);
	}
}

/**
 * First retrieves sizes of all changed elements, and than runs callbacks
 * listening on them. This eliminates layout thrashing by batching layout
 * reading->writing.
 */
function commit() {
	commitId = null;
	const changes: Change[] = [];

	for (const element of changedElements) {
		changes.push({
			element: element,
			offset: [element.offsetWidth ?? 0, element.offsetHeight ?? 0],
			client: [element.clientWidth, element.clientHeight],
		});
	}

	changedElements.clear();

	for (const change of changes) {
		const callbacks = elementChangeCallbacks.get(change.element);
		if (callbacks) for (const callback of callbacks) callback(change);
	}
}

/**
 * Observe element size.
 *
 * Batches all observer commits to prevent layout trashing if there is a lot of
 * observers active on the same page. Example:
 *
 * ```
 * const disposer = observeElementSize(element, ([width, height]) => console.log(width, height));
 * disposer.reconnect(newElement);
 * disposer(); // disconnect
 * ```
 */
export function observeElementSize(
	element: MaybeHTMLElement | null | undefined,
	callback: ElementResizeCallback,
	options: {
		box?: 'border-box' | 'padding-box'; // default: 'border-box'
	} = {}
): Disposer {
	const borderBox = options.box !== 'padding-box';
	const changeCallback = borderBox
		? (change: Change) => callback(change.offset)
		: (change: Change) => callback(change.client);

	if (element) registerResizeCallback(element, changeCallback);

	function disposer() {
		if (element) unregisterResizeCallback(element, changeCallback);
	}

	disposer.reconnect = (newElement: MaybeHTMLElement) => {
		disposer();
		element = newElement;
		registerResizeCallback(element, changeCallback);
	};

	return disposer;
}

/**
 * Immediately returns element size and starts observing its changes.
 * Will lead to layout trashing if misused.
 * Example:
 * ```
 * useEffect(() => {
 *   let [width, height, dispose] = tapElementSize(elementRef.current, ([width, height]) => {
 *     // do something with width & height
 *   });
 *
 *   return dispose;
 * }, []);
 * ```
 */
export function tapElementSize(
	element: MaybeHTMLElement,
	callback: ElementResizeCallback,
	options: {
		box?: 'border-box' | 'padding-box'; // default: 'border-box'
	} = {}
): [number, number, Disposer] {
	const disposer = observeElementSize(element, callback, options);

	return options.box === 'padding-box'
		? [element.clientWidth, element.clientHeight, disposer]
		: [element.offsetWidth ?? 0, element.offsetHeight ?? 0, disposer];
}
