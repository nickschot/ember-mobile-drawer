/**
 * A small damped-spring primitive, used to animate the drawer towards a snap
 * point after a gesture is released.
 *
 * The spring is solved analytically (closed-form solution of the damped
 * harmonic oscillator), so the result only depends on elapsed time, never on
 * the frame rate, and it stays stable for arbitrarily large time steps such as
 * the first frame after a backgrounded tab becomes visible again.
 *
 * Units: positions are in px, velocities in px/s, time in ms (as given by the
 * clock). Stiffness, damping and mass are in the usual "per second" units
 * (`F = -stiffness * x - damping * v`, `a = F / mass`).
 *
 * @module
 */
/**
 * Source of time and animation frames. The default uses `performance.now()`
 * and `requestAnimationFrame`; tests inject a fake one.
 */
export interface FrameClock {
    /** The current time in ms. */
    now(): number;
    /**
     * Schedules `callback` for the next frame. The callback receives the frame
     * time in ms, on the same time base as {@link FrameClock.now}.
     */
    requestFrame(callback: (time: number) => void): number;
    /** Cancels a frame scheduled with {@link FrameClock.requestFrame}. */
    cancelFrame(handle: number): void;
}
/**
 * Physical parameters of a spring. All values must be finite and greater than
 * zero; the {@link Spring} constructor throws a `RangeError` otherwise.
 */
export interface SpringConfig {
    /** Spring constant `k`. Higher is snappier. Default `400`. */
    stiffness: number;
    /**
     * Damping coefficient `c`. The defaults are critically damped
     * (`damping = 2 * sqrt(stiffness * mass)`): the spring does not oscillate,
     * but it can still overshoot the target once when it starts with a velocity
     * towards the target (with the defaults: faster than about 20 × the
     * distance, in px/s). Lower values bounce. Must be greater than zero, since
     * an undamped spring never comes to rest. Default `40`.
     */
    damping: number;
    /** Mass `m`. Higher is more sluggish. Default `1`. */
    mass: number;
    /**
     * The spring is at rest once it is within this distance (px) of its target
     * and slower than {@link SpringConfig.restVelocityThreshold}. It then snaps
     * exactly onto the target. Default `0.1`.
     */
    restDisplacementThreshold: number;
    /** See {@link SpringConfig.restDisplacementThreshold}, in px/s. Default `1`. */
    restVelocityThreshold: number;
}
/** Position and velocity of a spring at one point in time. */
export interface SpringState {
    /** Current position in px. */
    value: number;
    /** Current velocity in px/s. */
    velocity: number;
}
/** What the promise returned by {@link Spring.start} resolves with. */
export interface SpringResult {
    /**
     * `true` when the spring came to rest at its target. `false` when the run
     * ended early: {@link Spring.stop} was called, `onUpdate` or the clock
     * threw, or the simulation produced a non-finite value.
     */
    finished: boolean;
    /** Position when the run ended. Equals `target` when `finished`. */
    value: number;
    /** The target at the time the run ended (after any retargets). */
    target: number;
}
export interface SpringOptions extends Partial<SpringConfig> {
    /** Initial position in px. Default `0`. */
    from?: number;
    /** Target position in px. Default: `from`. */
    to?: number;
    /** Initial velocity in px/s, e.g. a gesture's release velocity. Default `0`. */
    velocity?: number;
    /**
     * Called on every animation frame with the new state, and once more when
     * the spring snaps onto its target (after the run has ended, so it may
     * start a new run). Not called on {@link Spring.stop}. If it throws, the
     * run ends with `finished: false` and the error is rethrown.
     */
    onUpdate?: (state: SpringState) => void;
    /** Time and frame source. Default: `performance.now` + `requestAnimationFrame`. */
    clock?: FrameClock;
    /**
     * Whether the user prefers reduced motion. Checked when a run starts
     * ({@link Spring.start} while idle); when it returns `true` the spring
     * jumps straight to its target. A run already in progress is not affected
     * if the preference changes. Default: the
     * `(prefers-reduced-motion: reduce)` media query.
     */
    prefersReducedMotion?: () => boolean;
}
/** Default physical parameters, see {@link SpringConfig}. */
export declare const DEFAULT_SPRING_CONFIG: Readonly<SpringConfig>;
/**
 * Advances a damped spring by `dt` seconds using the closed-form solution.
 * `displacement` is the position relative to the target.
 *
 * @internal exported for tests
 */
export declare function stepSpring(displacement: number, velocity: number, dt: number, { stiffness, damping, mass, }: Pick<SpringConfig, 'stiffness' | 'damping' | 'mass'>): {
    displacement: number;
    velocity: number;
};
/**
 * A one-dimensional damped spring driven by animation frames.
 *
 * It holds no tracked state: consumers apply {@link SpringState.value} in
 * `onUpdate` (e.g. to a CSS transform) themselves.
 *
 * Positions and velocities must be finite: the constructor,
 * {@link Spring.retarget} and {@link Spring.set} throw a `RangeError`
 * (without changing any state) otherwise. If a frame still produces a
 * non-finite value, the run ends with `finished: false` and the last finite
 * state is kept.
 *
 * ```ts
 * const spring = new Spring({
 *   from: currentOffset,
 *   to: snapPoint,
 *   velocity: releaseVelocity,
 *   onUpdate: ({ value }) => (el.style.transform = `translateY(${value}px)`),
 * });
 * const { finished } = await spring.start();
 * ```
 */
export declare class Spring {
    #private;
    readonly config: Readonly<SpringConfig>;
    constructor(options?: SpringOptions);
    /** Current position in px. */
    get value(): number;
    /** Current velocity in px/s. */
    get velocity(): number;
    /** Position the spring is moving towards, in px. */
    get target(): number;
    /** Whether a run started with {@link Spring.start} is in progress. */
    get isAnimating(): boolean;
    /**
     * Starts moving towards the target and returns a promise for the end of
     * this run. The promise never rejects; it resolves with `finished: true`
     * once the spring rests at its target (also after any
     * {@link Spring.retarget} calls), or with `finished: false` when the run
     * ends early (see {@link SpringResult.finished}).
     *
     * Calling `start()` while already animating returns the current run's
     * promise. With reduced motion, or when already at rest on the target, the
     * spring snaps to the target synchronously and the promise resolves with
     * `finished: true`.
     *
     * If the clock's `requestFrame` throws (e.g. no `requestAnimationFrame`
     * during server-side rendering), the run ends and the error is rethrown.
     */
    start(): Promise<SpringResult>;
    /**
     * Stops animating, leaving the spring at its current position and velocity.
     * A pending {@link Spring.start} promise resolves with `finished: false`.
     * Does nothing when not animating.
     */
    stop(): void;
    /**
     * Changes the target. Position and velocity are kept, so an animation in
     * progress continues smoothly towards the new target and the pending
     * {@link Spring.start} promise now resolves when that target is reached.
     * Does not start the spring when it is idle.
     *
     * @throws RangeError when `to` is not finite; the target is then unchanged.
     */
    retarget(to: number): void;
    /**
     * Sets position and velocity directly, e.g. to hand over a gesture's
     * position and release velocity before calling {@link Spring.start}. When
     * called while animating, the animation continues from the new state.
     *
     * @throws RangeError when `value` or `velocity` is not finite; the state is
     *   then unchanged.
     */
    set(value: number, velocity?: number): void;
}
//# sourceMappingURL=spring.d.ts.map