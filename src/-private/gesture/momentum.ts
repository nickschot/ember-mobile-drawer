/**
 * Scroll momentum after a drag scrolled the content from script (see
 * `MobileDrawer`), like the deceleration of a native iOS scroll view.
 *
 * @module
 */

import type { FrameClock } from '../spring/spring.ts';

/**
 * How much of its velocity the scroll keeps per ms: UIScrollView's
 * `decelerationRate` `normal`.
 */
export const DECELERATION_RATE = 0.998;

/**
 * Below this speed (px/ms) the momentum stops. A release slower than this
 * has no momentum.
 */
export const MIN_MOMENTUM_VELOCITY = 0.02;

const LN_RATE = Math.log(DECELERATION_RATE);

/**
 * Where a momentum that starts at `velocity` (px/ms) is `elapsed` ms later,
 * relative to where it started, and how fast it goes then: the velocity
 * decays by {@link DECELERATION_RATE} per ms.
 */
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
  /** The position (px) it starts at. */
  from: number;
  /** The velocity (px/ms) it starts with. */
  velocity: number;
  /** The range the position stays in: it stops at an end. */
  min: number;
  max: number;
  /** Writes a position. Called once per frame; must not read layout. */
  write: (position: number) => void;
  /** Called once when it stops, by itself or by `stop`. */
  onEnd?: () => void;
}

/**
 * A running momentum: one `write` per animation frame until it is slower
 * than {@link MIN_MOMENTUM_VELOCITY}, reaches `min` or `max`, or is stopped.
 */
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

  /** Stops it where it is. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#frame !== undefined) {
      this.#options.clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#options.onEnd?.();
  }

  /**
   * A frame, at the time on the clock (as the drawer's catch-up frames):
   * input of the same frame is handled after the frame's time stamp.
   */
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
