/**
 * Resolves once the browser has delivered the next round of ResizeObserver
 * callbacks, i.e. after every observer that was created earlier (such as a
 * drawer's) has been told about the size changes made so far.
 *
 * The browser broadcasts resize observations in a rendering frame, to the
 * observers in the order they were created. A new observer always gets one
 * initial callback (the root element has a size), in the first frame after
 * it starts to observe. So when that callback runs, the callbacks of the
 * older observers for the same frame, and their microtasks, have already
 * run.
 *
 * Use it after a size change, instead of polling with `waitUntil`: that
 * gives up after a fixed number of timer ticks (1s), and a busy machine can
 * delay the next rendering frame for about as long, while timers keep
 * running. Waiting for the frame itself has no such limit. A
 * `requestAnimationFrame` is not enough: its callbacks run before the
 * resize observations of the same frame.
 *
 * Call it from test code, not from a ResizeObserver callback.
 */
export function resizeObserversDelivered(): Promise<void> {
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement);
  });
}
