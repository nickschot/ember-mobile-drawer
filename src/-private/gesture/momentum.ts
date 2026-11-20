/**
 * Scroll momentum after a drag scrolled the content from script, like a
 * native iOS scroll view.
 *
 * @module
 */

import type { FrameClock } from '../spring/spring.ts';

/** Per ms: UIScrollView's `decelerationRate` `normal`. */
export const DECELERATION_RATE = 0.998;

/** Px/ms. */
export const MIN_MOMENTUM_VELOCITY = 0.02;

const LN_RATE = Math.log(DECELERATION_RATE);

/** Distance from the start and velocity `elapsed` ms later. */
export function momentumAt(
  velocity: number,
  elapsed: number,
): { distance: number; velocity: number } {
  if (!(elapsed > 0)) return { distance: 0, velocity };
  const decay = Math.pow(DECELERATION_RATE, elapsed);
  return {
    distance: (velocity * (decay - 1)) / LN_RATE,
    velocity: velocity * decay,
  };
}

export interface MomentumOptions {
  clock: FrameClock;
  from: number;
  /** Px/ms. */
  velocity: number;
  /** It stops at an end. */
  min: number;
  max: number;
  /** Once per frame; no layout read of its own. */
  write: (position: number) => void;
  /** Also on `stop`. */
  onEnd?: () => void;
}

export class Momentum {
  #options: MomentumOptions;
  #start: number;
  #frame?: number;
  #running = true;

  constructor(options: MomentumOptions) {
    this.#options = options;
    this.#start = options.clock.now();
    this.#frame = options.clock.requestFrame(this.#step);
  }

  get isRunning(): boolean {
    return this.#running;
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#frame !== undefined) {
      this.#options.clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#options.onEnd?.();
  }

  // The clock's time, not the frame's (as the catch-up): input of the same
  // frame is handled after the frame's time stamp.
  #step = (): void => {
    this.#frame = undefined;
    if (!this.#running) return;
    const { clock, from, min, max, write } = this.#options;
    const now = momentumAt(this.#options.velocity, clock.now() - this.#start);
    const position = from + now.distance;
    const clamped = Math.min(Math.max(position, min), max);
    write(clamped);
    if (
      clamped !== position ||
      Math.abs(now.velocity) < MIN_MOMENTUM_VELOCITY
    ) {
      this.stop();
      return;
    }
    this.#frame = clock.requestFrame(this.#step);
  };
}
