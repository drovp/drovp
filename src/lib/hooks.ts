import {
	isOfType,
	TargetedEvent,
	countDecimals,
	animationVolley,
	pickVisibleElements,
	isElementVisible,
} from 'lib/utils';
import {SLIDE_IN} from 'config/animations';
import {registerDraggingListener} from 'lib/draggingListener';
import {RefObject} from 'preact';
import {useCallback, useState, useEffect, useLayoutEffect, useRef, Inputs} from 'preact/hooks';
import {observeElementSize} from 'lib/elementSize';

/**
 * Creates function that re-renders current component when called.
 *
 * ```
 * const forceUpdate = useForceUpdate();
 * forceUpdate();
 * ```
 */
export function useForceUpdate() {
	const [, setState] = useState(NaN);
	return useCallback(() => setState(NaN), [setState]);
}

/**
 * Binds event callback to an element ref or window when omitted.
 *
 * ```
 * const elementRef = useRef<HTMLElement>();
 * useEventListener('click', (event) => {}, elementRef);
 * ```
 */
export function useEventListener(
	name: string,
	callback: (...args: any) => void,
	ref: RefObject<HTMLElement | Window> = {current: window},
	options?: AddEventListenerOptions
) {
	useEffect(() => {
		ref.current?.addEventListener(name, callback, options);
		return () => ref.current?.removeEventListener(name, callback);
	}, [callback, ref.current]);
}

/**
 * Creates an effect that manages and provides AbortSignal.
 * Useful for creating async effects that should abort on un-mount or when
 * pending and new one is called.
 *
 * ```
 * useAbortableEffect(async (signal) => {
 * 	try {
 * 		const response = await fetch(url + searchValue, {signal});
 * 		// do something with response
 * 	} catch {}
 * }, [searchValue]);
 * ```
 */
export function useAbortableEffect(
	effect: (signal: AbortSignal, doneCallback?: () => void) => null | Promise<void>,
	dependencies: Inputs
) {
	const abortControllerRef = useRef<AbortController | null>();

	useEffect(() => {
		abortControllerRef.current?.abort();

		const abortController = (abortControllerRef.current = new AbortController());
		let done = false;
		const markAsDone = () => (done = true);
		effect(abortController.signal, markAsDone)?.finally(markAsDone);

		return () => {
			if (!done && !abortControllerRef.current?.signal.aborted) abortControllerRef.current?.abort();
		};
	}, dependencies);
}

/**
 * Remembers element's scroll position, and recovers it next time the element is
 * created.
 */
export function useScrollPosition(id: string, ref: RefObject<HTMLElement>) {
	const cacheId = `${id}.scrollPosition`;
	let [scrollPosition, setScrollPosition] = useCache<number>(cacheId, 0);

	useLayoutEffect(() => {
		const container = ref.current;
		if (!container) return;
		container.scrollTop = scrollPosition;
		const savePosition = () => setScrollPosition(container.scrollTop);
		container.addEventListener('scroll', savePosition);
		return () => container.removeEventListener('scroll', savePosition);
	}, [id]);

	return () => setScrollPosition(0);
}

/**
 * Creates a keydown handler for number based input elements that enables
 * value incrementing/decrementing with Up/Down keyboard arrows.
 *
 * Modifiers:
 * shift      - 10
 * ctrl+shift - 100
 * alt        - 0.1
 * ctrl+alt   - 0.01
 */
export function useNumberInputShortcuts(inputRef: RefObject<HTMLInputElement>) {
	function handleKeyDown(event: TargetedEvent<HTMLInputElement, KeyboardEvent>) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

		const target = event.currentTarget;
		const targetValue = target.value.trim();
		const value = !targetValue ? 0 : parseFloat(targetValue);

		if (Number.isFinite(value)) {
			event.preventDefault();

			let amount: number;
			if (event.ctrlKey && event.shiftKey) amount = 100;
			else if (event.ctrlKey && event.altKey) amount = 0.01;
			else if (event.shiftKey) amount = 10;
			else if (event.altKey) amount = 0.1;
			else amount = 1;

			const decimalRounder = Math.pow(10, Math.max(countDecimals(value), countDecimals(amount)));
			const add = event.key === 'ArrowDown' ? -amount : amount;

			// This gets rid of the floating point noise
			target.value = String(Math.round((value + add) * decimalRounder) / decimalRounder);

			target.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
		}
	}

	useEventListener('keydown', handleKeyDown, inputRef);
}

/**
 * Facilitates animating inwards transition of container children.
 * Animates only visible children.
 * Skips elements with `data-volley-ignore` attribute.
 * Ensures the whole animation fits into duration.
 * Observers container and animates visible children added later.
 */
export function useVolley(
	containerRef: RefObject<HTMLElement>,
	{duration, maxDelay, perpetual}: {duration?: number; maxDelay?: number; perpetual?: boolean} = {}
) {
	useLayoutEffect(() => {
		if (!containerRef.current) return;

		const elementsFilter = (element: Element) =>
			isOfType<HTMLElement>(element, 'dataset' in element) && element.dataset.volleyIgnore == null;
		const volleyOptions = {
			animation: SLIDE_IN,
			fill: 'backwards' as const,
			duration,
			maxDelay,
		};

		// Initial volley
		animationVolley(pickVisibleElements(containerRef.current, elementsFilter), volleyOptions);

		// Keep animating in newly added items
		if (perpetual) {
			const observer = new MutationObserver(listener);
			observer.observe(containerRef.current, {childList: true});

			function listener(mutations: MutationRecord[]) {
				const newElements: Element[] = [];

				for (const {addedNodes} of mutations) {
					for (const node of addedNodes) {
						if (
							isOfType<Element>(node, 'innerHTML' in node) &&
							isElementVisible(node) &&
							elementsFilter(node)
						) {
							newElements.push(node);
						}
					}
				}

				animationVolley(newElements, volleyOptions);
			}

			return () => observer.disconnect();
		}
	}, []);
}

