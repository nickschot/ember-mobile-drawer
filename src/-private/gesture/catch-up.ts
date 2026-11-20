/**
 * Catch-up of the distance a finger moved before its pan was recognised
 * (`didPan`'s 10px or more): starting from the touchdown would make the tray
 * jump, starting at recognition would lose it. So the tray eases after the
 * finger over the first frames.
 *
 * @module
 */

/** Ms: about 6 frames at 60 Hz. */
export const CATCH_UP_DURATION = 100;

/**
 * Px/ms relative to the finger (4px per 60 Hz frame), so no frame moves the
 * tray by much more than the finger moved.
 */
export const CATCH_UP_SPEED = 0.24;

/**
 * Px of finger jitter back towards the tray that the catch-up ignores. A
 * larger move back holds the tray, so it never moves against the finger.
 */
export const TURN_SLOP = 2;

/** Smoothstep peaks at 1.5 times the average speed, halfway. */
export function catchUpDuration(distance: number): number {
  const duration = (1.5 * Math.abs(distance)) / CATCH_UP_SPEED;
  return Number.isFinite(duration)
    ? Math.max(CATCH_UP_DURATION, duration)
    : CATCH_UP_DURATION;
}

/**
 * How far the tray is still behind the finger: eases from `distance` to
 * exactly `0`, slowly at both ends so it neither jumps nor jolts.
 */
export function catchUpLag(distance: number, elapsed: number): number {
  if (!Number.isFinite(distance) || distance === 0) return 0;
  if (!(elapsed > 0)) return Number.isNaN(elapsed) ? 0 : distance;
  const t = elapsed / catchUpDuration(distance);
  if (t >= 1) return 0;
  const eased = t * t * (3 - 2 * t);
  return distance * (1 - eased);
}
