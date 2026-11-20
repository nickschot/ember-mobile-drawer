/**
 * A damped spring, solved in closed form: the result depends only on elapsed
 * time, not on the frame rate, and stays stable for large time steps (e.g.
 * the first frame after a background tab becomes visible).
 *
 * Units: px, px/s, and ms from the clock; stiffness, damping and mass are per
 * second.
 *
 * @module
 */
/** Source of time and animation frames; tests inject a fake one. */
export interface FrameClock {
    now(): number;
    /** The callback gets the frame time on the same time base as `now`. */
    requestFrame(callback: (time: number) => void): number;
    cancelFrame(handle: number): void;
}
/** All values must be finite and greater than zero. */
export interface SpringConfig {
    stiffness: number;
    /**
     * The defaults are critically damped: no oscillation, but a fast start
     * towards the target can still overshoot once. Zero would never rest.
     */
    damping: number;
    mass: number;
    /** Px; with `restVelocityThreshold`, the spring then snaps onto target. */
    restDisplacementThreshold: number;
    /** Px/s. */
    restVelocityThreshold: number;
}
export interface SpringState {
    value: number;
    velocity: number;
}
export interface SpringOptions extends Partial<SpringConfig> {
    /**
     * Called every frame, and once more when the spring snaps onto its target
     * (after the run ended, so it may start a new one). Not on `stop`.
     */
    onUpdate?: (state: SpringState) => void;
    clock?: FrameClock;
    /** Checked when a run starts; `true` jumps straight to the target. */
    prefersReducedMotion?: () => boolean;
}
export declare const DEFAULT_SPRING_CONFIG: Readonly<SpringConfig>;
export declare const browserClock: FrameClock;
export declare function browserPrefersReducedMotion(): boolean;
/**
 * Advances by `dt` seconds. `displacement` is relative to the target.
 *
 * @internal exported for tests
 */
export declare function stepSpring(displacement: number, velocity: number, dt: number, { stiffness, damping, mass, }: Pick<SpringConfig, 'stiffness' | 'damping' | 'mass'>): {
    displacement: number;
    velocity: number;
};
/**
 * A one-dimensional damped spring driven by animation frames. It holds no
 * tracked state: consumers apply the value in `onUpdate`. If a frame produces
 * a non-finite value, the run ends and the last finite state is kept.
 */
export declare class Spring {
    #private;
    constructor(options?: SpringOptions);
    /** A run in progress uses the new parameters from its next frame. */
    configure(overrides: Partial<SpringConfig>): void;
    get value(): number;
    get velocity(): number;
    get target(): number;
    get isAnimating(): boolean;
    /**
     * Returns a promise for the end of the run (also an early end); it never
     * rejects. While animating, returns the current run's promise. With reduced
     * motion or at rest, it snaps to the target synchronously.
     */
    start(): Promise<void>;
    /** Keeps position and velocity; the pending `start` promise resolves. */
    stop(): void;
    /** Keeps position and velocity. Does not start an idle spring. */
    retarget(to: number): void;
    set(value: number, velocity?: number): void;
}
//# sourceMappingURL=spring.d.ts.map