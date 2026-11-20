/**
 * Catch-up of the distance a finger moved before its pan was recognised
 * (`didPan`'s 10px or more): starting from the touchdown would make the tray
 * jump, starting at recognition would lose it. So the tray eases after the
 * finger over the first frames.
 *
 * @module
 */
/** Ms: about 6 frames at 60 Hz. */
export declare const CATCH_UP_DURATION = 100;
/**
 * Px/ms relative to the finger (4px per 60 Hz frame), so no frame moves the
 * tray by much more than the finger moved.
 */
export declare const CATCH_UP_SPEED = 0.24;
/**
 * Px of finger jitter back towards the tray that the catch-up ignores. A
 * larger move back holds the tray, so it never moves against the finger.
 */
export declare const TURN_SLOP = 2;
/** Smoothstep peaks at 1.5 times the average speed, halfway. */
export declare function catchUpDuration(distance: number): number;
/**
 * How far the tray is still behind the finger: eases from `distance` to
 * exactly `0`, slowly at both ends so it neither jumps nor jolts.
 */
export declare function catchUpLag(distance: number, elapsed: number): number;
//# sourceMappingURL=catch-up.d.ts.map