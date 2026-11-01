/**
 * Catch-up of the distance a finger moved before its pan was recognised.
 *
 * A pan is only recognised once the finger has moved past a threshold
 * (`didPan`'s 10px, more when the browser sends few pointer moves). Starting
 * the drag from where the finger touched down would make the tray jump by
 * that distance; starting it where the pan is recognised loses it. So the
 * drag starts where the pan is recognised and the tray then catches up with
 * the finger over the first frames: it lags behind the finger by
 * {@link catchUpLag} px, which eases from the full distance to `0`.
 *
 * @module
 */
/** The shortest catch-up, in ms: about 6 frames at 60 Hz. */
export declare const CATCH_UP_DURATION = 100;
/**
 * The fastest the tray moves relative to the finger while it catches up, in
 * px/ms (4px in a 60 Hz frame). A larger distance takes longer than
 * {@link CATCH_UP_DURATION}, so no frame moves the tray by much more than
 * the finger moved.
 */
export declare const CATCH_UP_SPEED = 0.24;
/**
 * How far (screen px) the finger may move back towards the tray during the
 * catch-up without stopping it: the jitter of a finger that holds still or
 * moves slowly. A larger move back holds the tray until the finger reaches
 * it, so it never moves against the finger or passes it.
 */
export declare const TURN_SLOP = 2;
/**
 * How long (ms) catching up `distance` px takes: {@link CATCH_UP_DURATION},
 * or longer for a distance that would otherwise be faster than
 * {@link CATCH_UP_SPEED}. The easing (`smoothstep`) is at its fastest
 * halfway, at 1.5 times the average speed.
 */
export declare function catchUpDuration(distance: number): number;
/**
 * How far (px, with the sign of `distance`) the tray is still behind the
 * finger `elapsed` ms after the pan was recognised, when the finger had
 * moved `distance` px by then. Starts at `distance` and eases to exactly `0`
 * after {@link catchUpDuration}: slowly at first, so the tray doesn't jump
 * when the drag starts, and slowly at the end, so it settles under the
 * finger without a jolt. Always finite.
 */
export declare function catchUpLag(distance: number, elapsed: number): number;
//# sourceMappingURL=catch-up.d.ts.map