import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { warn, assert } from '@ember/debug';
import { buildWaiter } from '@ember/test-waiters';
import { d as drawerEnvironment, V as VelocityTracker, u as unregisterDrawer, r as registerDrawer, D as DECISION_SLOP, a as dragSource } from './registry-XpaCNYky.js';
import { setModifierManager, capabilities, on } from '@ember/modifier';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import { g, i } from 'decorator-transforms/runtime-esm';

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

/**
 * Physical parameters of a spring. All values must be finite and greater than
 * zero; the {@link Spring} constructor throws a `RangeError` otherwise.
 */

/** Position and velocity of a spring at one point in time. */

/** What the promise returned by {@link Spring.start} resolves with. */

/** Default physical parameters, see {@link SpringConfig}. */
const DEFAULT_SPRING_CONFIG = Object.freeze({
  stiffness: 400,
  damping: 40,
  mass: 1,
  restDisplacementThreshold: 0.1,
  restVelocityThreshold: 1
});

/** `performance.now` + `requestAnimationFrame`. */
const browserClock = {
  now: () => performance.now(),
  requestFrame: callback => requestAnimationFrame(callback),
  cancelFrame: handle => cancelAnimationFrame(handle)
};

/** Whether the `prefers-reduced-motion: reduce` media query matches. */
function browserPrefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function assertFinite$1(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Spring: ${name} must be a finite number, got ${value}`);
  }
}
function assertPositive(name, value) {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`Spring: ${name} must be a finite number greater than 0, got ${value}`);
  }
}

/**
 * `base` with the defined values of `overrides`, validated and frozen.
 *
 * @throws RangeError when a value is not a finite number greater than 0.
 */
function mergeConfig(base, overrides) {
  const config = {
    ...base
  };
  for (const key of Object.keys(config)) {
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
function stepSpring(displacement, velocity, dt, {
  stiffness,
  damping,
  mass
}) {
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
      velocity: decay * (v0 - omega0 * b * dt)
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
      displacement: decay * (x0 * cos + (v0 + a * x0) / omegaD * sin),
      velocity: decay * (v0 * cos - (a * v0 + omega0 * omega0 * x0) / omegaD * sin)
    };
  }

  // Over-damped: sum of two decaying exponentials. r2 is computed directly
  // and r1 from r1 * r2 = omega0², which avoids cancellation for large zeta.
  const r2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
  const r1 = omega0 * omega0 / r2;
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * dt);
  const e2 = Math.exp(r2 * dt);
  return {
    displacement: c1 * e1 + c2 * e2,
    velocity: r1 * c1 * e1 + r2 * c2 * e2
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
class Spring {
  #config;
  #value;
  #velocity;
  #target;
  #onUpdate;
  #clock;
  #prefersReducedMotion;
  #frame;
  #lastTime = 0;
  #run;
  constructor(options = {}) {
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
    assertFinite$1('from', from);
    assertFinite$1('to', to);
    assertFinite$1('velocity', velocity);
    this.#config = config;
    this.#value = from;
    this.#velocity = velocity;
    this.#target = to;
    this.#onUpdate = onUpdate;
    this.#clock = clock;
    this.#prefersReducedMotion = prefersReducedMotion;
  }

  /** The physical parameters in use, see {@link Spring.configure}. */
  get config() {
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
  configure(overrides) {
    this.#config = mergeConfig(this.#config, overrides);
  }

  /** Current position in px. */
  get value() {
    return this.#value;
  }

  /** Current velocity in px/s. */
  get velocity() {
    return this.#velocity;
  }

  /** Position the spring is moving towards, in px. */
  get target() {
    return this.#target;
  }

  /** Whether a run started with {@link Spring.start} is in progress. */
  get isAnimating() {
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
  start() {
    if (this.#run) {
      return this.#run.promise;
    }

    // Query the environment before a run exists, so a throw leaves no run.
    const jump = this.#prefersReducedMotion() || this.#isAtRest();
    const now = jump ? 0 : this.#clock.now();
    let resolve;
    const promise = new Promise(r => resolve = r);
    this.#run = {
      promise,
      resolve
    };
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
  stop() {
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
  retarget(to) {
    assertFinite$1('target', to);
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
  set(value, velocity = 0) {
    assertFinite$1('value', value);
    assertFinite$1('velocity', velocity);
    this.#value = value;
    this.#velocity = velocity;
  }
  #tick = time => {
    this.#frame = undefined;
    const dt = Math.max(0, time - this.#lastTime) / 1000;
    this.#lastTime = Math.max(time, this.#lastTime);
    if (dt > 0) {
      const next = stepSpring(this.#value - this.#target, this.#velocity, dt, this.#config);
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
      this.#onUpdate?.({
        value: this.#value,
        velocity: this.#velocity
      });
    } catch (error) {
      this.stop();
      throw error;
    }

    // onUpdate may have called stop() (and maybe start() again).
    if (this.#run && this.#frame === undefined) {
      this.#scheduleFrame();
    }
  };
  #scheduleFrame() {
    try {
      this.#frame = this.#clock.requestFrame(this.#tick);
    } catch (error) {
      this.#endRun(false);
      throw error;
    }
  }
  #isAtRest() {
    return Math.abs(this.#value - this.#target) <= this.#config.restDisplacementThreshold && Math.abs(this.#velocity) <= this.#config.restVelocityThreshold;
  }
  #settle() {
    this.#value = this.#target;
    this.#velocity = 0;
    // End the run first, so the result is consistent even if onUpdate throws
    // or calls retarget()/start().
    this.#endRun(true);
    this.#onUpdate?.({
      value: this.#value,
      velocity: 0
    });
  }
  #endRun(finished) {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.resolve({
      finished,
      value: this.#value,
      target: this.#target
    });
  }
}

/**
 * Snap-point model for the drawer.
 *
 * Everything in here is a pure function on a single axis: an "offset" is the
 * distance in px the drawer is opened along its axis, from `0` (closed) up to
 * the container size (fully open). Mapping that distance to a placement
 * (left/right/top/bottom) is the component's job.
 *
 * @module
 */

/**
 * A snap point as passed in by the user:
 *
 * - a number: an offset in px, e.g. `0` or `240`;
 * - a percentage string: a fraction of the container size, e.g. `'50%'`;
 * - `'content'`: the measured size of the drawer content.
 *
 * The type only checks the shape. The runtime check in
 * {@link resolveSnapPoints} is the source of truth: px values must be finite
 * and `>= 0`, and percentages must be between `0%` and `100%`. The number
 * part of a percentage is parsed with `Number()`, so every numeric form the
 * type accepts (such as `'.5%'` or `'1e1%'`) also works at runtime.
 *
 * @example
 * ```ts
 * const snapPoints: SnapPoint[] = [0, '50%', 'content', '100%'];
 * ```
 */

/** The sizes snap points are resolved against, in px along the drawer axis. */

/** A snap point resolved to a px offset. */

/**
 * Offsets closer together than this (in px) are treated as the same snap
 * point. Sub-pixel differences can't be told apart on screen and would only
 * produce unreachable snap points.
 */
const DEDUPE_TOLERANCE = 0.5;
function describe(snapPoint) {
  return typeof snapPoint === 'string' ? `'${snapPoint}'` : String(snapPoint);
}
function assertSize(name, size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new RangeError(`ember-mobile-drawer: the ${name} size must be a finite number >= 0, got ${describe(size)}.`);
  }
}
function assertFinite(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`ember-mobile-drawer: ${name} must be a finite number, got ${describe(value)}.`);
  }
}
function resolveOne(snapPoint, index, sizes) {
  const prefix = `ember-mobile-drawer: invalid snap point ${describe(snapPoint)} at index ${index}.`;
  if (typeof snapPoint === 'number') {
    if (!Number.isFinite(snapPoint) || snapPoint < 0) {
      throw new RangeError(`${prefix} Pixel snap points must be finite numbers >= 0.`);
    }
    return snapPoint;
  }
  if (snapPoint === 'content') {
    if (sizes.content === undefined) {
      throw new Error(`${prefix} 'content' snap points need the measured content size, but none was given.`);
    }
    assertSize('content', sizes.content);
    return sizes.content;
  }
  if (typeof snapPoint === 'string') {
    const trimmed = snapPoint.trim();
    const number = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : '';
    // Number('') is 0, so an empty number part is rejected explicitly.
    const percentage = number === '' ? NaN : Number(number);
    if (!(percentage >= 0 && percentage <= 100)) {
      throw new RangeError(`${prefix} Percentage snap points must be between '0%' and '100%', like '50%'.`);
    }
    return percentage / 100 * sizes.container;
  }
  throw new Error(`${prefix} Expected a number (px), a percentage like '50%' or 'content'.`);
}

/**
 * Resolves snap points to px offsets, sorted ascending and de-duplicated.
 *
 * Offsets are clamped to `[0, sizes.container]`: the drawer can't open further
 * than its container, so a px value or `'content'` larger than the container
 * resolves to the container size (and is then de-duplicated with any other
 * snap point at that offset, e.g. `'100%'`).
 *
 * Offsets within half a pixel of each other are merged into one snap point
 * that keeps the indices of all merged inputs. It keeps the container size
 * when one of the merged offsets is exactly the container size, so "fully
 * open" stays exact. Otherwise it keeps the lowest merged offset.
 *
 * @throws RangeError when a size or a px or percentage snap point is
 *   non-finite or out of range.
 * @throws Error when `sizes` is missing, the snap point array is empty, a
 *   snap point is malformed (an unknown string or type), or `'content'` is used
 *   without a content size.
 *
 * @example
 * ```ts
 * resolveSnapPoints([0, '50%', 'content', '100%'], { container: 800, content: 300 });
 * // [
 * //   { offset: 0, indices: [0] },
 * //   { offset: 300, indices: [2] },
 * //   { offset: 400, indices: [1] },
 * //   { offset: 800, indices: [3] },
 * // ]
 * ```
 */
function resolveSnapPoints(snapPoints, sizes) {
  if (!Array.isArray(snapPoints) || snapPoints.length === 0) {
    throw new Error(`ember-mobile-drawer: snap points must be a non-empty array, got ${describe(snapPoints)}.`);
  }
  if (typeof sizes !== 'object' || sizes === null) {
    throw new Error(`ember-mobile-drawer: resolving snap points needs a sizes object like { container: 800 }, got ${describe(sizes)}.`);
  }
  assertSize('container', sizes.container);
  const sorted = snapPoints.map((snapPoint, index) => ({
    offset: Math.min(resolveOne(snapPoint, index, sizes), sizes.container),
    index
  })).sort((a, b) => a.offset - b.offset || a.index - b.index);
  const resolved = [];
  for (const {
    offset,
    index
  } of sorted) {
    const previous = resolved[resolved.length - 1];
    if (previous && offset - previous.offset < DEDUPE_TOLERANCE) {
      previous.indices.push(index);
      previous.indices.sort((a, b) => a - b);
      if (offset === sizes.container) {
        previous.offset = offset;
      }
    } else {
      resolved.push({
        offset,
        indices: [index]
      });
    }
  }
  return resolved;
}

/**
 * Finds the resolved snap point that the original snap point at `index`
 * resolved to. Use it to keep the drawer at "the same" snap point when the
 * snap points are re-resolved, e.g. after the container is resized.
 *
 * @returns The matching snap point, or `undefined` when `index` is not in
 *   `resolved` (e.g. the snap point array got shorter).
 */
function findSnapPoint(resolved, index) {
  return resolved.find(snapPoint => snapPoint.indices.includes(index));
}

/**
 * Default deceleration rate per millisecond, matching iOS
 * `UIScrollView.DecelerationRate.fast`. iOS `.normal` (`0.998`) projects
 * five times as far, which skips snap points too eagerly on small sheets.
 * Provisional: to be tuned on a real device.
 */
const DEFAULT_DECELERATION_RATE = 0.99;

/**
 * Projects where a release would come to rest if it kept moving and slowed
 * down by exponential decay: each millisecond the velocity is multiplied by
 * `decelerationRate`. Summed over time that adds
 * `velocity / 1000 * rate / (1 - rate)` px, which for the default rate is
 * roughly a tenth of the velocity in px/s (a 1000 px/s flick travels ~99px;
 * with `0.998` it would travel ~499px).
 *
 * @param offset Current offset in px.
 * @param velocity Release velocity in px/s along the same axis (positive moves
 *   towards larger offsets).
 * @param decelerationRate Velocity multiplier per ms, strictly between `0` and
 *   `1`. Lower values stop sooner. `0.99` matches iOS `.fast`.
 * @throws RangeError when `offset` or `velocity` is not finite, or
 *   `decelerationRate` is not strictly between `0` and `1`. Callers that
 *   derive velocity from a zero time delta must guard against that themselves.
 */
function projectOffset(offset, velocity, decelerationRate = DEFAULT_DECELERATION_RATE) {
  assertFinite('offset', offset);
  assertFinite('velocity', velocity);
  if (!(decelerationRate > 0 && decelerationRate < 1)) {
    throw new RangeError(`ember-mobile-drawer: decelerationRate must be a number strictly between 0 and 1, got ${describe(decelerationRate)}.`);
  }
  return offset + velocity / 1000 * decelerationRate / (1 - decelerationRate);
}

/** Options for {@link selectSnapPoint}. */

/**
 * Picks the snap point to settle on after a release: the one nearest to the
 * projected end position (see {@link projectOffset}). A slow release settles
 * on the nearest snap point, a fast flick can skip one or more.
 *
 * When the projected position is exactly halfway between two snap points the
 * one in the direction of the velocity wins (or the lower one when at rest).
 *
 * With {@link SelectSnapPointOptions.flingVelocity}, a release at least that
 * fast never settles against its direction: if the nearest snap point is not
 * beyond `offset` in the direction of the velocity, the first snap point that
 * is beyond it is picked instead.
 *
 * @param resolved Snap points from {@link resolveSnapPoints}; must not be empty.
 * @param offset Offset in px at release.
 * @param velocity Release velocity in px/s.
 * @throws RangeError for non-finite or out of range input, see
 *   {@link projectOffset}.
 * @throws Error when `resolved` is empty.
 */
function selectSnapPoint(resolved, offset, velocity, options = {}) {
  const first = resolved[0];
  if (!first) {
    throw new Error('ember-mobile-drawer: cannot select from zero snap points.');
  }
  const {
    flingVelocity
  } = options;
  if (flingVelocity !== undefined && !(Number.isFinite(flingVelocity) && flingVelocity >= 0)) {
    throw new RangeError(`ember-mobile-drawer: flingVelocity must be a finite number >= 0, got ${describe(flingVelocity)}.`);
  }
  const projected = projectOffset(offset, velocity, options.decelerationRate);
  let best = first;
  let bestDistance = Math.abs(first.offset - projected);
  for (const snapPoint of resolved.slice(1)) {
    const distance = Math.abs(snapPoint.offset - projected);
    // Ascending order: on a tie, moving to the higher one only when moving up.
    if (distance < bestDistance || distance === bestDistance && velocity > 0) {
      best = snapPoint;
      bestDistance = distance;
    }
  }
  if (flingVelocity !== undefined && velocity !== 0 && Math.abs(velocity) >= flingVelocity) {
    const forward = velocity > 0 ? resolved.find(snapPoint => snapPoint.offset > offset) : resolved.findLast(snapPoint => snapPoint.offset < offset);
    const backwards = velocity > 0 ? best.offset <= offset : best.offset >= offset;
    if (forward && backwards) best = forward;
  }
  return best;
}

/**
 * Default rubber-band factor, as used by iOS scroll views. Lower is stiffer,
 * `0` disables overscroll entirely.
 */
const DEFAULT_RUBBER_BAND_FACTOR = 0.55;

/** Options for {@link rubberBand}. */

/**
 * Applies rubber-band resistance to an offset dragged past `[min, max]`
 * (usually the first and last resolved snap point). Inside the range the
 * offset is returned unchanged; outside it the overshoot `x` becomes
 *
 * ```
 * (1 - 1 / (x * factor / dimension + 1)) * dimension
 * ```
 *
 * At first the drawer moves `factor` px for every px the finger moves
 * (`factor`:1). After that it gives diminishing returns the further it is
 * pulled, and the overshoot never exceeds `dimension`.
 *
 * @param offset Raw offset in px (e.g. where the finger is).
 * @param min Lowest allowed offset, e.g. the first snap point.
 * @param max Highest allowed offset, e.g. the last snap point; `>= min`.
 * @throws RangeError when an input is not finite, `min > max`, or `dimension`
 *   or `factor` is negative.
 */
function rubberBand(offset, min, max, {
  dimension,
  factor = DEFAULT_RUBBER_BAND_FACTOR
}) {
  assertFinite('offset', offset);
  assertFinite('min', min);
  assertFinite('max', max);
  if (min > max) {
    throw new RangeError(`ember-mobile-drawer: rubberBand min must be <= max, got min ${min} and max ${max}.`);
  }
  for (const [name, value] of [['dimension', dimension], ['factor', factor]]) {
    if (!(Number.isFinite(value) && value >= 0)) {
      throw new RangeError(`ember-mobile-drawer: rubberBand ${name} must be a finite number >= 0, got ${describe(value)}.`);
    }
  }
  const resist = overshoot => factor <= 0 || dimension <= 0 ? 0 : (1 - 1 / (overshoot * factor / dimension + 1)) * dimension;
  if (offset < min) {
    return min - resist(min - offset);
  }
  if (offset > max) {
    return max + resist(offset - max);
  }
  return offset;
}

/**
 * The inverse of {@link rubberBand}: the raw offset that `rubberBand` turns
 * into `offset`, so a drag that catches a rubber-banded drawer can continue
 * from where it is shown. `rubberBand(unRubberBand(x, ...), ...)` is `x`
 * (within floating point error) for every `x` less than
 * `MAX_BAND_FRACTION * dimension` outside the range.
 *
 * `rubberBand` only approaches `dimension`, and near it the inverse grows
 * without bound. So an overshoot is first clamped to
 * `MAX_BAND_FRACTION * dimension`, which keeps the result finite and
 * moderate: at most `999 * dimension / factor` outside the range. With a
 * `factor` or `dimension` of `0` nothing can be outside the range, so the
 * offset is clamped to it.
 *
 * @throws RangeError for the same input as {@link rubberBand}.
 */
function unRubberBand(offset, min, max, options) {
  // Validates the input the same way.
  rubberBand(offset, min, max, options);
  const {
    dimension,
    factor = DEFAULT_RUBBER_BAND_FACTOR
  } = options;
  const unresist = overshoot => {
    if (factor <= 0 || dimension <= 0) return 0;
    const fraction = Math.min(overshoot / dimension, MAX_BAND_FRACTION);
    return dimension / factor * (1 / (1 - fraction) - 1);
  };
  if (offset < min) {
    return min - unresist(min - offset);
  }
  if (offset > max) {
    return max + unresist(offset - max);
  }
  return offset;
}

/**
 * The largest fraction of the rubber-band `dimension` that
 * {@link unRubberBand} inverts; larger overshoots are clamped to it.
 */
const MAX_BAND_FRACTION = 0.999;

/** The rubber-bands below the first and above the last snap point. */

/**
 * Where a drag puts the drawer when it started at `start` (the offset shown
 * when the finger caught it) and the finger has since moved `delta` px
 * (positive opens).
 *
 * From inside `[min, max]` this is `rubberBand(start + delta)`. A drag that
 * catches the drawer outside the range (e.g. springing back from a
 * rubber-band, or a spring overshoot) continues from where it is shown,
 * without a jump:
 *
 * - towards the range, the drawer follows the finger 1:1 until it is back in
 *   the range, and from there as from inside;
 * - further away from the range, only the band that is left resists: the
 *   increase of the band from where it is. An overshoot at or past the
 *   band's limit (possible after a spring overshoot when the tray is longer
 *   than the largest snap point) then barely moves, but never jumps.
 *
 * @throws RangeError for non-finite input, or band options
 *   {@link rubberBand} rejects.
 */
function dragOffset(start, delta, min, max, bands) {
  assertFinite('start', start);
  assertFinite('delta', delta);
  const {
    below,
    above
  } = bands;
  const raw = start + delta;
  if (start > max && delta > 0) {
    // Further out: the band's increase from its (un-banded) position.
    const from = unRubberBand(start, min, max, above);
    return start + rubberBand(from + delta, min, max, above) - rubberBand(from, min, max, above);
  }
  if (start < min && delta < 0) {
    const from = unRubberBand(start, min, max, below);
    return start + rubberBand(from + delta, min, max, below) - rubberBand(from, min, max, below);
  }
  // Towards the range: 1:1 while still outside it.
  if (start > max && raw > max || start < min && raw < min) {
    return raw;
  }
  return rubberBand(raw, min, max, raw > max ? above : below);
}

/** Callbacks for {@link lifecycle}. */

function consume(args) {
  // Read every positional argument, so a change to any of them (and only to
  // them) triggers `updateModifier`.
  const [hooks, ...deps] = args.positional;
  return hooks;
}

/**
 * A minimal element modifier with install/update/destroy hooks, so the addon
 * doesn't need a runtime dependency on `ember-modifier`:
 *
 * ```hbs
 * <div {{lifecycle this.hooks @foo @bar}}></div>
 * ```
 *
 * `update` runs when `@foo` or `@bar` (or anything tracked that `install` or
 * `update` read) changes. The hooks run during rendering, so they must not
 * write tracked state synchronously.
 *
 * @internal
 */
const lifecycle = setModifierManager(() => ({
  capabilities: capabilities('3.22'),
  createModifier(_definition, args) {
    return {
      hooks: args.positional[0]
    };
  },
  installModifier(bucket, element, args) {
    bucket.hooks = consume(args);
    bucket.hooks.install(element);
  },
  updateModifier(bucket, args) {
    bucket.hooks = consume(args);
    bucket.hooks.update();
  },
  destroyModifier(bucket) {
    bucket.hooks.destroy();
  }
}), {});

/**
 * A modifier that does nothing, for yielding a modifier that only has an
 * effect in some configurations.
 *
 * @internal
 */
const noop = setModifierManager(() => ({
  capabilities: capabilities('3.22'),
  createModifier() {},
  installModifier() {},
  updateModifier() {},
  destroyModifier() {}
}), {});

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
const CATCH_UP_DURATION = 100;

/**
 * The fastest the tray moves relative to the finger while it catches up, in
 * px/ms (4px in a 60 Hz frame). A larger distance takes longer than
 * {@link CATCH_UP_DURATION}, so no frame moves the tray by much more than
 * the finger moved.
 */
const CATCH_UP_SPEED = 0.24;

/**
 * How far (screen px) the finger may move back towards the tray during the
 * catch-up without stopping it: the jitter of a finger that holds still or
 * moves slowly. A larger move back holds the tray until the finger reaches
 * it, so it never moves against the finger or passes it.
 */
const TURN_SLOP = 2;

/**
 * How long (ms) catching up `distance` px takes: {@link CATCH_UP_DURATION},
 * or longer for a distance that would otherwise be faster than
 * {@link CATCH_UP_SPEED}. The easing (`smoothstep`) is at its fastest
 * halfway, at 1.5 times the average speed.
 */
function catchUpDuration(distance) {
  const duration = 1.5 * Math.abs(distance) / CATCH_UP_SPEED;
  return Number.isFinite(duration) ? Math.max(CATCH_UP_DURATION, duration) : CATCH_UP_DURATION;
}

/**
 * How far (px, with the sign of `distance`) the tray is still behind the
 * finger `elapsed` ms after the pan was recognised, when the finger had
 * moved `distance` px by then. Starts at `distance` and eases to exactly `0`
 * after {@link catchUpDuration}: slowly at first, so the tray doesn't jump
 * when the drag starts, and slowly at the end, so it settles under the
 * finger without a jolt. Always finite.
 */
function catchUpLag(distance, elapsed) {
  if (!Number.isFinite(distance) || distance === 0) return 0;
  if (!(elapsed > 0)) return Number.isNaN(elapsed) ? 0 : distance;
  const t = elapsed / catchUpDuration(distance);
  if (t >= 1) return 0;
  const eased = t * t * (3 - 2 * t);
  return distance * (1 - eased);
}

/**
 * Scroll momentum after a drag scrolled the content from script (see
 * `MobileDrawer`), like the deceleration of a native iOS scroll view.
 *
 * @module
 */

/**
 * How much of its velocity the scroll keeps per ms: UIScrollView's
 * `decelerationRate` `normal`.
 */
const DECELERATION_RATE = 0.998;

/**
 * Below this speed (px/ms) the momentum stops. A release slower than this
 * has no momentum.
 */
const MIN_MOMENTUM_VELOCITY = 0.02;
const LN_RATE = Math.log(DECELERATION_RATE);

/**
 * Where a momentum that starts at `velocity` (px/ms) is `elapsed` ms later,
 * relative to where it started, and how fast it goes then: the velocity
 * decays by {@link DECELERATION_RATE} per ms.
 */
function momentumAt(velocity, elapsed) {
  if (!(elapsed > 0)) return {
    distance: 0,
    velocity
  };
  const decay = Math.pow(DECELERATION_RATE, elapsed);
  return {
    distance: velocity * (decay - 1) / LN_RATE,
    velocity: velocity * decay
  };
}
/**
 * A running momentum: one `write` per animation frame until it is slower
 * than {@link MIN_MOMENTUM_VELOCITY}, reaches `min` or `max`, or is stopped.
 */
class Momentum {
  #options;
  #start;
  #frame;
  #running = true;
  constructor(options) {
    this.#options = options;
    this.#start = options.clock.now();
    this.#frame = options.clock.requestFrame(this.#step);
  }
  get isRunning() {
    return this.#running;
  }

  /** Stops it where it is. */
  stop() {
    if (!this.#running) return;
    this.#running = false;
    if (this.#frame !== undefined) {
      this.#options.clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#options.onEnd?.();
  }

  /**
   * A frame, at the time on the clock (as the drawer's catch-up frames):
   * input of the same frame is handled after the frame's time stamp.
   */
  #step = () => {
    this.#frame = undefined;
    if (!this.#running) return;
    const {
      clock,
      from,
      min,
      max,
      write
    } = this.#options;
    const now = momentumAt(this.#options.velocity, clock.now() - this.#start);
    const position = from + now.distance;
    const clamped = Math.min(Math.max(position, min), max);
    write(clamped);
    if (clamped !== position || Math.abs(now.velocity) < MIN_MOMENTUM_VELOCITY) {
      this.stop();
      return;
    }
    this.#frame = clock.requestFrame(this.#step);
  };
}

/**
 * Makes everything on the page except some elements `inert`, for modal
 * drawers: the drawer's root and the portals of the drawers nested in it
 * (see `nesting.ts`).
 *
 * "Everything except the elements" are the siblings of each element and of
 * each of its ancestors up to `<body>`, except the elements and their
 * ancestors: the smallest set of subtrees that covers the page without
 * covering one of the elements. Each sibling gets the `inert` attribute,
 * which removes it from the tab order, from pointer and find-in-page
 * interaction and from the accessibility tree.
 *
 * Counted per element, so drawers can open and close in any order: an
 * element only loses `inert` once every drawer that made it inert let go.
 * Only attributes the drawers added are removed:
 * - elements that were already inert are left alone;
 * - once the app sets (or removes) `inert` on an element a drawer made
 *   inert, the attribute is the app's, and the drawers stop managing it.
 *   A `MutationObserver` on those elements notices that.
 * Elements added to the page later (e.g. a toast appended to `<body>`) are
 * not made inert.
 *
 * @module
 * @internal
 */

/** Elements that don't render, so there is no point in making them inert. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);

/** How many drawers made each element inert, for the elements they manage. */
const counts = new Map();
let observer$1;

/**
 * Hands every element whose `inert` attribute someone else changed over to
 * that someone: the drawers stop managing it.
 */
function handOver(records) {
  for (const record of records) counts.delete(record.target);
}

/**
 * Takes the pending records of changes by others, so they are handled before
 * the drawers change attributes themselves.
 */
function flush() {
  if (observer$1) handOver(observer$1.takeRecords());
}

/** Runs `change` without its own mutations counting as someone else's. */
function own(change) {
  flush();
  change();
  observer$1?.takeRecords();
}

/**
 * Makes every element on the page outside `elements` inert, until the
 * returned function is called. Calling it more than once does nothing.
 */
function inertOutside(...elements) {
  observer$1 ??= typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(handOver);
  // The elements and their ancestors: never inert.
  const kept = new Set();
  for (const element of elements) {
    for (let node = element; node; node = node.parentElement) {
      kept.add(node);
    }
  }
  const touched = [];
  own(() => {
    for (const element of elements) {
      // Inside another one of the elements: covered by that one.
      if (elements.some(other => other !== element && other.contains(element))) {
        continue;
      }
      for (let node = element; node.parentElement && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (kept.has(sibling) || touched.includes(sibling) || SKIP.has(sibling.tagName)) {
            continue;
          }
          const count = counts.get(sibling);
          if (count === undefined) {
            // Inert already, by the app: not ours to undo.
            if (sibling.hasAttribute('inert')) continue;
            sibling.setAttribute('inert', '');
            observer$1?.observe(sibling, {
              attributes: true,
              attributeFilter: ['inert']
            });
          }
          counts.set(sibling, (count ?? 0) + 1);
          touched.push(sibling);
        }
      }
    }
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    own(() => {
      for (const sibling of touched) {
        const count = counts.get(sibling);
        // Handed over to the app, or never ours.
        if (count === undefined) continue;
        if (count > 1) {
          counts.set(sibling, count - 1);
        } else {
          counts.delete(sibling);
          sibling.removeAttribute('inert');
        }
      }
    });
    if (counts.size === 0) {
      // Stop observing the elements that are no longer managed.
      observer$1?.disconnect();
    }
  };
}

/**
 * A reference-counted body scroll lock for modal drawers.
 *
 * Adapted from ember-mobile-menu's `utils/body-scroll-lock.js` (MIT, Nick
 * Schot), which in turn adapts https://github.com/willmcpo/body-scroll-lock
 * (MIT License, Copyright (c) 2018 Will Po). Unlike those, every lock is
 * counted: the page only scrolls again once the last lock is released, so
 * drawers can open and close in any order.
 *
 * - Everywhere: `overflow: hidden` on the root element (`<html>`), whose
 *   value applies to the viewport, so the page stops scrolling also when the
 *   app sets `overflow` on `<html>` itself. While a classic scrollbar
 *   disappears, the body is padded by its width so the page doesn't shift.
 * - iOS Safari ignores `overflow: hidden` for touch scrolling, so there the
 *   body is also fixed in place at its current scroll position (restored on
 *   unlock), and `touchmove`s outside the allowed elements (the trays of the
 *   locked drawers and the portals of the drawers nested in them) are
 *   cancelled, so the viewport doesn't rubber-band behind the drawer.
 * - For a transparent status bar (`transparentStatusBar`, #113), iOS gets
 *   a lock that doesn't fix `<body>` (a fixed `<body>` makes Safari 26+
 *   paint the status bar in one solid colour). `overflow: hidden` and
 *   `overscroll-behavior: none` go on `<html>` and `<body>`, and touchmoves
 *   are cancelled outside the allowed elements and also inside them when no
 *   element between the touch and the allowed element can scroll further in
 *   the direction of the swipe, so the swipe can't chain to (or rubber-band)
 *   the page. The page keeps its scroll position: a scroll of the page
 *   while locked is undone at once, and again on unlock. Not while a text
 *   field in a drawer has focus (the on-screen keyboard): iOS scrolls the
 *   visual viewport to show the field, which moves the fixed drawer with
 *   it, as with the fixed `<body>`. The page goes back when the field loses
 *   focus or the keyboard closes. But a drawer that contains a text field
 *   gets the fixed `<body>` (see `hasTypingField`, #116), also when it
 *   opens while the overflow lock is on: the lock then changes to the fixed
 *   `<body>` until the last lock is released (see `onLockChange`).
 *
 * @module
 * @internal
 */

/**
 * Checks for the elements inside which touchmoves aren't cancelled (iOS
 * only), one per lock.
 */
const allowed = [];
let saved;
function detectIOS() {
  if (typeof navigator === 'undefined') return false;
  const {
    platform,
    maxTouchPoints
  } = navigator;
  // iPadOS reports itself as a Mac, but has touch points.
  return /iP(ad|hone|od)/.test(platform) || platform === 'MacIntel' && maxTouchPoints > 1;
}
const onTouchMove = event => {
  // Leave multi-touch gestures (pinch-zoom) alone.
  if (event.touches.length > 1) return;
  const target = event.target;
  if (target instanceof Node && allowed.some(allows => allows(target))) {
    return;
  }
  if (event.cancelable) event.preventDefault();
};

/** The last touch position, for the direction of a swipe (overflow lock). */
let lastTouch;
/** The page's scroll position while the overflow lock is on. */
let pinned;

/**
 * Whether the on-screen keyboard is (or is about to be) open: the visual
 * viewport is shorter than the layout viewport (pinch zoom aside), or a
 * field the user types in has focus in one of the locked drawers.
 */
function keyboardOpen() {
  const viewport = window.visualViewport;
  if (viewport && viewport.height * viewport.scale < window.innerHeight - 1) {
    return true;
  }
  return typingFieldFocused();
}

/** Whether a field the user types in has focus in a locked drawer. */
function typingFieldFocused() {
  const active = document.activeElement;
  return active instanceof HTMLElement && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active.isContentEditable) && allowed.some(allows => allows(active));
}

/** Scrolls the page back to where it was when it was locked. */
function restorePinned() {
  if (!pinned) return;
  const {
    x,
    y
  } = pinned;
  if (window.scrollX !== x || window.scrollY !== y) {
    window.scrollTo({
      left: x,
      top: y,
      behavior: 'instant'
    });
  }
}

/**
 * iOS still scrolls the page with `overflow: hidden`: to show a focused text
 * field above the on-screen keyboard, it moves the visual viewport (and with
 * it `scrollY`) so that the field is in the middle of the part that the
 * keyboard doesn't cover. The fixed drawer moves with the visual viewport, so
 * that is what shows the field (the #71 lock gets the same scroll, see
 * #116). Thus while the keyboard is open, the scroll stays: scrolling it back
 * hid the field and made the sheet jump. Any other scroll of the page is
 * undone at once. When the keyboard closes, the page goes back to its
 * position (see `onViewportResize`).
 */
const onScroll = () => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/** The keyboard closed: put the page back where it was. */
const onViewportResize = () => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/**
 * Focus left a field in a drawer, and not for another one: put the page back
 * at once, as iOS does with the #71 lock, and not only once the keyboard
 * has closed.
 */
const onFocusOut = () => {
  // `activeElement` is the new focus only after the focusout.
  setTimeout(() => {
    if (pinned && !typingFieldFocused()) restorePinned();
  }, 0);
};
const onTouchStart = event => {
  const touch = event.touches[0];
  lastTouch = touch ? {
    x: touch.clientX,
    y: touch.clientY
  } : undefined;
};
function canScroll$1(element, dx, dy) {
  const style = getComputedStyle(element);
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (!/auto|scroll/.test(style.overflowY)) return false;
    const max = element.scrollHeight - element.clientHeight;
    // Finger down (dy > 0) scrolls towards the top.
    return dy > 0 ? element.scrollTop > 0 : element.scrollTop < max - 1;
  }
  if (!/auto|scroll/.test(style.overflowX)) return false;
  const max = element.scrollWidth - element.clientWidth;
  const left = Math.abs(element.scrollLeft); // negative in RTL
  return dx > 0 ? left > 0 : left < max - 1;
}

/**
 * The overflow lock's touchmove filter: allowed only when an element from the
 * target up through the allowed elements (see `allowed`) can still scroll in
 * the swipe's direction.
 */
const onTouchMoveOverflow = event => {
  if (event.touches.length > 1) return;
  const touch = event.touches[0];
  const target = event.target;
  const allows = target instanceof Node ? allowed.find(check => check(target)) : undefined;
  let allow = false;
  if (allows && touch && lastTouch) {
    const dx = touch.clientX - lastTouch.x;
    const dy = touch.clientY - lastTouch.y;
    if (dx === 0 && dy === 0) return;
    let element = target instanceof Element ? target : target.parentElement;
    while (element && allows(element)) {
      if (canScroll$1(element, dx, dy)) {
        allow = true;
        break;
      }
      element = element.parentElement;
    }
  }
  if (touch) lastTouch = {
    x: touch.clientX,
    y: touch.clientY
  };
  if (!allow && event.cancelable) event.preventDefault();
};

/** `<input>` types that open no on-screen keyboard. */
const NON_TEXT_INPUTS$1 = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * Whether `element` contains a field the user types in (it opens the
 * on-screen keyboard).
 *
 * The overflow lock can't give the keyboard behaviour of the
 * fixed `<body>`. iOS shows a focused field by scrolling the visual viewport
 * so that the field is in the middle of the part that the keyboard doesn't
 * cover. With a fixed `<body>` the page can only scroll from 0 down to the
 * keyboard height, so iOS scrolls down (animated with the keyboard) or not
 * at all. With the tall page of the overflow lock, iOS also scrolls up, and
 * on a real iPhone the page and the drawer move apart. Fixing `<body>` only
 * when a field gets focus doesn't work: during the touch (`touchstart`,
 * `touchend`) the change of `scrollY` makes iOS drop the tap (no focus, no
 * caret under the finger); in `focusin` iOS shows the page background for
 * about 6 frames. Cancelling the tap and focusing with `preventScroll`
 * leaves a dark overlay on the field and breaks the caret placement. Thus a
 * drawer with such a field gets the fixed `<body>` from the start; the
 * status bar is then one solid colour (#113).
 */
function hasTypingField(element) {
  for (const field of element.querySelectorAll('input, textarea, [contenteditable]')) {
    if (field instanceof HTMLInputElement) {
      if (!NON_TEXT_INPUTS$1.has(field.type) && !field.disabled && !field.readOnly) {
        return true;
      }
    } else if (field instanceof HTMLTextAreaElement) {
      if (!field.disabled && !field.readOnly) return true;
    } else if (field.isContentEditable) {
      return true;
    }
  }
  return false;
}
function lock(options) {
  const html = document.documentElement;
  const body = document.body;
  const ios = (drawerEnvironment.isIOS ?? detectIOS)();
  const result = {
    htmlOverflow: html.style.overflow,
    bodyPaddingRight: body.style.paddingRight
  };

  // Measured before hiding the overflow, which removes a classic scrollbar.
  const scrollbar = window.innerWidth - html.clientWidth;
  if (scrollbar > 0) {
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbar}px`;
  }
  if (ios && options.transparentStatusBar && !options.fields?.some(hasTypingField)) {
    const {
      scrollX: x,
      scrollY: y
    } = window;
    result.overflow = {
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
      x,
      y
    };
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    pinned = {
      x,
      y
    };
    window.addEventListener('scroll', onScroll, {
      passive: true
    });
    window.visualViewport?.addEventListener('resize', onViewportResize);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('touchstart', onTouchStart, {
      passive: true
    });
    document.addEventListener('touchmove', onTouchMoveOverflow, {
      passive: false
    });
  } else if (ios) {
    const {
      scrollX: x,
      scrollY: y
    } = window;
    const {
      position,
      top,
      left,
      right
    } = body.style;
    result.position = {
      position,
      top,
      left,
      right,
      x,
      y
    };
    body.style.position = 'fixed';
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.right = `${x}px`;
    document.addEventListener('touchmove', onTouchMove, {
      passive: false
    });
  }
  html.style.overflow = 'hidden';
  return result;
}
function unlock(state) {
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = state.htmlOverflow;
  body.style.paddingRight = state.bodyPaddingRight;
  const {
    position,
    overflow
  } = state;
  if (overflow) {
    window.removeEventListener('scroll', onScroll);
    window.visualViewport?.removeEventListener('resize', onViewportResize);
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMoveOverflow);
    lastTouch = undefined;
    pinned = undefined;
    body.style.overflow = overflow.bodyOverflow;
    html.style.overscrollBehavior = overflow.htmlOverscroll;
    body.style.overscrollBehavior = overflow.bodyOverscroll;
    if (window.scrollX !== overflow.x || window.scrollY !== overflow.y) {
      window.scrollTo({
        left: overflow.x,
        top: overflow.y,
        behavior: 'instant'
      });
    }
  }
  if (position) {
    document.removeEventListener('touchmove', onTouchMove);
    body.style.position = position.position;
    body.style.top = position.top;
    body.style.left = position.left;
    body.style.right = position.right;
    // `instant`, so a `scroll-behavior: smooth` page doesn't visibly scroll
    // back to where it was.
    window.scrollTo({
      left: position.x,
      top: position.y,
      behavior: 'instant'
    });
  }
}
const lockChangeListeners = new Set();

