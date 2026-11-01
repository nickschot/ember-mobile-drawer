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
export declare const DECELERATION_RATE = 0.998;
/**
 * Below this speed (px/ms) the momentum stops. A release slower than this
 * has no momentum.
 */
export declare const MIN_MOMENTUM_VELOCITY = 0.02;
/**
 * Where a momentum that starts at `velocity` (px/ms) is `elapsed` ms later,
 * relative to where it started, and how fast it goes then: the velocity
 * decays by {@link DECELERATION_RATE} per ms.
 */
export declare function momentumAt(velocity: number, elapsed: number): {
    distance: number;
    velocity: number;
};
export interface MomentumOptions {
    clock: FrameClock;
    /** The position (px) it starts at. */
    from: number;
    /** The velocity (px/ms) it starts with. */
    velocity: number;
    /** The range the position stays in: it stops at an end. */
    min: number;
    max: number;
    /** Writes a position. Called once per frame; no layout read of its own. */
    write: (position: number) => void;
    /** Called once when it stops, by itself or by `stop`. */
    onEnd?: () => void;
}
/**
 * A running momentum: one `write` per animation frame until it is slower
 * than {@link MIN_MOMENTUM_VELOCITY}, reaches `min` or `max`, or is stopped.
 */
export declare class Momentum {
    #private;
    constructor(options: MomentumOptions);
    get isRunning(): boolean;
    /** Stops it where it is. */
    stop(): void;
}
//# sourceMappingURL=momentum.d.ts.map