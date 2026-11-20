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

export const DEFAULT_SPRING_CONFIG: Readonly<SpringConfig> = Object.freeze({
  stiffness: 400,
  damping: 40,
  mass: 1,
  restDisplacementThreshold: 0.1,
  restVelocityThreshold: 1,
});

export const browserClock: FrameClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

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

/** `base` with the defined values of `overrides`, validated and frozen. */
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
 * Advances by `dt` seconds. `displacement` is relative to the target.
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
    const decay = Math.exp(-omega0 * dt);
    const b = v0 + omega0 * x0;
    return {
      displacement: decay * (x0 + b * dt),
      velocity: decay * (v0 - omega0 * b * dt),
    };
  }

  if (zeta < 1) {
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

  // Over-damped. r1 from r1 * r2 = omega0² avoids cancellation for large zeta.
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
 * A one-dimensional damped spring driven by animation frames. It holds no
 * tracked state: consumers apply the value in `onUpdate`. If a frame produces
 * a non-finite value, the run ends and the last finite state is kept.
 */
export class Spring {
  #config: Readonly<SpringConfig>;

  #value = 0;
  #velocity = 0;
  #target = 0;
  #onUpdate?: (state: SpringState) => void;
  #clock: FrameClock;
  #prefersReducedMotion: () => boolean;

  #frame: number | undefined;
  #lastTime = 0;
  #run: { promise: Promise<void>; resolve: () => void } | undefined;

  constructor(options: SpringOptions = {}) {
    const {
      onUpdate,
      clock = browserClock,
      prefersReducedMotion = browserPrefersReducedMotion,
      ...overrides
    } = options;

    this.#config = mergeConfig(DEFAULT_SPRING_CONFIG, overrides);
    this.#onUpdate = onUpdate;
    this.#clock = clock;
    this.#prefersReducedMotion = prefersReducedMotion;
  }

  /** A run in progress uses the new parameters from its next frame. */
  configure(overrides: Partial<SpringConfig>): void {
    this.#config = mergeConfig(this.#config, overrides);
  }

  get value(): number {
    return this.#value;
  }

  get velocity(): number {
    return this.#velocity;
  }

  get target(): number {
    return this.#target;
  }

  get isAnimating(): boolean {
    return this.#run !== undefined;
  }

  /**
   * Returns a promise for the end of the run (also an early end); it never
   * rejects. While animating, returns the current run's promise. With reduced
   * motion or at rest, it snaps to the target synchronously.
   */
  start(): Promise<void> {
    if (this.#run) {
      return this.#run.promise;
    }

    // Query the environment before a run exists, so a throw leaves no run.
    const jump = this.#prefersReducedMotion() || this.#isAtRest();
    const now = jump ? 0 : this.#clock.now();

    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.#run = { promise, resolve };

    if (jump) {
      this.#settle();
    } else {
      this.#lastTime = now;
      this.#scheduleFrame();
    }

    return promise;
  }

  /** Keeps position and velocity; the pending `start` promise resolves. */
  stop(): void {
    if (this.#frame !== undefined) {
      this.#clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#endRun();
  }

  /** Keeps position and velocity. Does not start an idle spring. */
  retarget(to: number): void {
    assertFinite('target', to);
    this.#target = to;
  }

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
        this.#endRun();
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
    this.#frame = this.#clock.requestFrame(this.#tick);
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
    // End the run first, so it ends even if onUpdate throws or calls
    // retarget()/start().
    this.#endRun();
    this.#onUpdate?.({ value: this.#value, velocity: 0 });
  }

  #endRun(): void {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.resolve();
  }
}