/**
 * Sets up element Resize Observer, extracts element sizes, and returns them as
 * a `[number, number]` tuple. Initial call returns `[null, null]`.
 *
 * Note: uses `observeElementSize` utility, which throttles all dimension
 * retrieval from all of its consumers to a 1-2 frame interval, and then batches
 * it all before triggering callbacks (commits). This eliminates layout trashing
 * to allow fast UI rendering with no stutters and CPU meltdowns when you drag
 * something. The disadvantage is that initial dimension retrieval is impossible
 * to get before 1st render. If this is needed, a custom useLayoutEffect solution
 * with `tapElementSize` utility is required.
 *
 * ```ts
 * const containerRef = useRef<HTMLElement>();
 * const [width, height] = useElementSize(containerRef, 'content-box');
 * ```
 */
export function useElementSize(ref: RefObject<HTMLElement>, box: 'border-box' | 'padding-box' = 'border-box') {
	const [sizes, setSizes] = useState<[number, number] | [null, null]>([null, null]);

	useLayoutEffect(() => {
		if (!ref.current) throw new Error();
		return observeElementSize(ref.current, setSizes, {box});
	}, [box]);

	return sizes;
}

/**
 * Retrieves/saves value to store cache: a non-reactive storage with an optional
 * expiration timeout.
 *
 * ```
 * const [value, setValue] = useCache('cache.value.identifier', 'default value');
 * ```
 *
 * In case where key can be undefined (optional), use `CACHE_IGNORE_KEY`.
 * This will always return the default value, with a noop setter.
 *
 * ```
 * const [value, setValue] = useCache(key || CACHE_IGNORE_KEY, 'default');
 * ```
 */
export function useCache<T>(key: unknown, defaultValue: T, timeout?: number): [T, (value: T) => void] {
	return key === CACHE_IGNORE_KEY
		? [defaultValue, () => {}]
		: [
				(CACHE.has(key) ? CACHE.get(key)!.value : defaultValue) as T,
				useCallback(
					(value: T, timeoutOverride?: number) => {
						const old = CACHE.get(key);
						if (old?.timeoutId != null) clearTimeout(old.timeoutId);
						const requestedTimeout = timeoutOverride ?? timeout;
						const timeoutId = requestedTimeout
							? setTimeout(() => CACHE.delete(key), requestedTimeout)
							: null;
						CACHE.set(key, {timeoutId, value});
					},
					[key]
				),
		  ];
}

export const CACHE_IGNORE_KEY = Symbol('cache_ignore');
const CACHE = new Map<any, {timeoutId: ReturnType<typeof setTimeout> | null; value: unknown}>();
const CACHE_SUBS = new Map<unknown, Set<() => void>>();

function registerCacheSub(key: unknown, reload: () => void) {
	let maybeSet = CACHE_SUBS.get(key);
	if (!maybeSet) {
		maybeSet = new Set<() => void>();
		CACHE_SUBS.set(key, maybeSet);
	}
	const set = maybeSet;
	set.add(reload);
	return () => set.delete(reload);
}

function triggerCacheSubs(key: unknown) {
	let set = CACHE_SUBS.get(key);
	if (set) {
		for (const trigger of set) trigger();
	}
}

/**
 * Same as `useCache()`, but redraws current component on `setValue()`.
 *
 * ```
 * const [value, setValue] = useCachedState('cache.value.identifier', 'default value');
 * ```
 */
export function useCachedState<T>(key: unknown, defaultValue: T): [T, (value: T) => void] {
	const [value, setCache] = useCache<T>(key, defaultValue);
	const forceUpdate = useForceUpdate();

	useLayoutEffect(() => registerCacheSub(key, forceUpdate), [key]);

	return [
		value,
		(value: T) => {
			setCache(value);
			triggerCacheSubs(key);
		},
	];
}

/**
 * Holy fucking shit the drag events API is a total disaster. This below is the
 * only way how to style elements when something is dragging over them in a
 * reliable and performant way.
 * Until there is a dedicated CSS selector, or a new alternative event to
 * dragLeave, don't event question it, you're just wasting time.
 */
export function useIsDraggedOver(ref: RefObject<HTMLElement>) {
	const [isDraggedOver, setIsDraggedOver] = useState(false);

	useEffect(() => {
		const container = ref.current;

		if (!container) return;

		const enable = () => setIsDraggedOver(true);
		const disable = () => setIsDraggedOver(false);
		const handleDragLeave = ({x, y}: DragEvent) => {
			const rect = container.getBoundingClientRect();
			if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) disable();
		};

		container.addEventListener('dragenter', enable);
		container.addEventListener('drop', disable);
		container.addEventListener('dragleave', handleDragLeave);

		return () => {
			container.removeEventListener('dragenter', enable);
			container.removeEventListener('drop', disable);
			container.removeEventListener('dragleave', handleDragLeave);
			disable();
		};
	}, []);

	return isDraggedOver;
}

/**
 * Returns true if user is dragging something over window.
 */
export function useDraggingState() {
	const [isDragging, setIsDragging] = useState(false);
	useEffect(() => registerDraggingListener(setIsDragging));
	return isDragging;
}
