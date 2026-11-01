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
export declare const VELOCITY_WINDOW = 100;
/**
 * The largest velocity reported, in px/s. Faster than any real flick; it
 * stops events with nearly equal time stamps (e.g. coalesced or replayed
 * events) from producing absurd speeds.
 */
export declare const MAX_VELOCITY = 8000;
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
export declare class VelocityTracker {
    #private;
    /** Forgets all samples. */
    reset(): void;
    /**
     * Adds a sample. `time` is in ms and must not go backwards; a sample older
     * than the previous one is ignored.
     */
    add(time: number, position: number): void;
    /**
     * The average velocity in px/s over the samples taken within
     * {@link VELOCITY_WINDOW} ms before `now`, or `0` when that can't be
     * determined.
     */
    velocity(now: number): number;
}
//# sourceMappingURL=velocity.d.ts.map