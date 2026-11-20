/**
 * Scroll momentum after a drag scrolled the content from script, like a
 * native iOS scroll view.
 *
 * @module
 */
import type { FrameClock } from '../spring/spring.ts';
/** Per ms: UIScrollView's `decelerationRate` `normal`. */
export declare const DECELERATION_RATE = 0.998;
/** Px/ms. */
export declare const MIN_MOMENTUM_VELOCITY = 0.02;
/** Distance from the start and velocity `elapsed` ms later. */
export declare function momentumAt(velocity: number, elapsed: number): {
    distance: number;
    velocity: number;
};
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
export declare class Momentum {
    #private;
    constructor(options: MomentumOptions);
    get isRunning(): boolean;
    stop(): void;
}
//# sourceMappingURL=momentum.d.ts.map