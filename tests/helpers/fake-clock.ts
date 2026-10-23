import type { FrameClock } from '#src/-private/spring/spring.ts';

/** Deterministic stand-in for `performance.now` + `requestAnimationFrame`. */
export class FakeClock implements FrameClock {
  time = 1000;
  #nextHandle = 1;
  #callbacks = new Map<number, (time: number) => void>();

  now(): number {
    return this.time;
  }

  requestFrame(callback: (time: number) => void): number {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.#callbacks.delete(handle);
  }

  get pendingFrames(): number {
    return this.#callbacks.size;
  }

  /** Advances time by `ms` and runs the frame callbacks scheduled so far. */
  frame(ms = 16): void {
    this.time += ms;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback(this.time);
  }

  /** Runs frames until nothing is scheduled; returns the number of frames. */
  runUntilIdle(ms = 16, maxFrames = 10_000): number {
    let frames = 0;
    while (this.pendingFrames > 0) {
      if (++frames > maxFrames) throw new Error('animation did not settle');
      this.frame(ms);
    }
    return frames;
  }
}
