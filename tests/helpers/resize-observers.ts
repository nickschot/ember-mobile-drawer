/** How long `resizeObserversDelivered` waits for a frame, in ms. */
export const RESIZE_OBSERVER_TIMEOUT = 5000;

/**
 * Resolves after the resize observations of the next rendering frame: every
 * ResizeObserver that was created earlier (such as a drawer's) and has a
 * size change got its callbacks, and their microtasks ran.
 *
 * The browser broadcasts resize observations in a rendering frame, to the
 * observers in the order they were created. A new observer always gets one
 * initial callback (the root element has a size), in the first round of
 * callbacks of the first frame after it starts to observe. A callback that
 * changes the size of a deeper observed element starts another round in the
 * same frame. The promise resolves in a task after that callback, not in
 * its microtask: so the later rounds of the frame have run too, and the
 * code after `await` runs outside of the browser's resize observation step
 * (a new observer or a size change there could make the browser skip
 * notifications and report a "ResizeObserver loop" error).
 *
 * Use it after a size change, instead of polling with `waitUntil`: that
 * gives up after a fixed number of timer ticks (1s), and a busy machine can
 * delay the next rendering frame for most of that time, while timers keep
 * running. A `requestAnimationFrame` is not enough: its callbacks run before
 * the resize observations of the same frame.
 *
 * Rejects when no frame comes within `timeout` ms (default
 * {@link RESIZE_OBSERVER_TIMEOUT}, far above the frame delays measured under
 * load), so a missing frame fails the test with a clear message. The
 * observer is disconnected and the timer cleared in both cases.
 */
export function resizeObserversDelivered(
  timeout = RESIZE_OBSERVER_TIMEOUT,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    const observer = new ResizeObserver(() => {
      finish();
      // In a task, after the frame's resize observations.
      setTimeout(resolve, 0);
    });
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`No ResizeObserver delivery within ${timeout} ms`));
    }, timeout);
    observer.observe(document.documentElement);
  });
}
