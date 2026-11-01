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
export const DEFAULT_SPRING_CONFIG: Readonly<SpringConfig> = Object.freeze({
  stiffness: 400,
  damping: 40,
  mass: 1,
  restDisplacementThreshold: 0.1,
  restVelocityThreshold: 1,
});

/** `performance.now` + `requestAnimationFrame`. */
export const browserClock: FrameClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/** Whether the `prefers-reduced-motion: reduce` media query matches. */
export function browserPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Spring: ${name} must be a finite number, got ${value}`,
    );
  }
}

function assertPositive(name: string, value: number): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(
      `Spring: ${name} must be a finite number greater than 0, got ${value}`,
    );
  }
}

/**
 * `base` with the defined values of `overrides`, validated and frozen.
 *
 * @throws RangeError when a value is not a finite number greater than 0.
 */
function mergeConfig(
  base: Readonly<SpringConfig>,
  overrides: Partial<SpringConfig>,
): Readonly<SpringConfig> {
  const config: SpringConfig = { ...base };
  for (const key of Object.keys(config) as (keyof SpringConfig)[]) {
    const value = overrides[key];
    if (value !== undefined) config[key] = value;
    assertPositive(key, config[key]);
  }
  return Object.freeze(config);
}

/**
 * Advances a damped spring by `dt` seconds using the closed-form solution.
 * `displacement` is the position relative to the target.
 *
 * @internal exported for tests
 */
export function stepSpring(
  displacement: number,
  velocity: number,
  dt: number,
  {
    stiffness,
    damping,
    mass,
  }: Pick<SpringConfig, 'stiffness' | 'damping' | 'mass'>,
): { displacement: number; velocity: number } {
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const x0 = displacement;
  const v0 = velocity;

  if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped.
    const decay = Math.exp(-omega0 * dt);
    const b = v0 + omega0 * x0;
    return {
      displacement: decay * (x0 + b * dt),
      velocity: decay * (v0 - omega0 * b * dt),
    };
  }

  if (zeta < 1) {
    // Under-damped: oscillates around the target.
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const a = zeta * omega0;
    const decay = Math.exp(-a * dt);
    const cos = Math.cos(omegaD * dt);
    const sin = Math.sin(omegaD * dt);
    return {
      displacement: decay * (x0 * cos + ((v0 + a * x0) / omegaD) * sin),
      velocity:
        decay * (v0 * cos - ((a * v0 + omega0 * omega0 * x0) / omegaD) * sin),
    };
  }

  // Over-damped: sum of two decaying exponentials. r2 is computed directly
  // and r1 from r1 * r2 = omega0², which avoids cancellation for large zeta.
  const r2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
  const r1 = (omega0 * omega0) / r2;
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return {
    displacement: c1 * e1 + c2 * e2,
    velocity: r1 * c1 * e1 + r2 * c2 * e2,
  };
}

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
export class Spring {
  #config: Readonly<SpringConfig>;

  #value: number;
  #velocity: number;
  #target: number;
  #onUpdate?: (state: SpringState) => void;
  #clock: FrameClock;
  #prefersReducedMotion: () => boolean;

  #frame: number | undefined;
  #lastTime = 0;
  #run:
    | { promise: Promise<SpringResult>; resolve: (r: SpringResult) => void }
    | undefined;

  constructor(options: SpringOptions = {}) {
    const {
      from = 0,
      to = from,
      velocity = 0,
      onUpdate,
      clock = browserClock,
      prefersReducedMotion = browserPrefersReducedMotion,
      ...overrides
    } = options;

    const config = mergeConfig(DEFAULT_SPRING_CONFIG, overrides);
    assertFinite('from', from);
    assertFinite('to', to);
    assertFinite('velocity', velocity);

    this.#config = config;
    this.#value = from;
    this.#velocity = velocity;
    this.#target = to;
    this.#onUpdate = onUpdate;
    this.#clock = clock;
    this.#prefersReducedMotion = prefersReducedMotion;
  }

  /** The physical parameters in use, see {@link Spring.configure}. */
  get config(): Readonly<SpringConfig> {
    return this.#config;
  }

  /**
   * Changes physical parameters; keys that are left out or `undefined` keep
   * their current value. Position, velocity and target are kept. A run in
   * progress continues with the new parameters from its next frame.
   *
   * @throws RangeError when a value is not a finite number greater than 0;
   *   the parameters are then unchanged.
   */
  configure(overrides: Partial<SpringConfig>): void {
    this.#config = mergeConfig(this.#config, overrides);
  }

  /** Current position in px. */
  get value(): number {
    return this.#value;
  }

  /** Current velocity in px/s. */
  get velocity(): number {
    return this.#velocity;
  }

  /** Position the spring is moving towards, in px. */
  get target(): number {
    return this.#target;
  }

  /** Whether a run started with {@link Spring.start} is in progress. */
  get isAnimating(): boolean {
    return this.#run !== undefined;
  }

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
  start(): Promise<SpringResult> {
    if (this.#run) {
      return this.#run.promise;
    }

    // Query the environment before a run exists, so a throw leaves no run.
    const jump = this.#prefersReducedMotion() || this.#isAtRest();
    const now = jump ? 0 : this.#clock.now();

    let resolve!: (r: SpringResult) => void;
    const promise = new Promise<SpringResult>((r) => (resolve = r));
    this.#run = { promise, resolve };

    if (jump) {
      this.#settle();
    } else {
      this.#lastTime = now;
      this.#scheduleFrame();
    }

    return promise;
  }

  /**
   * Stops animating, leaving the spring at its current position and velocity.
   * A pending {@link Spring.start} promise resolves with `finished: false`.
   * Does nothing when not animating.
   */
  stop(): void {
    if (this.#frame !== undefined) {
      this.#clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#endRun(false);
  }

  /**
   * Changes the target. Position and velocity are kept, so an animation in
   * progress continues smoothly towards the new target and the pending
   * {@link Spring.start} promise now resolves when that target is reached.
   * Does not start the spring when it is idle.
   *
   * @throws RangeError when `to` is not finite; the target is then unchanged.
   */
  retarget(to: number): void {
    assertFinite('target', to);
    this.#target = to;
  }

  /**
   * Sets position and velocity directly, e.g. to hand over a gesture's
   * position and release velocity before calling {@link Spring.start}. When
   * called while animating, the animation continues from the new state.
   *
   * @throws RangeError when `value` or `velocity` is not finite; the state is
   *   then unchanged.
   */
  set(value: number, velocity = 0): void {
    assertFinite('value', value);
    assertFinite('velocity', velocity);
    this.#value = value;
    this.#velocity = velocity;
  }

  #tick = (time: number): void => {
    this.#frame = undefined;

    const dt = Math.max(0, time - this.#lastTime) / 1000;
    this.#lastTime = Math.max(time, this.#lastTime);

    if (dt > 0) {
      const next = stepSpring(
        this.#value - this.#target,
        this.#velocity,
        dt,
        this.#config,
      );
      const value = this.#target + next.displacement;
      if (!Number.isFinite(value) || !Number.isFinite(next.velocity)) {
        // Keep the last finite state rather than looping on NaN forever.
        this.#endRun(false);
        return;
      }
      this.#value = value;
      this.#velocity = next.velocity;
    }

    if (this.#isAtRest()) {
      this.#settle();
      return;
    }

    try {
      this.#onUpdate?.({ value: this.#value, velocity: this.#velocity });
    } catch (error) {
      this.stop();
      throw error;
    }

    // onUpdate may have called stop() (and maybe start() again).
    if (this.#run && this.#frame === undefined) {
      this.#scheduleFrame();
    }
  };

  #scheduleFrame(): void {
    try {
      this.#frame = this.#clock.requestFrame(this.#tick);
    } catch (error) {
      this.#endRun(false);
      throw error;
    }
  }

  #isAtRest(): boolean {
    return (
      Math.abs(this.#value - this.#target) <=
        this.#config.restDisplacementThreshold &&
      Math.abs(this.#velocity) <= this.#config.restVelocityThreshold
    );
  }

  #settle(): void {
    this.#value = this.#target;
    this.#velocity = 0;
    // End the run first, so the result is consistent even if onUpdate throws
    // or calls retarget()/start().
    this.#endRun(true);
    this.#onUpdate?.({ value: this.#value, velocity: 0 });
  }

  #endRun(finished: boolean): void {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.resolve({ finished, value: this.#value, target: this.#target });
  }
}
