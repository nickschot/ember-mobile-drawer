/**
 * The longest time (ms) that a test waits for one animation frame. A
 * browser that renders gives a frame in about 16 ms, also on a busy
 * machine. Without a limit, a browser that stops rendering frames makes
 * each test wait for the 60 s QUnit timeout.
 */
export const FRAME_TIME_LIMIT = 5000;

/**
 * Resolves after `count` animation frames (`requestAnimationFrame`).
 * Rejects with a clear error when a frame does not come in `timeout` ms,
 * for example when the browser counts the page as
 * hidden or occluded (see `testem.cjs`).
 */
export async function nextFrames(
  count = 1,
  timeout = FRAME_TIME_LIMIT,
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cancelAnimationFrame(handle);
        reject(
          new Error(
            `No animation frame came in ${timeout} ms (frame ${i} of ${count}). ` +
              `The browser stopped rendering frames: ` +
              `document.visibilityState is "${document.visibilityState}", ` +
              `document.hasFocus() is ${document.hasFocus()}.`,
          ),
        );
      }, timeout);
      const handle = requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/** Resolves after the next animation frame, see `nextFrames`. */
export function nextFrame(): Promise<void> {
  return nextFrames(1);
}