/**
 * Calls `listener` when the lock that is on changes from the overflow lock
 * to the fixed `<body>` (a drawer with a text field opened while the
 * overflow lock was on). Returns a function that removes the listener.
 */
function onLockChange(listener) {
  lockChangeListeners.add(listener);
  return () => lockChangeListeners.delete(listener);
}

/**
 * Locks body scrolling until the returned function is called. Touch scrolling
 * on the nodes `allow` returns `true` for keeps working on iOS (a drawer
 * allows its tray and the portals of the drawers nested in it). Calling the
 * returned function more than once does nothing.
 */
function lockBodyScroll(allow, options = {}) {
  if (allowed.length === 0) {
    saved = lock(options);
  } else if (saved?.overflow && options.fields?.some(hasTypingField)) {
    // The on-screen keyboard needs the fixed `<body>` (#116). The page goes
    // back to where it was locked, and is fixed there.
    unlock(saved);
    saved = lock({});
    for (const listener of [...lockChangeListeners]) listener();
  }
  allowed.push(allow);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    allowed.splice(allowed.indexOf(allow), 1);
    if (allowed.length === 0 && saved) {
      const state = saved;
      saved = undefined;
      unlock(state);
    }
  };
}

/**
 * Whether the lock that is on is the iOS overflow lock for a transparent
 * status bar (#113): `<body>` isn't fixed, and the drawers move
 * their fixed elements away from the top edge (`data-status-bar`).
 */
function transparentStatusBarLock() {
  return saved?.overflow !== undefined;
}

/**
 * The dim layer for a transparent iOS status bar (`@transparentStatusBar`,
 * #113).
 *
 * iOS Safari 26+ paints the status bar in one solid colour when a fixed or
 * sticky element is within 4px of the top clip line, or when `<body>` is
 * fixed. With `@transparentStatusBar`, the root of a modal drawer starts 5px
 * below the top (see the iOS block of styles.css), the backdrop only takes
 * the pointer events (transparent), and `<body>` isn't fixed (the overflow
 * lock, see `scroll-lock.ts`). The visible dim is this element instead: page
 * content (`position: absolute`, as large as the document), outside every
 * fixed element. Safari then shows the dimmed page, with its gradual blur,
 * in the status bar, with no edge.
 *
 * The element is inserted just before the drawer's root, so it is in the
 * same stacking context with the same `z-index`, and paints below the root
 * (and above an outer drawer, for a nested one). It is moved to the
 * document's origin, whatever its containing block, and sized to the
 * document with a ResizeObserver.
 *
 * Limits: an ancestor of the root that clips (`overflow`) or that is a
 * stacking context below page content cuts or hides the dim. A scaled
 * ancestor scales it too, so it doesn't cover the whole document then.
 *
 * @module
 * @internal
 */

class PageDim {
  element;
  #observer;
  constructor(root) {
    const element = document.createElement('div');
    element.className = 'mobile-drawer__dim';
    element.setAttribute('aria-hidden', 'true');
    element.style.zIndex = getComputedStyle(root).zIndex;
    root.before(element);
    this.element = element;
    this.#place();
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.#place());
      this.#observer.observe(document.documentElement);
      this.#observer.observe(document.body);
    }
    window.addEventListener('resize', this.#onResize);
  }
  #onResize = () => this.#place();

  /** Puts the element at the document's origin, at the document's size. */
  #place() {
    const {
      element
    } = this;
    const html = document.documentElement;
    const {
      style
    } = element;
    style.top = '0px';
    style.left = '0px';
    // Without its own size first, so the document can also get smaller.
    style.width = '0px';
    style.height = '0px';
    style.width = `${Math.max(html.scrollWidth, window.innerWidth)}px`;
    style.height = `${Math.max(html.scrollHeight, window.innerHeight)}px`;
    // The containing block can be any positioned ancestor of the root, also
    // a scaled one (the scale of the width applies to the offsets too).
    const rect = element.getBoundingClientRect();
    const scale = rect.width / element.offsetWidth || 1;
    const top = (-window.scrollY - rect.top) / scale;
    const left = (-window.scrollX - rect.left) / scale;
    if (Math.abs(top) >= 0.5) style.top = `${top}px`;
    if (Math.abs(left) >= 0.5) style.left = `${left}px`;
  }
  destroy() {
    this.#observer?.disconnect();
    window.removeEventListener('resize', this.#onResize);
    this.element.remove();
  }
}

/**
 * Small focus helpers for the modal drawer's focus trap, instead of a
 * runtime dependency such as `focus-trap`/`tabbable`. They cover the common
 * cases: native interactive elements and `tabindex`; not shadow DOM, and
 * every radio button in a group counts as its own stop.
 *
 * @module
 * @internal
 */

