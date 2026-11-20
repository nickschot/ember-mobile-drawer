/**
 * Ms before the release that count. Long enough to smooth noisy events, short
 * enough that a finger that stopped before lifting has (almost) no velocity.
 */
export declare const VELOCITY_WINDOW = 100;
/** Px/s. Stops events with nearly equal time stamps giving absurd speeds. */
export declare const MAX_VELOCITY = 8000;
/**
 * The average velocity over the last `VELOCITY_WINDOW` ms. Always finite (`0`
 * when unknown): the spring and the snap-point functions throw otherwise.
 */
export declare class VelocityTracker {
    #private;
    reset(): void;
    /** A sample older than the previous one is ignored. */
    add(time: number, position: number): void;
    /** Px/s. */
    velocity(now: number): number;
}
//# sourceMappingURL=velocity.d.ts.map