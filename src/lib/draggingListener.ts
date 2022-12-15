type DraggingListener = (isDragging: boolean, event: DragEvent) => void;
const draggingListeners = new Set<DraggingListener>();
const draggingState = {
	isDragging: false,
	startEvent: '',
};

/**
 * Register listener that gets called any time dragging state changes.
 * Dragging state: if user is dragging something over the window.
 * ```
 * const dispose = registerDraggingListener((isDragging, event) => doSomething(isDragging));
 * ```
 */
export function registerDraggingListener(listener: DraggingListener) {
	draggingListeners.add(listener);
	return () => {
		draggingListeners.delete(listener);
	};
}

function triggerDraggingListeners(isDragging: boolean, event: DragEvent) {
	if (isDragging === draggingState.isDragging) return;

	// Terminating dragging is a bit tricky
	if (!isDragging) {
		// If dragging was started by dragstart, we need to wait for dragend or drop
		if (draggingState.startEvent === 'dragstart') {
			if (event.type === 'dragleave') return;
		} else if (event.type === 'dragleave') {
			// Only dragleave event out of window has both values zeroed out
			if (event.clientX !== 0 || event.clientY !== 0) return;
		}
	} else {
		draggingState.startEvent = event.type;
	}

	draggingState.isDragging = isDragging;
	draggingListeners.forEach((listener) => listener(isDragging, event));
}

window.addEventListener('dragstart', (event) => triggerDraggingListeners(true, event));
window.addEventListener('dragenter', (event) => triggerDraggingListeners(true, event));
window.addEventListener('dragleave', (event) => {
	// Only dragleave event out of window has both values zeroed out.
	if (event.clientX === 0 && event.clientY === 0) triggerDraggingListeners(false, event);
});
window.addEventListener('drop', (event) => triggerDraggingListeners(false, event));
window.addEventListener('dragend', (event) => triggerDraggingListeners(false, event));