const CANDIDATES = ['a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'iframe', 'summary', 'audio[controls]', 'video[controls]', '[contenteditable]:not([contenteditable="false"])', '[tabindex]'].join(',');
function isVisible(element) {
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({
      visibilityProperty: true
    });
  }
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

/** Whether `element` can be focused by the user and is in the tab order. */
function isTabbable(element) {
  return element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') &&
  // Content of a closed <details>, except its <summary>, isn't rendered;
  // `checkVisibility` covers that, the fallback doesn't.
  isVisible(element);
}

/** The elements inside `container` that Tab moves through, in order. */
function tabbables(container) {
  return [...container.querySelectorAll(CANDIDATES)].filter(isTabbable);
}

/**
 * The element to focus when a modal drawer opens: the first element with
 * `autofocus`, else the first tabbable element that isn't a yielded
 * `Grabber` (`data-mobile-drawer-grabber`), else `fallback`. The grabber
 * comes first in a bottom drawer, but it is a control for the drawer, not
 * its content, so focus (and a screen reader) starts at the content.
 */
function initialFocus(container, fallback) {
  const autofocus = [...container.querySelectorAll('[autofocus]')].find(element => !element.closest('[inert]') && isVisible(element));
  return autofocus ?? tabbables(container).find(element => !element.hasAttribute('data-mobile-drawer-grabber')) ?? fallback;
}

/** `element.focus()` without scrolling to it. */
function focusWithoutScrolling(element) {
  element.focus({
    preventScroll: true
  });
}

/**
 * The nesting relation between drawers when a nested drawer is not inside
 * the DOM of the drawer around it.
 *
 * A nested drawer inside the outer drawer's tray is clipped by that tray (a
 * transformed element is the containing block of its `position: fixed`
 * descendants), so the yielded `Nested` component renders its block outside
 * the tray, in a "portal" element elsewhere on the page. Each portal is
 * registered here with the element it belongs to: the outer drawer's tray.
 * For the drawers, the portal is then inside that tray: `logicalParent`
 * goes from a portal to the tray instead of to its DOM parent, and
 * `logicallyContains` follows that. Without portals both are the same as
 * the DOM (`parentElement`, `contains`).
 *
 * Events still follow the DOM: a touch in a portal never reaches the outer
 * drawer's tray.
 *
 * @module
 * @internal
 */

/** Every portal on the page and the element it belongs to. */
const anchors = new Map();

/**
 * Registers `portal` as a part of the element `anchor` returns (the outer
 * drawer's tray). A getter: the portal can be in the DOM before the outer
 * drawer knows its tray. Until then the portal's DOM parent counts.
 */
function addPortal(portal, anchor) {
  anchors.set(portal, anchor);
}
function removePortal(portal) {
  anchors.delete(portal);
}

/**
 * The parent of `node` for the nesting relation: the anchor of a portal,
 * else its DOM parent.
 */
function logicalParent(node) {
  return (node instanceof Element ? anchors.get(node)?.() : undefined) ?? node.parentElement;
}

/**
 * Whether `node` is `ancestor` or inside it, also through portals: like
 * `ancestor.contains(node)`, but a portal counts as inside its anchor.
 */
function logicallyContains(ancestor, node) {
  for (let current = node ?? null; current; current = logicalParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * The portals that are logically inside `element` (also through other
 * portals), but not in its DOM: the parts of the page that belong to it.
 */
function portalsOf(element) {
  return [...anchors.keys()].filter(portal => !element.contains(portal) && logicallyContains(element, portal));
}

/**
 * The yielded `Nested` component of `<MobileDrawer>`: renders its block (a
 * nested drawer) outside the drawer's tray, at the end of `@destination`
 * (default: the parent element of the drawer's root, or of the outermost
 * drawer whose tray the drawer is in, see `#nestedDestination`, so the
 * nested drawer gets the same ancestors, such as a theme class), in a
 * `.mobile-drawer-nested` element. The drawer registers that element as a
 * part of its tray (see `nesting.ts`), so the nesting relation stays the
 * same as for a drawer inside the tray.
 *
 * Without `@destination` the block renders once the drawer is in the DOM
 * (a render later): before that, the drawer's parent element isn't known.
 *
 * @internal
 */
class NestedPortal extends Component {
  #element;
  get destination() {
    return this.args.destination ?? this.args.fallback;
  }
  hooks = {
    install: element => {
      this.#element = element;
      this.args.owner.add(element);
    },
    update: () => {},
    destroy: () => {
      if (this.#element) this.args.owner.remove(this.#element);
      this.#element = undefined;
    }
  };
  static {
    setComponentTemplate(precompileTemplate("{{#if this.destination}}\n  {{#in-element this.destination insertBefore=null}}\n    <div class=\"mobile-drawer-nested\" {{lifecycle this.hooks}}>\n      {{yield}}\n    </div>\n  {{/in-element}}\n{{/if}}", {
      strictMode: true,
      scope: () => ({
        lifecycle
      })
    }), this);
  }
}

let ids = 0;
/** An activation's announcement, see `Grabber#announcements`. */

/**
 * The yielded `Grabber` component of `<MobileDrawer>`: a `<button>` that is
 * a drag handle (the drawer's `handle` modifier) and, on a tap, a click,
 * Enter or Space, moves the drawer to its next open snap point, like the
 * grabber of an iOS sheet. Its accessible description is the snap point the
 * drawer is at, and a status element after the button announces the new
 * snap point after an activation. A click that ends a drag is ignored.
 *
 * @internal
 */
class Grabber extends Component {
  valueId = `mobile-drawer-grabber-${++ids}`;
  /** The last announcement; a new `id` renders a new text node. */
  static {
    g(this.prototype, "announcement", [tracked]);
  }
  #announcement = (i(this, "announcement"), void 0);
  /** `dragCount` at the last pointerdown on the button, until its click. */#downDrags;
  get label() {
    return this.args.label ?? 'Sheet grabber';
  }
  get valueText() {
    return this.stateText(this.args.activeSnapPoint);
  }
  /**
  * The status text: the last activation's announcement while the drawer is
  * at its snap point. It shows once the snap point is active (a controlled
  * parent can pass it in later), and goes for good when the drawer moves
  * in another way (a drag, the backdrop, Escape, the app), so no stale
  * text stays in the status element. The flags are not tracked: they only
  * change here, as `activeSnapPoint` changes.
  */
  get announcements() {
    const announcement = this.announcement;
    if (!announcement || announcement.gone) return [];
    const active = this.args.activeSnapPoint;
    if (active === announcement.index) {
      announcement.reached = true;
      return [announcement];
    }
    // Not there yet: wait while the drawer is still where it was.
    if (!announcement.reached && active === announcement.from) return [];
    announcement.gone = true;
    return [];
  }
  /**
  * The text for the snap point at `index`: `@snapPointLabels[index]`, else
  * by its place among the open snap points: `'Expanded'` for the largest,
  * `'Collapsed'` for the smallest (of two or more), `'Partly expanded'`
  * between them, and `'Closed'` for a snap point that isn't open.
  */
  stateText(index) {
    const custom = this.args.snapPointLabels?.[index];
    if (custom !== undefined) return custom;
    const open = this.args.openSnapPoints;
    const rank = open.findIndex(indices => indices.includes(index));
    if (rank === -1) return 'Closed';
    if (rank === open.length - 1) return 'Expanded';
    if (rank === 0) return 'Collapsed';
    return 'Partly expanded';
  }
  onPointerDown = () => {
    this.#downDrags = this.args.owner.dragCount();
  };
  onClick = event => {
    const down = this.#downDrags;
    this.#downDrags = undefined;
    // A pointer that dragged the drawer since it went down on the button
    // isn't a tap. Keyboard clicks (`detail` 0) always count.
    if (event.detail !== 0 && down !== undefined && down !== this.args.owner.dragCount()) {
      return;
    }
    const from = this.args.activeSnapPoint;
    const index = this.args.owner.cycle();
    if (index === undefined) return;
    this.announcement = {
      id: (this.announcement?.id ?? 0) + 1,
      index,
      from,
      reached: false,
      gone: false,
      text: this.stateText(index)
    };
  };
  static {
    setComponentTemplate(precompileTemplate("{{!-- The pointerdown only records the drag count; the action is on click. --}}\n{{!-- template-lint-disable no-pointer-down-event-binding --}}\n<button type=\"button\" aria-label={{this.label}} aria-describedby={{this.valueId}} data-mobile-drawer-grabber ...attributes {{@handle}} {{on \"pointerdown\" this.onPointerDown}} {{on \"click\" this.onClick}}><span id={{this.valueId}} class=\"mobile-drawer__visually-hidden\">{{this.valueText}}</span></button>\n<span class=\"mobile-drawer__visually-hidden\" role=\"status\" data-mobile-drawer-grabber-status>{{#each this.announcements key=\"id\" as |announcement|}}{{announcement.text}}{{/each}}</span>", {
      strictMode: true,
      scope: () => ({
        on
      })
    }), this);
  }
}

/**
 * Publishes how far the modal drawers are open to the page behind them, for
 * effects such as the iOS theme's page scale.
 *
 * Every element marked with `data-mobile-drawer-page` gets two inline custom
 * properties while a modal drawer outside it is open above its smallest snap
 * point:
 * - `--mobile-drawer-page-progress`: the largest progress of those drawers,
 *   above `0` and at most `1`;
 * - `--mobile-drawer-page-viewport-top`: where the top of the viewport is in
 *   the element, in px (`0` when the element starts at the top of the
 *   viewport, `500px` when the page is scrolled down by 500px), measured
 *   when the element was looked up. Body scrolling is locked while a modal
 *   drawer is open, so it doesn't change after that.
 * It also gets the attribute `data-mobile-drawer-page-active` for that time,
 * for styles that only need to know that the page is behind an open drawer
 * (e.g. the iOS theme's black `<body>`).
 * Otherwise the properties and the attribute are removed, so styles that
 * use the properties (with no fallback) don't apply at all, and e.g. a
 * `transform` on the page doesn't change `position: fixed` content in it
 * while no drawer is open.
 *
 * Only modal drawers from the bottom call this (see the component's
 * `#render`). A drawer inside a marked element never drives that element:
 * the page that contains a drawer can't move without moving the drawer.
 *
 * The marked elements are looked up when the first drawer starts to open
 * and kept until no drawer is open, so the document isn't queried on every
 * frame. While a drawer is open, a `MutationObserver` looks them up again
 * when elements are added or removed, or an element is marked or unmarked
 * (e.g. a route change replaces the page wrapper), and writes the current
 * progress on them at once, also while the drawers are at rest. An element
 * that leaves the list gets its properties and attribute removed.
 *
 * @module
 * @internal
 */

const PAGE_ATTRIBUTE = 'data-mobile-drawer-page';
const PAGE_PROGRESS_PROPERTY = '--mobile-drawer-page-progress';
const PAGE_VIEWPORT_TOP_PROPERTY = '--mobile-drawer-page-viewport-top';
const PAGE_ACTIVE_ATTRIBUTE = 'data-mobile-drawer-page-active';
/** Progress (above 0) by drawer root. */
const sources = new Map();
/** The marked elements; `undefined` when they must be looked up again. */
let pages;
/** The pages written so far, also while `pages` is out of date. */
const written = new Map();
let observer;
function write(page, progress) {
  if (progress === page.progress) return;
  const {
    element
  } = page;
  const {
    style
  } = element;
  if (progress > 0) {
    if (page.progress === 0) {
      const top = -element.getBoundingClientRect().top;
      style.setProperty(PAGE_VIEWPORT_TOP_PROPERTY, `${top}px`);
      element.setAttribute(PAGE_ACTIVE_ATTRIBUTE, '');
      written.set(element, page);
    }
    style.setProperty(PAGE_PROGRESS_PROPERTY, String(progress));
  } else {
    style.removeProperty(PAGE_PROGRESS_PROPERTY);
    style.removeProperty(PAGE_VIEWPORT_TOP_PROPERTY);
    element.removeAttribute(PAGE_ACTIVE_ATTRIBUTE);
    written.delete(element);
  }
  page.progress = progress;
}

/** Looks up the marked elements, and clears those that are no longer. */
function findPages() {
  const found = Array.from(document.querySelectorAll(`[${PAGE_ATTRIBUTE}]`), element => written.get(element) ?? {
    element,
    progress: 0
  });
  for (const page of Array.from(written.values())) {
    if (!found.includes(page)) write(page, 0);
  }
  return found;
}

/** Writes the current progress of the drawers on every page element. */
function writeAll(pages) {
  for (const page of pages) {
    let max = 0;
    for (const [root, value] of sources) {
      if (value > max && !page.element.contains(root)) max = value;
    }
    write(page, max);
  }
}

/**
 * Watches the DOM while a drawer is open: after a change, looks up the page
 * elements again and writes the current progress on them at once, also
 * while the drawers are at rest.
 */
function observe() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    if (sources.size === 0) return;
    pages = findPages();
    writeAll(pages);
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributeFilter: [PAGE_ATTRIBUTE]
  });
}

/**
 * Sets the progress of the drawer with root `source`, from `0` to `1`, and
 * updates the marked page elements. `0` removes the drawer, e.g. when it
 * closes or is destroyed.
 */
function setPageProgress(source, progress) {
  if (progress > 0) {
    sources.set(source, Math.min(progress, 1));
  } else if (!sources.delete(source)) {
    return;
  }
  if (typeof document === 'undefined') return;
  pages ??= findPages();
  writeAll(pages);
  if (sources.size > 0) {
    observe();
  } else {
    pages = undefined;
    observer?.disconnect();
    observer = undefined;
  }
}

/**
 * The sheet's colour below a bottom drawer while an on-screen keyboard is
 * open in iOS Safari.
 *
 * When a field gets focus, iOS Safari scrolls the visual viewport up in the
 * layout viewport to show the field above the keyboard. Fixed elements stay
 * in the layout viewport, and Safari clips them to it (also with negative
 * insets): so the drawer's fixed root ends that far above the bottom of the
 * screen, at about the level of Safari's floating URL bar, and above the
 * top of the keyboard. Safari's URL bar, its keyboard accessory bar and the
 * keyboard are translucent, and in the strip between the root and the
 * bottom of the screen the page shows through them instead of the sheet.
 * No part of the drawer can paint there.
 *
 * Measured in the iOS 27 simulator (iPhone 17, layout viewport 714px): a
 * field in a sheet at 40% gets focus, the visual viewport becomes 384px
 * high and moves 310px down in the layout viewport (`offsetTop`), and the
 * client coordinates (`getBoundingClientRect`) follow the visual viewport.
 * So the fixed root is at `top: -310px` and ends 404px below the top of the
 * visual viewport, 20px below its bottom. The keyboard starts about 80px
 * lower; the screen ends 310px lower. At full height the field is near the
 * top, the visual viewport doesn't move and there is no strip.
 *
 * This fills that strip: an element in the document (not fixed, so Safari
 * doesn't clip it), a child of `<html>`, so that a fixed `<body>` (the iOS
 * scroll lock) doesn't contain it, from the bottom of the root to the
 * bottom of the screen, with the tray's background colour and backdrop
 * filter (or the glass layer's, see `glass`). It doesn't take pointer events and is hidden from assistive
 * technology. While it shows, the root gets `data-keyboard`, so the
 * floating sheet goes to the edges and the bottom of the root and meets
 * it (see styles.css). It changes nothing that is in the drawer: the field
 * and the content don't move.
 *
 * The strip is as high as the layout viewport's top is above the visual
 * viewport's: the screen is as high as the layout viewport, and the root
 * ends at its bottom. That is the root's computed `top` (its offset in the
 * layout viewport, e.g. 5px with `@transparentStatusBar`, #124) minus the
 * top of its client rect; `-top` of the client rect alone would make the
 * fill that offset too short. Other browsers (e.g. Chrome) keep the client
 * coordinates in the layout viewport, so the root's client top is its
 * computed `top` there, also with a keyboard open, and nothing is filled.
 * Only while the visual viewport is lower than the root, the page isn't
 * zoomed in (a pinch zoom also moves the visual viewport) and the root is
 * `position: fixed` (an embedded drawer's root is in the page, and can be
 * above the viewport because the page is scrolled).
 *
 * Only one drawer shows a fill at a time: with nested drawers (also those
 * rendered with the yielded `Nested`), the outer drawer is an open bottom
 * drawer too, and two fills would show at the same place. Of the drawers
 * that can show one, the innermost drawer that contains the focused
 * element shows it; if none contains it, the drawer that became active
 * last. Every change (a viewport event, a drawer that opens or closes, a
 * focusout) syncs all of them. A focusout in any drawer to an element that
 * doesn't keep the keyboard open hides every fill at once.
 *
 * @module
 * @internal
 */

/** A computed `backdrop-filter`, also where only the prefixed one is set. */
function backdropFilterOf(style) {
  return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') || 'none';
}

/** The class of the fill element, a child of `<html>`. */
const KEYBOARD_FILL_CLASS = 'mobile-drawer-keyboard-fill';
/** On the drawer's root while the fill shows. */
const KEYBOARD_ATTRIBUTE = 'data-keyboard';

/** The part of `VisualViewport` this needs, see `drawerEnvironment`. */

/** Below this (px), the strip counts as none. */
const MIN_STRIP = 1;
/** The fills of the mounted drawers. */
const fills = new Set();
/** Counts activations, so the drawer that became active last is known. */
let activations = 0;

/** The focused element, also inside an open shadow root. */
function focusedElement() {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

/**
 * Shows the fill of the one drawer that should have it (see the module
 * docs), where it needs one, and hides every other fill.
 */
function syncAll() {
  const candidates = [];
  for (const fill of fills) {
    const strip = fill.strip();
    if (strip) candidates.push({
      fill,
      strip
    });else fill.hide();
  }
  const focused = focusedElement();
  const holding = candidates.filter(({
    fill
  }) => fill.contains(focused));
  // The innermost drawer that holds the focus: no other one is inside it.
  let owner = holding.find(({
    fill
  }) => !holding.some(other => other.fill !== fill && fill.contains(other.fill.root)));
  if (!owner) {
    for (const candidate of candidates) {
      if (!owner || candidate.fill.activation > owner.fill.activation) {
        owner = candidate;
      }
    }
  }
  for (const {
    fill,
    strip
  } of candidates) {
    if (owner?.fill === fill) fill.show(strip);else fill.hide();
  }
}
function hideAll() {
  for (const fill of fills) fill.hide();
}
class KeyboardFill {
  #options;
  #element;
  #listening = false;
  /** When it became active last, see `activations`. */
  activation = 0;
  constructor(options) {
    this.#options = options;
    options.root.addEventListener('focusout', this.#onFocusOut);
    fills.add(this);
  }
  get root() {
    return this.#options.root;
  }

  /** Whether the fill shows. */
  get showing() {
    return this.#element?.isConnected ?? false;
  }

  /** Whether `node` belongs to this drawer. */
  contains(node) {
    return this.#options.contains(this.#options.root, node);
  }

  /**
   * Listens to the visual viewport while the drawer is active, and shows,
   * moves or hides the fills of all drawers. Call it when the drawer opens
   * or closes; the viewport's own `resize` and `scroll` events call it too.
   */
  sync = () => {
    const {
      viewport,
      active
    } = this.#options;
    const on = active();
    if (viewport && on !== this.#listening) {
      this.#listening = on;
      if (on) this.activation = ++activations;
      const method = on ? 'addEventListener' : 'removeEventListener';
      viewport[method]('resize', this.sync);
      viewport[method]('scroll', this.sync);
    }
    syncAll();
  };

  /**
   * Copies the tray's colour to the fill again, e.g. after the drawer moved
   * to a snap point where a theme changes it. Does nothing while the fill
   * is hidden. It forces a style calculation, so the component only calls
   * it when the colour can change: when the expand progress or
   * `data-expanded` changes.
   */
  paint() {
    const element = this.#element;
    if (!element?.isConnected) return;
    const tray = getComputedStyle(this.#options.tray);
    const {
      style
    } = element;
    style.backgroundColor = tray.backgroundColor;
    let filter = backdropFilterOf(tray);
    // The theme's blur may be on the glass layer under the tray instead.
    if (filter === 'none' && this.#options.glass) {
      const glass = getComputedStyle(this.#options.glass);
      if (glass.display !== 'none') filter = backdropFilterOf(glass);
    }
    style.setProperty('backdrop-filter', filter);
    style.setProperty('-webkit-backdrop-filter', filter);
    style.zIndex = getComputedStyle(this.#options.root).zIndex;
  }
  destroy() {
    const {
      viewport,
      root
    } = this.#options;
    root.removeEventListener('focusout', this.#onFocusOut);
    if (viewport && this.#listening) {
      viewport.removeEventListener('resize', this.sync);
      viewport.removeEventListener('scroll', this.sync);
    }
    this.#listening = false;
    fills.delete(this);
    this.hide();
    // Another drawer may need its fill now.
    if (fills.size > 0) syncAll();
  }

  /**
   * Hides every fill at once when focus leaves a field in the drawer for an
   * element that doesn't keep the keyboard open (or for nothing, e.g. the
   * keyboard's Done button). Safari moves the fixed root back down as the
   * keyboard starts to close, before the visual viewport's events: a fill
   * would then cover the bottom of the sheet until they come. Every fill,
   * also that of a drawer around this one, which doesn't get this focusout
   * (e.g. this drawer is rendered with its `Nested`). Focus that moves to
   * another field keeps them; the viewport's events move them.
   */
  #onFocusOut = event => {
    const to = event.relatedTarget;
    if (to instanceof Element && this.#options.keepsKeyboard(to)) return;
    hideAll();
  };

  /**
   * The strip between the root's bottom and the screen's, in client px, or
   * `undefined` if there is none or the drawer is not active.
   */
  strip() {
    const {
      viewport,
      root
    } = this.#options;
    if (!viewport || !this.#listening) return undefined;
    if ((viewport.scale ?? 1) > 1.01) return undefined;
    const rect = root.getBoundingClientRect();
    if (viewport.height >= rect.height - MIN_STRIP) return undefined;
    const style = getComputedStyle(root);
    if (style.position !== 'fixed') return undefined;
    // The root's own offset from the top of the layout viewport (e.g. the
    // 5px of `@transparentStatusBar`): its client top without it is the
    // top of the layout viewport, and so of the screen.
    const height = (parseFloat(style.top) || 0) - rect.top;
    if (height < MIN_STRIP) return undefined;
    return {
      top: rect.bottom,
      height
    };
  }
  show({
    top,
    height
  }) {
    let element = this.#element;
    if (!element) {
      element = this.#element = document.createElement('div');
      element.className = KEYBOARD_FILL_CLASS;
      element.setAttribute('aria-hidden', 'true');
      const {
        style
      } = element;
      style.position = 'absolute';
      style.left = '0';
      style.width = '100%';
      style.top = '0px';
      style.margin = '0';
      style.pointerEvents = 'none';
    }
    const {
      style
    } = element;
    if (!element.isConnected) {
      document.documentElement.append(element);
      this.#options.root.setAttribute(KEYBOARD_ATTRIBUTE, '');
      this.paint();
    }
    // Where its containing block puts it now, so `top` is right whatever
    // that block is and however far the document is scrolled.
    const current = parseFloat(style.top) || 0;
    const offset = element.getBoundingClientRect().top - current;
    style.top = `${top - offset}px`;
    style.height = `${height}px`;
  }
  hide() {
    if (!this.#element?.isConnected) return;
    this.#element.remove();
    this.#options.root.removeAttribute(KEYBOARD_ATTRIBUTE);
  }
}

const animationWaiter = buildWaiter('ember-mobile-drawer:animation');
const PLACEMENTS = ['bottom', 'top', 'left', 'right'];
const DEFAULT_SNAP_POINTS = Object.freeze([0, 'content']);
/**
 * Pointer types that can drag the drawer. Mouse is left out: a mouse drag
 * would also select text and end in a click on whatever is under the pointer.
 */
const POINTER_TYPES = Object.freeze(['touch', 'pen']);
/**
 * A release at least this fast (px/s) always moves to at least the next snap
 * point in the direction of the finger, see `selectSnapPoint`.
 */
const FLING_VELOCITY = 400;
/**
 * Which way along the pointer's axis opens the drawer: `1` when opening moves
 * towards larger client coordinates (right, down), `-1` otherwise.
 */
const OPENING_DIRECTION = {
  bottom: -1,
  top: 1,
  left: 1,
  right: -1
};
/**
 * The rubber band past the largest snap point, like the content of an iOS
 * sheet: the classic UIScrollView curve `(1 - 1 / (x * c / d + 1)) * d` with
 * `c = DEFAULT_RUBBER_BAND_FACTOR` (0.55) and a dimension `d` of this ratio
 * times the tray's length (the scroll container's size along the axis).
 * Measured in the iOS 27 simulator (iPhone 17e): a sheet at its largest
 * detent doesn't move, its content bounces with c ≈ 0.55 and d ≈ 440pt for
 * a scroll view of about 800pt, so d ≈ 0.55 × the scroll view's size. Past
 * the tray's length only the content moves (see `#renderBounce`); the tray
 * stays at its edge. Past the smallest snap point the container size is
 * used.
 */
const OPEN_RUBBER_BAND_RATIO = 0.55;
/**
 * Marks an element in `.mobile-drawer__content` that stays at the tray's
 * edge while the content bounces past fully open, such as a sticky grabber
 * or header: the component writes the opposite `translate` on it.
 */
const PINNED_ATTRIBUTE = 'data-mobile-drawer-pinned';
/**
 * Marks an element inside the tray as a scroll container for scroll vs drag
 * handling. The tray itself always is one.
 */
const SCROLL_ATTRIBUTE = 'data-mobile-drawer-scroll';
/**
 * Events on the tray that (re)lock the scroll containers they reach. `wheel`
 * isn't passive, so the browser applies the lock before the wheel scrolls.
 */
const TRAY_INPUT_EVENTS = ['pointerdown', 'wheel', 'focusin'];
const CAPTURE_PASSIVE = {
  capture: true,
  passive: true
};
const CAPTURE_ACTIVE = {
  capture: true,
  passive: false
};
/**
 * Tolerance (px) for "at the highest snap point" and "at a scroll end":
 * offsets and scroll positions can be fractional.
 */
const EPSILON = 0.5;
/**
 * How far (screen px) a pointer may move between going down on the backdrop
 * and its click for the click to still count as a tap. The same distance at
 * which `didPan` recognises a pan.
 */
const TAP_SLOP = 10;
/**
 * How long (ms) after a pointer stopped the content's momentum its click is
 * still cancelled, see `#swallowClick`.
 */
const SWALLOW_CLICK_TIME = 1000;
/**
 * How far (px) a click may be from where the backdrop pointer lifted to
 * still be that pointer's click. Pointer and click coordinates can differ
 * by rounding.
 */
const CLICK_MATCH = 2;
/**
 * The open modal drawers, in the order they became modal, except that a
 * drawer always comes before the modal drawers inside it (see
 * `#activateModal`). Only the last one handles Escape and Tab on the
 * document.
 */
const modalStack = [];
/** Every drawer in the DOM, to find nested drawers, see `#applyNested`. */
const mountedDrawers = new Set();
/**
 * The root elements of the drawers in `mountedDrawers`, to tell a drawer's
 * root from another element with the `mobile-drawer` class, see `#inNested`.
 */
const mountedRoots = new WeakSet();
/** The kind of input the user gave last, see `trackInput`. */
/** The drawers that show (open or at a peek), see `trackInput`. */const shownDrawers = new Set();
/**
 * The input the user gave last while a drawer showed, and when (ms, see
 * `inputTime`), or `undefined` when there was none since then. See
 * `trackInput`.
 */
let lastInput;
/**
 * How long (ms) after a key press or a pointer that goes down a focus still
 * counts as caused by it, see `focusInputOf`. A focus from Tab, a tap or a
 * click, or from the app's own handler for the event, comes at once. A long
 * press can take more time; then the browser decides, as for focus without
 * input.
 */
const INPUT_WINDOW = 1000;
/** The time for `lastInput`: the drawer's clock, as for its animations. */
const inputTime = () => (drawerEnvironment.clock ?? performance).now();
const onInputKeyDown = () => {
  lastInput = {
    type: 'keyboard',
    time: inputTime()
  };
};
const onInputPointerDown = () => {
  lastInput = {
    type: 'pointer',
    time: inputTime()
  };
};
const INPUT_LISTENER = {
  capture: true,
  passive: true
};
/**
 * Adds `drawer` to the drawers that show (`shown`) or removes it. While one
 * or more drawers show, listeners on the window record the input the user
 * gave last: a key press (`keydown`) or a pointer that goes down (mouse,
 * touch or pen, `pointerdown`). They are in the capture phase, so the record
 * is there before the focus that the input causes, also when the app moves
 * focus in its own handler for the event, and an app's listener that stops
 * the event doesn't hide it. When no drawer shows, the listeners go and the
 * record is forgotten. See `focusInputOf`.
 */
function trackInput(drawer, shown) {
  if (shown) {
    if (shownDrawers.has(drawer)) return;
    if (shownDrawers.size === 0) {
      window.addEventListener('keydown', onInputKeyDown, INPUT_LISTENER);
      window.addEventListener('pointerdown', onInputPointerDown, INPUT_LISTENER);
    }
    shownDrawers.add(drawer);
  } else if (shownDrawers.delete(drawer) && shownDrawers.size === 0) {
    window.removeEventListener('keydown', onInputKeyDown, INPUT_LISTENER);
    window.removeEventListener('pointerdown', onInputPointerDown, INPUT_LISTENER);
    lastInput = undefined;
  }
}
/**
 * The input that gives `element` focus now: keyboard focus when the last
 * input was a key press (see `trackInput`) less than `INPUT_WINDOW` ago.
 * Also programmatic focus by the app right after a key press, like
 * `:focus-visible` in Chrome. The same in every browser, and for every
 * element: a mouse click on a `readonly` text field is pointer focus, though
 * Chrome gives it `:focus-visible`.
 *
 * Without a recent input the browser decides: `:focus-visible`, but never
 * for a `readonly` or `disabled` text field (Chrome gives it
 * `:focus-visible` after a mouse click too). That is focus from a screen
 * reader or switch access, which sends no key or pointer event to the page
 * (an old tap must not make it pointer focus), and focus that the app moves
 * right after the click or key press that opened the drawer, before the
 * listeners were there. A browser without `:focus-visible` (Safari before
 * 15.4) throws; nothing then counts as keyboard focus.
 */
function focusInputOf(element) {
  if (lastInput && inputTime() - lastInput.time < INPUT_WINDOW) {
    return lastInput.type;
  }
  if (isInactiveTextField(element)) return 'pointer';
  try {
    return element.matches(':focus-visible') ? 'keyboard' : 'pointer';
  } catch {
    return 'pointer';
  }
}
/**
 * Whether `element` can scroll along the axis in the direction a finger that
 * moved `movement` px (positive: down or right) pushes its content.
 */
function canScroll(element, vertical, movement) {
  const style = getComputedStyle(element);
  const overflow = vertical ? style.overflowY : style.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  const range = vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
  if (!(range > EPSILON)) return false;
  // Horizontal right-to-left scroll positions run from -range to 0.
  const rtl = !vertical && style.direction === 'rtl';
  const min = rtl ? -range : 0;
  const max = rtl ? 0 : range;
  // iOS reports positions past the ends while bouncing; those count as ends.
  const position = vertical ? element.scrollTop : element.scrollLeft;
  // A finger moving down (right) reveals what is above (left of) the view,
  // so the position has to be able to decrease; moving up (left), increase.
  return movement > 0 ? position > min + EPSILON : position < max - EPSILON;
}
/**
 * Whether `element` is nearer the end of its scroll range along the axis
 * that a finger moving `way` (positive: down or right) pushes its content
 * towards than the other end.
 */
function nearEnd(element, vertical, way) {
  const range = vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
  if (!(range > EPSILON)) return true;
  const rtl = !vertical && getComputedStyle(element).direction === 'rtl';
  const min = rtl ? -range : 0;
  const position = vertical ? element.scrollTop : element.scrollLeft;
  const fromMin = position - min;
  // A finger moving down (right) pushes the content towards `min`.
  return way > 0 ? fromMin <= range / 2 : fromMin >= range / 2;
}

/**
 * A scroll container that a drag scrolls from script past the highest snap
 * point, see `#splitDrag`. Positions are `scrollTop` (vertical) or
 * `scrollLeft`, read once when the drag reaches it.
 */

/** A scroll reset of the tray, see `#planScrollReset`. */

/**
 * The border-box length of `element` along the drawer axis, in fractional px
 * and in the element's own coordinate space, or `undefined` when it can't be
 * measured: outside of the render tree (e.g. under a `display: none`
 * ancestor) computed styles return specified values such as `'auto'` or
 * `'100%'` instead of px. Computed styles are used instead
 * of `getBoundingClientRect()`, which also includes transforms (of the tray
 * and of any ancestor, e.g. a scaled preview), and instead of
 * `offsetHeight`/`offsetWidth`, which are rounded.
 *
 * `extra` is what the `height`/`width` property doesn't include (padding and
 * border under `box-sizing: content-box`), needed to write an explicit size.
 */
function measureLength(element, vertical) {
  const style = getComputedStyle(element);
  const px = value => value.endsWith('px') ? parseFloat(value) : NaN;
  const extra = style.boxSizing === 'content-box' ? vertical ? px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth) : px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth) : 0;
  const length = px(vertical ? style.height : style.width) + extra;
  return Number.isFinite(length) ? {
    length,
    extra
  } : undefined;
}
/** `<input>` types that take no typed text, so open no on-screen keyboard. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
/**
 * Whether `element` is a field the user edits: a text input, a textarea, a
 * select, or contenteditable content. Focus on one of them can open an
 * on-screen keyboard or picker, and the browser then scrolls the field into
 * view. An iframe counts too: the element focused inside it is unknown. A
 * `readonly` or `disabled` text field opens no keyboard, so it doesn't count.
 */
function isEditable(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.readOnly || element.disabled) return false;
    return element instanceof HTMLTextAreaElement || !NON_TEXT_INPUTS.has(element.type);
  }
  return element instanceof HTMLSelectElement || element instanceof HTMLIFrameElement || element instanceof HTMLElement && element.isContentEditable;
}
/**
 * Whether `element` is a text `<input>` or a `<textarea>` that is `readonly`
 * or `disabled`: it opens no keyboard, see `isEditable`.
 */
function isInactiveTextField(element) {
  return (element instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(element.type) || element instanceof HTMLTextAreaElement) && (element.readOnly || element.disabled);
}
/**
 * Whether `element` is a field the user types in: a text `<input>` or a
 * `<textarea>` that isn't `readonly` or `disabled`, or contenteditable
 * content. Focus on one of them opens an on-screen keyboard, also after a
 * tap. Unlike `isEditable`, not a select or an iframe.
 */
function isTypingField(element) {
  return isEditable(element) && !(element instanceof HTMLSelectElement) && !(element instanceof HTMLIFrameElement);
}
/**
 * Whether `element` is a field that takes text: a text `<input>` (not
 * `disabled`), a `<textarea>` or contenteditable content. Unlike
 * `isEditable`, `readonly` fields count: their text can still be selected.
 */
function isTextField(element) {
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !NON_TEXT_INPUTS.has(element.type);
  }
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  return element instanceof HTMLElement && element.isContentEditable;
}
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
/** The valid index into an array of `count` items nearest to `index`. */
const clampIndex = (index, count) => Number.isFinite(index) ? clamp(Math.round(index), 0, count - 1) : 0;
/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring.
 *
 * The tray can be dragged with touch or pen input along the drawer's axis
 * (through `didPan` from ember-gesture-modifiers). It follows the finger 1:1,
 * with rubber-band resistance past the first and last snap point. Past the
 * last one the tray stays at its edge; a drag from the content scrolls the
 * content there when it can (see `#splitDrag`), else the content bounces,
 * like an iOS sheet (see `OPEN_RUBBER_BAND_RATIO` and `#renderBounce`).
 * On release the drawer's velocity is handed to the spring and the snap point nearest to where the
 * release would carry the drawer is picked; a release faster than
 * `FLING_VELOCITY` always moves at least one snap point its way. A touch
 * holds a running animation where it is, and a drag continues from there.
 * Elements with the yielded `handle` modifier always drag, see below. With
 * `@handleOnly`, only they start a drag. One finger drags at a time.
 *
 * Scroll vs drag: the tray is a scroll container, as is every element in it
 * marked with `data-mobile-drawer-scroll`. Each touch gesture is decided
 * once the finger has moved a few px along the axis, and further along it
 * than across it (see `dragSource`), and keeps that decision until the
 * finger lifts:
 * - below the highest snap point every gesture along the axis drags, and
 *   the content can't scroll along the axis at all (see `#syncScrollLock`);
 * - at the highest snap point a gesture scrolls if a scroll container
 *   between the touched element and the tray (inclusive) can scroll the way
 *   the finger pushes the content, and drags otherwise. So at the start of
 *   the content, pulling a bottom drawer down closes it.
 * One exception to "keeps that decision": a gesture that scrolls the
 * content and reaches its scroll start while the finger still pulls
 * towards close is taken over by a drag (the scroll handoff of an iOS
 * sheet, see `onTrayScroll`). The drag starts where the tray is, locks the
 * content and stays a drag until the finger lifts. Momentum after the
 * finger lifted never moves the drawer.
 * The other way, a drag from the content (not a handle) that reaches the
 * highest snap point while the finger moves on towards open scrolls the
 * content from script, 1:1 with the finger, and its release goes on with a
 * momentum (see `#splitDrag` and `#startMomentum`). The gesture stays a
 * drag: in iOS Safari a native scroll can't start after its touchmoves
 * were cancelled.
 * A gesture that drags cancels its `touchmove` events at every snap point
 * (see `dragSource`), so the browser can't scroll the content or the page
 * under it. The tray also gets `touch-action: pan-x` (vertical drawers) or
 * `pan-y` (horizontal ones) below the highest snap point and `pan-x pan-y`
 * at it, but iOS Safari doesn't reliably honour `touch-action` on a scroll
 * container, so nothing relies on it alone. Touchmoves are only cancelled
 * once a gesture is decided, so swipes across the axis (a carousel, a list
 * in a side drawer) keep working.
 *
 * Handles: an element with the `handle` modifier is a drag source of its
 * own, with `didPan`'s `touch-action` (`pan-x` for a vertical axis, `pan-y`
 * for a horizontal one), so the browser doesn't pan along the axis on it. A
 * gesture that starts on a handle always drags, at every snap point, also
 * when the content is scrolled (see `#onHandle`): a sticky header with the
 * modifier stays a way to drag a scrolled sheet. The handle's drag source
 * decides such a gesture as a drag like the tray's does (`shouldHandleDrag`),
 * so it cancels the touchmoves, also with `@handleOnly`. Without
 * `@handleOnly` the tray's drag source decides it as a drag too
 * (`shouldDrag`); whichever of the two recognises the pan first owns the
 * drag, and the other is ignored. A handle wins over everything in it, also
 * a `data-mobile-drawer-scroll` element, except a text field (see
 * `#onHandle`). A handle belongs to the drawer that yielded it, not to a
 * drawer around that one. A tap on an element in a handle (a button) still
 * clicks.
 *
 * Nested drawers: a drawer in this drawer's tray is a part of its tray, so
 * its touches also reach this drawer's drag sources. A gesture that starts
 * in a nested drawer (its tray, a handle or its backdrop) belongs to that
 * drawer only (see `#inNested`): it never drags this drawer, also when the
 * nested drawer is at its closed position and the finger moves on, and it
 * doesn't hold this drawer's running animation. A nested drawer in the
 * yielded `Nested` renders outside the tray (see `nesting.ts`), so the tray
 * doesn't clip it; its touches never reach this drawer. For the modal
 * stack, `data-nested`, `inert`, focus, the scroll lock and the hiding of
 * a closed drawer it still counts as inside this drawer. When this drawer
 * starts to close, it closes such a drawer (see `#closePortaled`).
 *
 * With `@handleOnly` the content is locked below the highest snap point
 * too, so it only scrolls when the drawer is fully open, and swipes along
 * the axis on it are cancelled there without dragging (see
 * `#onTrayTouchMove`), so the page behind doesn't scroll instead.
 * When a bottom or top drawer leaves its highest snap point, its tray
 * scrolls back to its scroll start, the content start at the leading edge;
 * at the highest snap point it opens at `scrollTop` 0 (see
 * `#planScrollReset`).
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` (unless
 * `@backdrop={{false}}`) and a `.mobile-drawer__sheet` with the
 * `.mobile-drawer__tray` in it, with the block inside
 * `.mobile-drawer__content`, and an empty `.mobile-drawer__bar-tint` after
 * the sheet and (with the backdrop) an empty `.mobile-drawer__backdrop-tint`
 * after the backdrop (for the iOS Safari 26 bars, see styles.css), and a
 * `.mobile-drawer__shadow` before the sheet, for a theme's outer shadow of
 * a floating bottom sheet (see `#paintShadow`), and an empty
 * `.mobile-drawer__glass` in the sheet before the tray, for a theme's
 * `backdrop-filter` on a floating bottom sheet (see `#paintShadow`).
 * Attributes are applied to the root element.
 *
 * Sheet: the sheet clips the tray. Every frame the component writes the
 * expand progress on it (see `#paintExpand`), from the second-highest to
 * the highest snap point, for themes such as a floating sheet that goes
 * edge-to-edge (`--mobile-drawer-inset`). The root gets `data-at-highest`
 * while the tray is at its highest snap point, and `data-nested` while a
 * modal drawer in front of it is open (see `#syncNested`).
 *
 * Backdrop: its opacity follows the drawer frame by frame through
 * `--mobile-drawer-progress`, written in `#render` like the transform. A tap
 * on it calls `close` (unless `@closeOnBackdropClick={{false}}`); a pointer
 * that moved more than `TAP_SLOP` isn't a tap. The backdrop
 * is not a drag source: touching it doesn't hold a running animation, and
 * a drag on it doesn't move the drawer.
 *
 * Modal (`@modal`, default): "open" means the active snap point is above
 * the smallest one. While open, the rest of the page is inert (the siblings
 * of the root and of each of its ancestors up to `<body>`), body scrolling is
 * locked, Tab wraps around inside the tray and Escape calls `close`. Focus
 * moves in when it opens and back to the previously focused element when it
 * closes, before `data-closed` hides the drawer. All of that is applied in a
 * microtask after rendering (`#syncOpen`), and undone right away on teardown.
 *
 * Keyboard focus on an element in the tray that is off screen moves the
 * drawer (modal or not, also from a peek, then without the modal
 * behaviour) to its highest snap point, see `#onTrayFocusIn`. The root never scrolls, see `#resetRootScroll`.
 *
 * Snap points are re-measured when the root or `.mobile-drawer__content`
 * changes size, and when an argument changes. The tray itself is not
 * observed (the component sizes it), so a change to only the tray's own
 * padding or border is picked up at the next of those.
 *
 * ```gts
 * <MobileDrawer @snapPoints={{array 0 "50%" "100%"}} as |drawer|>
 *   <button type="button" {{on "click" drawer.close}}>Close</button>
 * </MobileDrawer>
 * ```
 */
class MobileDrawer extends Component {
  static {
    g(this.prototype, "isAnimating", [tracked], function () {
      return false;
    });
  }
  #isAnimating = (i(this, "isAnimating"), void 0);
  static {
    g(this.prototype, "isDragging", [tracked], function () {
      return false;
    });
  }
  #isDragging = (i(this, "isDragging"), void 0);
  static {
    g(this.prototype, "progress", [tracked], function () {
      return 0;
    });
  }
  #progress = (i(this, "progress"), void 0);
  /**
  * Starts at `0`: the real value needs the measured layout, which only
  * exists after the first render. A drawer inserted at a snap point other
  * than closed therefore renders its block once more after insertion.
  */
  static {
    g(this.prototype, "uncontrolledVersion", [tracked], function () {
      return 0;
    });
  }
  #uncontrolledVersion = (i(this, "uncontrolledVersion"), void 0);
  /**
  * Bumped when the drawer changes its own (uncontrolled) snap point, so
  * everything that reads `activeSnapPoint` updates.
  */
  static {
    g(this.prototype, "modalActive", [tracked], function () {
      return false;
    });
  }
  #modalActive = (i(this, "modalActive"), void 0);
  /** Whether the modal behaviour is on, for `aria-modal`. */
  static {
    g(this.prototype, "openSnapPoints", [tracked], function () {
      return [];
    });
  }
  #openSnapPoints = (i(this, "openSnapPoints"), void 0);
  /**
  * For the yielded `Grabber`: the indices of the open snap points (offset
  * above `0`), one entry per resolved snap point, ascending by offset.
  * Updated after each measurement (see `#measure`), so empty before the
  * first one.
  */
  static {
    g(this.prototype, "nestedParent", [tracked]);
  }
  #nestedParent = (i(this, "nestedParent"), void 0);
  /**
  * The parent element of the root, once the drawer is in the DOM: where
  * the yielded `Nested` renders without `@destination`.
  */
  /**
  * The portal elements of the yielded `Nested` (see `nesting.ts`). They
  * are a part of the tray for the nesting relation, and hidden with the
  * drawer (`data-closed`, see `#setClosed`).
  */
  #portals = new Set();
  /** What the yielded `Nested` registers its portal element with. */
  nestedOwner = {
    add: portal => {
      this.#portals.add(portal);
      addPortal(portal, () => this.#tray);
      // Like the root until the drawer has rendered: closed.
      portal.toggleAttribute('data-closed', this.#root?.hasAttribute('data-closed') ?? true);
      MobileDrawer.#portalsChanged();
    },
    remove: portal => {
      this.#portals.delete(portal);
      removePortal(portal);
      MobileDrawer.#portalsChanged();
    }
  };
  /**
  * The snap point when uncontrolled. Not tracked (see `uncontrolledVersion`)
  * because it is also written during rendering, to remember the last
  * controlled index: dropping `@activeSnapPoint` keeps the drawer where it
  * is.
  */
  #uncontrolledSnapPoint = 0;
  #lastWarning;
  #root;
  /** The `.mobile-drawer__sheet` around the tray, see `#paintExpand`. */
  #sheet;
  #tray;
  #content;
  /** The root's `.mobile-drawer__bar-tint` child, if any. */
  #barTint;
  /** The root's `.mobile-drawer__shadow` child, see `#paintShadow`. */
  #shadow;
  /** The `.mobile-drawer__shadow-body` in it, see `#paintShadow`. */
  #shadowBody;
  /** The sheet's `.mobile-drawer__glass` child, see `#paintShadow`. */
  #glass;
  /**
  * The sheet's colour below the root while an on-screen keyboard is open
  * in iOS Safari, see `KeyboardFill`.
  */
  #keyboardFill;
  /** Whether the content is moved past fully open, see `#renderBounce`. */
  #bouncing = false;
  /**
  * The pinned elements while bouncing (see `PINNED_ATTRIBUTE`), with their
  * inline `translate` from before the bounce, put back after.
  */
  #pinned = new Map();
  /** The content's inline `will-change` before a bounce, put back after. */
  #contentWillChange;
  #backdrop;
  /** The backdrop's `.mobile-drawer__backdrop-tint` sibling, if any. */
  #backdropTint;
  /**
  * Whether the root has `data-status-bar="transparent"` (#113),
  * see `#syncStatusBar`.
  */
  #statusBar = false;
  /** The dim layer (#113), while `#statusBar` with a backdrop. */
  #pageDim;
  /** Removes the listener for a change of the scroll lock. */
  #offLockChange;
  #spring;
  #resizeObserver;
  #layout;
  /** Whether the tray is below the lowest open snap point, see `#paintSink`. */
  #below = false;
  /** Whether the sheet floats, read in `#paintSink`. */
  #floats = false;
  /** How far (px) `#paintSink` moved the sheet down. */
  #moved = 0;
  #placement;
  #destroyed = false;
  #pendingState;
  /** The injected clock, if any (tests); see `#timeOf`. */
  #clock;
  #drag;
  /**
  * Set while a pointer that went down on a drag source holds a running
  * animation that it stopped, until a drag starts or the pointer lifts.
  */
  #hold;
  #velocity = new VelocityTracker();
  /**
  * The velocity of the content part of a drag (see `#splitDrag`), for
  * the momentum on release.
  */
  #scrollVelocity = new VelocityTracker();
  /**
  * The momentum of content that a drag scrolled, after its release, see
  * `#startMomentum`.
  */
  #momentum;
  /** The click that a tap which stopped the momentum may not do. */
  #clickSwallow;
  /** Offset written by the last `#render`, after clamping. */
  #renderedOffset = 0;
  /**
  * How far (px) the tray may be rendered past fully open while not dragged.
  * Set on release to where the finger left it and only shrinks from there,
  * so the tray returns from a rubber-band without jumping but the spring
  * never pulls it further off its edge.
  */
  #overshoot = 0;
  /**
  * Set when a run of the spring towards the highest snap point has
  * reached it; the render then holds the tray there for the rest of that
  * run (see `#render`). Cleared when the run ends, a drag starts or the
  * target changes.
  */
  #arrivedAtHighest = false;
  /**
  * Whether the tray was at (or past) the highest snap point at the last
  * render, i.e. whether its content may scroll. See `#trayTouchAction`.
  */
  #atTop = false;
  /**
  * A scroll reset that follows the tray in `#render`, see
  * `#planScrollReset`.
  */
  #scrollReset;
  /** The spring of a scroll reset that runs on its own, if any. */
  #scrollSpring;
  /**
  * The elements whose scrolling along the axis is locked, with the inline
  * value of the overflow property they had before. See `#syncScrollLock`.
  */
  #scrollLock = new Map();
  /** The overflow property the lock sets, while locked. */
  #scrollLockProperty;
  /**
  * The elements with an inline `overscroll-behavior` during a scroll, with
  * the inline value they had before, see `#setOverscroll`.
  */
  #overscroll = new Map();
  /**
  * With `@handleOnly`, the touch on the tray that started while scrolling
  * was locked, see `#onTrayTouchMove`. `cancels` is `undefined` until the
  * gesture is decided; `far` once it moved `TAP_SLOP` along the axis.
  */
  #lockedTouch;
  /**
  * The elements with the yielded `handle` modifier, see `#onHandle`.
  */
  #handles = new Set();
  /** Drags started so far, see `GrabberOwner`. */
  #dragCount = 0;
  /**
  * The element whose keyboard focus moves the drawer to its highest snap
  * point, to show in the tray when it arrives, see `#onTrayFocusIn`.
  */
  #reveal;
  /** Backdrop progress written by the last `#render`, see `#paintBackdrop`. */
  #backdropProgress = 0;
  /** Expand progress written by the last `#render`, see `#paintExpand`. */
  #expandProgress = NaN;
  /**
  * Whether the last `#render` was above the smallest snap point, where the
  * backdrop catches pointers, see `#paintBackdrop`.
  */
  #backdropBlocks = false;
  /**
  * Whether the active snap point is above the smallest one, i.e. the drawer
  * is open or opening. Updated during rendering by `#syncOpen`; the modal
  * behaviour and focus follow in a microtask, see `#applyOpen`.
  */
  #open = false;
  /**
  * Whether the active snap point is at 0, i.e. the drawer is closed or
  * closing and `data-closed` hides it (or soon will). Unlike `!#open`, not
  * set while the drawer rests at a peek: a smallest snap point above 0 keeps
  * the drawer, and the drawers inside it, visible. Also set until the
  * drawer is first measured. Updated with `#open` by `#syncOpen`, see
  * `#insideClosedDrawer`.
  */
  #hidden = true;
  /**
  * `#open` as last reported through `@onOpen`/`@onClose`. The first value
  * `#syncOpen` computes (on insertion, or at the first successful measure
  * of a drawer inserted while hidden) counts as reported. See `#applyOpen`.
  */
  #reportedOpen = false;
  /** Whether `#reportedOpen` has its first value, see `#syncOpen`. */
  #hasReportBaseline = false;
  /** The element to focus again when the drawer closes. */
  #returnFocus;
  /** Its ancestors when the drawer opened, see `#returnFocusAfterClose`. */
  #returnFocusPath = [];
  /**
  * Set while the drawer is open because keyboard focus moved it up from
  * its peek (see `#onTrayFocusIn`): it is then not modal, and goes back
  * to its peek when focus leaves it (see `#onRootFocusOut`). Set when the
  * drawer opens while `#focusOpenPending`, cleared when it closes (to its
  * peek or to `0`). A drag or an action that moves it between open snap
  * points meanwhile keeps it; one that opens it from the peek doesn't set
  * it, so the drawer is modal as before.
  */
  #openedByFocus = false;
  /**
  * Set from a focus move from the peek until the drawer opens, or until
  * the next task when a controlled parent doesn't take the new index.
  */
  #focusOpenPending = false;
  /**
  * The last element outside the drawer that focus came from into the
  * tray, to return focus to when a drawer opened by focus closes.
  */
  #enteredFrom;
  /** Set while a modal drawer moves focus in, see `#activateModal`. */
  #initialFocusing = false;
  /**
  * The element a modal drawer focused when it opened (see
  * `#activateModal`), until focus moves to another element. Its keyboard
  * focus doesn't hold the scroll reset, see `#focusHoldsReset`.
  */
  #initialFocused;
  /**
  * The element in the tray that got focus last, also inside an open shadow
  * root, and the input that focused it (see `focusInputOf`), read when it
  * got focus: a later key press (e.g. typing, or Space on a tapped button)
  * doesn't make it keyboard focus. See `#onTrayFocusIn`.
  */
  #focused;
  /**
  * Set when the drawer closed and `#applyOpen` has yet to return focus:
  * whether focus was inside the drawer when it closed.
  */
  #closedWithFocusInside;
  #applyQueued = false;
  /** Undoes the modal behaviour while it is on. */
  #releaseModal;
  /**
  * Undoes the `inert` part of the modal behaviour while it is on, see
  * `#makeOutsideInert`.
  */
  #releaseInert;
  #warnedLabel = false;
  /**
  * The pointer that went down on the backdrop, from its `pointerdown` until
  * its click, its `pointercancel` or the next pointer down. `moved` once it
  * went further than `TAP_SLOP`: its click then isn't a tap. `up` is where
  * it lifted; only a click there belongs to it (see `onBackdropClick`).
  */
  #backdropPointer;
  get placement() {
    const {
      placement
    } = this.args;
    return placement && PLACEMENTS.includes(placement) ? placement : 'bottom';
  }
  get snapPoints() {
    return this.args.snapPoints ?? DEFAULT_SNAP_POINTS;
  }
  get axis() {
    return this.placement === 'bottom' || this.placement === 'top' ? 'vertical' : 'horizontal';
  }
  get handleOnly() {
    return this.args.handleOnly === true;
  }
  get isModal() {
    return this.args.modal !== false;
  }
  /** Unset, the backdrop follows `@modal`. */
  get showBackdrop() {
    return this.args.backdrop ?? this.isModal;
  }
  get closeOnBackdropClick() {
    return this.args.closeOnBackdropClick !== false;
  }
  get isControlled() {
    return this.args.activeSnapPoint !== undefined;
  }
  /**
  * The active index into `@snapPoints`. An `@activeSnapPoint` that isn't a
  * valid index (e.g. `@snapPoints` shrank before the parent updated
  * `@activeSnapPoint`) is clamped to the nearest valid index, with a warning
  * in development, rather than throwing during rendering.
  */
  get activeSnapPoint() {
    const count = this.snapPoints.length;
    const {
      activeSnapPoint
    } = this.args;
    if (activeSnapPoint === undefined) {
      void this.uncontrolledVersion;
      return clampIndex(this.#uncontrolledSnapPoint, count);
    }
    const index = clampIndex(activeSnapPoint, count);
    if (index !== activeSnapPoint) {
      this.#warnOnce(`<MobileDrawer>: @activeSnapPoint must be an index into @snapPoints (0-${count - 1}), got ${activeSnapPoint}. Using ${index} instead.`);
    }
    return index;
  }
  /** Warns in development, once per distinct message in a row. */
  #warnOnce(message) {
    if (message === this.#lastWarning) return;
    this.#lastWarning = message;
    // `warn` from @ember/debug is a no-op in production builds of Ember.
    warn(message, false, {
      id: 'ember-mobile-drawer.invalid-snap-point'
    });
  }
  snapTo = index => {
    assert(`<MobileDrawer>: snapTo needs an index into @snapPoints (0-${this.snapPoints.length - 1}), got ${index}.`, Number.isInteger(index) && index >= 0 && index < this.snapPoints.length);
    if (index === this.activeSnapPoint) {
      // Already the active snap point: make sure the drawer is (moving)
      // there, e.g. after a resize stopped an animation.
      this.#moveToActive(true);
      return;
    }
    if (!this.isControlled) {
      // Re-renders the lifecycle modifier, which animates to it.
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.args.onSnapPointChange?.(index);
  };
  /**
  * The yielded `Grabber`'s action, like the grabber of an iOS sheet: moves
  * to the next larger open snap point (offset above `0`), and from the
  * largest back to the smallest open one. It never closes the drawer.
  * Returns the index it moved to, or `undefined` when there is nothing to
  * move to: before the drawer is measured, during a drag, or with fewer
  * than two open snap points.
  */
  #cycle() {
    const layout = this.#layout;
    if (!layout || this.#drag || this.#destroyed) return undefined;
    const open = layout.resolved.filter(snapPoint => snapPoint.offset > 0);
    if (open.length < 2) return undefined;
    const active = this.activeSnapPoint;
    const at = open.findIndex(snapPoint => snapPoint.indices.includes(active));
    const next = open[at === -1 || at === open.length - 1 ? 0 : at + 1];
    const index = this.#indexOf(next);
    this.snapTo(index);
    return index;
  }
  /** What the yielded `Grabber` gets, see `grabber.gts`. */
  grabberOwner = {
    cycle: () => this.#cycle(),
    dragCount: () => this.#dragCount
  };
  open = () => {
    const resolved = this.#layout?.resolved;
    const last = resolved?.[resolved.length - 1];
    if (last) this.snapTo(this.#indexOf(last));
  };
  close = () => {
    const first = this.#layout?.resolved[0];
    if (first) this.snapTo(this.#indexOf(first));
  };
  /** Prefers the active index when several snap points share an offset. */
  #indexOf(snapPoint) {
    const active = this.activeSnapPoint;
    return snapPoint.indices.includes(active) ? active : snapPoint.indices[0];
  }
  hooks = {
    install: root => {
      this.#root = root;
      this.#sheet = root.querySelector(':scope > .mobile-drawer__sheet');
      this.#tray = this.#sheet.querySelector(':scope > .mobile-drawer__tray');
      this.#barTint = root.querySelector(':scope > .mobile-drawer__bar-tint') ?? undefined;
      this.#shadow = root.querySelector(':scope > .mobile-drawer__shadow') ?? undefined;
      this.#shadowBody = this.#shadow?.querySelector('.mobile-drawer__shadow-body') ?? undefined;
      this.#glass = this.#sheet.querySelector(':scope > .mobile-drawer__glass') ?? undefined;
      this.#content = this.#tray.querySelector(':scope > .mobile-drawer__content');
      const {
        clock
      } = drawerEnvironment;
      this.#clock = clock;
      this.#spring = new Spring({
        ...this.#springConfig(),
        clock,
        prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
        onUpdate: ({
          value
        }) => this.#render(value)
      });
      this.#placement = this.placement;
      root.addEventListener('keydown', this.#onKeyDown);
      root.addEventListener('scroll', this.#onRootScroll, {
        passive: true
      });
      root.addEventListener('focusout', this.#onRootFocusOut);
      this.#sheet.addEventListener('scroll', this.#onRootScroll, {
        passive: true
      });
      mountedDrawers.add(this);
      mountedRoots.add(root);
      MobileDrawer.#syncNested();
      // Where the yielded `Nested` renders by default. Tracked state, so not
      // during rendering (and the drawers around this one are in the DOM
      // by then).
      queueMicrotask(() => {
        if (!this.#destroyed) this.nestedParent = this.#nestedDestination();
      });
      this.#measure();
      // Appear at the initial snap point without animating in.
      this.#moveToActive(false);
      this.#syncScrollLock();
      // A drawer with a text field opened in front: the lock is now the
      // fixed `<body>`, so the status bar is solid again.
      this.#offLockChange = onLockChange(() => this.#endStatusBar());
      registerDrawer({
        root,
        tray: this.#tray,
        placement: () => this.placement,
        isDragging: () => this.#drag !== undefined,
        offset: () => this.#renderedOffset,
        offsetOf: index => this.#layout ? findSnapPoint(this.#layout.resolved, index)?.offset : undefined,
        screenScale: () => this.#layout ? this.#screenScale() : 1,
        open: this.open,
        close: this.close
      });
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray.addEventListener(type, this.#onTrayInput, type === 'wheel' ? CAPTURE_ACTIVE : CAPTURE_PASSIVE);
      }
      tray.addEventListener('focusin', this.#onTrayFocusIn);
      tray.addEventListener('touchstart', this.#onTrayTouchStart, {
        passive: true
      });
      // Not passive: see `#onTrayTouchMove`.
      tray.addEventListener('touchmove', this.#onTrayTouchMove, {
        passive: false
      });
      tray.addEventListener('touchend', this.#onTrayTouchEnd);
      tray.addEventListener('touchcancel', this.#onTrayTouchEnd);
      this.#keyboardFill = new KeyboardFill({
        root,
        tray,
        glass: this.#glass,
        viewport: drawerEnvironment.visualViewport ? drawerEnvironment.visualViewport() : window.visualViewport ?? null,
        // Only a bottom drawer (a sheet) ends at the bottom of the screen
        // and has its background there; only while it shows.
        active: () => !this.#destroyed && this.placement === 'bottom' && !root.hasAttribute('data-closed'),
        keepsKeyboard: isEditable,
        contains: logicallyContains
      });
      this.#keyboardFill.sync();
      if (typeof ResizeObserver !== 'undefined') {
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(this.#content);
      }
    },
    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      if (placementChanged) this.#stopMomentum();
      this.#measure();
      // The axis may have changed.
      this.#syncScrollLock();
      if (this.#drag) {
        // The finger wins until it lets go; the release then picks a snap
        // point (and asks the parent, when controlled). A new placement is a
        // new axis, so that drag is over.
        if (!placementChanged) {
          this.#syncOpen();
          return;
        }
        const drag = this.#endDrag();
        // Not during rendering. The drawer jumps to the active snap point.
        queueMicrotask(() => {
          if (this.#destroyed) return;
          this.args.onDragEnd?.({
            snapPoint: this.activeSnapPoint,
            offset: drag.target,
            velocity: 0
          });
        });
      }
      // A new placement is a different layout: jump instead of animating
      // along the new axis from the old position.
      this.#moveToActive(!placementChanged);
      if (placementChanged) this.#keyboardFill?.sync();
    },
    destroy: () => {
      this.#destroyed = true;
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray?.removeEventListener(type, this.#onTrayInput, true);
      }
      tray?.removeEventListener('focusin', this.#onTrayFocusIn);
      tray?.removeEventListener('touchstart', this.#onTrayTouchStart);
      tray?.removeEventListener('touchmove', this.#onTrayTouchMove);
      tray?.removeEventListener('touchend', this.#onTrayTouchEnd);
      tray?.removeEventListener('touchcancel', this.#onTrayTouchEnd);
      this.#lockedTouch = undefined;
      this.#reveal = undefined;
      this.#keyboardFill?.destroy();
      this.#endHold();
      this.#cancelCatchUp(this.#drag);
      this.#endBackdropPointer();
      this.#resizeObserver?.disconnect();
      this.#spring?.stop();
      this.#stopScrollReset();
      this.#stopMomentum();
      this.#endSwallowClick();
      this.#syncScrollLock();
      this.onTrayScrollEnd();
      this.#root?.removeEventListener('keydown', this.#onKeyDown);
      this.#root?.removeEventListener('scroll', this.#onRootScroll);
      this.#root?.removeEventListener('focusout', this.#onRootFocusOut);
      this.#sheet?.removeEventListener('scroll', this.#onRootScroll);
      mountedDrawers.delete(this);
      if (this.#root) mountedRoots.delete(this.#root);
      MobileDrawer.#syncNested();
      trackInput(this, false);
      this.#focused = undefined;
      if (this.#root) {
        setPageProgress(this.#root, 0);
        unregisterDrawer(this.#root);
      }
      // Undone right away, so nothing outlives the drawer. Focus can only
      // move back once the drawer is gone from the DOM.
      const wasModal = this.#releaseModal !== undefined;
      this.#deactivateModal();
      this.#endStatusBar();
      this.#offLockChange?.();
      if (this.#open) {
        this.#open = false;
        const focusInside = this.#hasFocus();
        queueMicrotask(() => this.#returnFocusAfterClose(focusInside, wasModal));
      }
    }
  };
  /**
  * Measures the container and the tray, resolves the snap points and sizes
  * the tray so the largest snap point fits. Forces layout, so it only runs
  * on setup, argument changes and resizes, never per frame.
  *
  * Returns `false`, leaving the previous layout and inline sizes in place,
  * when the tray can't be measured (e.g. while hidden). The resize observer
  * measures again once the drawer gets a size.
  */
  #measure() {
    const tray = this.#tray;
    const vertical = this.placement === 'bottom' || this.placement === 'top';
    const size = vertical ? 'height' : 'width';
    const {
      style
    } = tray;
    const {
      height,
      width
    } = style;
    // The tray's natural size.
    style.height = '';
    style.width = '';
    const content = measureLength(tray, vertical);
    // The space the tray can open into: the root minus the opposite safe-area
    // inset, or the tray's own max size.
    style[size] = '100%';
    const available = measureLength(tray, vertical);
    if (!content || !available) {
      style.height = height;
      style.width = width;
      return false;
    }
    const {
      length: natural,
      extra
    } = content;
    const container = available.length;
    const resolved = resolveSnapPoints(this.snapPoints, {
      container,
      content: natural
    });
    const maxOffset = resolved[resolved.length - 1].offset;
    let trayLength = natural;
    if (maxOffset > natural) {
      // A snap point needs more than the content: grow the tray to it.
      style[size] = `${maxOffset - extra}px`;
      trayLength = maxOffset;
    } else {
      style[size] = '';
    }
    this.#layout = {
      resolved,
      container,
      trayLength,
      maxOffset
    };
    // The shadow and glass layers have the tray's length (bottom sheets
    // only).
    const layerHeight = this.placement === 'bottom' ? `${trayLength}px` : '';
    if (this.#shadow) this.#shadow.style.height = layerHeight;
    if (this.#glass) this.#glass.style.height = layerHeight;
    const open = resolved.filter(snapPoint => snapPoint.offset > 0).map(snapPoint => snapPoint.indices);
    if (JSON.stringify(open) !== JSON.stringify(this.openSnapPoints)) {
      this.#queueState({
        openSnapPoints: open
      });
    }
    return true;
  }
  #offsetOf(index) {
    const {
      resolved
    } = this.#layout;
    return (findSnapPoint(resolved, index) ?? resolved[0]).offset;
  }
  #progressOf(offset) {
    const {
      maxOffset
    } = this.#layout;
    return maxOffset > 0 ? clamp(offset / maxOffset, 0, 1) : 0;
  }
  /**
  * Moves (or jumps) to the active snap point. Does nothing while dragging:
  * the release moves to the active snap point.
  */
  #moveToActive(animate) {
    const spring = this.#spring;
    const index = this.activeSnapPoint;
    // Remember a controlled index, so dropping @activeSnapPoint keeps it.
    this.#uncontrolledSnapPoint = index;
    if (!spring || !this.#layout || this.#destroyed) return;
    this.#syncOpen();
    if (this.#drag) return;
    const target = this.#offsetOf(index);
    this.#queueState({
      progress: this.#progressOf(target)
    });
    spring.retarget(target);
    this.#markExpanded(target);
    if (!animate) {
      // A jump (setup, a new placement): the content starts where it starts
      // at the target, see `#scrollToStart`.
      spring.stop();
      spring.set(target, 0);
      this.#render(target);
      this.#scrollToStart(target);
      this.#queueState({
        isAnimating: false
      });
      return;
    }
    this.#planScrollReset(target);
    if (spring.isAnimating) return; // Retargeted; the run continues.
    void this.#startSpring(spring).then(() => {
      if (spring.isAnimating) return;
      this.#queueState({
        isAnimating: false
      });
      this.#revealFocus();
    });
    // With reduced motion the run ends synchronously.
    this.#queueState({
      isAnimating: spring.isAnimating
    });
    // Show the drawer now rather than at the first frame, so focus can move
    // into an opening drawer right away.
    if (spring.isAnimating) this.#setClosed(false);
  }
  /**
  * Sets `data-expanded` on the root when the drawer rests at, or is
  * animating to, its highest snap point (and that snap point is open at
  * all), from `target`: where the drawer is headed. Only called when the
  * target changes outside a drag, so the attribute keeps its value during
  * a drag and while a touch holds the drawer: small movements at the top
  * never flicker it, and a drag down from the top only removes it when it
  * is released towards a lower snap point. Unlike the scroll lock (see
  * `#syncScrollLock`), which follows the rendered position.
  */
  #markExpanded(target) {
    const {
      maxOffset
    } = this.#layout;
    const root = this.#root;
    const expanded = maxOffset > 0 && target >= maxOffset - EPSILON;
    if (root.hasAttribute('data-expanded') === expanded) return;
    root.toggleAttribute('data-expanded', expanded);
    // A theme may change the tray's colour with it, see `KeyboardFill`.
    this.#keyboardFill?.paint();
  }
  /**
  * Plans the scroll reset for a run to `target`: below the highest snap
  * point the tray of a vertical drawer goes back to its scroll start (the
  * content start at the leading edge: `scrollTop` 0 for a bottom drawer,
  * the end of the scroll range for a top drawer, whose leading edge is its
  * bottom), where the content can't be scrolled. At the highest snap point
  * the content starts at `scrollTop` 0 for every placement, so the tray
  * is put there when it opens from closed to the highest snap point; a
  * move up from a lower snap point keeps the position. Nothing changes
  * for left and right drawers, whose tray isn't sized by the snap point
  * along its scroll axis.
  *
  * The reset never jumps while the tray shows:
  * - towards closed (offset `0`), it waits until the tray is closed, when
  *   nothing of it shows, so a closing sheet keeps its content in place;
  * - when the tray is hidden (closed), at once;
  * - when the tray has at least as far to go as the content (`span >=
  *   distance`, up or down), in step with the tray in `#render`: the
  *   content reaches its start when the tray reaches the target and never
  *   moves faster than the tray, or back when the spring overshoots;
  * - otherwise (the tray is near its target, e.g. released just past it,
  *   or caught while closing and released below it), on a spring of its
  *   own with the drawer's spring settings, from rest: it eases in, so no
  *   frame moves the content far. A new plan while that spring runs (a
  *   resize, a new target) keeps its velocity instead of starting over.
  * With reduced motion both springs end at once, and so does the reset.
  *
  * Reads layout only here, so the render loop only writes. A drag or a
  * touch that holds the drawer stops the reset where it is; the release
  * plans a new one. A drag down from the top of a bottom drawer only
  * starts when the tray is at its scroll start anyway (see `shouldDrag`);
  * one with `@handleOnly` may start anywhere, and resets after its release.
  */
  #planScrollReset(target) {
    // A new plan while the reset's own spring runs (e.g. on each frame of
    // a resize) keeps its speed, so the reset doesn't start over from rest.
    const running = this.#scrollSpring?.isAnimating ? this.#scrollSpring : undefined;
    const velocity = running?.velocity ?? 0;
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    if (this.#isHighest(target)) {
      // Opening from closed: start at the content start. A move up from a
      // lower snap point keeps the position, so nothing jumps.
      if (this.#renderedOffset <= EPSILON) this.#scrollToStart(target);
      return;
    }
    const tray = this.#tray;
    const top = this.placement === 'top';
    const start = top ? Math.max(0, tray.scrollHeight - tray.clientHeight) : 0;
    let distance = Math.abs(tray.scrollTop - start);
    // The browser rounds scroll positions. Where the tray is still where
    // the running spring put it, go on from the spring's exact position:
    // otherwise a resize on every frame could keep the reset a pixel short.
    if (running && Math.abs(distance - running.value) < 1) {
      distance = running.value;
    }
    const open = this.#renderedOffset;
    const reset = {
      start,
      sign: top ? -1 : 1,
      distance,
      from: open,
      target,
      fraction: 1
    };
    if (distance <= EPSILON || open <= EPSILON) {
      // Nothing (much) to do, or nothing of the tray shows: at once.
      this.#writeScroll(reset, 0);
      return;
    }
    if (target <= EPSILON || Math.abs(open - target) >= distance) {
      this.#scrollReset = reset;
      return;
    }
    const scrollSpring = new Spring({
      ...this.#springConfig(),
      clock: this.#clock,
      prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
      onUpdate: ({
        value
      }) => this.#writeScroll(reset, clamp(value / distance, 0, 1))
    });
    this.#scrollSpring = scrollSpring;
    scrollSpring.set(distance, velocity);
    scrollSpring.retarget(0);
    void this.#startSpring(scrollSpring).then(() => {
      if (this.#scrollSpring === scrollSpring && !scrollSpring.isAnimating) {
        this.#scrollSpring = undefined;
      }
    });
  }
  /**
  * Moves the tray's scroll position along with the run in `#render`, for
  * a reset that follows the tray (see `#planScrollReset`).
  */
  #applyScrollReset(open) {
    const reset = this.#scrollReset;
    if (!reset) return;
    let fraction;
    if (reset.target <= EPSILON) {
      fraction = open <= EPSILON ? 0 : 1;
    } else {
      // At least `distance`, which is more than EPSILON, when planned.
      const span = Math.abs(reset.from - reset.target);
      fraction = clamp(Math.abs(open - reset.target) / span, 0, 1);
    }
    if (fraction >= reset.fraction) return;
    this.#writeScroll(reset, fraction);
    if (fraction === 0) this.#scrollReset = undefined;
  }
  /**
  * Scrolls the tray to `fraction` of the reset's distance from its scroll
  * start, without reading layout. `behavior: 'instant'`, so an app's
  * `scroll-behavior: smooth` doesn't turn each frame into a smooth scroll.
  */
  #writeScroll(reset, fraction) {
    reset.fraction = fraction;
    const top = reset.start + reset.sign * reset.distance * fraction;
    this.#tray.scrollTo({
      top,
      behavior: 'instant'
    });
  }
  /**
  * Starts a run of `spring` and registers it with the test waiter, so
  * `await settled()` waits until it ends (it comes to rest or is stopped).
  * Not with an injected clock: the addon's own tests then run the frames
  * themselves, and `settled()` would wait for frames that never come.
  */
  #startSpring(spring) {
    if (!spring.isAnimating) spring.configure(this.#springConfig());
    const run = spring.start();
    if (spring.isAnimating && !this.#clock) {
      const token = animationWaiter.beginAsync();
      void run.then(() => animationWaiter.endAsync(token));
    }
    return run;
  }
  /**
  * The spring parameters from `@spring`, with the defaults for the keys it
  * leaves out. Development builds assert that every value is valid;
  * production builds use the default instead of an invalid value.
  */
  #springConfig() {
    const {
      stiffness,
      damping,
      mass
    } = DEFAULT_SPRING_CONFIG;
    const config = {
      stiffness,
      damping,
      mass
    };
    const spring = this.args.spring;
    if (!spring) return config;
    for (const key of ['stiffness', 'damping', 'mass']) {
      const value = spring[key];
      if (value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        config[key] = value;
      } else {
        const shown = typeof value === 'number' ? String(value) : typeof value;
        assert(`<MobileDrawer>: @spring.${key} must be a finite number greater than 0, got ${shown}`);
      }
    }
    return config;
  }
  /** Stops a running scroll reset where it is. */
  #stopScrollReset() {
    this.#scrollReset = undefined;
    this.#scrollSpring?.stop();
    this.#scrollSpring = undefined;
  }
  /** Whether `offset` is the highest snap point (when it is open at all). */
  #isHighest(offset) {
    const {
      maxOffset
    } = this.#layout;
    return maxOffset > 0 && offset >= maxOffset - EPSILON;
  }
  /**
  * Scrolls the tray of a vertical drawer at once to where its content
  * starts at `target`: `scrollTop` 0 at the highest snap point (for every
  * placement: the content starts at the top there and is read from the
  * top down), and the scroll start below it (see `#planScrollReset`).
  */
  #scrollToStart(target) {
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    const tray = this.#tray;
    const top = this.placement === 'top' && !this.#isHighest(target) ? Math.max(0, tray.scrollHeight - tray.clientHeight) : 0;
    tray.scrollTo({
      top,
      behavior: 'instant'
    });
  }
  /**
  * Whether focus in the tray holds a resize's scroll reset: focus on an
  * editable element (see `isEditable`), or keyboard focus (focus after a
  * key press, see `focusInputOf`) on any element in it, which the browser
  * scrolled into view. Not the tray itself, which a modal drawer focuses
  * when it opens. Also inside an open shadow root in the tray.
  *
  * Keyboard focus that the drawer gave itself (the initial focus of a
  * modal drawer, see `#activateModal`) doesn't hold it: that focus doesn't
  * scroll, so the content end of a top drawer stays at its leading edge.
  * It holds it again when focus moves. An editable element always holds
  * it: an on-screen keyboard can open for it. A `readonly` text field
  * holds it like any other element: after a key press, not after a click
  * or a tap.
  */
  #focusHoldsReset() {
    const tray = this.#tray;
    let active = document.activeElement;
    if (active !== this.#initialFocused) this.#initialFocused = undefined;
    if (!active || active === tray || !tray.contains(active)) return false;
    const initial = active === this.#initialFocused;
    while (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (isEditable(active)) return true;
    if (initial) return false;
    return this.#inputOf(active) === 'keyboard';
  }
  /**
  * The input that focused `element`, which has focus: as read when it got
  * focus (see `#focused`), or now when the drawer didn't see that focus.
  */
  #inputOf(element) {
    const focused = this.#focused;
    return focused?.element === element ? focused.input : focusInputOf(element);
  }
  #onResize() {
    const spring = this.#spring;
    if (!spring || this.#destroyed || !this.#measure()) return;
    // While dragging or while a touch holds the drawer, it stays at the
    // offset shown (re-rendered for the new tray length) until the finger
    // moves or lifts.
    if (this.#drag || this.#hold) {
      this.#render(this.#drag?.offset ?? this.#renderedOffset);
      return;
    }
    this.#syncOpen();
    const target = this.#offsetOf(this.activeSnapPoint);
    this.#queueState({
      progress: this.#progressOf(target)
    });
    this.#markExpanded(target);
    // From where the tray and its content are now. Also keeps a top drawer's
    // content end at its leading edge below the top when the content changes.
    // Not while a field in the tray has focus, or an element has keyboard
    // focus: the browser may have scrolled it into view (e.g. above an
    // Android keyboard that resizes the page, or on Tab), and the reset
    // would move it out of view again. Other focused elements (e.g. a
    // tapped button) don't hold the reset.
    if (!this.#focusHoldsReset()) this.#planScrollReset(target);
    if (spring.isAnimating) {
      // Keep going from the current position to the new target.
      spring.retarget(target);
      this.#render(spring.value);
    } else {
      // Stay at the same snap point. This runs before the next paint, so the
      // drawer never shows at the old position with the new size.
      spring.retarget(target);
      spring.set(target, 0);
      this.#render(target);
    }
  }
  /**
  * Writes the tray transform and backdrop progress for `offset` (px open).
  * Runs every animation frame, so it only touches inline styles and never
  * tracked state.
  */
  #render(offset) {
    const layout = this.#layout;
    const root = this.#root;
    if (!layout || !root || this.#destroyed) return;
    // Never push the tray further than fully closed. While dragging, the
    // rubber-band may pull it off its open edge. Otherwise a fast spring can
    // overshoot, but never pulls the tray further off its edge than where
    // the finger left it.
    const max = this.#drag ? Infinity : layout.trayLength + this.#overshoot;
    let open = clamp(offset, 0, max);
    // A spring that bounces comes back below its target after it overshoots
    // it. At the highest snap point that would lock the content's scrolling
    // again for a moment (and make a touch drag instead of scroll), so once a
    // run towards the highest snap point gets there, the tray stays there
    // for the rest of the run. The undershoot is a fraction of a percent of
    // the move, so this doesn't show.
    const spring = this.#spring;
    if (this.#drag || !spring.isAnimating || layout.maxOffset <= 0 || Math.abs(spring.target - layout.maxOffset) > EPSILON) {
      this.#arrivedAtHighest = false;
    } else if (this.#arrivedAtHighest || open >= layout.maxOffset - EPSILON) {
      this.#arrivedAtHighest = true;
      open = Math.max(open, layout.maxOffset);
    }
    if (!this.#drag) {
      this.#overshoot = clamp(open - layout.trayLength, 0, this.#overshoot);
    }
    this.#renderedOffset = open;
    // Past the tray's length the tray stays at its edge; the content moves
    // on inside it (see `#renderBounce`).
    const distance = Math.max(0, layout.trayLength - open);
    const transform = {
      bottom: `translate3d(0, ${distance}px, 0)`,
      top: `translate3d(0, ${-distance}px, 0)`,
      left: `translate3d(${-distance}px, 0, 0)`,
      right: `translate3d(${distance}px, 0, 0)`
    }[this.placement];
    this.#tray.style.transform = transform;
    this.#paintShadow(transform, distance, this.#sinkOf(open));
    this.#renderBounce(Math.max(0, open - layout.trayLength));
    const atTop = open >= layout.maxOffset - EPSILON;
    this.#paintExpand(open, atTop);
    // A no-op while it keeps its value.
    root.toggleAttribute('data-at-highest', atTop && layout.maxOffset > 0);
    if (atTop !== this.#atTop) {
      this.#atTop = atTop;
      // The content's momentum is for the highest snap point only.
      if (!atTop) this.#stopMomentum();
      // Only while the tray is a drag source (not with @handleOnly).
      if (this.#tray.style.touchAction) {
        this.#tray.style.touchAction = this.trayTouchAction();
      }
      this.#syncScrollLock();
    }
    if (!this.#drag) this.#applyScrollReset(open);
    this.#backdropProgress = this.#progressOf(open);
    const smallest = layout.resolved[0].offset;
    this.#backdropBlocks = open > smallest;
    this.#paintBackdrop();
    // For themes whose bar colour follows the dim, see `#paintExpand`.
    this.#barTint?.style.setProperty('--mobile-drawer-progress', String(this.#backdropProgress));
    // For the page behind (`data-mobile-drawer-page`, see
    // `setPageProgress`): from the smallest snap point (0) to the largest
    // (1), for modal bottom drawers only. A non-modal drawer leaves the page
    // as it is, usable; and like on iOS, only a sheet from the bottom moves
    // the page back, not a top or side drawer.
    setPageProgress(root, this.isModal && this.placement === 'bottom' && layout.maxOffset > smallest ? clamp((open - smallest) / (layout.maxOffset - smallest), 0, 1) : 0);
    this.#setClosed(open <= 0 && !this.#spring.isAnimating && !this.#drag);
    // At rest without the modal behaviour (closed, or at a peek): no
    // transparent status bar until the drawer locks the page again.
    if (!this.#releaseModal && !this.#spring.isAnimating && !this.#drag) {
      this.#endStatusBar();
    }
  }
  /**
  * Sets or removes `data-closed` on the root and on the portals of the
  * yielded `Nested`, so a nested drawer rendered outside the tray hides
  * with this drawer, like one inside it.
  */
  #setClosed(closed) {
    const root = this.#root;
    const changed = root.hasAttribute('data-closed') !== closed;
    root.toggleAttribute('data-closed', closed);
    // The next open reads the inset again, see `#paintSink`.
    if (closed) this.#below = false;
    for (const portal of this.#portals) {
      portal.toggleAttribute('data-closed', closed);
    }
    // Shows or hides the sheet's colour below the root, see `KeyboardFill`.
    if (changed) this.#keyboardFill?.sync();
  }
  /**
  * Moves the shadow layer (`.mobile-drawer__shadow`, see styles.css) with
  * the tray: the same `transform` as the tray. Its body
  * (`.mobile-drawer__shadow-body`) gets the opposite transform, so it
  * stays at the sheet's bottom edge while the layer around it moves. Both
  * are transforms only, so a theme's shadow on them is not painted again
  * while the drawer moves. The glass layer (`.mobile-drawer__glass`, in
  * the sheet) gets the tray's `transform` too, so a theme's blur on it
  * stays under the tray. Only for bottom drawers: the layers are only
  * used for a floating bottom sheet.
  *
  * Below the lowest open snap point a floating sheet moves down as one
  * piece, see `#paintSink`; the shadow body moves with it.
  */
  #paintShadow(transform, distance, sink) {
    // Also for the other placements: that clears a move that a bottom
    // drawer left before its placement changed.
    const moved = this.#paintSink(sink);
    if (this.placement !== 'bottom') return;
    if (this.#glass) this.#glass.style.transform = transform;
    const shadow = this.#shadow;
    if (!shadow) return;
    shadow.style.transform = transform;
    if (this.#shadowBody) {
      this.#shadowBody.style.transform = `translate3d(0, ${moved - distance}px, 0)`;
    }
  }
  /**
  * Moves a floating bottom sheet down by `sink` px (see `#sinkOf`) with an
  * inline `translate`, and with it its clip (the bottom edge with a
  * theme's inset and bottom radius). The tray and the glass layer get the
  * opposite `translate`, so they stay where their `transform` puts them.
  * Transforms only, so a frame doesn't lay out or paint again. The
  * properties are only written when the value changes, so at and above
  * the lowest open snap point an inline `translate` of the app on the tray
  * stays. A sheet without an inset (`--mobile-drawer-inset: 0px`, the
  * default) doesn't move: its clip would cut the tray's top shadow. The
  * inset is read once when the drawer goes below the lowest open snap
  * point, and again after a close (a style read, no layout), so an inset
  * that the app or the theme changes (e.g. the iOS page scale) applies to
  * the next move. Returns the px the sheet is moved.
  */
  #paintSink(sink) {
    const below = sink > 0;
    if (below && !this.#below) this.#floats = this.#isFloating();
    this.#below = below;
    const value = below && this.#floats ? sink : 0;
    if (value === this.#moved) return value;
    this.#moved = value;
    const down = value > 0 ? `0px ${value}px` : '';
    const up = value > 0 ? `0px ${-value}px` : '';
    this.#sheet.style.translate = down;
    this.#tray.style.translate = up;
    if (this.#glass) this.#glass.style.translate = up;
    return value;
  }
  /** Whether the sheet floats: a `--mobile-drawer-inset` that isn't 0. */
  #isFloating() {
    const inset = getComputedStyle(this.#sheet).getPropertyValue('--mobile-drawer-inset').trim();
    return inset !== '' && parseFloat(inset) !== 0;
  }
  /**
  * How far (px) a bottom sheet moves down as one piece at `open` (px
  * open): the distance below the lowest open snap point, else 0. Below
  * that snap point the sheet's clip moves with the tray, as a native iOS
  * sheet does when it closes (#142); without it the bottom edge stays and
  * the visible sheet gets shorter until it is gone.
  */
  #sinkOf(open) {
    if (this.placement !== 'bottom' || !this.#layout) return 0;
    const lowest = this.#layout.resolved.find(snapPoint => snapPoint.offset > 0)?.offset ?? 0;
    return Math.max(0, lowest - open);
  }
  /**
  * Writes the expand progress for `open` (px open) as
  * `--mobile-drawer-expand-progress` on the sheet: `0` at or below the
  * second-highest snap point (or closed, for a drawer with one open snap
  * point), `1` at the highest snap point and past it, linear in between.
  * Themes move the sheet from its floating look to its full-height look
  * with it (see `--mobile-drawer-inset` in styles.css). Only the sheet gets
  * it, not the root: the property is registered as not inherited, and only
  * the tray takes it from the sheet, so the content isn't styled again on
  * every frame. The bar tint and, in `#paintBackdrop`, the backdrop and its
  * tint (all three empty elements) get it too, for a dim and bar colours
  * that follow it. Only written when it changes.
  */
  #paintExpand(open, atTop) {
    const {
      resolved,
      maxOffset
    } = this.#layout;
    const below = resolved.length > 1 ? resolved[resolved.length - 2].offset : 0;
    let progress = 0;
    if (atTop) {
      progress = maxOffset > 0 ? 1 : 0;
    } else if (maxOffset > below) {
      progress = clamp((open - below) / (maxOffset - below), 0, 1);
    }
    if (progress === this.#expandProgress) return;
    this.#expandProgress = progress;
    const value = String(progress);
    this.#sheet?.style.setProperty('--mobile-drawer-expand-progress', value);
    this.#barTint?.style.setProperty('--mobile-drawer-expand-progress', value);
    this.#shadow?.style.setProperty('--mobile-drawer-expand-progress', value);
    // A theme may change the tray's colour with it (e.g. the iOS theme's
    // glass that becomes opaque), see `KeyboardFill`.
    this.#keyboardFill?.paint();
  }
  /**
  * Moves the content `bounce` px past fully open, in the opening direction,
  * with an inline `translate` on `.mobile-drawer__content` (the individual
  * property, so it composes with an app `transform` there). The tray stays
  * at its edge and clips the content. Pinned elements (`PINNED_ATTRIBUTE`)
  * get the opposite `translate`, so they stay at the tray's edge; their own
  * inline `translate` is put back after the bounce. Runs every
  * frame; it only writes inline styles. While the content is moved it gets
  * `will-change: translate` (its own layer, so a frame doesn't paint it
  * again) and scrolling along the axis is locked (`#syncScrollLock`): the
  * moved content widens the scrollable overflow of a top or left tray for
  * the moment, and no scroll may start on top of the bounce.
  */
  #renderBounce(bounce) {
    const content = this.#content;
    if (!content) return;
    const bouncing = bounce > 0;
    const value = b => bouncing ? {
      bottom: `0px ${-b}px`,
      top: `0px ${b}px`,
      left: `${b}px 0px`,
      right: `${-b}px 0px`
    }[this.placement] : '';
    if (bouncing !== this.#bouncing) {
      this.#bouncing = bouncing;
      const {
        style
      } = content;
      if (bouncing) {
        this.#contentWillChange = {
          value: style.getPropertyValue('will-change'),
          priority: style.getPropertyPriority('will-change')
        };
        style.setProperty('will-change', 'translate');
        for (const element of content.querySelectorAll(`[${PINNED_ATTRIBUTE}]`)) {
          if (element.closest('.mobile-drawer__content') !== content) continue;
          this.#pinned.set(element, {
            value: element.style.getPropertyValue('translate'),
            priority: element.style.getPropertyPriority('translate')
          });
        }
      } else {
        const saved = this.#contentWillChange;
        style.setProperty('will-change', saved?.value ?? '', saved?.priority);
        this.#contentWillChange = undefined;
        for (const [element, saved] of this.#pinned) {
          element.style.setProperty('translate', saved.value, saved.priority);
        }
        this.#pinned.clear();
      }
      this.#syncScrollLock();
    }
    const translate = value(bounce);
    if (content.style.translate !== translate) {
      content.style.translate = translate;
    }
    if (bouncing) {
      const opposite = value(-bounce);
      for (const element of this.#pinned.keys()) {
        element.style.translate = opposite;
      }
    }
  }
  /**
  * Locks scrolling along the axis below the highest snap point, so the
  * content and the drag never fight there: the tray and the marked scroll
  * containers in it (`data-mobile-drawer-scroll`, not those of a nested
  * drawer) get an inline `overflow-y: hidden` (`overflow-x` for left and
  * right), which is removed again at the highest snap point. `hidden`
  * keeps them scroll containers, so their scroll position is kept. Also
  * with `@handleOnly`: the content only scrolls when the drawer is fully
  * open, so a handle never scrolls out of reach below the top.
  *
  * Inline styles rather than a CSS rule keyed on a state attribute: the
  * marked elements are the app's, and their `overflow` usually comes from
  * unlayered app CSS, which beats every rule in the drawer's cascade layer;
  * and it must follow the rendered position, also mid-drag. The previous
  * inline value is put back on unlock. Runs when `#atTop` flips, on
  * install, on argument changes and on teardown; a marked element added
  * while locked, or whose inline style the app rewrote, is locked when a
  * pointer goes down, a wheel turns or focus moves in it (`#onTrayInput`).
  * After a placement change during a drag, the lock follows the new
  * layout from the next frame.
  */
  #syncScrollLock() {
    const tray = this.#tray;
    if (!tray) return;
    const lock = !this.#destroyed && (!this.#atTop || this.#bouncing || this.#drag?.handoff === true);
    const property = this.axis === 'vertical' ? 'overflow-y' : 'overflow-x';
    this.#scrollLockProperty = lock ? property : undefined;
    for (const [element, saved] of this.#scrollLock) {
      if (!element.isConnected) {
        // Removed from the page: nothing to put back.
        this.#scrollLock.delete(element);
      } else if (!lock || saved.property !== property) {
        this.#unlockScroll(element);
      }
    }
    if (!lock) return;
    this.#lockScroll(tray);
    for (const element of tray.querySelectorAll(`[${SCROLL_ATTRIBUTE}]`)) {
      if (element.closest('.mobile-drawer__tray') === tray) {
        this.#lockScroll(element);
      }
    }
  }
  /**
  * Locks `element` with the current lock property, or locks it again if
  * the app has rewritten its inline style since: the app's value is then
  * the one to put back.
  */
  #lockScroll(element) {
    const property = this.#scrollLockProperty;
    if (!property) return;
    const {
      style
    } = element;
    const value = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property);
    if (value === 'hidden' && !priority && this.#scrollLock.has(element)) {
      return;
    }
    this.#scrollLock.set(element, {
      property,
      value,
      priority
    });
    style.setProperty(property, 'hidden');
  }
  /**
  * Puts back the inline value `element` had before it was locked, unless
  * the app has set a value of its own since, which is then kept.
  */
  #unlockScroll(element) {
    const saved = this.#scrollLock.get(element);
    if (!saved) return;
    this.#scrollLock.delete(element);
    const {
      style
    } = element;
    if (style.getPropertyValue(saved.property) === 'hidden' && !style.getPropertyPriority(saved.property)) {
      style.setProperty(saved.property, saved.value, saved.priority);
    }
  }
  /**
  * Writes the progress of the last render on the backdrop, if there is one:
  * `--mobile-drawer-progress` for its opacity (also on the backdrop tint,
  * for the iOS Safari 26 bar colour), and `pointer-events: none`
  * at or below the smallest snap point. So an invisible backdrop (e.g.
  * while the drawer closes, before `data-closed` hides it) never blocks the
  * page, and neither does the backdrop of a "peek" drawer (smallest snap
  * point above 0) resting at its peek.
  */
  #paintBackdrop() {
    const backdrop = this.#backdrop;
    if (!backdrop) return;
    const progress = String(this.#backdropProgress);
    const expand = String(Number.isNaN(this.#expandProgress) ? 0 : this.#expandProgress);
    for (const element of [backdrop, this.#backdropTint, this.#pageDim?.element]) {
      element?.style.setProperty('--mobile-drawer-progress', progress);
      element?.style.setProperty('--mobile-drawer-expand-progress', expand);
    }
    const pointerEvents = this.#backdropBlocks ? '' : 'none';
    if (backdrop.style.pointerEvents !== pointerEvents) {
      backdrop.style.pointerEvents = pointerEvents;
    }
  }
  /**
  * The backdrop is optional (`@backdrop`), so it registers itself. It is a
  * pointer convenience and deliberately not focusable or a button: a
  * keyboard closes the drawer with Escape or the app's own controls, so its
  * listeners are added here rather than with `{{on}}`.
  */
  backdropHooks = {
    install: backdrop => {
      this.#backdrop = backdrop;
      // Rendered in the same block, after the backdrop.
      const tint = backdrop.nextElementSibling;
      this.#backdropTint = tint instanceof HTMLElement && tint.classList.contains('mobile-drawer__backdrop-tint') ? tint : undefined;
      backdrop.addEventListener('pointerdown', this.onBackdropPointerDown);
      backdrop.addEventListener('click', this.onBackdropClick);
      this.#paintBackdrop();
    },
    update: () => {},
    destroy: () => {
      const backdrop = this.#backdrop;
      backdrop?.removeEventListener('pointerdown', this.onBackdropPointerDown);
      backdrop?.removeEventListener('click', this.onBackdropClick);
      this.#backdrop = undefined;
      this.#backdropTint = undefined;
      this.#pageDim?.destroy();
      this.#pageDim = undefined;
      this.#endBackdropPointer();
    }
  };
  /**
  * Starts tracking a pointer on the backdrop, to tell a tap from a drag
  * (or a scroll the browser took over) when its click arrives. Pointer
  * events of a touch stay on the backdrop (implicit capture), those of a
  * mouse don't, so movement is followed on the document.
  */
  onBackdropPointerDown = event => {
    if (!event.isPrimary) return;
    this.#endBackdropPointer();
    this.#backdropPointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
    document.addEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true,
      passive: true
    });
    document.addEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true
    });
    document.addEventListener('pointercancel', this.#onBackdropPointerCancel, {
      capture: true
    });
  };
  #onBackdropPointerMove = event => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#trackBackdropPointer(event.clientX, event.clientY);
    }
  };
  /** Marks the backdrop pointer as `moved` once it is at `x`/`y`. */
  #trackBackdropPointer(x, y) {
    const pointer = this.#backdropPointer;
    if (!pointer) return;
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    // NaN (no coordinates) doesn't count as moved.
    if (distance > TAP_SLOP) pointer.moved = true;
  }
  /**
  * The pointer lifted: stop following it, but keep it (with where it
  * lifted) for the click that may follow, which reads `moved`. A click
  * elsewhere (e.g. a mouse dragged onto the tray) never reaches the
  * backdrop; the record is then ignored by the next click, see
  * `onBackdropClick`.
  */
  #onBackdropPointerUp = event => {
    const pointer = this.#backdropPointer;
    if (pointer?.pointerId !== event.pointerId) return;
    this.#trackBackdropPointer(event.clientX, event.clientY);
    pointer.up = {
      x: event.clientX,
      y: event.clientY
    };
    this.#removeBackdropListeners();
  };
  /** The browser took the pointer over (e.g. to scroll): no click follows. */
  #onBackdropPointerCancel = event => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#endBackdropPointer();
    }
  };
  #removeBackdropListeners() {
    document.removeEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true
    });
    document.removeEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true
    });
    document.removeEventListener('pointercancel', this.#onBackdropPointerCancel, {
      capture: true
    });
  }
  #endBackdropPointer() {
    this.#removeBackdropListeners();
    this.#backdropPointer = undefined;
  }
  /**
  * Closes the drawer on a tap on the backdrop. A click whose pointer moved
  * past `TAP_SLOP` (a drag that happened to start on the backdrop) isn't a
  * tap. The click a pointer causes lands where it lifted; any other click,
  * e.g. one without a pointer (`element.click()`, assistive technology),
  * is a tap, also when an earlier pointer's click never reached the
  * backdrop.
  */
  onBackdropClick = event => {
    const pointer = this.#backdropPointer;
    const own = pointer?.up !== undefined && Math.hypot(event.clientX - pointer.up.x, event.clientY - pointer.up.y) <= CLICK_MATCH;
    this.#endBackdropPointer();
    if (!this.closeOnBackdropClick || this.#destroyed) return;
    if (own && pointer?.moved) return;
    this.close();
  };
  /**
  * Notes whether the active snap point is above the smallest one, and
  * queues `#applyOpen` for the modal behaviour and focus, which must not run
  * during rendering. Called whenever the target may have changed (and on
  * every argument change, which covers `@modal`).
  */
  #syncOpen() {
    const layout = this.#layout;
    if (!layout || this.#destroyed) return;
    const target = this.#offsetOf(this.activeSnapPoint);
    const open = target > layout.resolved[0].offset;
    const hidden = target <= 0;
    if (hidden !== this.#hidden) {
      this.#hidden = hidden;
      MobileDrawer.#syncNested();
      if (hidden) this.#closePortaled();
    }
    trackInput(this, !this.#hidden);
    if (!this.#hasReportBaseline) {
      // The first open state the drawer knows (on insertion, or once a
      // drawer inserted while hidden is measured) is not a change.
      this.#hasReportBaseline = true;
      this.#reportedOpen = open;
    }
    if (open && !this.#open) {
      this.#open = true;
      // Reopened before the close was applied: keep where focus came from.
      const reopened = this.#closedWithFocusInside !== undefined;
      this.#closedWithFocusInside = undefined;
      const active = document.activeElement;
      if ((active instanceof HTMLElement || active instanceof SVGElement) && active !== document.body && !this.#contains(active)) {
        this.#returnFocus = active;
        this.#returnFocusPath = this.#ancestorsOf(active);
      } else if (!reopened) {
        this.#returnFocus = undefined;
        this.#returnFocusPath = [];
      }
      this.#openedByFocus = this.#focusOpenPending;
      this.#focusOpenPending = false;
      // Focus is already inside: return it to where it came from into the
      // tray, e.g. on Escape.
      const from = this.#enteredFrom;
      if (this.#openedByFocus && from?.isConnected && !this.#contains(from)) {
        this.#returnFocus = from;
        this.#returnFocusPath = this.#ancestorsOf(from);
      }
    } else if (!open && this.#open) {
      this.#open = false;
      this.#openedByFocus = false;
      // Read now: a drawer that closes without animating is hidden (and
      // loses focus) before the microtask runs.
      this.#closedWithFocusInside = this.#hasFocus();
    }
    if (this.#applyQueued) return;
    this.#applyQueued = true;
    queueMicrotask(() => {
      this.#applyQueued = false;
      this.#applyOpen();
    });
  }
  /**
  * Turns the modal behaviour on or off to match `#open` and `@modal`, and
  * moves focus: into a modal drawer that opens, back to where it came from
  * when the drawer closes.
  */
  #applyOpen() {
    if (this.#destroyed) return;
    const insideClosed = this.#insideClosedDrawer();
    const modal = this.#open && this.isModal && !insideClosed && !this.#openedByFocus;
    const wasModal = this.#releaseModal !== undefined;
    if (modal && !wasModal) {
      this.#activateModal();
    } else if (!modal && wasModal) {
      this.#deactivateModal();
      if (insideClosed && this.#open) this.#moveFocusOutOfClosedDrawer();
    }
    // Before focus returns: an open modal drawer inside this one would keep
    // the element to return to inert.
    this.#applyNested();
    const focusInside = this.#closedWithFocusInside;
    if (focusInside !== undefined) {
      this.#closedWithFocusInside = undefined;
      this.#returnFocusAfterClose(focusInside, wasModal);
    }
    this.#reportOpen();
  }
  /**
  * Calls `@onOpen` or `@onClose` when `#open` differs from what was last
  * reported. Runs in `#applyOpen`, so a drawer that opens and closes again
  * before it runs reports neither.
  */
  #reportOpen() {
    const open = this.#open;
    if (open === this.#reportedOpen) return;
    this.#reportedOpen = open;
    const event = {
      snapPoint: this.activeSnapPoint
    };
    if (open) {
      this.args.onOpen?.(event);
    } else {
      this.args.onClose?.(event);
    }
  }
  #activateModal() {
    const root = this.#root;
    const tray = this.#tray;
    this.#makeOutsideInert();
    // The tray, with the portals of the drawers nested in it.
    const releaseScroll = lockBodyScroll(target => logicallyContains(tray, target), {
      fields: [tray, ...this.#portals],
      transparentStatusBar: this.args.transparentStatusBar === true && this.placement !== 'top'
    });
    this.#syncStatusBar();
    // Below the modal drawers inside this one (e.g. a peeking drawer that
    // opens under its open nested drawer, also one rendered outside the
    // tray with `Nested`): the nested drawer stays in front, so it keeps
    // Escape and the Tab wrap.
    const nested = modalStack.findIndex(other => logicallyContains(root, other.#root));
    modalStack.splice(nested === -1 ? modalStack.length : nested, 0, this);
    MobileDrawer.#syncNested();
    document.addEventListener('keydown', this.#onDocumentKeyDown);
    this.#releaseModal = () => {
      document.removeEventListener('keydown', this.#onDocumentKeyDown);
      modalStack.splice(modalStack.indexOf(this), 1);
      MobileDrawer.#syncNested();
      releaseScroll();
      // Not moving (e.g. a jump without animation): `#render` won't run
      // again to end it.
      if (!this.#spring?.isAnimating && !this.#drag) this.#endStatusBar();
      this.#releaseInert?.();
      this.#releaseInert = undefined;
    };
    this.modalActive = true;
    if (!this.#warnedLabel && !root.hasAttribute('aria-label') && !root.hasAttribute('aria-labelledby')) {
      this.#warnedLabel = true;
      warn('<MobileDrawer>: a modal drawer is a dialog and needs an accessible name. Add `aria-label` or `aria-labelledby` to <MobileDrawer>.', false, {
        id: 'ember-mobile-drawer.modal-label'
      });
    }
    if (!this.#hasFocus()) {
      // The drawer's own focus never moves it (see `#onTrayFocusIn`): the
      // app chose the snap point it opens at.
      this.#initialFocusing = true;
      try {
        const element = initialFocus(tray, tray);
        focusWithoutScrolling(element);
        if (document.activeElement === element) this.#initialFocused = element;
      } finally {
        this.#initialFocusing = false;
      }
    }
  }
  /**
  * `@transparentStatusBar` (#113): while the scroll lock is the one for a
  * transparent status bar (the first modal drawer decides, so a drawer
  * nested in it follows), the root gets `data-status-bar="transparent"`
  * (styles.css moves it 5px down and makes the backdrop transparent on
  * iOS), and a drawer with a backdrop gets the dim layer (`PageDim`). Both
  * stay until the drawer rests without the modal behaviour (closed, or at
  * a peek, see `#render`), so the dim also fades out while it closes. They
  * end at once when the lock changes to the fixed `<body>` (see
  * `onLockChange`). Not for top drawers, and not for an embedded drawer (a
  * root that isn't `position: fixed`).
  */
  #syncStatusBar() {
    const root = this.#root;
    if (this.#statusBar || !root || !transparentStatusBarLock() || this.placement === 'top' || getComputedStyle(root).position !== 'fixed') {
      return;
    }
    this.#statusBar = true;
    root.setAttribute('data-status-bar', 'transparent');
    if (this.#backdrop) {
      this.#pageDim = new PageDim(root);
      this.#paintBackdrop();
    }
  }
  /** Undoes `#syncStatusBar`. */
  #endStatusBar() {
    if (!this.#statusBar) return;
    this.#statusBar = false;
    this.#root?.removeAttribute('data-status-bar');
    this.#pageDim?.destroy();
    this.#pageDim = undefined;
  }
  /** Undoes `#activateModal`, if it is on. Leaves focus alone. */
  #deactivateModal() {
    const release = this.#releaseModal;
    if (!release) return;
    this.#releaseModal = undefined;
    this.#initialFocused = undefined;
    release();
    if (!this.#destroyed) this.modalActive = false;
  }
  /**
  * Where the yielded `Nested` renders by default: the parent element of
  * the root, or, when this drawer is inside the tray of another drawer
  * (also through a `Nested` of that drawer), the parent element of the
  * outermost such drawer. A transformed tray is the containing block of the
  * fixed drawers in it, so a nested drawer in the tray of any drawer
  * around this one would be clipped by that tray again.
  */
  #nestedDestination() {
    let root = this.#root;
    for (;;) {
      const inner = root;
      const outer = [...mountedDrawers].find(other => other.#root !== inner && !!other.#tray && logicallyContains(other.#tray, inner));
      const outerRoot = outer ? outer.#root : undefined;
      if (!outerRoot) break;
      root = outerRoot;
    }
    return root.parentElement ?? undefined;
  }
  /**
  * Called when this drawer starts to close (see `#hidden`): closes the
  * drawers in the portals of its `Nested` that show, like `close()`, so
  * they move away together with this drawer. A drawer inside the tray
  * moves with the tray; one in a portal would else stay on the screen
  * until this drawer has closed, and then disappear at once. In a
  * microtask: `close()` can call `@onSnapPointChange`, which must not run
  * during rendering. A controlled drawer whose parent doesn't take the new
  * index hides with this drawer (`data-closed` on the portal).
  */
  #closePortaled() {
    if (this.#portals.size === 0) return;
    queueMicrotask(() => {
      if (this.#destroyed || !this.#hidden) return;
      const root = this.#root;
      for (const other of mountedDrawers) {
        const otherRoot = other.#root;
        if (other === this || other.#hidden || !otherRoot || ![...this.#portals].some(portal => portal.contains(otherRoot)) || other.#closestDrawerRoot() !== root) {
          continue;
        }
        other.close();
      }
    });
  }
  /**
  * The root of the nearest drawer around this one, also through portals
  * (see `nesting.ts`).
  */
  #closestDrawerRoot() {
    for (let node = this.#root ? logicalParent(this.#root) : null; node; node = logicalParent(node)) {
      if (mountedRoots.has(node)) return node;
    }
    return undefined;
  }
  /**
  * Makes the page outside the drawer inert (see `inertOutside`), or
  * updates that: everything except the root and the portals of the drawers
  * nested in this one (see `nesting.ts`), which are a part of this drawer.
  * The new `inert` attributes are set before the old ones are released, so
  * an element that stays inert never loses it in between.
  */
  #makeOutsideInert() {
    const root = this.#root;
    const release = this.#releaseInert;
    this.#releaseInert = inertOutside(root, ...portalsOf(root));
    release?.();
  }
  /**
  * Called when a portal of the yielded `Nested` is added or removed:
  * updates what the open modal drawers make inert (a portal can be added
  * in an element that is inert already), `data-nested`, and the open state
  * of the drawers nested in the drawers. In a microtask: portals are added
  * and removed during rendering, where the open state must not change.
  */
  static #portalsChanged() {
    if (MobileDrawer.#portalsQueued) return;
    MobileDrawer.#portalsQueued = true;
    queueMicrotask(() => {
      MobileDrawer.#portalsQueued = false;
      MobileDrawer.#applyPortals();
    });
  }
  static #portalsQueued = false;
  static #applyPortals() {
    for (const drawer of modalStack) {
      if (drawer.#releaseInert) drawer.#makeOutsideInert();
    }
    MobileDrawer.#syncNested();
    for (const drawer of mountedDrawers) {
      if (drawer.#portals.size > 0) drawer.#applyNested();
    }
  }
  /**
  * Whether `node` is inside the drawer: in its DOM, or in a portal of a
  * drawer nested in it (see `nesting.ts`).
  */
  #contains(node) {
    const root = this.#root;
    return !!root && logicallyContains(root, node);
  }
  /** Whether focus is inside the drawer. */
  #hasFocus() {
    return this.#contains(document.activeElement);
  }
  /**
  * Focuses the element that had focus when the drawer opened again, if
  * focus was inside the drawer when it closed (or, for a modal drawer, was
  * dropped onto `<body>`). Runs after the modal behaviour was undone, so the
  * element is no longer inert.
  *
  * If that element has left the page (e.g. the drawer deleted the list item
  * it was opened from), focus goes to the first tabbable element in the
  * nearest of its former ancestors that is still on the page, outside the
  * drawer, but never all the way up to `<body>`: focus then stays where the
  * browser put it.
  */
  #returnFocusAfterClose(focusInside, wasModal) {
    const target = this.#returnFocus;
    const path = this.#returnFocusPath;
    this.#returnFocus = undefined;
    this.#returnFocusPath = [];
    if (!target) return;
    const active = document.activeElement;
    const dropped = !active || active === document.body;
    if (!(focusInside || this.#hasFocus() || wasModal && dropped)) return;
    if (target.isConnected) {
      target.focus();
      return;
    }
    const root = this.#root;
    const ancestor = path.find(element => element.isConnected);
    if (!ancestor) return;
    tabbables(ancestor).find(element => !(root && logicallyContains(root, element)))?.focus();
  }
  /**
  * The ancestors of `element` from its parent up to (not including)
  * `<body>`, for the fallback in `#returnFocusAfterClose`.
  */
  #ancestorsOf(element) {
    const path = [];
    for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      path.push(node);
    }
    return path;
  }
  /**
  * Whether the drawer is inside another drawer that is closed or closing,
  * whose `data-closed` hides it (or soon will): its modal behaviour is then
  * off, so it never keeps the page inert and locked from inside a hidden
  * drawer. It comes back when that drawer opens again. A drawer that rests
  * at a peek (a smallest snap point above 0) is visible, so it does not
  * count, see `#hidden`.
  */
  #insideClosedDrawer() {
    const root = this.#root;
    return !!root && this.#hiddenByDrawer(root);
  }
  /**
  * Whether `element` is inside a drawer (other than this one) that is
  * closed or closing, see `#hidden`.
  */
  #hiddenByDrawer(element) {
    for (const other of mountedDrawers) {
      if (other !== this && other.#hidden && other.#contains(element)) {
        return true;
      }
    }
    return false;
  }
  /**
  * Called when the modal behaviour turns off because a drawer around this
  * one closes, while this drawer stays open. If focus is inside this
  * drawer, which is now hidden (or soon will be), it moves to the element
  * this drawer was opened from, if that is still on the page and not
  * hidden too. Else focus leaves the drawer for `<body>`: the drawer
  * around this one returns it from there if it was open (see
  * `#returnFocusAfterClose`). `#returnFocus` is kept, for when this drawer
  * closes after the drawer around it opens again.
  */
  #moveFocusOutOfClosedDrawer() {
    if (!this.#hasFocus()) return;
    const target = this.#returnFocus;
    if (target?.isConnected && !this.#hiddenByDrawer(target)) {
      target.focus();
      if (!this.#hasFocus()) return;
    }
    document.activeElement?.blur();
  }
  /**
  * Sets `data-nested` on the root of every drawer that the front modal
  * drawer (the last one in `modalStack`) covers, and removes it from the
  * others: every drawer that shows (not closed or closing, see `#hidden`)
  * except the front one and the drawers inside it, which are in front of
  * it. Themes dim a covered sheet with it. Runs when the modal stack
  * changes, when a drawer starts to show or hide, and when a drawer is
  * inserted or removed.
  */
  static #syncNested() {
    const front = modalStack[modalStack.length - 1];
    const frontRoot = front ? front.#root : undefined;
    for (const drawer of mountedDrawers) {
      const root = drawer.#root;
      if (!root) continue;
      root.toggleAttribute('data-nested', !!frontRoot && drawer !== front && !drawer.#hidden && !logicallyContains(frontRoot, root));
    }
  }
  /** Re-applies the open state of the drawers inside this one. */
  #applyNested() {
    const root = this.#root;
    if (!root) return;
    for (const other of mountedDrawers) {
      if (other !== this && other.#root && logicallyContains(root, other.#root)) {
        other.#applyOpen();
      }
    }
  }
  /**
  * Escape closes an open drawer while focus is inside it, modal or not.
  * Events another handler already took care of (`preventDefault`) are left
  * alone, so of nested drawers only the innermost one closes. Ignored while
  * the drawer is dragged: the release decides where it goes, so the parent
  * never sees a close and a reopen.
  */
  #onKeyDown = event => {
    // A key (e.g. one that scrolls) stops the content's momentum.
    this.#stopMomentum();
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !this.#open || this.#drag || this.#destroyed) {
      return;
    }
    event.preventDefault();
    this.close();
  };
  /**
  * While modal, for the topmost modal drawer only: Escape closes the drawer
  * also when focus is outside it (e.g. on `<body>` after a click on the
  * backdrop), and Tab and Shift+Tab wrap around inside the tray.
  */
  #onDocumentKeyDown = event => {
    if (event.defaultPrevented || modalStack[modalStack.length - 1] !== this || this.#destroyed) {
      return;
    }
    if (event.key === 'Escape') {
      // Not during a drag: the release decides where the drawer goes.
      if (event.isComposing || !this.#open || this.#drag) return;
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      this.#trapTab(event);
    }
  };
  /**
  * Keeps Tab inside the tray: from the last tabbable element (or from
  * outside the tray) it moves to the first, Shift+Tab the other way round.
  * In between the browser moves focus as usual; the rest of the page is
  * inert, so focus can't leave the drawer.
  */
  #trapTab(event) {
    const tray = this.#tray;
    const items = tabbables(tray);
    const active = document.activeElement;
    const inside = !!active && tray.contains(active);
    const first = items[0];
    const last = items[items.length - 1];
    // Whether a tabbable element comes after (or before) the focused one,
    // also when that isn't tabbable itself (e.g. a focused `tabindex="-1"`
    // status message after the last button).
    const any = position => !!active && items.some(item => active.compareDocumentPosition(item) & position);
    let next;
    if (!first || !last) {
      next = tray;
    } else if (event.shiftKey) {
      if (!inside || active === tray || !any(Node.DOCUMENT_POSITION_PRECEDING)) {
        next = last;
      }
    } else if (!inside || !any(Node.DOCUMENT_POSITION_FOLLOWING)) {
      next = first;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
  /**
  * Screen px per px of drawer offset along the axis: `1`, unless an
  * ancestor is scaled (e.g. a scaled preview). Pointer coordinates are in
  * screen px, offsets in the drawer's own px, so this keeps the drawer under
  * the finger. Measured once per drag; it forces layout.
  */
  #screenScale() {
    const layout = this.#layout;
    const rect = this.#tray.getBoundingClientRect();
    const scale = (this.axis === 'vertical' ? rect.height : rect.width) / layout.trayLength;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
  /** The pointer coordinate along the drawer axis. */
  #positionOf(data) {
    const position = this.axis === 'vertical' ? data.current.y : data.current.x;
    return Number.isFinite(position) ? position : undefined;
  }
  /**
  * The time of `event` in ms, for the release velocity: the event's own
  * time stamp, which is when the input happened even if the main thread was
  * busy. With an injected clock (tests) the clock's time instead, since
  * event time stamps can't be set.
  */
  #timeOf(event) {
    const {
      dragTime
    } = drawerEnvironment;
    if (dragTime) return dragTime();
    if (this.#clock) return this.#clock.now();
    return event?.timeStamp ?? performance.now();
  }
  /**
  * Where the drag puts the drawer after the finger moved `delta` px (in
  * drawer px, positive opens) since the drag started: 1:1 inside the snap
  * range and back towards it, rubber-banded outside it (stiff past fully
  * open like an iOS sheet's content, see `OPEN_RUBBER_BAND_RATIO`). See
  * `dragOffset`.
  */
  #dragOffset(drag, delta) {
    const {
      resolved,
      container,
      trayLength
    } = this.#layout;
    return dragOffset(drag.startOffset, delta, resolved[0].offset, resolved[resolved.length - 1].offset, {
      below: {
        dimension: container
      },
      above: {
        dimension: trayLength * OPEN_RUBBER_BAND_RATIO
      }
    });
  }
  /**
  * The tray's `touch-action`. Below the highest snap point every gesture
  * along the axis drags, so the browser may only pan across it. At the
  * highest snap point the content may scroll along the axis too; gestures
  * that drag cancel their `touchmove` events instead. Read when a touch
  * starts, so it is kept up to date in `#render`.
  */
  trayTouchAction = () => {
    if (this.#atTop) return 'pan-x pan-y';
    return this.axis === 'vertical' ? 'pan-x' : 'pan-y';
  };
  /**
  * Decides whether a gesture on the tray drags the drawer or scrolls (see
  * the class docs). A gesture that starts on a handle always drags, one
  * that starts in a nested drawer never does. Called once per gesture,
  * after a touch on a moving drawer has held it.
  */
  shouldDrag = (movement, target) => {
    const layout = this.#layout;
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    if (!layout || !tray) return true;
    if (this.#renderedOffset < layout.maxOffset - EPSILON) return true;
    if (this.#onHandle(target)) return true;
    return !this.#scrollChain(target).some(element => canScroll(element, this.axis === 'vertical', movement));
  };
  /**
  * The scroll containers that take part in a gesture that starts at
  * `target`: the marked ones (`data-mobile-drawer-scroll`) between it and
  * the tray, innermost first, and the tray.
  */
  #scrollChain(target) {
    const tray = this.#tray;
    if (!tray) return [];
    const chain = [];
    for (let element = target instanceof Element ? target : tray; element && tray.contains(element); element = element.parentElement) {
      if (element instanceof HTMLElement && (element === tray || element.hasAttribute(SCROLL_ATTRIBUTE))) {
        chain.push(element);
      }
      if (element === tray) break;
    }
    return chain;
  }
  /**
  * The tray's `onScroll`, for every `touchmove` of a gesture that scrolls
  * the content (see `dragSource`): whether a drag takes it over, the scroll
  * handoff of a native sheet. That is when the finger moves `step` px
  * towards close and no scroll container of the gesture (see
  * `#scrollChain`) can scroll that way any more: the content is at its
  * scroll start (for a bottom drawer). The drag then follows the finger
  * from where it is. Only while the finger is down: momentum that carries
  * the content to its start after the finger lifted doesn't move the
  * drawer. Not for a gesture in a nested drawer.
  *
  * Before that, so the content doesn't bounce at its start (iOS) and then
  * jump back when the drag locks it, the scroll containers of the gesture
  * that are nearer the end a pull towards close scrolls to than the other
  * end get `overscroll-behavior: none` along the axis, see `#setOverscroll`.
  */
  onTrayScroll = (step, target) => {
    const layout = this.#layout;
    if (!layout || this.#destroyed || this.#drag || this.#inNested(target)) {
      return false;
    }
    const vertical = this.axis === 'vertical';
    // The finger moving this way closes the drawer.
    const closing = -OPENING_DIRECTION[this.placement];
    const chain = this.#scrollChain(target);
    for (const element of chain) {
      this.#setOverscroll(element, nearEnd(element, vertical, closing));
    }
    if (Math.sign(step) !== closing || !this.#isHighest(this.#renderedOffset)) {
      return false;
    }
    return !chain.some(element => canScroll(element, vertical, step));
  };
  /** The tray's `onScrollEnd`: puts back the overscroll behaviour. */
  onTrayScrollEnd = () => {
    for (const element of [...this.#overscroll.keys()]) {
      this.#setOverscroll(element, false);
    }
  };
  /**
  * Sets (`none`) an inline `overscroll-behavior-y` (`-x` for left and
  * right) on `element`, or puts back the inline value it had before. iOS
  * applies a change during a scroll.
  */
  #setOverscroll(element, none) {
    const property = this.axis === 'vertical' ? 'overscroll-behavior-y' : 'overscroll-behavior-x';
    const {
      style
    } = element;
    const saved = this.#overscroll.get(element);
    if (none) {
      if (saved && saved.property === property) return;
      if (saved) this.#setOverscroll(element, false);
      this.#overscroll.set(element, {
        property,
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property)
      });
      style.setProperty(property, 'none');
    } else if (saved) {
      this.#overscroll.delete(element);
      style.setProperty(saved.property, saved.value, saved.priority);
    }
  }
  /**
  * Whether `target` is in one of this drawer's handles (not a nested
  * drawer's). A gesture that starts there always drags. A text field in a
  * handle (see `isTextField`) is not part of it, so text selection in it
  * keeps working: without `@handleOnly` a gesture there follows the rules
  * of the rest of the tray, with it a gesture there doesn't drag.
  */
  #onHandle(target) {
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    for (let element = target; element && element !== tray && tray?.contains(element); element = element.parentElement) {
      if (isTextField(element)) return false;
      if (this.#handles.has(element)) return true;
    }
    return false;
  }
  /**
  * The handles' `shouldDrag`: a gesture on a handle drags (see
  * `#onHandle`). With it the handle's drag source also cancels the
  * touchmoves of a drag, so the browser can't scroll the tray under it,
  * also with `@handleOnly`, where the tray isn't a drag source.
  */
  shouldHandleDrag = (_movement, target) => this.#onHandle(target);
  /**
  * Whether `target` is in a drawer nested in this one (in its tray, a
  * handle or its backdrop): its gestures belong to that drawer only, see
  * the class docs.
  */
  #inNested(target) {
    const root = this.#root;
    if (!root || !(target instanceof Element) || !root.contains(target)) {
      return false;
    }
    // The root of a mounted drawer, not any element with the
    // `mobile-drawer` class (e.g. an app element that reuses it). A drawer
    // nested with `Nested` is not in this drawer's DOM: its events never get
    // here.
    for (let element = target; element && element !== root; element = element.parentElement) {
      if (mountedRoots.has(element)) return true;
    }
    return false;
  }
  onHandleInstall = element => {
    this.#handles.add(element);
  };
  onHandleTeardown = element => {
    this.#handles.delete(element);
    this.onDragSourceTeardown(element);
  };
  /**
  * A touch on a drag source holds a running animation right away, like
  * native sheets, instead of only once a pan is recognised (past didPan's
  * threshold). If no drag starts, lifting the finger resumes the animation,
  * so taps on content keep working. Not a touch in a nested drawer (see
  * `#inNested`).
  */
  onPointerDown = event => {
    const spring = this.#spring;
    if (!spring?.isAnimating || this.#drag || this.#hold || this.#destroyed || this.#inNested(event.target)) {
      return;
    }
    spring.stop();
    this.#stopScrollReset();
    const end = up => {
      if (up.pointerId !== event.pointerId) return;
      this.#endHold();
      this.#moveToActive(true);
    };
    this.#hold = {
      pointerId: event.pointerId,
      end
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  };
  /**
  * While scrolling is locked, locks the marked scroll containers around
  * the target of a `pointerdown`, `wheel` or `focusin` on the tray before
  * the browser scrolls them: those added after the lock, and those whose
  * inline style the app has rewritten since (see `#lockScroll`). Listens
  * on the tray itself, so it works with `@handleOnly` and any pointer type.
  */
  #onTrayInput = event => {
    // A new touch, a wheel or focus stops the content's momentum, as in a
    // native scroll view.
    this.#stopMomentumOnInput(event);
    const tray = this.#tray;
    const {
      target
    } = event;
    if (!tray || !this.#scrollLockProperty || !(target instanceof Element)) {
      return;
    }
    this.#lockScroll(tray);
    for (let element = target; element && element !== tray && tray.contains(element); element = element.parentElement) {
      if (element instanceof HTMLElement && element.hasAttribute(SCROLL_ATTRIBUTE) && element.closest('.mobile-drawer__tray') === tray) {
        this.#lockScroll(element);
      }
    }
  };
  /**
  * Keyboard focus on an element in the tray that isn't fully visible at
  * the active snap point moves a visible drawer below its highest snap
  * point to its highest snap point, like `open`: uncontrolled it moves
  * there, controlled it asks the parent through `@onSnapPointChange`, as
  * after a drag. Below the highest snap point the content can't scroll
  * along the axis, so this is the only way to show it. Modal or not: the
  * focused element is hidden either way. Also at a peek (a smallest snap
  * point above `0`), where Tab reaches the content from the page: the
  * drawer then opens, so `@onOpen` is called, but it doesn't become modal
  * (see `#openedByFocus`): Tab goes on through the drawer and out to the
  * page, and the drawer goes back to its peek when focus leaves it (see
  * `#onRootFocusOut`). Not while the drawer closes to `0`. When the drawer arrives, the tray scrolls the
  * element into view if the browser didn't (see `#revealFocus`).
  *
  * Only keyboard focus (focus after a key press, see `focusInputOf`, also
  * programmatic focus after a key press, such as the Tab wrap): a tap
  * focuses what is under the finger, which shows. Not the initial focus of
  * a modal drawer (see `#activateModal`): the drawer moves focus in itself,
  * and the app chose the snap point it opens (or is inserted) at, so that
  * one is kept. Also any focus on a field the user types in (see
  * `isTypingField`): a tap on a text field that is only partly visible
  * moves the drawer too, which shows the field above an on-screen keyboard.
  * Not a tap on a `readonly` text field, which opens no keyboard. Not
  * during a drag or while a touch holds the drawer, and not for the tray
  * itself or for the content of a drawer nested in this one, whose own tray
  * handles it.
  *
  * Visibility is checked where the element will be once the drawer rests
  * at its active snap point, not where it is now: a drawer that is still
  * on its way there (e.g. one that opens) must not move for an element
  * that will show. Visible means inside both the tray and the root (the space
  * the tray opens into), along the axis.
  */
  #onTrayFocusIn = event => {
    const tray = this.#tray;
    const {
      target,
      relatedTarget: from
    } = event;
    // The focused element itself, also inside an open shadow root.
    const element = event.composedPath()[0];
    if (element instanceof Element) {
      this.#focused = {
        element,
        input: focusInputOf(element)
      };
    }
    if ((from instanceof HTMLElement || from instanceof SVGElement) && !this.#contains(from)) {
      this.#enteredFrom = from;
    }
    if (!tray || !this.#layout || this.#destroyed || this.#drag || this.#hold || this.#hidden || this.#initialFocusing || target === tray || !(target instanceof Element) || target.closest('.mobile-drawer__tray') !== tray) {
      return;
    }
    if (!(element instanceof Element) || this.#inputOf(element) !== 'keyboard' && !isTypingField(element)) {
      return;
    }
    const offset = this.#offsetOf(this.activeSnapPoint);
    if (this.#isHighest(offset) || this.#isVisibleAt(element, offset)) return;
    this.#reveal = element;
    // Not during rendering (an app may focus an element as it renders).
    queueMicrotask(() => {
      if (this.#destroyed || this.#reveal !== element || this.#drag || this.#hidden || this.#isHighest(this.#offsetOf(this.activeSnapPoint))) {
        return;
      }
      this.#resetRootScroll();
      if (!this.#open) {
        // From the peek: the drawer opens, but not as a modal dialog. A
        // controlled parent that doesn't take the new index in this task
        // doesn't get a drawer that is not modal later.
        this.#focusOpenPending = true;
        setTimeout(() => this.#focusOpenPending = false);
      }
      this.open();
    });
  };
  /**
  * A drawer that keyboard focus opened from its peek (see
  * `#openedByFocus`) goes back to its peek when focus moves to an element
  * outside it, e.g. Tab past its last element: like a peek that only shows
  * what has focus. Not when focus goes nowhere (`relatedTarget` `null`,
  * e.g. the window loses focus or a click on something that can't take
  * focus), nor during a drag. Like `close`, so through
  * `@onSnapPointChange` when controlled. Also forgets the initial focus of
  * a modal drawer when focus moves on from it (see `#focusHoldsReset`).
  */
  #onRootFocusOut = event => {
    const to = event.relatedTarget;
    // Focus moved on from the modal drawer's initial focus (not only the
    // window that lost focus), see `#focusHoldsReset`.
    if (to && event.target === this.#initialFocused) {
      this.#initialFocused = undefined;
    }
    if (!this.#openedByFocus || !this.#open || this.#destroyed || this.#drag || !(to instanceof Node) || this.#contains(to)) {
      return;
    }
    queueMicrotask(() => {
      if (this.#openedByFocus && this.#open && !this.#destroyed && !this.#drag && !this.#hasFocus()) {
        this.close();
      }
    });
  };
  /**
  * Scrolls the sheet and the root back to their start. Both are
  * `overflow: hidden` and never meant to scroll, but a browser that scrolls
  * a focused element into view scrolls them too: below the highest snap
  * point part of the tray is outside the sheet, so the browser moves the
  * tray up in the sheet to show the element, and the tray leaves its
  * edge, while the drawer stays at its snap point. The sheet takes that
  * scroll, so it doesn't go on to the page behind. (The root only scrolls
  * if something else in it overflows.) Called before a move for keyboard
  * focus (Chrome scrolls before the focus events), and on every `scroll`
  * of the sheet or the root (`#onRootScroll`), for browsers that scroll
  * after them and for focus that doesn't move the drawer (a tap on a
  * partly visible button, a peek of a drawer whose parent declines the
  * move).
  */
  #resetRootScroll() {
    for (const element of [this.#sheet, this.#root]) {
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
        element.scrollTo({
          top: 0,
          left: 0,
          behavior: 'instant'
        });
      }
    }
  }
  #onRootScroll = () => {
    if (!this.#destroyed) this.#resetRootScroll();
  };
  /**
  * The part of the root that the tray covers along the axis, in screen px,
  * with the tray moved by `shift` px from where it is rendered: where the
  * content can show. The sheet clips the tray too: a floating sheet (see
  * `--mobile-drawer-inset`) ends above the root's bottom edge. A scroll of
  * the root moves the sheet; that is undone, like `shift` undoes it for
  * the tray (see `#isVisibleAt`). `sheetShift` moves the sheet the same
  * way (a bottom sheet below its lowest open snap point, see `#sinkOf`).
  */
  #visibleRange(shift, sheetShift = 0) {
    const vertical = this.axis === 'vertical';
    const tray = this.#tray.getBoundingClientRect();
    const root = this.#root;
    const rootRect = root.getBoundingClientRect();
    const sheet = this.#sheet.getBoundingClientRect();
    const scroll = vertical ? root.scrollTop : root.scrollLeft;
    const unscroll = (scroll ? scroll * this.#screenScale() : 0) + sheetShift;
    return {
      start: Math.max((vertical ? tray.top : tray.left) + shift, vertical ? rootRect.top : rootRect.left, (vertical ? sheet.top : sheet.left) + unscroll),
      end: Math.min((vertical ? tray.bottom : tray.right) + shift, vertical ? rootRect.bottom : rootRect.right, (vertical ? sheet.bottom : sheet.right) + unscroll)
    };
  }
  /**
  * Whether `element` is fully inside the visible part of the tray along
  * the axis (see `#visibleRange`) once the drawer is at `offset` (px open).
  * Forces layout, so only for focus changes.
  */
  #isVisibleAt(element, offset) {
    const root = this.#root;
    const sheet = this.#sheet;
    const vertical = this.axis === 'vertical';
    // Also undoes a scroll of the sheet or the root (see
    // `#resetRootScroll`), which moves the tray and the element alike, but
    // not the root.
    const shift = (OPENING_DIRECTION[this.placement] * (offset - this.#renderedOffset) + (vertical ? root.scrollTop + sheet.scrollTop : root.scrollLeft + sheet.scrollLeft)) * this.#screenScale();
    const sheetShift = ((this.#isFloating() ? this.#sinkOf(offset) : 0) - this.#moved) * this.#screenScale();
    const visible = this.#visibleRange(shift, sheetShift);
    const rect = element.getBoundingClientRect();
    const start = (vertical ? rect.top : rect.left) + shift;
    const end = (vertical ? rect.bottom : rect.right) + shift;
    return start >= visible.start - EPSILON && end <= visible.end + EPSILON;
  }
  /**
  * Called when a run of the spring ends. If keyboard focus moved the drawer
  * to its highest snap point (see `#onTrayFocusIn`), the drawer rests there
  * and the element still has focus, scrolls the tray of a vertical drawer
  * so the element shows: below the highest snap point the tray was locked,
  * and the browser may not have scrolled it (e.g. focus that came with
  * `preventScroll`, such as the initial focus of a modal drawer). Only the
  * tray scrolls, not the page. Left and right drawers scroll across their
  * axis, which isn't locked, so the browser already did.
  */
  #revealFocus() {
    const element = this.#reveal;
    this.#reveal = undefined;
    const tray = this.#tray;
    if (!element || !tray || !this.#layout || this.#destroyed || this.#drag || this.axis !== 'vertical' || !this.#isHighest(this.#renderedOffset)) {
      return;
    }
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (active !== element) return;
    const visible = this.#visibleRange(0);
    const rect = element.getBoundingClientRect();
    // Show the element's end if it is below, but its start first of all.
    let delta = Math.max(0, rect.bottom - visible.end);
    delta = Math.min(delta, rect.top - visible.start);
    if (Math.abs(delta) <= EPSILON) return;
    tray.scrollBy({
      top: delta / this.#screenScale(),
      behavior: 'instant'
    });
  }
  #onTrayTouchStart = event => {
    this.#stopMomentumOnInput(event);
    const current = this.#lockedTouch;
    // A gesture whose touch is gone ended without its touchend reaching the
    // tray (e.g. its element was removed): start over.
    if (current && Array.from(event.touches).some(touch => touch.identifier === current.id)) {
      return;
    }
    this.#lockedTouch = undefined;
    const touch = event.changedTouches[0];
    if (!touch || !this.handleOnly || !this.#scrollLockProperty) return;
    this.#lockedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      far: false
    };
  };
  /**
  * With `@handleOnly` below the highest snap point, the content can't
  * scroll along the axis, and the content isn't a drag source, so nothing
  * else would cancel a swipe along the axis: iOS then skips the locked tray
  * and scrolls the page behind it, whatever `overscroll-behavior` says.
  * So such a swipe has its touchmoves cancelled, decided as in
  * `dragSource`: once the finger has moved `DECISION_SLOP` px along the
  * axis and further along it than across it, and released to the browser
  * if it turns sideways before it has moved `TAP_SLOP` px along the axis.
  * It never drags the drawer. Swipes across the axis (a carousel, a side
  * drawer's list) are left alone. Without `@handleOnly`, `dragSource` does
  * this as part of dragging.
  */
  #onTrayTouchMove = event => {
    const gesture = this.#lockedTouch;
    if (!gesture) return;
    const touch = Array.from(event.changedTouches).find(changed => changed.identifier === gesture.id);
    if (!touch) return;
    const vertical = this.axis === 'vertical';
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    const along = Math.abs(vertical ? dy : dx);
    const across = Math.abs(vertical ? dx : dy);
    if (gesture.cancels === undefined) {
      if (along >= DECISION_SLOP && along > across) gesture.cancels = true;
    } else if (gesture.cancels && !gesture.far && across > along) {
      gesture.cancels = false;
    }
    if (along >= TAP_SLOP) gesture.far = true;
    if (gesture.cancels && event.cancelable) event.preventDefault();
  };
  #onTrayTouchEnd = event => {
    const gesture = this.#lockedTouch;
    if (gesture && Array.from(event.changedTouches).some(touch => touch.identifier === gesture.id)) {
      this.#lockedTouch = undefined;
    }
  };
  #endHold() {
    const hold = this.#hold;
    if (!hold) return;
    this.#hold = undefined;
    document.removeEventListener('pointerup', hold.end, true);
    document.removeEventListener('pointercancel', hold.end, true);
  }
  onPanStart = (data, source) => {
    const spring = this.#spring;
    const position = this.#positionOf(data);
    if (!spring || !this.#layout || this.#destroyed || position === undefined ||
    // One drag at a time: a second finger on another handle is ignored.
    this.#drag) {
      return;
    }
    // Catch a running animation where it is on screen: the rendered offset,
    // not the spring's value, which may be past an edge the render clamps.
    spring.stop();
    this.#stopScrollReset();
    this.#stopMomentum();
    this.#endHold();
    const offset = this.#renderedOffset;
    // didPan recognises the pan once the finger has moved past its threshold.
    // Anchored at the touchdown the tray would jump by that distance, so the
    // tray starts where it is and catches up with the finger over the first
    // frames (`#follow`). Anchored on the offset shown, also when that is
    // past an end (`dragOffset`).
    const scale = this.#screenScale();
    const initial = data.initial;
    let down = this.axis === 'vertical' ? initial?.y : initial?.x;
    let recognisedAt = OPENING_DIRECTION[this.placement] * (position - (down ?? NaN)) / scale;
    if (!Number.isFinite(recognisedAt)) {
      // No usable touchdown: follow from here, without a catch-up.
      down = position;
      recognisedAt = 0;
    }
    const drag = {
      source,
      startOffset: offset,
      startPosition: down,
      scale,
      lagFrom: recognisedAt,
      lagStart: this.#now(),
      holding: false,
      moved: false,
      peak: recognisedAt,
      delta: recognisedAt,
      drawn: 0,
      target: offset,
      offset,
      handoff: data.handoff === true,
      from: data.target ?? null,
      written: 0
    };
    const {
      maxOffset
    } = this.#layout;
    if (source === this.#tray && maxOffset > 0 && offset <= maxOffset + EPSILON && !this.#inNested(drag.from) && !this.#onHandle(drag.from)) {
      drag.scrollAt = Math.max(0, maxOffset - offset);
    }
    this.#drag = drag;
    this.#dragCount++;
    // The browser still scrolls a handed-off gesture: stop it at once.
    if (drag.handoff) this.#syncScrollLock();
    this.#velocity.reset();
    this.#scrollVelocity.reset();
    this.#queueState({
      isDragging: true
    });
    this.#follow(drag, drag.lagStart);
    // The velocity of the finger (see `onPan`), not of the catch-up.
    this.#addVelocity(drag, data);
    this.args.onDragStart?.({
      snapPoint: this.activeSnapPoint,
      offset
    });
  };
  onPan = (data, source) => {
    const drag = this.#drag;
    const position = this.#positionOf(data);
    if (!drag || drag.source !== source || !this.#layout || this.#destroyed || position === undefined) {
      return;
    }
    // How far the finger moved since it went down, in drawer px.
    const delta = OPENING_DIRECTION[this.placement] * (position - drag.startPosition) / drag.scale;
    if (!Number.isFinite(delta)) return;
    const now = this.#now();
    const lag = drag.delta - drag.drawn;
    const step = delta - drag.delta;
    // The way the tray catches up: 1 or -1, 0 when it has caught up.
    const way = Math.sign(drag.lagFrom);
    if (drag.holding) {
      if (lag === 0) {
        // The finger reached the tray: 1:1 from here.
        drag.holding = false;
      } else if (step * lag > 0) {
        // On again, away from the tray: ease the gap from here.
        drag.lagFrom = lag;
        drag.lagStart = now;
        drag.holding = false;
        drag.peak = delta;
      } else {
        // Holds until the finger reaches it.
        const drawn = way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
        drag.lagFrom = delta - drawn;
      }
    } else if (lag !== 0 && (drag.peak - delta) * way > TURN_SLOP / drag.scale) {
      // Back towards the tray during the catch-up, further than a jitter of
      // the finger: the tray holds still until the finger reaches it, and
      // then follows it. Easing on would take it against the finger, and
      // past it. A jitter doesn't stop the easing: the tray then stays
      // behind the finger by the lag.
      const drawn = way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
      drag.lagFrom = delta - drawn;
      drag.lagStart = now;
      drag.holding = true;
    } else if (way !== 0) {
      drag.peak = way > 0 ? Math.max(drag.peak, delta) : Math.min(drag.peak, delta);
    }
    drag.moved = true;
    drag.delta = delta;
    this.#follow(drag, now);
    this.#addVelocity(drag, data);
  };
  /**
  * Samples the release velocities: of the drawer where the finger puts it
  * (after resistance), so a release past an end doesn't hand the spring
  * more speed than the tray had, and the catch-up adds none; and of the
  * content that the drag scrolls, for its momentum (see `#splitDrag`).
  */
  #addVelocity(drag, data) {
    const time = this.#timeOf(data.originalEvent);
    this.#velocity.add(time, drag.target);
    if (drag.scroll) {
      this.#scrollVelocity.add(time, this.#splitDrag(drag, drag.delta)[1]);
    }
  }
  /** The time (ms) on the clock that runs the frames. */
  #now() {
    return (this.#clock ?? browserClock).now();
  }
  /**
  * Renders the drag at `time`: the tray follows the finger 1:1, but at the
  * start of the drag it is behind it by the catch-up lag (`catchUpLag`),
  * which eases from the distance moved before the pan was recognised to
  * `0`. While it lags it is also moved every frame, so it catches up when
  * the finger holds still. It is never past the finger: while the finger
  * comes back towards it, it holds still (`holding`, see `onPan`). Past
  * the highest snap point the content that the drag scrolls (see
  * `#splitDrag`) lags the same way.
  */
  #follow(drag, time) {
    const lag = drag.holding ? drag.lagFrom : catchUpLag(drag.lagFrom, time - drag.lagStart);
    drag.drawn = drag.delta - lag;
    this.#reachContent(drag);
    drag.target = this.#dragOffset(drag, this.#splitDrag(drag, drag.delta)[0]);
    const [tray, scrolled] = this.#splitDrag(drag, drag.drawn);
    drag.offset = lag === 0 ? drag.target : this.#dragOffset(drag, tray);
    this.#writeContentScroll(drag, scrolled);
    this.#render(drag.offset);
    if (lag === 0) {
      this.#cancelCatchUp(drag);
    } else if (drag.frame === undefined) {
      drag.frame = (this.#clock ?? browserClock).requestFrame(this.#catchUpFrame);
    }
  }
  /**
  * Splits `delta` (drawer px towards open, see `Drag`) into the part that
  * moves the tray and the part that scrolls the content: `[tray, scroll]`.
  *
  * A drag from the tray (not a handle, not in a nested drawer) that
  * reaches the highest snap point while the finger moves on towards open
  * scrolls the content from script from there, like a native sheet. In
  * iOS Safari a native scroll can't start in a gesture whose touchmoves
  * were cancelled (see `onTrayScroll`), so the drag sets the scroll
  * position itself, 1:1 with the finger. Once the content has reached its
  * end, the rest moves the tray past fully open as before (the content
  * bounces, see `#renderBounce`). Back towards close, the content scrolls
  * back first, to its content start, and then the tray moves. So once the
  * drag has reached the content (see `#reachContent`), the split only
  * depends on `delta`: the tray stays at the highest snap point while the
  * content scrolls.
  */
  #splitDrag(drag, delta) {
    const at = drag.scrollAt;
    const scroll = drag.scroll;
    if (at === undefined || !scroll) return [delta, 0];
    const scrolled = clamp(delta - at, -scroll.back, scroll.room);
    return [delta - scrolled, scrolled];
  }
  /**
  * Looks up the content that a drag scrolls (see `#splitDrag`), once the
  * tray it draws gets past the highest snap point: the innermost scroll
  * container of the gesture (see `#scrollChain`) that can scroll the way
  * the finger pushes the content. Reads layout once per drag.
  */
  #reachContent(drag) {
    if (drag.scroll !== undefined || drag.scrollAt === undefined || !(drag.drawn > drag.scrollAt)) {
      return;
    }
    drag.scroll = null;
    const vertical = this.axis === 'vertical';
    // A finger moving towards open moves the position this way.
    const sign = -OPENING_DIRECTION[this.placement];
    for (const element of this.#scrollChain(drag.from)) {
      const range = vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
      if (!(range > EPSILON)) continue;
      const style = this.#unlockedStyle(element);
      const overflow = vertical ? style.overflowY : style.overflowX;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      const rtl = !vertical && style.direction === 'rtl';
      const min = rtl ? -range : 0;
      const max = rtl ? 0 : range;
      const start = clamp(vertical ? element.scrollTop : element.scrollLeft, min, max);
      const room = sign > 0 ? max - start : start - min;
      if (!(room > EPSILON)) continue;
      drag.scroll = {
        element,
        vertical,
        start,
        sign,
        min,
        max,
        room,
        back: sign > 0 ? start - min : max - start
      };
      return;
    }
  }
  /**
  * The computed style `element` has without the scroll lock (see
  * `#syncScrollLock`), which may still be on for this frame, or for a
  * handed-off drag. Reads layout.
  */
  #unlockedStyle(element) {
    const saved = this.#scrollLock.get(element);
    const {
      style
    } = element;
    if (saved) style.setProperty(saved.property, saved.value, saved.priority);
    const {
      overflowX,
      overflowY,
      direction
    } = getComputedStyle(element);
    if (saved) style.setProperty(saved.property, 'hidden');
    return {
      overflowX,
      overflowY,
      direction
    };
  }
  /**
  * Scrolls the content of a drag to `scrolled` (see `#splitDrag`): one
  * write, no layout read of its own. `behavior: 'instant'`, so an app's
  * `scroll-behavior: smooth` doesn't smooth it.
  */
  #writeContentScroll(drag, scrolled) {
    const scroll = drag.scroll;
    if (!scroll || scrolled === drag.written) return;
    drag.written = scrolled;
    this.#scrollContent(scroll, scroll.start + scroll.sign * scrolled);
  }
  #scrollContent(scroll, position) {
    scroll.element.scrollTo(scroll.vertical ? {
      top: position,
      behavior: 'instant'
    } : {
      left: position,
      behavior: 'instant'
    });
  }
  /**
  * After the release of a drag that scrolled the content, while the tray
  * stays at the highest snap point: the content goes on with the
  * release velocity and slows down like a native scroll view (see
  * `Momentum`), driven by animation frames. It stops at the content's end
  * or start, never moves the page or the tray, and stops when a pointer
  * goes down on the tray (see `#onTrayInput`; that tap doesn't click, see
  * `#swallowClick`), a wheel turns on it, focus moves into it, a key is
  * pressed in the drawer, a drag starts or the tray leaves the highest
  * snap point. None with reduced
  * motion: the content stays where the finger left it.
  */
  #startMomentum(drag, velocity) {
    const scroll = drag.scroll;
    if (!scroll) return;
    // px/s along the finger's opening direction to scroll px/ms.
    const speed = scroll.sign * velocity / 1000;
    if (Math.abs(speed) < MIN_MOMENTUM_VELOCITY || (drawerEnvironment.prefersReducedMotion ?? browserPrefersReducedMotion)()) {
      return;
    }
    this.#stopMomentum();
    const token = this.#clock ? undefined : animationWaiter.beginAsync();
    const momentum = new Momentum({
      clock: this.#clock ?? browserClock,
      from: scroll.start + scroll.sign * drag.written,
      velocity: speed,
      min: scroll.min,
      max: scroll.max,
      write: position => this.#scrollContent(scroll, position),
      onEnd: () => {
        if (this.#momentum === momentum) this.#momentum = undefined;
        if (token) animationWaiter.endAsync(token);
      }
    });
    this.#momentum = momentum;
  }
  /** Stops the content's momentum; returns whether one was running. */
  #stopMomentum() {
    const momentum = this.#momentum;
    momentum?.stop();
    return momentum !== undefined;
  }
  /**
  * A pointer that went down on the tray stopped the content's momentum:
  * as in a native scroll view, that tap doesn't click. The next `click` in
  * the tray is cancelled (capture phase, once), unless it comes later than
  * `SWALLOW_CLICK_TIME` or after a pointer went down again once this one
  * lifted.
  */
  #swallowClick() {
    this.#endSwallowClick();
    const tray = this.#tray;
    if (!tray) return;
    const click = event => {
      this.#endSwallowClick();
      if (event.target instanceof Node && tray.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const release = () => {
      if (this.#clickSwallow) this.#clickSwallow.released = true;
    };
    const timer = setTimeout(() => this.#endSwallowClick(), SWALLOW_CLICK_TIME);
    document.addEventListener('click', click, true);
    document.addEventListener('pointerup', release, CAPTURE_PASSIVE);
    document.addEventListener('touchend', release, CAPTURE_PASSIVE);
    this.#clickSwallow = {
      click,
      release,
      released: false,
      timer
    };
  }
  #endSwallowClick() {
    const swallow = this.#clickSwallow;
    if (!swallow) return;
    this.#clickSwallow = undefined;
    clearTimeout(swallow.timer);
    document.removeEventListener('click', swallow.click, true);
    document.removeEventListener('pointerup', swallow.release, true);
    document.removeEventListener('touchend', swallow.release, true);
  }
  /**
  * Stops the content's momentum on input on the tray (see
  * `#startMomentum`); a pointer that stopped it doesn't click.
  */
  #stopMomentumOnInput(event) {
    if (event.type === 'pointerdown' || event.type === 'touchstart') {
      // A new tap: a click after it is its own.
      if (this.#clickSwallow?.released) this.#endSwallowClick();
      if (this.#stopMomentum()) this.#swallowClick();
    } else {
      this.#stopMomentum();
    }
  }
  #cancelCatchUp(drag) {
    if (drag?.frame === undefined) return;
    (this.#clock ?? browserClock).cancelFrame(drag.frame);
    drag.frame = undefined;
  }
  /**
  * A frame of the catch-up. At the time on the clock, not the frame's time
  * stamp: input of the same frame is handled after that time stamp, and
  * going back to it would move the tray back a little.
  */
  #catchUpFrame = () => {
    const drag = this.#drag;
    if (!drag || this.#destroyed) return;
    drag.frame = undefined;
    const now = this.#now();
    if (drag.holding && !drag.moved) {
      // The finger stopped before it reached the tray: catch up from here.
      drag.holding = false;
      drag.lagFrom = drag.delta - drag.drawn;
      drag.lagStart = now;
      drag.peak = drag.delta;
    }
    drag.moved = false;
    this.#follow(drag, now);
  };
  onPanEnd = (data, source) => {
    if (this.#drag?.source !== source) return;
    // A cancelled pointer (e.g. the browser took over the gesture) has no
    // meaningful position or velocity: settle from where the drawer is.
    const type = data.originalEvent?.type;
    const cancelled = type === 'pointercancel' || type === 'touchcancel';
    if (!cancelled) this.onPan(data, source);
    const drag = this.#endDrag();
    const time = this.#timeOf(data.originalEvent);
    // Released while the content scrolls (the tray at the highest snap
    // point): the content goes on (see `#startMomentum`), and the tray stays
    // where it is. Its velocity from before the handoff (in the last
    // samples) would carry it past the snap point while the content moves.
    const scroll = drag.scroll;
    const scrolling = scroll && drag.scrollAt !== undefined && drag.delta >= drag.scrollAt - scroll.back && drag.delta <= drag.scrollAt + scroll.room;
    const velocity = cancelled || scrolling ? 0 : this.#velocity.velocity(time);
    this.#release(drag.offset, velocity, drag.target);
    if (!cancelled && scrolling) {
      this.#startMomentum(drag, this.#scrollVelocity.velocity(time));
    }
  };
  /**
  * The pan modifier of `source` was torn down (its element removed, or,
  * for the tray, `@handleOnly` changed). If it owned the drag, its pointer
  * events won't arrive any more: settle from where the drawer is, as on
  * `pointercancel`.
  * Teardown happens during rendering, so the release waits for a microtask.
  */
  onDragSourceTeardown = source => {
    if (this.#drag?.source !== source) return;
    const drag = this.#endDrag();
    queueMicrotask(() => {
      if (!this.#destroyed && !this.#drag) {
        this.#release(drag.offset, 0, drag.target);
      }
    });
  };
  #endDrag() {
    const drag = this.#drag;
    this.#drag = undefined;
    this.#cancelCatchUp(drag);
    if (drag?.handoff) this.#syncScrollLock();
    this.#queueState({
      isDragging: false
    });
    return drag;
  }
  /**
  * Hands the release to the spring and settles on the snap point the
  * projection picks. Uncontrolled, that becomes the active snap point.
  * Controlled, the drawer asks the parent through `@onSnapPointChange` and
  * meanwhile heads for the active snap point: the parent always wins, so the
  * drawer turns towards the new one once (and only if) the parent passes it
  * in. A parent that answers synchronously does so before the next frame.
  * The spring starts at `offset`, where the tray is; the snap point is
  * picked for `released`, where the finger put it (ahead of `offset` while
  * the tray still catches up, see `#follow`), which `@onDragEnd` reports.
  */
  #release(offset, velocity, released = offset) {
    const spring = this.#spring;
    const layout = this.#layout;
    if (!spring || !layout || this.#destroyed) return;
    const target = selectSnapPoint(layout.resolved, released, velocity, {
      flingVelocity: FLING_VELOCITY
    });
    const index = this.#indexOf(target);
    const previous = this.activeSnapPoint;
    spring.set(offset, velocity);
    this.#overshoot = Math.max(0, offset - layout.trayLength);
    if (index !== previous && !this.isControlled) {
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.#moveToActive(true);
    this.args.onDragEnd?.({
      snapPoint: index,
      offset: released,
      velocity
    });
    if (index !== previous) this.args.onSnapPointChange?.(index);
  }
  /**
  * Updates tracked state in a microtask. The lifecycle hooks run during
  * rendering, where writing tracked state that was already rendered is an
  * error, and batching keeps the state coarse (a run that starts and ends in
  * the same task never flips `isAnimating`).
  */
  #queueState(state) {
    const flush = !this.#pendingState;
    this.#pendingState = {
      ...this.#pendingState,
      ...state
    };
    if (!flush) return;
    queueMicrotask(() => {
      const pending = this.#pendingState;
      this.#pendingState = undefined;
      if (this.#destroyed) return;
      if (pending.isAnimating !== undefined && pending.isAnimating !== this.isAnimating) {
        this.isAnimating = pending.isAnimating;
      }
      if (pending.progress !== undefined && pending.progress !== this.progress) {
        this.progress = pending.progress;
      }
      if (pending.isDragging !== undefined && pending.isDragging !== this.isDragging) {
        this.isDragging = pending.isDragging;
      }
      if (pending.openSnapPoints) {
        this.openSnapPoints = pending.openSnapPoints;
      }
    });
  }
  static {
    setComponentTemplate(precompileTemplate("<div class=\"mobile-drawer\" data-placement={{this.placement}} data-closed role={{if this.isModal \"dialog\"}} aria-modal={{if this.modalActive \"true\"}} ...attributes {{lifecycle this.hooks this.placement this.snapPoints this.activeSnapPoint this.isModal}}>\n  {{#if this.showBackdrop}}\n    <div class=\"mobile-drawer__backdrop\" {{lifecycle this.backdropHooks}}></div>\n    <div class=\"mobile-drawer__backdrop-tint\" aria-hidden=\"true\"></div>\n  {{/if}}\n  <div class=\"mobile-drawer__shadow\" aria-hidden=\"true\">\n    <div class=\"mobile-drawer__shadow-edge\"></div>\n    <div class=\"mobile-drawer__shadow-clip\">\n      <div class=\"mobile-drawer__shadow-body\"></div>\n    </div>\n  </div>\n  <div class=\"mobile-drawer__sheet\">\n    <div class=\"mobile-drawer__glass\" aria-hidden=\"true\"></div>\n    <div class=\"mobile-drawer__tray\" tabindex={{if this.isModal \"-1\"}} {{(if this.handleOnly noop (modifier dragSource axis=this.axis pointerTypes=POINTER_TYPES onPointerDown=this.onPointerDown onPanStart=this.onPanStart onPan=this.onPan onPanEnd=this.onPanEnd onTeardown=this.onDragSourceTeardown shouldDrag=this.shouldDrag touchAction=this.trayTouchAction onScroll=this.onTrayScroll onScrollEnd=this.onTrayScrollEnd))}}>\n      <div class=\"mobile-drawer__content\">\n        {{#let (modifier dragSource axis=this.axis pointerTypes=POINTER_TYPES onPointerDown=this.onPointerDown onPanStart=this.onPanStart onPan=this.onPan onPanEnd=this.onPanEnd onInstall=this.onHandleInstall shouldDrag=this.shouldHandleDrag onTeardown=this.onHandleTeardown) as |handle|}}\n          {{yield (hash snapTo=this.snapTo open=this.open close=this.close activeSnapPoint=this.activeSnapPoint handle=handle Grabber=(component Grabber owner=this.grabberOwner handle=handle activeSnapPoint=this.activeSnapPoint openSnapPoints=this.openSnapPoints) isDragging=this.isDragging isAnimating=this.isAnimating progress=this.progress Nested=(component NestedPortal owner=this.nestedOwner fallback=this.nestedParent))}}\n        {{/let}}\n      </div>\n    </div>\n  </div>\n  <div class=\"mobile-drawer__bar-tint\" aria-hidden=\"true\"></div>\n</div>", {
      strictMode: true,
      scope: () => ({
        lifecycle,
        noop,
        dragSource,
        POINTER_TYPES,
        hash,
        Grabber,
        NestedPortal
      })
    }), this);
  }
}

export { DEFAULT_SPRING_CONFIG as D, MobileDrawer as M };
//# sourceMappingURL=mobile-drawer-B9c9Lzoq.js.map
