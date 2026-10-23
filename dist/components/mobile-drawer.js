import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { warn, assert } from '@ember/debug';
import { setModifierManager, capabilities } from '@ember/modifier';
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
const browserClock = {
  now: () => performance.now(),
  requestFrame: callback => requestAnimationFrame(callback),
  cancelFrame: handle => cancelAnimationFrame(handle)
};
function browserPrefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function assertFinite(name, value) {
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
  config;
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
    const config = {
      ...DEFAULT_SPRING_CONFIG
    };
    for (const key of Object.keys(config)) {
      const value = overrides[key];
      if (value !== undefined) config[key] = value;
      assertPositive(key, config[key]);
    }
    assertFinite('from', from);
    assertFinite('to', to);
    assertFinite('velocity', velocity);
    this.config = Object.freeze(config);
    this.#value = from;
    this.#velocity = velocity;
    this.#target = to;
    this.#onUpdate = onUpdate;
    this.#clock = clock;
    this.#prefersReducedMotion = prefersReducedMotion;
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
  set(value, velocity = 0) {
    assertFinite('value', value);
    assertFinite('velocity', velocity);
    this.#value = value;
    this.#velocity = velocity;
  }
  #tick = time => {
    this.#frame = undefined;
    const dt = Math.max(0, time - this.#lastTime) / 1000;
    this.#lastTime = Math.max(time, this.#lastTime);
    if (dt > 0) {
      const next = stepSpring(this.#value - this.#target, this.#velocity, dt, this.config);
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
    return Math.abs(this.#value - this.#target) <= this.config.restDisplacementThreshold && Math.abs(this.#velocity) <= this.config.restVelocityThreshold;
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
 * Overrides for the environment the drawer animates in. Every field is
 * optional; unset fields use the browser defaults of {@link Spring}
 * (`performance.now` + `requestAnimationFrame`, and the
 * `prefers-reduced-motion` media query).
 *
 * Read when a drawer is inserted into the DOM, so set it before rendering.
 *
 * @internal Not public API. The addon's own tests use it to drive animations
 *   frame by frame with a fake clock.
 */
const drawerEnvironment = {};

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

const PLACEMENTS = ['bottom', 'top', 'left', 'right'];
const DEFAULT_SNAP_POINTS = Object.freeze([0, 'content']);
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
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
/** The valid index into an array of `count` items nearest to `index`. */
const clampIndex = (index, count) => Number.isFinite(index) ? clamp(Math.round(index), 0, count - 1) : 0;
/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring.
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` and a
 * `.mobile-drawer__tray`, with the block inside `.mobile-drawer__content`.
 * Attributes are applied to the root element.
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
  /**
  * The snap point when uncontrolled. Not tracked (see `uncontrolledVersion`)
  * because it is also written during rendering, to remember the last
  * controlled index: dropping `@activeSnapPoint` keeps the drawer where it
  * is.
  */
  #uncontrolledSnapPoint = 0;
  #lastWarning;
  #root;
  #tray;
  #backdrop;
  #spring;
  #resizeObserver;
  #layout;
  #placement;
  #destroyed = false;
  #pendingState;
  get placement() {
    const {
      placement
    } = this.args;
    return placement && PLACEMENTS.includes(placement) ? placement : 'bottom';
  }
  get snapPoints() {
    return this.args.snapPoints ?? DEFAULT_SNAP_POINTS;
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
      this.#tray = root.querySelector(':scope > .mobile-drawer__tray');
      this.#backdrop = root.querySelector(':scope > .mobile-drawer__backdrop');
      this.#spring = new Spring({
        clock: drawerEnvironment.clock,
        prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
        onUpdate: ({
          value
        }) => this.#render(value)
      });
      this.#placement = this.placement;
      this.#measure();
      // Appear at the initial snap point without animating in.
      this.#moveToActive(false);
      if (typeof ResizeObserver !== 'undefined') {
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(root.querySelector(':scope > * > .mobile-drawer__content'));
      }
    },
    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      this.#measure();
      // A new placement is a different layout: jump instead of animating
      // along the new axis from the old position.
      this.#moveToActive(!placementChanged);
    },
    destroy: () => {
      this.#destroyed = true;
      this.#resizeObserver?.disconnect();
      this.#spring?.stop();
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
      trayLength,
      maxOffset
    };
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
  /** Moves (or jumps) to the active snap point. */
  #moveToActive(animate) {
    const spring = this.#spring;
    const index = this.activeSnapPoint;
    // Remember a controlled index, so dropping @activeSnapPoint keeps it.
    this.#uncontrolledSnapPoint = index;
    if (!spring || !this.#layout || this.#destroyed) return;
    const target = this.#offsetOf(index);
    this.#queueState({
      progress: this.#progressOf(target)
    });
    spring.retarget(target);
    if (!animate) {
      spring.stop();
      spring.set(target, 0);
      this.#render(target);
      this.#queueState({
        isAnimating: false
      });
      return;
    }
    if (spring.isAnimating) return; // Retargeted; the run continues.
    void spring.start().then(() => {
      if (!spring.isAnimating) this.#queueState({
        isAnimating: false
      });
    });
    // With reduced motion the run ends synchronously.
    this.#queueState({
      isAnimating: spring.isAnimating
    });
  }
  #onResize() {
    const spring = this.#spring;
    if (!spring || this.#destroyed || !this.#measure()) return;
    const target = this.#offsetOf(this.activeSnapPoint);
    this.#queueState({
      progress: this.#progressOf(target)
    });
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
    // A fast spring can overshoot; never pull the tray off its edge or push
    // it further than fully closed.
    const open = clamp(offset, 0, layout.trayLength);
    const distance = layout.trayLength - open;
    const transform = {
      bottom: `translate3d(0, ${distance}px, 0)`,
      top: `translate3d(0, ${-distance}px, 0)`,
      left: `translate3d(${-distance}px, 0, 0)`,
      right: `translate3d(${distance}px, 0, 0)`
    }[this.placement];
    this.#tray.style.transform = transform;
    this.#backdrop.style.setProperty('--mobile-drawer-progress', String(this.#progressOf(open)));
    root.toggleAttribute('data-closed', open <= 0 && !this.#spring.isAnimating);
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
    });
  }
  static {
    setComponentTemplate(precompileTemplate("<div class=\"mobile-drawer\" data-placement={{this.placement}} data-closed ...attributes {{lifecycle this.hooks this.placement this.snapPoints this.activeSnapPoint}}>\n  <div class=\"mobile-drawer__backdrop\"></div>\n  <div class=\"mobile-drawer__tray\">\n    <div class=\"mobile-drawer__content\">\n      {{yield (hash snapTo=this.snapTo open=this.open close=this.close activeSnapPoint=this.activeSnapPoint isDragging=false isAnimating=this.isAnimating progress=this.progress)}}\n    </div>\n  </div>\n</div>", {
      strictMode: true,
      scope: () => ({
        lifecycle,
        hash
      })
    }), this);
  }
}

export { MobileDrawer as default };
//# sourceMappingURL=mobile-drawer.js.map
