/**
 * Ms before the release that count. Long enough to smooth noisy events, short
 * enough that a finger that stopped before lifting has (almost) no velocity.
 */
export const VELOCITY_WINDOW = 100;

/** Px/s. Stops events with nearly equal time stamps giving absurd speeds. */
export const MAX_VELOCITY = 8000;

interface Sample {
  time: number;
  position: number;
}

/**
 * The average velocity over the last `VELOCITY_WINDOW` ms. Always finite (`0`
 * when unknown): the spring and the snap-point functions throw otherwise.
 */
export class VelocityTracker {
  #samples: Sample[] = [];

  reset(): void {
    this.#samples = [];
  }

  /** A sample older than the previous one is ignored. */
  add(time: number, position: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(position)) return;
    const last = this.#samples[this.#samples.length - 1];
    if (last && time < last.time) return;
    this.#samples.push({ time, position });
    const cutoff = time - VELOCITY_WINDOW;
    const firstInWindow = this.#samples.findIndex((s) => s.time >= cutoff);
    if (firstInWindow > 0) this.#samples.splice(0, firstInWindow);
  }

  /** Px/s. */
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
