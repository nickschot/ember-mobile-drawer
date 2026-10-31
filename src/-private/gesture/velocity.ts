/**
 * Release velocity of a drag.
 *
 * @module
 */

/**
 * Only samples from this many ms before the release count towards the release
 * velocity. Long enough to smooth out a few noisy pointer events, short enough
 * that a finger that stopped before lifting releases with (almost) no
 * velocity.
 */
export const VELOCITY_WINDOW = 100;

/**
 * The largest velocity reported, in px/s. Faster than any real flick; it
 * stops events with nearly equal time stamps (e.g. coalesced or replayed
 * events) from producing absurd speeds.
 */
export const MAX_VELOCITY = 8000;

interface Sample {
  time: number;
  position: number;
}

/**
 * Tracks a position over time and reports the average velocity over the last
 * {@link VELOCITY_WINDOW} ms.
 *
 * The result is always finite: non-finite samples are ignored, and without a
 * positive time step between the samples in the window (e.g. two events with
 * the same time stamp, or a single sample) the velocity is `0`. That keeps it
 * safe to hand to the spring and the snap-point functions, which throw on
 * non-finite input. It is capped at ±{@link MAX_VELOCITY}.
 */
export class VelocityTracker {
  #samples: Sample[] = [];

  /** Forgets all samples. */
  reset(): void {
    this.#samples = [];
  }

  /**
   * Adds a sample. `time` is in ms and must not go backwards; a sample older
   * than the previous one is ignored.
   */
  add(time: number, position: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(position)) return;
    const last = this.#samples[this.#samples.length - 1];
    if (last && time < last.time) return;
    this.#samples.push({ time, position });
    // Drop samples that have left the window.
    const cutoff = time - VELOCITY_WINDOW;
    const firstInWindow = this.#samples.findIndex((s) => s.time >= cutoff);
    if (firstInWindow > 0) this.#samples.splice(0, firstInWindow);
  }

  /**
   * The average velocity in px/s over the samples taken within
   * {@link VELOCITY_WINDOW} ms before `now`, or `0` when that can't be
   * determined.
   */
  velocity(now: number): number {
    if (!Number.isFinite(now)) return 0;
    const cutoff = now - VELOCITY_WINDOW;
    const samples = this.#samples.filter(
      (s) => s.time >= cutoff && s.time <= now,
    );
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return 0;
    const dt = last.time - first.time;
    if (!(dt > 0)) return 0;
    const velocity = ((last.position - first.position) / dt) * 1000;
    if (!Number.isFinite(velocity)) return 0;
    return Math.min(Math.max(velocity, -MAX_VELOCITY), MAX_VELOCITY);
  }
}
