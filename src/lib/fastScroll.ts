const destinationMap = new WeakMap();

interface ScrollerOptions {
	speed?: number;
	distanceFactor?: number;
	easingFunction?: (x: number) => number;
}

interface FastScrollOptions extends ScrollerOptions {
	subtree?: boolean;
}

/**
 * Takes over wheel scrolling to produce a nice high velocity responsive
 * scrolling UX instead of the often built in slow ramping up timing function.
 * ```
 * // Only for element - disables scrolling on scrollable children
 * const dispose = fastScroll(element);
 * dispose();
 *
 * // Element and all descendants
 * const dispose = fastScroll(document.documentElement, {subtree: true});
 * dispose();
 * ```
 */
export function fastScroll(element: HTMLElement, {subtree = false, distanceFactor = 1, ...scrollerOptions}: FastScrollOptions = {}) {
	element.addEventListener('wheel', handleWheel, {passive: false});

	function handleWheel(event: WheelEvent) {
		let deltaY = 0;
		let deltaX = 0;

		switch (event.deltaMode) {
			case WheelEvent.DOM_DELTA_PIXEL:
				deltaY = event.deltaY * distanceFactor;
				deltaX = event.deltaX * distanceFactor;
				break;
			case WheelEvent.DOM_DELTA_LINE:
				deltaY = event.deltaY * 34 * distanceFactor;
				deltaX = event.deltaX * 34 * distanceFactor;
				break;
			case WheelEvent.DOM_DELTA_PAGE:
				deltaY = event.deltaY * 500 * distanceFactor;
				deltaX = event.deltaX * 500 * distanceFactor;
				break;
		}

		const scrollableTarget = subtree
			? getFirstScrollableParent(event.target as HTMLElement, deltaY, deltaX)
			: element;

		if (!scrollableTarget) return;

		event.preventDefault();
		getElementScroller(scrollableTarget, scrollerOptions).by(deltaY, deltaX);
	}

	return () => element.removeEventListener('wheel', handleWheel);
}

function getElementScroller(element: HTMLElement, options?: ScrollerOptions) {
	if (destinationMap.has(element)) return destinationMap.get(element);

	const destination = new Scroller(element, options);
	destinationMap.set(element, destination);

	return destination;
}

class Scroller {
	element: HTMLElement;
	speed: number;
	easingFunction: (x: number) => number;
	top: number;
	left: number;
	frameId: number | null = null;
	start: {time: number; top: number; left: number} | null = null;

	constructor(element: HTMLElement, {speed = 300, easingFunction = easeOutQuart}: ScrollerOptions = {}) {
		this.element = element;
		this.speed = speed;
		this.easingFunction = easingFunction;
		this.top = element.scrollTop;
		this.left = element.scrollLeft;
		this.scrollTick = this.scrollTick.bind(this);

		// 'smooth' scrolling breaks this script for some reason
		element.style.scrollBehavior = 'auto';
	}

	get isScrolling() {
		return this.start != null;
	}

	to(top: number, left: number) {
		this.top = Math.max(Math.min(top, this.element.scrollHeight - this.element.clientHeight), 0);
		this.left = Math.max(Math.min(left, this.element.scrollWidth - this.element.clientWidth), 0);

		// Start scrolling
		if (this.top === this.element.scrollTop && this.left === this.element.scrollLeft) return;
		this.start = {
			time: performance.now(),
			top: this.element.scrollTop,
			left: this.element.scrollLeft,
		};
		if (!this.frameId) this.frameId = requestAnimationFrame(this.scrollTick);
	}

	by(topDelta: number, leftDelta: number) {
		const top = this.isScrolling ? this.top : this.element.scrollTop;
		const left = this.isScrolling ? this.left : this.element.scrollLeft;
		this.to(top + topDelta, left + leftDelta);
	}

	scrollTick() {
		this.frameId = null;

		if (!this.start) return;

		const progress = this.easingFunction(Math.min((performance.now() - this.start.time) / this.speed, 1));
		const top = this.start.top + progress * (this.top - this.start.top);
		const left = this.start.left + progress * (this.left - this.start.left);

		this.element.scrollTop = top;
		this.element.scrollLeft = left;

		if (top !== this.top || left !== this.left) {
			this.frameId = requestAnimationFrame(this.scrollTick);
		} else {
			this.start = null;
		}
	}
}

function easeOutQuart(x: number): number {
	return 1 - Math.pow(1 - x, 4);
}

function getFirstScrollableParent(element: HTMLElement | null, deltaY: number, deltaX: number): HTMLElement | null {
	while (element) {
		if (deltaY !== 0) {
			if (isScrollableY(element)) return element;
		} else if (deltaX !== 0) {
			if (isScrollableX(element)) return element;
		}

		element = element.parentElement;
	}

	return null;
}

function isScrollableY(element: HTMLElement) {
	// First check if there is any potential scrollable distance.
	// This might be inflated by negative child element margins, so this
	// is not enough to return true, but sufficient for false.
	if (element.scrollHeight === element.clientHeight) return false;

	// Check if scrolling is disabled by CSS
	if (getComputedStyle(element).overflowY === 'hidden') return false;

	// If scrollTop is above 0 here, we are definitely scrolling
	if (element.scrollTop > 0) return true;

	// Try checking if browser resets the value back
	element.scrollTop = 1;
	if (element.scrollTop > 0) {
		// Value was accepted, lets put it back and report true
		element.scrollTop = 0;
		return true;
	}

	return false;
}

function isScrollableX(element: HTMLElement) {
	// See comments in isScrollableY()
	if (element.scrollWidth === element.clientWidth || getComputedStyle(element).overflowX === 'hidden') return false;
	if (element.scrollLeft > 0) return true;
	element.scrollLeft = 1;
	if (element.scrollLeft > 0) {
		element.scrollLeft = 0;
		return true;
	}
	return false;
}
