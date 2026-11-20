import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { warn, assert } from '@ember/debug';
import { buildWaiter } from '@ember/test-waiters';
import { d as drawerEnvironment, V as VelocityTracker, u as unregisterDrawer, r as registerDrawer, i as isDrawerRoot, D as DECISION_SLOP, a as dragSource } from './registry-BPzq7lPE.js';
import { setModifierManager, capabilities, on } from '@ember/modifier';
import { precompileTemplate } from '@ember/template-compilation';
import { setComponentTemplate } from '@ember/component';
import { g, i } from 'decorator-transforms/runtime-esm';

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

/** All values must be finite and greater than zero. */

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

/** `base` with the defined values of `overrides`, validated and frozen. */
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
 * Advances by `dt` seconds. `displacement` is relative to the target.
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
    const decay = Math.exp(-omega0 * dt);
    const b = v0 + omega0 * x0;
    return {
      displacement: decay * (x0 + b * dt),
      velocity: decay * (v0 - omega0 * b * dt)
    };
  }
  if (zeta < 1) {
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

  // Over-damped. r1 from r1 * r2 = omega0² avoids cancellation for large zeta.
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
 * A one-dimensional damped spring driven by animation frames. It holds no
 * tracked state: consumers apply the value in `onUpdate`. If a frame produces
 * a non-finite value, the run ends and the last finite state is kept.
 */
class Spring {
  #config;
  #value = 0;
  #velocity = 0;
  #target = 0;
  #onUpdate;
  #clock;
  #prefersReducedMotion;
  #frame;
  #lastTime = 0;
  #run;
  constructor(options = {}) {
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
  configure(overrides) {
    this.#config = mergeConfig(this.#config, overrides);
  }
  get value() {
    return this.#value;
  }
  get velocity() {
    return this.#velocity;
  }
  get target() {
    return this.#target;
  }
  get isAnimating() {
    return this.#run !== undefined;
  }

  /**
   * Returns a promise for the end of the run (also an early end); it never
   * rejects. While animating, returns the current run's promise. With reduced
   * motion or at rest, it snaps to the target synchronously.
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

  /** Keeps position and velocity; the pending `start` promise resolves. */
  stop() {
    if (this.#frame !== undefined) {
      this.#clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#endRun();
  }

  /** Keeps position and velocity. Does not start an idle spring. */
  retarget(to) {
    assertFinite$1('target', to);
    this.#target = to;
  }
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
    this.#frame = this.#clock.requestFrame(this.#tick);
  }
  #isAtRest() {
    return Math.abs(this.#value - this.#target) <= this.#config.restDisplacementThreshold && Math.abs(this.#velocity) <= this.#config.restVelocityThreshold;
  }
  #settle() {
    this.#value = this.#target;
    this.#velocity = 0;
    // End the run first, so it ends even if onUpdate throws or calls
    // retarget()/start().
    this.#endRun();
    this.#onUpdate?.({
      value: this.#value,
      velocity: 0
    });
  }
  #endRun() {
    const run = this.#run;
    if (!run) return;
    this.#run = undefined;
    run.resolve();
  }
}

/**
 * Snap-point model: pure functions on one axis. An "offset" is how far (px)
 * the drawer is open, from `0` (closed) to the container size.
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

/** Px: closer offsets are one snap point (else one would be unreachable). */
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
 * Resolves snap points to px offsets, sorted ascending, clamped to the
 * container and de-duplicated. A merged snap point keeps the container size
 * if one of its offsets is exactly that, so "fully open" stays exact;
 * otherwise its lowest offset.
 *
 * @throws RangeError for a non-finite or out-of-range size or snap point.
 * @throws Error for an empty array, a malformed snap point, or `'content'`
 *   without a content size.
 */
function resolveSnapPoints(snapPoints, sizes) {
  if (!Array.isArray(snapPoints) || snapPoints.length === 0) {
    throw new Error(`ember-mobile-drawer: snap points must be a non-empty array, got ${describe(snapPoints)}.`);
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

/** The resolved snap point that the input at `index` resolved to. */
function findSnapPoint(resolved, index) {
  return resolved.find(snapPoint => snapPoint.indices.includes(index));
}

/**
 * Per millisecond, as iOS `UIScrollView.DecelerationRate.fast`. `.normal`
 * (`0.998`) projects five times as far and skips snap points on small sheets.
 */
const DECELERATION_RATE$1 = 0.99;

/**
 * Where a release at `velocity` (px/s) comes to rest with exponential decay
 * at `DECELERATION_RATE`: about a tenth of the velocity further.
 *
 * @throws RangeError when `offset` or `velocity` is not finite.
 */
function projectOffset(offset, velocity) {
  assertFinite('offset', offset);
  assertFinite('velocity', velocity);
  return offset + velocity / 1000 * DECELERATION_RATE$1 / (1 - DECELERATION_RATE$1);
}
/**
 * The snap point nearest to the projected rest position; on a tie, the one in
 * the direction of the velocity (the lower one at rest). `resolved` must not
 * be empty.
 */
function selectSnapPoint(resolved, offset, velocity, options = {}) {
  const first = resolved[0];
  const {
    flingVelocity
  } = options;
  const projected = projectOffset(offset, velocity);
  let best = first;
  let bestDistance = Math.abs(first.offset - projected);
  for (const snapPoint of resolved.slice(1)) {
    const distance = Math.abs(snapPoint.offset - projected);
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

/** Rubber-band resistance factor, as used by iOS scroll views. */
const DEFAULT_RUBBER_BAND_FACTOR = 0.55;
/**
 * Rubber-band resistance outside `[min, max]`: an overshoot `x` becomes
 * `(1 - 1 / (x * factor / dimension + 1)) * dimension`.
 */
function rubberBand(offset, min, max, {
  dimension
}) {
  const factor = DEFAULT_RUBBER_BAND_FACTOR;
  const resist = overshoot => dimension <= 0 ? 0 : (1 - 1 / (overshoot * factor / dimension + 1)) * dimension;
  if (offset < min) {
    return min - resist(min - offset);
  }
  if (offset > max) {
    return max + resist(offset - max);
  }
  return offset;
}

/**
 * The inverse of `rubberBand`. It grows without bound near `dimension`, so
 * the overshoot is clamped to `MAX_BAND_FRACTION` of it.
 */
function unRubberBand(offset, min, max, {
  dimension
}) {
  const factor = DEFAULT_RUBBER_BAND_FACTOR;
  const unresist = overshoot => {
    if (dimension <= 0) return 0;
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
const MAX_BAND_FRACTION = 0.999;
/**
 * Where a drag from `start` (the offset shown when caught) puts the drawer
 * after `delta` px. A drag that catches the drawer outside `[min, max]`
 * continues without a jump: 1:1 towards the range, and only the rest of the
 * band resists further out.
 */
function dragOffset(start, delta, min, max, bands) {
  const {
    below,
    above
  } = bands;
  const raw = start + delta;
  if (start > max ? delta > 0 : start < min && delta < 0) {
    // Further out: the band's increase from its (un-banded) position.
    const band = start > max ? above : below;
    const from = unRubberBand(start, min, max, band);
    return start + rubberBand(from + delta, min, max, band) - rubberBand(from, min, max, band);
  }
  // Towards the range: 1:1 while still outside it.
  if (start > max && raw > max || start < min && raw < min) {
    return raw;
  }
  return rubberBand(raw, min, max, raw > max ? above : below);
}

function consume(args) {
  // Read every positional argument, so a change to any of them triggers
  // `updateModifier`. Tracked state that the hooks read triggers it too.
  const [hooks, ...deps] = args.positional;
  return hooks;
}

/**
 * A minimal modifier, to avoid a runtime dependency on `ember-modifier`:
 * `{{lifecycle this.hooks @foo @bar}}`. The hooks run during rendering, so
 * they must not write tracked state synchronously.
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

/** @internal */
const noop = setModifierManager(() => ({
  capabilities: capabilities('3.22'),
  createModifier() {},
  installModifier() {},
  updateModifier() {},
  destroyModifier() {}
}), {});

/**
 * Catch-up of the distance a finger moved before its pan was recognised
 * (`didPan`'s 10px or more): starting from the touchdown would make the tray
 * jump, starting at recognition would lose it. So the tray eases after the
 * finger over the first frames.
 *
 * @module
 */

/** Ms: about 6 frames at 60 Hz. */
const CATCH_UP_DURATION = 100;

/**
 * Px/ms relative to the finger (4px per 60 Hz frame), so no frame moves the
 * tray by much more than the finger moved.
 */
const CATCH_UP_SPEED = 0.24;

/**
 * Px of finger jitter back towards the tray that the catch-up ignores. A
 * larger move back holds the tray, so it never moves against the finger.
 */
const TURN_SLOP = 2;

/** Smoothstep peaks at 1.5 times the average speed, halfway. */
function catchUpDuration(distance) {
  const duration = 1.5 * Math.abs(distance) / CATCH_UP_SPEED;
  return Number.isFinite(duration) ? Math.max(CATCH_UP_DURATION, duration) : CATCH_UP_DURATION;
}

/**
 * How far the tray is still behind the finger: eases from `distance` to
 * exactly `0`, slowly at both ends so it neither jumps nor jolts.
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
 * Scroll momentum after a drag scrolled the content from script, like a
 * native iOS scroll view.
 *
 * @module
 */

/** Per ms: UIScrollView's `decelerationRate` `normal`. */
const DECELERATION_RATE = 0.998;

/** Px/ms. */
const MIN_MOMENTUM_VELOCITY = 0.02;
const LN_RATE = Math.log(DECELERATION_RATE);

/** Distance from the start and velocity `elapsed` ms later. */
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
  stop() {
    if (!this.#running) return;
    this.#running = false;
    if (this.#frame !== undefined) {
      this.#options.clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    this.#options.onEnd?.();
  }

  // The clock's time, not the frame's (as the catch-up): input of the same
  // frame is handled after the frame's time stamp.
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
 * drawers: the siblings of each element and of its ancestors up to `<body>`.
 *
 * Counted per element, so drawers can open and close in any order. Only
 * attributes the drawers added are removed: once the app changes `inert` on
 * such an element, it is the app's. Elements added later are not made inert.
 *
 * @module
 * @internal
 */

/** Elements that don't render. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
const counts = new Map();
let observer$1;

/** The drawers stop managing an element whose `inert` someone else changed. */
function handOver(records) {
  for (const record of records) counts.delete(record.target);
}

/** Handles changes by others before the drawers change attributes. */
function flush() {
  if (observer$1) handOver(observer$1.takeRecords());
}
function own(change) {
  flush();
  change();
  observer$1?.takeRecords();
}

/** Until the returned (idempotent) function is called. */
function inertOutside(...elements) {
  observer$1 ??= typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(handOver);
  const kept = new Set();
  for (const element of elements) {
    for (let node = element; node; node = node.parentElement) {
      kept.add(node);
    }
  }
  const touched = [];
  own(() => {
    for (const element of elements) {
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
      observer$1?.disconnect();
    }
  };
}

/**
 * Which form fields open an on-screen keyboard, and which take text.
 *
 * @module
 * @internal
 */

/** `<input>` types that open no on-screen keyboard. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
function isTextControl(element) {
  return element instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(element.type) || element instanceof HTMLTextAreaElement;
}
function isWritableTextControl(element) {
  return isTextControl(element) && !element.readOnly && !element.disabled;
}

/**
 * A field whose focus can open a keyboard or picker (and the browser scrolls
 * it into view). An iframe counts: what is focused inside it is unknown.
 */
function isEditable(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return isWritableTextControl(element);
  }
  return element instanceof HTMLSelectElement || element instanceof HTMLIFrameElement || element instanceof HTMLElement && element.isContentEditable;
}

/** A `readonly` or `disabled` text field: it opens no keyboard. */
function isInactiveTextField(element) {
  return isTextControl(element) && (element.readOnly || element.disabled);
}

/** Like `isEditable`, but not a select or an iframe: opens a keyboard. */
function isTypingField(element) {
  return isEditable(element) && !(element instanceof HTMLSelectElement) && !(element instanceof HTMLIFrameElement);
}

/** Whether `element` contains an `isTypingField` field. */
function containsTypingField(element) {
  for (const field of element.querySelectorAll('input, textarea, [contenteditable]')) {
    if (isTypingField(field)) return true;
  }
  return false;
}

/** Unlike `isEditable`, `readonly` counts: its text can be selected. */
function isTextField(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return isTextControl(element) && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Scroll positions along one axis, also in right-to-left containers. Used by
 * the component and by the iOS overflow lock.
 *
 * @module
 * @internal
 */

/** Tolerance (px): scroll positions can be fractional. */
const EPSILON$1 = 0.5;

/** How far (px) `element` can scroll along the axis in all. */
function scrollRange(element, vertical) {
  return vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
}

/** Right-to-left horizontal positions run from `-range` to `0`. */
function scrollBounds(element, vertical, style) {
  const range = scrollRange(element, vertical);
  const rtl = !vertical && style.direction === 'rtl';
  return {
    range,
    min: rtl ? -range : 0,
    max: rtl ? 0 : range,
    position: vertical ? element.scrollTop : element.scrollLeft
  };
}
function scrollsAlong(style, vertical) {
  const overflow = vertical ? style.overflowY : style.overflowX;
  return overflow === 'auto' || overflow === 'scroll';
}

/**
 * Whether `element` can scroll along the axis in the direction a finger that
 * moved `movement` px (positive: down or right) pushes its content.
 */
function canScroll(element, vertical, movement) {
  const style = getComputedStyle(element);
  if (!scrollsAlong(style, vertical)) return false;
  const {
    range,
    min,
    max,
    position
  } = scrollBounds(element, vertical, style);
  if (!(range > EPSILON$1)) return false;
  // iOS reports positions past the ends while bouncing; those count as ends.
  return movement > 0 ? position > min + EPSILON$1 : position < max - EPSILON$1;
}

/**
 * A reference-counted body scroll lock for modal drawers: the page scrolls
 * again only once the last lock is released.
 *
 * Adapted from ember-mobile-menu's `utils/body-scroll-lock.js` (MIT, Nick
 * Schot), which adapts https://github.com/willmcpo/body-scroll-lock (MIT
 * License, Copyright (c) 2018 Will Po).
 *
 * - Everywhere: `overflow: hidden` on `<html>`, whose value applies to the
 *   viewport (also when the app sets `overflow` on `<html>`), and the body is
 *   padded by the width of a classic scrollbar so the page doesn't shift.
 * - iOS ignores `overflow: hidden` for touch scrolling: `<body>` is fixed at
 *   its scroll position, and touchmoves outside the allowed elements are
 *   cancelled so the viewport doesn't rubber-band.
 * - Transparent status bar: a fixed `<body>` makes Safari 26+ paint the
 *   status bar in one solid colour, so iOS gets the "overflow lock" instead.
 *   Touchmoves are also cancelled inside the allowed elements when nothing
 *   there can scroll further in the swipe's direction, and a page scroll is
 *   undone at once, except while the on-screen keyboard is open. A drawer
 *   with a text field still gets the fixed `<body>` (see `lock`).
 *
 * @module
 * @internal
 */

/** One per lock: where touchmoves are not cancelled (iOS). */
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
let lastTouch;
let pinned;

/** The keyboard is open, or about to open (a field in a drawer has focus). */
function keyboardOpen() {
  const viewport = window.visualViewport;
  if (viewport && viewport.height * viewport.scale < window.innerHeight - 1) {
    return true;
  }
  return typingFieldFocused();
}
function typingFieldFocused() {
  const active = document.activeElement;
  return active !== null && isTypingField(active) && allowed.some(allows => allows(active));
}
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
 * Undoes any page scroll, except while the keyboard is open: iOS scrolls the
 * page to show a focused field, and the fixed drawer moves with it. Scrolling
 * back would hide the field. The viewport `resize` restores it on close.
 */
const onViewportChange = () => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/** Puts the page back as soon as focus leaves the fields, as iOS does. */
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

/** Whether `element` can scroll along the swipe's main axis (also in RTL). */
function canScrollSwipe(element, dx, dy) {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  return canScroll(element, vertical, vertical ? dy : dx);
}

/**
 * Allows a touchmove only when an element from the target up through the
 * allowed element can still scroll in the swipe's direction.
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
      if (canScrollSwipe(element, dx, dy)) {
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

/**
 * A drawer with a text field gets the fixed `<body>` from the start: with the
 * tall page of the overflow lock, iOS also scrolls up to show a focused field,
 * and the page and the drawer move apart. Fixing `<body>` only on focus does
 * not work: during the touch iOS drops the tap, and in `focusin` it flashes
 * the page background. Cancelling the tap and focusing with `preventScroll`
 * leaves a dark overlay on the field and breaks the caret placement.
 */
function lock(options) {
  const html = document.documentElement;
  const body = document.body;
  const ios = (drawerEnvironment.isIOS ?? detectIOS)();
  const result = {
    htmlOverflow: html.style.overflow,
    bodyPaddingRight: body.style.paddingRight
  };

  // Before hiding the overflow, which removes a classic scrollbar.
  const scrollbar = window.innerWidth - html.clientWidth;
  if (scrollbar > 0) {
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbar}px`;
  }
  if (ios && options.transparentStatusBar && !options.fields?.some(containsTypingField)) {
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
    window.addEventListener('scroll', onViewportChange, {
      passive: true
    });
    window.visualViewport?.addEventListener('resize', onViewportChange);
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
    window.removeEventListener('scroll', onViewportChange);
    window.visualViewport?.removeEventListener('resize', onViewportChange);
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

/** Called when the overflow lock changes to the fixed `<body>`. */
function onLockChange(listener) {
  lockChangeListeners.add(listener);
  return () => lockChangeListeners.delete(listener);
}

/**
 * Locks body scrolling until the returned (idempotent) function is called.
 * Touch scrolling on the nodes `allow` accepts keeps working on iOS.
 */
function lockBodyScroll(allow, options = {}) {
  if (allowed.length === 0) {
    saved = lock(options);
  } else if (saved?.overflow && options.fields?.some(containsTypingField)) {
    // The keyboard needs the fixed `<body>`.
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

/** Whether the iOS overflow lock (no fixed `<body>`) is on. */
function transparentStatusBarLock() {
  return saved?.overflow !== undefined;
}

/**
 * The dim layer for `@transparentStatusBar`. iOS Safari 26+ paints the status
 * bar in one solid colour when a fixed or sticky element is within 4px of the
 * top, or when `<body>` is fixed. So the dim is page content (absolute, as
 * large as the document), and the transparent backdrop only takes pointers.
 *
 * Inserted just before the root: same stacking context and `z-index`. An
 * ancestor that clips, or a scaled one, cuts the dim.
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
    // The containing block can be any positioned (also scaled) ancestor.
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
 * Focus helpers for the focus trap, instead of a dependency such as
 * `tabbable`. Not covered: shadow DOM; each radio button is its own stop.
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
function isTabbable(element) {
  return element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') &&
  // Content of a closed <details>, except its <summary>, isn't rendered;
  // `checkVisibility` covers that, the fallback doesn't.
  isVisible(element);
}
function tabbables(container) {
  return [...container.querySelectorAll(CANDIDATES)].filter(isTabbable);
}

/**
 * Skips the yielded `Grabber`: it comes first in a bottom drawer, but focus
 * (and a screen reader) should start at the content.
 */
function initialFocus(container, fallback) {
  const autofocus = [...container.querySelectorAll('[autofocus]')].find(element => !element.closest('[inert]') && isVisible(element));
  return autofocus ?? tabbables(container).find(element => !element.hasAttribute('data-mobile-drawer-grabber')) ?? fallback;
}
function focusWithoutScrolling(element) {
  element.focus({
    preventScroll: true
  });
}

/**
 * The nesting relation between drawers through portals. A transformed tray
 * clips its `position: fixed` descendants, so the yielded `Nested` renders
 * outside the tray, in a portal that counts as inside the tray here. Events
 * still follow the DOM.
 *
 * @module
 * @internal
 */

const anchors = new Map();

/**
 * A getter: the portal can be in the DOM before the outer drawer knows its
 * tray. Until then the portal's DOM parent counts.
 */
function addPortal(portal, anchor) {
  anchors.set(portal, anchor);
}
function removePortal(portal) {
  anchors.delete(portal);
}
function logicalParent(node) {
  return (node instanceof Element ? anchors.get(node)?.() : undefined) ?? node.parentElement;
}

/** `ancestor.contains(node)`, but a portal counts as inside its anchor. */
function logicallyContains(ancestor, node) {
  for (let current = node ?? null; current; current = logicalParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** The portals logically inside `element`, but not in its DOM. */
function portalsOf(element) {
  return [...anchors.keys()].filter(portal => !element.contains(portal) && logicallyContains(element, portal));
}

/**
 * The yielded `Nested`: renders a nested drawer outside the tray, which would
 * clip it. Without `@destination` it renders a render later: the drawer's
 * parent element isn't known before that.
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
/**
 * The yielded `Grabber`: a drag handle `<button>` that moves the drawer to its
 * next open snap point on activation, like the grabber of an iOS sheet.
 *
 * @internal
 */
class Grabber extends Component {
  valueId = `mobile-drawer-grabber-${++ids}`;
  /** A new `id` renders a new text node. */
  static {
    g(this.prototype, "announcement", [tracked]);
  }
  #announcement = (i(this, "announcement"), void 0);
  /** `dragCount` at the last pointerdown, until its click. */#downDrags;
  get label() {
    return this.args.label ?? 'Sheet grabber';
  }
  get valueText() {
    return this.stateText(this.args.activeSnapPoint);
  }
  /**
  * Shows once the snap point is active (a controlled parent can pass it in
  * later), and goes for good when the drawer moves in another way, so no
  * stale text stays. The flags are untracked: they change only here.
  */
  get announcements() {
    const announcement = this.announcement;
    if (!announcement || announcement.gone) return [];
    const active = this.args.activeSnapPoint;
    if (active === announcement.index) {
      announcement.reached = true;
      return [announcement];
    }
    if (!announcement.reached && active === announcement.from) return [];
    announcement.gone = true;
    return [];
  }
  /** Else 'Expanded', 'Partly expanded', 'Collapsed' or 'Closed'. */
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
    // A click that ends a drag isn't a tap. Keyboard clicks (`detail` 0) are.
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
 * Publishes how far the modal drawers are open to the page elements behind
 * them (`data-mobile-drawer-page`), for effects such as the iOS page scale.
 *
 * The viewport top is measured once: body scrolling is locked while a modal
 * drawer is open. With no drawer open, the properties and the attribute are
 * removed, so e.g. a page `transform` doesn't change `position: fixed`
 * content then. A drawer inside a marked element never drives it: the page
 * can't move without moving the drawer.
 *
 * The marked elements are cached while a drawer is open, so the document
 * isn't queried every frame; a `MutationObserver` refreshes them (e.g. a
 * route change replaces the page wrapper).
 *
 * @module
 * @internal
 */

const PAGE_ATTRIBUTE = 'data-mobile-drawer-page';
const PAGE_PROGRESS_PROPERTY = '--mobile-drawer-page-progress';
const PAGE_VIEWPORT_TOP_PROPERTY = '--mobile-drawer-page-viewport-top';
const PAGE_ACTIVE_ATTRIBUTE = 'data-mobile-drawer-page-active';
const sources = new Map();
let pages;
/** Also while `pages` is out of date. */
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
function writeAll(pages) {
  for (const page of pages) {
    let max = 0;
    for (const [root, value] of sources) {
      if (value > max && !page.element.contains(root)) max = value;
    }
    write(page, max);
  }
}
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

/** `0` removes the drawer, e.g. when it closes or is destroyed. */
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
 * To show a focused field, iOS scrolls the visual viewport down in the layout
 * viewport. Safari clips fixed elements to the layout viewport, so the fixed
 * root ends above the bottom of the screen, and the page shows through the
 * translucent URL bar and keyboard in the strip below it. No part of the
 * drawer can paint there.
 *
 * The fill is an element in the document (not fixed, so it is not clipped), a
 * child of `<html>` so that a fixed `<body>` doesn't contain it, with the
 * tray's background and backdrop filter. While it shows, the root gets
 * `data-keyboard`. Other browsers keep client coordinates in the layout
 * viewport, so they never get a strip.
 *
 * Only one drawer shows a fill at a time, else nested bottom drawers would
 * show two at the same place: the innermost drawer that holds the focus, else
 * the drawer that became active last.
 *
 * @module
 * @internal
 */

/** A computed `backdrop-filter`, also where only the prefixed one is set. */
function backdropFilterOf(style) {
  return style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') || 'none';
}
const KEYBOARD_FILL_CLASS = 'mobile-drawer-keyboard-fill';
/** On the drawer's root while the fill shows. */
const KEYBOARD_ATTRIBUTE = 'data-keyboard';

/** The part of `VisualViewport` this needs, see `drawerEnvironment`. */

const MIN_STRIP = 1;
const fills = new Set();
let activations = 0;

/** The focused element, also inside an open shadow root. */
function focusedElement() {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

/** Shows the fill of the one drawer that should have it, hides the rest. */
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
  // The innermost drawer that holds the focus.
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
  activation = 0;
  constructor(options) {
    this.#options = options;
    options.root.addEventListener('focusout', this.#onFocusOut);
    fills.add(this);
  }
  get root() {
    return this.#options.root;
  }
  contains(node) {
    return this.#options.contains(this.#options.root, node);
  }

  /** Call when the drawer opens or closes; syncs the fills of all drawers. */
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
   * Copies the tray's colour to the fill again. It forces a style
   * calculation, so call it only when the colour can change.
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
   * Hides every fill (also of the drawers around this one) when focus leaves
   * for an element that doesn't keep the keyboard: Safari moves the root back
   * down before the viewport's events come, and the fill would cover the
   * sheet until then.
   */
  #onFocusOut = event => {
    const to = event.relatedTarget;
    if (to instanceof Element && this.#options.keepsKeyboard(to)) return;
    hideAll();
  };

  /** The strip between the root's bottom and the screen's, in client px. */
  strip() {
    const {
      viewport,
      root
    } = this.#options;
    if (!viewport || !this.#listening) return undefined;
    // A pinch zoom also moves the visual viewport.
    if ((viewport.scale ?? 1) > 1.01) return undefined;
    const rect = root.getBoundingClientRect();
    if (viewport.height >= rect.height - MIN_STRIP) return undefined;
    const style = getComputedStyle(root);
    // An embedded root is in the page; a page scroll can put it above.
    if (style.position !== 'fixed') return undefined;
    // Without the root's own `top`, its client top is the screen's top.
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
    // Relative to where its containing block puts it, however scrolled.
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

/**
 * Inline style values that the drawer overrides, saved to put back later.
 *
 * @module
 * @internal
 */

/** One property per element. */
class InlineOverrides {
  #saved = new Map();
  save(element, property) {
    const {
      style
    } = element;
    this.#saved.set(element, {
      property,
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property)
    });
  }
  set(element, property, value) {
    this.save(element, property);
    element.style.setProperty(property, value);
  }
  get(element) {
    return this.#saved.get(element);
  }
  delete(element) {
    this.#saved.delete(element);
  }

  /** With `ifStill`, a value the app set in the meantime is kept. */
  restore(element, ifStill) {
    const saved = this.#saved.get(element);
    if (!saved) return;
    this.#saved.delete(element);
    const {
      style
    } = element;
    if (ifStill === undefined || style.getPropertyValue(saved.property) === ifStill && !style.getPropertyPriority(saved.property)) {
      style.setProperty(saved.property, saved.value, saved.priority);
    }
  }
  restoreAll() {
    for (const element of [...this.#saved.keys()]) this.restore(element);
  }
  [Symbol.iterator]() {
    return this.#saved.entries();
  }
  keys() {
    return this.#saved.keys();
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
/** A release this fast (px/s) moves at least to the next snap point. */
const FLING_VELOCITY = 400;
/** `1` when opening moves towards larger client coordinates, else `-1`. */
const OPENING_DIRECTION = {
  bottom: -1,
  top: 1,
  left: 1,
  right: -1
};
/**
 * The rubber band past the largest snap point, like an iOS sheet's content:
 * the UIScrollView curve `(1 - 1 / (x * c / d + 1)) * d` with `c = 0.55` and
 * `d` this ratio times the tray's length. Only the content moves; the tray
 * stays at its edge. Past the smallest snap point `d` is the container size.
 */
const OPEN_RUBBER_BAND_RATIO = 0.55;
/** Content that stays at the tray's edge while the content bounces. */
const PINNED_ATTRIBUTE = 'data-mobile-drawer-pinned';
/** Marks a scroll container in the tray. The tray itself always is one. */
const SCROLL_ATTRIBUTE = 'data-mobile-drawer-scroll';
/**
 * Events on the tray that (re)lock the scroll containers they reach. `wheel`
 * isn't passive, so the lock applies before the wheel scrolls.
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
/** Tolerance (px): offsets and scroll positions can be fractional. */
const EPSILON = 0.5;
/** How far (screen px) a backdrop tap may move. The same as `didPan`. */
const TAP_SLOP = 10;
/** How long (ms) after stopping momentum its click is still cancelled. */
const SWALLOW_CLICK_TIME = 1000;
/** How far (px) a click may be from where the pointer lifted (rounding). */
const CLICK_MATCH = 2;
/**
 * The open modal drawers in the order they became modal, but a drawer always
 * comes before the modal drawers inside it. Only the last one handles Escape
 * and Tab.
 */
const modalStack = [];
const mountedDrawers = new Set();
/** The drawers that show (open or at a peek). */const shownDrawers = new Set();
/** The input the user gave last while a drawer showed. */
let lastInput;
/**
 * How long (ms) after an input a focus still counts as caused by it. A long
 * press can take more time; then the browser decides.
 */
const INPUT_WINDOW = 1000;
/** The drawer's clock, as for its animations. */
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
 * While a drawer shows, window listeners record the last input. They capture,
 * so the record is there before the focus the input causes (also when the
 * app moves focus in its handler) and an app that stops the event can't hide
 * it.
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
 * The input that gives `element` focus now: the recent input when there is
 * one, the same in every browser (Chrome gives a clicked `readonly` field
 * `:focus-visible`). Else, as for a screen reader or switch access, which
 * send no key or pointer event, `:focus-visible` decides, but never for an
 * inactive text field. Safari before 15.4 throws on `:focus-visible`.
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
/** Whether `element` is nearer the end that a finger moving `way` pushes to. */
function nearEnd(element, vertical, way) {
  if (!(scrollRange(element, vertical) > EPSILON)) return true;
  const {
    range,
    min,
    position
  } = scrollBounds(element, vertical, getComputedStyle(element));
  const fromMin = position - min;
  // A finger moving down (right) pushes the content towards `min`.
  return way > 0 ? fromMin <= range / 2 : fromMin >= range / 2;
}

/** A scroll container that a drag scrolls from script past the top. */

/**
 * The border-box length of `element` along the axis, or `undefined` outside
 * the render tree (computed styles then aren't px). Not
 * `getBoundingClientRect()`, which includes transforms, nor `offsetHeight`,
 * which is rounded. `extra` is the padding and border of `content-box`.
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
/**
 * Whether `element` handles its own touch gestures, so a swipe on it in a
 * nested drawer is never cancelled. `:disabled` also matches a control in a
 * disabled fieldset.
 */
function handlesOwnGesture(element, style) {
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    if (element.matches(':disabled')) return false;
    return !(element instanceof HTMLInputElement) || element.type === 'range' || isTextField(element);
  }
  if (element instanceof HTMLMediaElement) return element.controls;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  if (element.getAttribute('draggable') === 'true') return true;
  return style.touchAction === 'none';
}
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const clampIndex = (index, count) => Number.isFinite(index) ? clamp(Math.round(index), 0, count - 1) : 0;
/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring. The README describes the behaviour; the notes here are about how.
 *
 * Scroll vs drag: each touch gesture is decided once (see `dragSource`) and
 * keeps that decision until the finger lifts. Below the highest snap point
 * the content is locked along the axis (see `#syncScrollLock`) and every
 * gesture drags; at it, a gesture scrolls when a scroll container under the
 * finger can scroll that way. Two exceptions: a scroll that reaches its
 * scroll start while pulling towards close is taken over by a drag (see
 * `onTrayScroll`), and a drag that reaches the highest snap point scrolls the
 * content from script (see `#splitDrag`), because in iOS Safari a native
 * scroll can't start after its touchmoves were cancelled.
 *
 * A drag cancels its touchmoves at every snap point: iOS Safari doesn't
 * reliably honour `touch-action` on a scroll container, so nothing relies on
 * it alone. Touchmoves are only cancelled once a gesture is decided, so
 * swipes across the axis keep working.
 *
 * Handles are drag sources of their own and always drag; whichever drag
 * source recognises the pan first owns the drag (see `#onHandle`). A gesture
 * that starts in a nested drawer belongs to that drawer only (see
 * `#inNested` and `#onNestedTouchMove`).
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
  * The real value needs the measured layout, so a drawer inserted open
  * renders its block once more after insertion.
  */
  static {
    g(this.prototype, "uncontrolledVersion", [tracked], function () {
      return 0;
    });
  }
  #uncontrolledVersion = (i(this, "uncontrolledVersion"), void 0);
  /** Bumped when the drawer changes its own (uncontrolled) snap point. */
  static {
    g(this.prototype, "modalActive", [tracked], function () {
      return false;
    });
  }
  #modalActive = (i(this, "modalActive"), void 0);
  static {
    g(this.prototype, "openSnapPoints", [tracked], function () {
      return [];
    });
  }
  #openSnapPoints = (i(this, "openSnapPoints"), void 0);
  /** For the `Grabber`: the open snap point indices, ascending by offset. */
  static {
    g(this.prototype, "nestedParent", [tracked]);
  }
  #nestedParent = (i(this, "nestedParent"), void 0);
  /** Where the yielded `Nested` renders without `@destination`. */
  /** The `Nested` portals: a part of the tray, hidden with the drawer. */#portals = new Set();
  nestedOwner = {
    add: portal => {
      this.#portals.add(portal);
      this.#listenNested(portal, true);
      addPortal(portal, () => this.#tray);
      // Like the root until the drawer has rendered: closed.
      portal.toggleAttribute('data-closed', this.#root?.hasAttribute('data-closed') ?? true);
      MobileDrawer.#portalsChanged();
    },
    remove: portal => {
      this.#portals.delete(portal);
      this.#listenNested(portal, false);
      removePortal(portal);
      MobileDrawer.#portalsChanged();
    }
  };
  /**
  * The snap point when uncontrolled. Not tracked: it is also written during
  * rendering, so dropping `@activeSnapPoint` keeps the drawer where it is.
  */
  #uncontrolledSnapPoint = 0;
  #lastWarning;
  #root;
  #sheet;
  #tray;
  #content;
  #header;
  /**
  * The tray, or with a header the content, so the header stays out of the
  * scroll and the content bounces under it, as in a native iOS sheet.
  */
  get #scroller() {
    return this.#header ? this.#content : this.#tray;
  }
  /** The DOM order (tab and reading order) is the order on screen. */
  get headerFirst() {
    return this.placement === 'bottom' || this.placement === 'right';
  }
  /** A placement change renders the header again, as a new element. */
  #syncHeader() {
    const header = this.#tray?.querySelector(':scope > .mobile-drawer__header') ?? undefined;
    if (header === this.#header) return;
    if (this.#header) this.#resizeObserver?.unobserve(this.#header);
    this.#header = header;
    if (header) this.#resizeObserver?.observe(header);
  }
  #barTint;
  #shadow;
  #shadowBody;
  #glass;
  /** Fills below the root while the iOS Safari keyboard is open. */
  #keyboardFill;
  /** Whether the content is moved past fully open. */
  #bouncing = false;
  /** The pinned elements' own inline `translate`, put back after a bounce. */
  #pinned = new InlineOverrides();
  #contentWillChange = new InlineOverrides();
  #backdrop;
  #backdropTint;
  /** Whether the root has `data-status-bar="transparent"`. */
  #statusBar = false;
  #pageDim;
  #offLockChange;
  #listeners;
  #backdropListeners;
  #spring;
  #resizeObserver;
  #layout;
  /** Whether the tray is below the lowest open snap point. */
  #below = false;
  #floats = false;
  /** How far (px) `#paintSink` moved the sheet down. */
  #moved = 0;
  #placement;
  #destroyed = false;
  #pendingState;
  /** The injected clock, if any (tests). */
  #clock;
  #drag;
  /** A pointer that stopped a running animation, until a drag or its lift. */
  #hold;
  #velocity = new VelocityTracker();
  /** The velocity of the content part of a drag, for its momentum. */
  #scrollVelocity = new VelocityTracker();
  #momentum;
  /** The click that a tap which stopped the momentum may not do. */
  #clickSwallow;
  #renderedOffset = 0;
  /**
  * How far (px) the tray may be rendered past fully open while not dragged.
  * Only shrinks after the release, so the tray returns from a rubber band
  * without a jump but the spring never pulls it further off its edge.
  */
  #overshoot = 0;
  /** Holds the tray at the highest snap point for the rest of the run. */
  #arrivedAtHighest = false;
  /** Whether the tray was at the highest snap point at the last render. */
  #atTop = false;
  #scrollReset;
  /** The spring of a scroll reset that runs on its own. */
  #scrollSpring;
  /** The locked elements, with their own inline overflow. */
  #scrollLock = new InlineOverrides();
  #scrollLockProperty;
  #overscroll = new InlineOverrides();
  /**
  * With `@handleOnly`, a touch that started while scrolling was locked.
  * `cancels` is `undefined` until decided; `far` past `TAP_SLOP`.
  */
  #lockedTouch;
  /**
  * A touch that started in a nested drawer: the elements that may scroll
  * for it, whether it is on an element with its own gestures (`own`) and
  * whether it is cancelled (`undefined` until decided).
  */
  #nestedTouch;
  #handles = new Set();
  #dragCount = 0;
  /** The element that keyboard focus reveals once the drawer arrives. */
  #reveal;
  #backdropProgress = 0;
  #expandProgress = NaN;
  /** Whether the backdrop catches pointers (above the smallest snap point). */
  #backdropBlocks = false;
  /**
  * Whether the active snap point is above the smallest one. Updated during
  * rendering; the modal behaviour and focus follow in a microtask.
  */
  #open = false;
  /**
  * Whether the active snap point is at 0, so `data-closed` hides the drawer.
  * Unlike `!#open`, not set at a peek. Also set until the first measure.
  */
  #hidden = true;
  /**
  * `#open` as last reported through `@onOpen`/`@onClose`. The first value
  * counts as reported.
  */
  #reportedOpen = false;
  #hasReportBaseline = false;
  #returnFocus;
  /** Its ancestors when the drawer opened. */
  #returnFocusPath = [];
  /**
  * Set while keyboard focus opened the drawer from its peek: it is then not
  * modal, and goes back to its peek when focus leaves it. A move between
  * open snap points keeps it; an open from the peek by other means doesn't
  * set it.
  */
  #openedByFocus = false;
  /** Until the drawer opens, or the next task if the parent says no. */
  #focusOpenPending = false;
  /** Where focus came from into the tray, for a drawer opened by focus. */
  #enteredFrom;
  #initialFocusing = false;
  /** Its keyboard focus doesn't hold the scroll reset. */
  #initialFocused;
  /**
  * The last focused element in the tray, with its input read at focus time:
  * a later key press (typing, Space on a tapped button) doesn't change it.
  */
  #focused;
  /** Whether focus was inside when the drawer closed, until it returns. */
  #closedWithFocusInside;
  #applyQueued = false;
  #releaseModal;
  #releaseInert;
  #warnedLabel = false;
  /**
  * The pointer that went down on the backdrop, until its click, cancel or
  * the next pointer. `moved` past `TAP_SLOP`: no tap. Only a click at `up`
  * belongs to it.
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
  * An invalid `@activeSnapPoint` (e.g. `@snapPoints` shrank first) is
  * clamped with a warning, rather than throwing during rendering.
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
    warn(message, false, {
      id: 'ember-mobile-drawer.invalid-snap-point'
    });
  }
  snapTo = index => {
    assert(`<MobileDrawer>: snapTo needs an index into @snapPoints (0-${this.snapPoints.length - 1}), got ${index}.`, Number.isInteger(index) && index >= 0 && index < this.snapPoints.length);
    if (index === this.activeSnapPoint) {
      // E.g. after a resize stopped an animation.
      this.#moveToActive(true);
      return;
    }
    if (!this.isControlled) {
      // Re-renders the lifecycle modifier, whose `update` animates to it.
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.args.onSnapPointChange?.(index);
  };
  /**
  * The `Grabber`'s action, like an iOS sheet's grabber: the next larger
  * open snap point, from the largest back to the smallest. Never closes.
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
      this.#header = this.#tray.querySelector(':scope > .mobile-drawer__header') ?? undefined;
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
        }) => this.#onSpringUpdate(value)
      });
      this.#placement = this.placement;
      this.#listeners = new AbortController();
      const {
        signal
      } = this.#listeners;
      root.addEventListener('keydown', this.#onKeyDown, {
        signal
      });
      root.addEventListener('scroll', this.#onRootScroll, {
        passive: true,
        signal
      });
      root.addEventListener('focusout', this.#onRootFocusOut, {
        signal
      });
      this.#sheet.addEventListener('scroll', this.#onRootScroll, {
        passive: true,
        signal
      });
      mountedDrawers.add(this);
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
      MobileDrawer.#syncNested();
      // Tracked state, so not during rendering (and the drawers around this
      // one are in the DOM by then).
      queueMicrotask(() => {
        if (!this.#destroyed) this.nestedParent = this.#nestedDestination();
      });
      this.#measure();
      this.#moveToActive(false);
      this.#syncScrollLock();
      // A drawer with a text field opened in front: the lock is now the
      // fixed `<body>`, so the status bar is solid again.
      this.#offLockChange = onLockChange(() => this.#endStatusBar());
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray.addEventListener(type, this.#onTrayInput, {
          ...(type === 'wheel' ? CAPTURE_ACTIVE : CAPTURE_PASSIVE),
          signal
        });
      }
      tray.addEventListener('focusin', this.#onTrayFocusIn, {
        signal
      });
      tray.addEventListener('touchstart', this.#onTrayTouchStart, {
        passive: true,
        signal
      });
      tray.addEventListener('touchmove', this.#onTrayTouchMove, {
        passive: false,
        signal
      });
      tray.addEventListener('touchend', this.#onTrayTouchEnd, {
        signal
      });
      tray.addEventListener('touchcancel', this.#onTrayTouchEnd, {
        signal
      });
      this.#listenNested(tray, true);
      this.#keyboardFill = new KeyboardFill({
        root,
        tray,
        glass: this.#glass,
        viewport: drawerEnvironment.visualViewport ? drawerEnvironment.visualViewport() : window.visualViewport ?? null,
        // Only a bottom drawer has its background at the screen's bottom.
        active: () => !this.#destroyed && this.placement === 'bottom' && !root.hasAttribute('data-closed'),
        keepsKeyboard: isEditable,
        contains: logicallyContains
      });
      this.#keyboardFill.sync();
      if (typeof ResizeObserver !== 'undefined') {
        // Not the tray: the component sizes it, so the observer would fire
        // on its own writes. A tray-only padding change waits for the next.
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(this.#content);
        if (this.#header) this.#resizeObserver.observe(this.#header);
      }
    },
    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      if (placementChanged) {
        this.#stopMomentum();
        this.#syncHeader();
      }
      this.#measure();
      this.#syncScrollLock();
      if (this.#drag) {
        // The finger wins until it lets go. A new placement is a new axis, so
        // that drag is over.
        if (!placementChanged) {
          this.#syncOpen();
          return;
        }
        const drag = this.#endDrag();
        // Not during rendering.
        queueMicrotask(() => {
          if (this.#destroyed) return;
          this.args.onDragEnd?.({
            snapPoint: this.activeSnapPoint,
            offset: drag.target,
            velocity: 0
          });
        });
      }
      // A new placement jumps instead of animating along the new axis.
      this.#moveToActive(!placementChanged);
      if (placementChanged) this.#keyboardFill?.sync();
    },
    destroy: () => {
      this.#destroyed = true;
      this.#listeners?.abort();
      this.#listeners = undefined;
      const tray = this.#tray;
      if (tray) this.#listenNested(tray, false);
      for (const portal of this.#portals) this.#listenNested(portal, false);
      this.#lockedTouch = undefined;
      this.#nestedTouch = undefined;
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
      mountedDrawers.delete(this);
      if (this.#root) unregisterDrawer(this.#root);
      MobileDrawer.#syncNested();
      trackInput(this, false);
      this.#focused = undefined;
      if (this.#root) setPageProgress(this.#root, 0);
      // Focus can only move back once the drawer is gone from the DOM.
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
  * Resolves the snap points and sizes the tray. Forces layout, so never per
  * frame. `false` while the tray can't be measured (e.g. hidden): the resize
  * observer measures again once it gets a size.
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
    style.height = '';
    style.width = '';
    const content = measureLength(tray, vertical);
    // The root minus the opposite safe-area inset, or the tray's max size.
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
  /** Does nothing while dragging: the release moves to the active one. */
  #moveToActive(animate) {
    const spring = this.#spring;
    const index = this.activeSnapPoint;
    // So dropping @activeSnapPoint keeps it.
    this.#uncontrolledSnapPoint = index;
    if (!spring || !this.#layout || this.#destroyed) return;
    this.#syncOpen();
    if (this.#drag) return;
    const target = this.#offsetOf(index);
    this.#queueState({
      progress: this.#progressOf(target)
    });
    spring.retarget(animate ? this.#aimFor(target) : target);
    this.#markExpanded(target);
    if (!animate) {
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
    if (spring.isAnimating) return;
    void this.#startSpring(spring).then(() => {
      if (spring.isAnimating) return;
      this.#queueState({
        isAnimating: false
      });
      this.#revealFocus();
    });
    // With reduced motion the run ended synchronously.
    this.#queueState({
      isAnimating: spring.isAnimating
    });
    // Now rather than at the first frame, so focus can move in at once.
    if (spring.isAnimating) this.#setClosed(false);
  }
  /**
  * `data-expanded` follows the target, not the rendered position, and only
  * outside a drag, so small movements at the top never flicker it.
  */
  #markExpanded(target) {
    const {
      maxOffset
    } = this.#layout;
    const root = this.#root;
    const expanded = maxOffset > 0 && target >= maxOffset - EPSILON;
    if (root.hasAttribute('data-expanded') === expanded) return;
    root.toggleAttribute('data-expanded', expanded);
    // A theme may change the tray's colour with it.
    this.#keyboardFill?.paint();
  }
  /**
  * Below the highest snap point a vertical drawer's content goes back to its
  * scroll start (the end of the range for a top drawer), where it is locked.
  * Opening from closed to the highest snap point starts at `scrollTop` 0.
  * Not for side drawers: their tray isn't sized by the snap point along its
  * scroll axis.
  *
  * The reset never jumps while the tray shows: towards closed it waits until
  * the tray is closed; when the tray has at least as far to go as the
  * content, it follows the tray in `#render`, so the content never moves
  * faster than the tray; otherwise it runs on a spring of its own from rest.
  * Reads layout only here, so the render loop only writes.
  */
  #planScrollReset(target) {
    // A new plan (e.g. each frame of a resize) keeps the running speed.
    const running = this.#scrollSpring?.isAnimating ? this.#scrollSpring : undefined;
    const velocity = running?.velocity ?? 0;
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    if (this.#isHighest(target)) {
      // A move up from a lower snap point keeps the position.
      if (this.#renderedOffset <= EPSILON) this.#scrollToStart(target);
      return;
    }
    const scroller = this.#scroller;
    const top = this.placement === 'top';
    const start = top ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    let distance = Math.abs(scroller.scrollTop - start);
    // The browser rounds scroll positions: go on from the spring's exact
    // value, or a resize on every frame could keep the reset a pixel short.
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
  #applyScrollReset(open) {
    const reset = this.#scrollReset;
    if (!reset) return;
    let fraction;
    if (reset.target <= EPSILON) {
      fraction = open <= EPSILON ? 0 : 1;
    } else {
      // At least `distance` (more than EPSILON) when planned.
      const span = Math.abs(reset.from - reset.target);
      fraction = clamp(Math.abs(open - reset.target) / span, 0, 1);
    }
    if (fraction >= reset.fraction) return;
    this.#writeScroll(reset, fraction);
    if (fraction === 0) this.#scrollReset = undefined;
  }
  /** `instant`, so an app's `scroll-behavior: smooth` doesn't apply. */
  #writeScroll(reset, fraction) {
    reset.fraction = fraction;
    const top = reset.start + reset.sign * reset.distance * fraction;
    this.#scroller.scrollTo({
      top,
      behavior: 'instant'
    });
  }
  /**
  * Registers the run with the test waiter, but not with an injected clock:
  * those tests run the frames themselves, so `settled()` would hang.
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
  /** Production builds use the default instead of an invalid value. */
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
  #stopScrollReset() {
    this.#scrollReset = undefined;
    this.#scrollSpring?.stop();
    this.#scrollSpring = undefined;
  }
  #isHighest(offset) {
    const {
      maxOffset
    } = this.#layout;
    return maxOffset > 0 && offset >= maxOffset - EPSILON;
  }
  /** `scrollTop` 0 at the highest snap point, else the scroll start. */
  #scrollToStart(target) {
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    const scroller = this.#scroller;
    const top = this.placement === 'top' && !this.#isHighest(target) ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    scroller.scrollTo({
      top,
      behavior: 'instant'
    });
  }
  /**
  * Whether focus in the tray holds a resize's scroll reset: the browser
  * scrolled keyboard focus into view, and an editable element can open an
  * on-screen keyboard. The drawer's own initial focus doesn't scroll, so it
  * doesn't hold it.
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
  /** As read when it got focus, or now when the drawer didn't see that. */
  #inputOf(element) {
    const focused = this.#focused;
    return focused?.element === element ? focused.input : focusInputOf(element);
  }
  #onResize() {
    const spring = this.#spring;
    if (!spring || this.#destroyed || !this.#measure()) return;
    // A drag or a hold stays at the offset shown until the finger moves.
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
    // Not when the browser may have scrolled focus into view (e.g. above an
    // Android keyboard that resizes the page): the reset would hide it.
    if (!this.#focusHoldsReset()) this.#planScrollReset(target);
    if (spring.isAnimating) {
      spring.retarget(this.#aimFor(target));
      this.#render(spring.value);
    } else {
      // Before the next paint, so the old position never shows at the new
      // size.
      spring.retarget(target);
      spring.set(target, 0);
      this.#render(target);
    }
  }
  /**
  * Where the spring aims for `target`: past closed (`CLOSE_OVERSHOOT`) for
  * a close to offset 0 while the tray is open by any amount, so the tray
  * doesn't creep to the edge. Also in the last pixel of such a run, where a
  * retarget to 0 (a resize, a changed argument) would give a long invisible
  * tail. `#onSpringUpdate` ends that run at 0.
  */
  #aimFor(target) {
    return target <= 0 && this.#spring.value > 0 ? -60 : target;
  }
  /**
  * Ends a run aimed past closed when it reaches closed, at exactly 0 and at
  * rest. Also after reduced motion jumped to that target.
  */
  #onSpringUpdate(value) {
    const spring = this.#spring;
    if (spring.target < 0 && value <= 0) {
      spring.stop();
      spring.retarget(0);
      spring.set(0, 0);
      value = 0;
    }
    this.#render(value);
  }
  /** Runs every frame: only inline styles, never tracked state. */
  #render(offset) {
    const layout = this.#layout;
    const root = this.#root;
    if (!layout || !root || this.#destroyed) return;
    const max = this.#drag ? Infinity : layout.trayLength + this.#overshoot;
    let open = clamp(offset, 0, max);
    // A bouncing spring comes back below its target. At the highest snap
    // point that would lock the content for a moment (and make a touch drag
    // instead of scroll), so the tray stays there for the rest of the run.
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
    // Past the tray's length only the content moves.
    const distance = Math.max(0, layout.trayLength - open);
    const shift = -OPENING_DIRECTION[this.placement] * distance;
    const transform = this.axis === 'vertical' ? `translate3d(0, ${shift}px, 0)` : `translate3d(${shift}px, 0, 0)`;
    this.#tray.style.transform = transform;
    this.#paintShadow(transform, distance, this.#sinkOf(open));
    this.#renderBounce(Math.max(0, open - layout.trayLength));
    const atTop = open >= layout.maxOffset - EPSILON;
    this.#paintExpand(open, atTop);
    root.toggleAttribute('data-at-highest', atTop && layout.maxOffset > 0);
    if (atTop !== this.#atTop) {
      this.#atTop = atTop;
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
    this.#barTint?.style.setProperty('--mobile-drawer-progress', String(this.#backdropProgress));
    // Like on iOS, only a modal sheet from the bottom moves the page back.
    setPageProgress(root, this.isModal && this.placement === 'bottom' && layout.maxOffset > smallest ? clamp((open - smallest) / (layout.maxOffset - smallest), 0, 1) : 0);
    this.#setClosed(open <= 0 && !this.#spring.isAnimating && !this.#drag);
    // At rest without the modal behaviour: no transparent status bar.
    if (!this.#releaseModal && !this.#spring.isAnimating && !this.#drag) {
      this.#endStatusBar();
    }
  }
  /** Also on the `Nested` portals, so they hide with this drawer. */
  #setClosed(closed) {
    const root = this.#root;
    const changed = root.hasAttribute('data-closed') !== closed;
    root.toggleAttribute('data-closed', closed);
    // The next open reads the inset again.
    if (closed) this.#below = false;
    for (const portal of this.#portals) {
      portal.toggleAttribute('data-closed', closed);
    }
    if (changed) this.#keyboardFill?.sync();
  }
  /**
  * The shadow and glass layers move with the tray; the shadow body gets the
  * opposite transform, so it stays at the sheet's bottom edge. Transforms
  * only, so a theme's shadow is not painted again while the drawer moves.
  */
  #paintShadow(transform, distance, sink) {
    // Also for other placements, to clear a bottom drawer's move.
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
  * Moves a floating sheet, and with it its clip, down by `sink` px; the tray
  * and glass get the opposite `translate`. Only written on a change, so an
  * app's inline `translate` on the tray stays above the lowest open snap
  * point. A sheet without an inset doesn't move: its clip would cut the
  * tray's top shadow. The inset is read once per move below, so a change
  * (e.g. the iOS page scale) applies to the next one.
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
  #isFloating() {
    const inset = getComputedStyle(this.#sheet).getPropertyValue('--mobile-drawer-inset').trim();
    return inset !== '' && parseFloat(inset) !== 0;
  }
  /**
  * Below the lowest open snap point the sheet moves down as one piece, as a
  * native iOS sheet does when it closes, instead of getting shorter.
  */
  #sinkOf(open) {
    if (this.placement !== 'bottom' || !this.#layout) return 0;
    const lowest = this.#layout.resolved.find(snapPoint => snapPoint.offset > 0)?.offset ?? 0;
    return Math.max(0, lowest - open);
  }
  /**
  * Not on the root: the property is not inherited and only the tray takes
  * it from the sheet, so the content isn't styled again on every frame.
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
    // A theme may change the tray's colour with it.
    this.#keyboardFill?.paint();
  }
  /**
  * Moves the content past fully open with `translate`, which composes with
  * an app `transform`. Scrolling is locked meanwhile: the moved content
  * widens a top or left tray's scrollable overflow, and no scroll may start
  * on top of the bounce.
  */
  #renderBounce(bounce) {
    const content = this.#content;
    if (!content) return;
    const bouncing = bounce > 0;
    const value = b => {
      if (!bouncing) return '';
      const shift = OPENING_DIRECTION[this.placement] * b;
      return this.axis === 'vertical' ? `0px ${shift}px` : `${shift}px 0px`;
    };
    if (bouncing !== this.#bouncing) {
      this.#bouncing = bouncing;
      if (bouncing) {
        this.#contentWillChange.set(content, 'will-change', 'translate');
        for (const element of content.querySelectorAll(`[${PINNED_ATTRIBUTE}]`)) {
          if (element.closest('.mobile-drawer__content') !== content) continue;
          this.#pinned.save(element, 'translate');
        }
      } else {
        this.#contentWillChange.restoreAll();
        this.#pinned.restoreAll();
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
  * Below the highest snap point the scroll containers get an inline
  * `overflow: hidden` along the axis, so content and drag never fight.
  * `hidden` keeps their scroll position. Inline, not a CSS rule: their
  * `overflow` usually comes from unlayered app CSS, which beats the
  * drawer's layer, and the lock must follow the rendered position.
  */
  #syncScrollLock() {
    const tray = this.#tray;
    if (!tray) return;
    const lock = !this.#destroyed && (!this.#atTop || this.#bouncing || this.#drag?.handoff === true);
    const property = this.axis === 'vertical' ? 'overflow-y' : 'overflow-x';
    this.#scrollLockProperty = lock ? property : undefined;
    for (const [element, saved] of this.#scrollLock) {
      if (!element.isConnected) {
        this.#scrollLock.delete(element);
      } else if (!lock || saved.property !== property) {
        // Keeps a value the app has set since.
        this.#scrollLock.restore(element, 'hidden');
      }
    }
    if (!lock) return;
    this.#lockContainers(tray, tray.querySelectorAll(`[${SCROLL_ATTRIBUTE}]`));
  }
  /** Not the scroll containers of a nested drawer. */
  #lockContainers(tray, marked) {
    this.#lockScroll(tray);
    if (this.#header) this.#lockScroll(this.#content);
    for (const element of marked) {
      if (element instanceof HTMLElement && element.hasAttribute(SCROLL_ATTRIBUTE) && element.closest('.mobile-drawer__tray') === tray) {
        this.#lockScroll(element);
      }
    }
  }
  /** If the app has rewritten the inline style, its value is put back. */
  #lockScroll(element) {
    const property = this.#scrollLockProperty;
    if (!property) return;
    const {
      style
    } = element;
    if (style.getPropertyValue(property) === 'hidden' && !style.getPropertyPriority(property) && this.#scrollLock.get(element)) {
      return;
    }
    this.#scrollLock.set(element, property, 'hidden');
  }
  /**
  * `pointer-events: none` at or below the smallest snap point, so an
  * invisible (closing) backdrop or a peek's backdrop never blocks the page.
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
  * The backdrop is a pointer convenience, deliberately not focusable or a
  * button: a keyboard closes with Escape or the app's own controls.
  */
  backdropHooks = {
    install: backdrop => {
      this.#backdrop = backdrop;
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
  * Tells a tap from a drag when the click arrives. A mouse has no implicit
  * capture, so movement is followed on the document.
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
    this.#backdropListeners = new AbortController();
    const {
      signal
    } = this.#backdropListeners;
    document.addEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true,
      passive: true,
      signal
    });
    document.addEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true,
      signal
    });
    document.addEventListener('pointercancel', this.#onBackdropPointerCancel, {
      capture: true,
      signal
    });
  };
  #onBackdropPointerMove = event => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#trackBackdropPointer(event.clientX, event.clientY);
    }
  };
  #trackBackdropPointer(x, y) {
    const pointer = this.#backdropPointer;
    if (!pointer) return;
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    // NaN (no coordinates) doesn't count as moved.
    if (distance > TAP_SLOP) pointer.moved = true;
  }
  /**
  * Keeps the pointer for its click. A click elsewhere (e.g. a mouse dragged
  * onto the tray) never comes; the next click then ignores the record.
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
    this.#backdropListeners?.abort();
    this.#backdropListeners = undefined;
  }
  #endBackdropPointer() {
    this.#removeBackdropListeners();
    this.#backdropPointer = undefined;
  }
  /**
  * A click whose pointer moved isn't a tap. A pointer's click lands where
  * it lifted; any other click (`element.click()`, assistive technology) is.
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
  * Queues `#applyOpen` for the modal behaviour and focus, which must not run
  * during rendering. Runs on every argument change, which covers `@modal`.
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
      // The first known open state is not a change.
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
      // Focus is already inside: return it to where it came from.
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
  * A drawer that opens and closes again before this runs reports neither
  * `@onOpen` nor `@onClose`. The modal behaviour is off inside a closed or
  * closing drawer, so a hidden drawer never keeps the page inert and locked.
  */
  #applyOpen() {
    if (this.#destroyed) return;
    const root = this.#root;
    const insideClosed = !!root && this.#hiddenByDrawer(root);
    const modal = this.#open && this.isModal && !insideClosed && !this.#openedByFocus;
    const wasModal = this.#releaseModal !== undefined;
    if (modal && !wasModal) {
      this.#activateModal();
    } else if (!modal && wasModal) {
      this.#deactivateModal();
      if (insideClosed && this.#open) this.#moveFocusOutOfClosedDrawer();
    }
    // Before focus returns: a modal drawer inside would keep its target inert.
    this.#applyNested();
    const focusInside = this.#closedWithFocusInside;
    if (focusInside !== undefined) {
      this.#closedWithFocusInside = undefined;
      this.#returnFocusAfterClose(focusInside, wasModal);
    }
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
    const releaseScroll = lockBodyScroll(target => logicallyContains(tray, target), {
      fields: [tray, ...this.#portals],
      transparentStatusBar: this.args.transparentStatusBar === true && this.placement !== 'top'
    });
    this.#syncStatusBar();
    // Below the modal drawers inside this one (e.g. a peek that opens under
    // its open nested drawer), which keep Escape and the Tab wrap.
    const nested = modalStack.findIndex(other => logicallyContains(root, other.#root));
    modalStack.splice(nested === -1 ? modalStack.length : nested, 0, this);
    MobileDrawer.#syncNested();
    document.addEventListener('keydown', this.#onDocumentKeyDown);
    this.#releaseModal = () => {
      document.removeEventListener('keydown', this.#onDocumentKeyDown);
      modalStack.splice(modalStack.indexOf(this), 1);
      MobileDrawer.#syncNested();
      releaseScroll();
      // Not moving: `#render` won't run again to end it.
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
      // The drawer's own focus never moves it: the app chose the snap point.
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
  * The first modal drawer's lock decides, so a nested drawer follows. Stays
  * until the drawer rests without the modal behaviour, so the dim fades out
  * while it closes. Not for an embedded (not `position: fixed`) root.
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
  #endStatusBar() {
    if (!this.#statusBar) return;
    this.#statusBar = false;
    this.#root?.removeAttribute('data-status-bar');
    this.#pageDim?.destroy();
    this.#pageDim = undefined;
  }
  /** Leaves focus alone. */
  #deactivateModal() {
    const release = this.#releaseModal;
    if (!release) return;
    this.#releaseModal = undefined;
    this.#initialFocused = undefined;
    release();
    if (!this.#destroyed) this.modalActive = false;
  }
  /**
  * The root's parent, or, inside another drawer's tray (also through its
  * `Nested`), the outermost such drawer's parent: a transformed tray is the
  * containing block of the fixed drawers in it, so it would clip.
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
  * Closes the drawers in the `Nested` portals with this drawer: unlike one
  * in the tray, they would else stay on the screen and then vanish. In a
  * microtask: `@onSnapPointChange` must not run during rendering.
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
  #closestDrawerRoot() {
    for (let node = this.#root ? logicalParent(this.#root) : null; node; node = logicalParent(node)) {
      if (isDrawerRoot(node)) return node;
    }
    return undefined;
  }
  /**
  * Sets the new `inert` attributes before it releases the old ones, so an
  * element that stays inert never loses it in between.
  */
  #makeOutsideInert() {
    const root = this.#root;
    const release = this.#releaseInert;
    this.#releaseInert = inertOutside(root, ...portalsOf(root));
    release?.();
  }
  /**
  * A portal can be added in an element that is inert already. In a
  * microtask: portals change during rendering.
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
  /** Also in a portal of a drawer nested in it. */
  #contains(node) {
    const root = this.#root;
    return !!root && logicallyContains(root, node);
  }
  #hasFocus() {
    return this.#contains(document.activeElement);
  }
  /**
  * Runs after the modal behaviour was undone, so the element isn't inert.
  * If it has left the page (e.g. a deleted list item), focus goes into its
  * nearest former ancestor still on the page, but never `<body>`.
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
  #ancestorsOf(element) {
    const path = [];
    for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      path.push(node);
    }
    return path;
  }
  #hiddenByDrawer(element) {
    for (const other of mountedDrawers) {
      if (other !== this && other.#hidden && other.#contains(element)) {
        return true;
      }
    }
    return false;
  }
  /**
  * A drawer around this open one closes. Else focus goes to `<body>`, where
  * the outer drawer returns it from. `#returnFocus` is kept, for when this
  * drawer closes after the outer one opens again.
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
  /** `data-nested` on every shown drawer that the front modal one covers. */
  static #syncNested() {
    const front = modalStack[modalStack.length - 1];
    const frontRoot = front ? front.#root : undefined;
    for (const drawer of mountedDrawers) {
      const root = drawer.#root;
      if (!root) continue;
      root.toggleAttribute('data-nested', !!frontRoot && drawer !== front && !drawer.#hidden && !logicallyContains(frontRoot, root));
    }
  }
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
  * `defaultPrevented` is left alone, so only the innermost nested drawer
  * closes. Not during a drag: the release decides where it goes, so the
  * parent never sees a close and a reopen.
  */
  #onKeyDown = event => {
    this.#stopMomentum();
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !this.#open || this.#drag || this.#destroyed) {
      return;
    }
    event.preventDefault();
    this.close();
  };
  /** Escape with focus outside (e.g. on `<body>`), and the Tab wrap. */
  #onDocumentKeyDown = event => {
    if (event.defaultPrevented || modalStack[modalStack.length - 1] !== this || this.#destroyed) {
      return;
    }
    if (event.key === 'Escape') {
      if (event.isComposing || !this.#open || this.#drag) return;
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      this.#trapTab(event);
    }
  };
  /** Only wraps at the ends: the rest of the page is inert anyway. */
  #trapTab(event) {
    const tray = this.#tray;
    const items = tabbables(tray);
    const active = document.activeElement;
    const inside = !!active && tray.contains(active);
    const first = items[0];
    const last = items[items.length - 1];
    // The focused element may not be tabbable itself (`tabindex="-1"`).
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
  * Screen px per px of drawer offset: not `1` under a scaled ancestor.
  * Forces layout, so once per drag.
  */
  #screenScale() {
    const layout = this.#layout;
    const rect = this.#tray.getBoundingClientRect();
    const scale = (this.axis === 'vertical' ? rect.height : rect.width) / layout.trayLength;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }
  #positionOf(data) {
    const position = this.axis === 'vertical' ? data.current.y : data.current.x;
    return Number.isFinite(position) ? position : undefined;
  }
  /**
  * The event's time stamp is when the input happened, also when the main
  * thread was busy. Tests can't set it, so they use the injected clock.
  */
  #timeOf(event) {
    const {
      dragTime
    } = drawerEnvironment;
    if (dragTime) return dragTime();
    if (this.#clock) return this.#clock.now();
    return event?.timeStamp ?? performance.now();
  }
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
  /** Read when a touch starts, so `#render` keeps it up to date. */
  trayTouchAction = () => {
    if (this.#atTop) return 'pan-x pan-y';
    return this.axis === 'vertical' ? 'pan-x' : 'pan-y';
  };
  /** Once per gesture, after a touch on a moving drawer has held it. */
  shouldDrag = (movement, target) => {
    const layout = this.#layout;
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    if (!layout || !tray) return true;
    if (this.#renderedOffset < layout.maxOffset - EPSILON) return true;
    if (this.#onHandle(target)) return true;
    return !this.#scrollChain(target).some(element => canScroll(element, this.axis === 'vertical', movement));
  };
  /** Innermost first. A gesture on the header has none. */
  #scrollChain(target) {
    const tray = this.#tray;
    const scroller = this.#scroller;
    if (!tray || !scroller) return [];
    const chain = [];
    for (let element = target instanceof Element ? target : scroller; element && tray.contains(element); element = element.parentElement) {
      if (element instanceof HTMLElement && (element === scroller || element.hasAttribute(SCROLL_ATTRIBUTE))) {
        chain.push(element);
      }
      if (element === scroller || element === tray) break;
    }
    return chain;
  }
  /**
  * The scroll handoff of a native sheet: a drag takes over a scroll that
  * reaches its scroll start while the finger pulls towards close. Only
  * while the finger is down: momentum never moves the drawer. Before that,
  * `overscroll-behavior: none` near that end, so the content doesn't bounce
  * (iOS) and then jump back when the drag locks it.
  */
  onTrayScroll = (step, target) => {
    const layout = this.#layout;
    if (!layout || this.#destroyed || this.#drag || this.#inNested(target)) {
      return false;
    }
    const vertical = this.axis === 'vertical';
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
  onTrayScrollEnd = () => {
    this.#overscroll.restoreAll();
  };
  /** iOS applies a change during a scroll. */
  #setOverscroll(element, none) {
    const property = this.axis === 'vertical' ? 'overscroll-behavior-y' : 'overscroll-behavior-x';
    if (none && this.#overscroll.get(element)?.property === property) return;
    this.#overscroll.restore(element);
    if (none) this.#overscroll.set(element, property, 'none');
  }
  /**
  * Not a nested drawer's handle. A text field in a handle is not part of
  * it, so text selection in it keeps working.
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
  * So the handle's drag source cancels the touchmoves too, also with
  * `@handleOnly`, where the tray isn't a drag source.
  */
  shouldHandleDrag = (_movement, target) => this.#onHandle(target);
  /** Its gestures belong to the nested drawer only. */
  #inNested(target) {
    const root = this.#root;
    if (!root || !(target instanceof Element) || !root.contains(target)) {
      return false;
    }
    // A mounted drawer's root, not any element with the `mobile-drawer`
    // class (an app element may reuse it).
    for (let element = target; element && element !== root; element = element.parentElement) {
      if (isDrawerRoot(element)) return true;
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
  * A touch holds a running animation at once, like native sheets, not only
  * once a pan is recognised. Lifting without a drag resumes it, so taps on
  * content keep working.
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
  * Locks scroll containers added, or rewritten by the app, after the lock,
  * before the browser scrolls them. On the tray itself, so it works with
  * `@handleOnly` and any pointer type.
  */
  #onTrayInput = event => {
    // As in a native scroll view.
    this.#stopMomentumOnInput(event);
    const tray = this.#tray;
    const {
      target
    } = event;
    if (!tray || !this.#scrollLockProperty || !(target instanceof Element)) {
      return;
    }
    const between = [];
    for (let element = target; element && element !== tray && tray.contains(element); element = element.parentElement) {
      between.push(element);
    }
    this.#lockContainers(tray, between);
  };
  /**
  * Keyboard focus on an element that isn't fully visible moves the drawer
  * to its highest snap point: below it the content can't scroll, so this is
  * the only way to show it. From a peek the drawer opens but isn't modal.
  * A tap shows what it focuses, so only keyboard focus, and any focus on a
  * typing field (to show it above the on-screen keyboard). Not the drawer's
  * own initial focus: the app chose that snap point. Visibility is checked
  * at the active snap point, so an opening drawer doesn't move for an
  * element that will show.
  */
  #onTrayFocusIn = event => {
    const tray = this.#tray;
    const {
      target,
      relatedTarget: from
    } = event;
    // Also inside an open shadow root.
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
    // An app may focus an element as it renders.
    queueMicrotask(() => {
      if (this.#destroyed || this.#reveal !== element || this.#drag || this.#hidden || this.#isHighest(this.#offsetOf(this.activeSnapPoint))) {
        return;
      }
      this.#resetRootScroll();
      if (!this.#open) {
        // Not modal. A controlled parent that doesn't take the new index in
        // this task doesn't get a non-modal drawer later.
        this.#focusOpenPending = true;
        setTimeout(() => this.#focusOpenPending = false);
      }
      this.open();
    });
  };
  /**
  * A drawer that focus opened goes back to its peek when focus moves out,
  * but not when it goes nowhere (`relatedTarget` `null`: the window lost
  * focus, or a click on something that can't take it).
  */
  #onRootFocusOut = event => {
    const to = event.relatedTarget;
    // Not when only the window lost focus.
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
  * The sheet and root are `overflow: hidden`, but a browser that scrolls a
  * focused element into view scrolls them too, and the tray leaves its
  * edge. Chrome scrolls before the focus events, others after, so this
  * runs both before a focus move and on every `scroll`.
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
  * Where the content can show, in screen px, with the tray moved by
  * `shift`: the tray, the root and the sheet (a floating sheet ends above
  * the root's edge) clip it. A scroll of the root is undone.
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
  /** Forces layout, so only for focus changes. */
  #isVisibleAt(element, offset) {
    const root = this.#root;
    const sheet = this.#sheet;
    const vertical = this.axis === 'vertical';
    // Also undoes a scroll of the sheet or the root, which moves the tray
    // and the element alike, but not the root.
    const shift = (OPENING_DIRECTION[this.placement] * (offset - this.#renderedOffset) + (vertical ? root.scrollTop + sheet.scrollTop : root.scrollLeft + sheet.scrollLeft)) * this.#screenScale();
    const sheetShift = ((this.#isFloating() ? this.#sinkOf(offset) : 0) - this.#moved) * this.#screenScale();
    const visible = this.#visibleRange(shift, sheetShift);
    const rect = element.getBoundingClientRect();
    const start = (vertical ? rect.top : rect.left) + shift;
    const end = (vertical ? rect.bottom : rect.right) + shift;
    return start >= visible.start - EPSILON && end <= visible.end + EPSILON;
  }
  /**
  * After focus moved the drawer up: the tray was locked, so the browser
  * may not have scrolled the element into view (e.g. `preventScroll`).
  * Side drawers scroll across their axis, which isn't locked.
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
    const header = this.#header;
    if (header) {
      // The header doesn't scroll.
      if (header.contains(element)) return;
      const box = this.#content.getBoundingClientRect();
      visible.start = Math.max(visible.start, box.top);
      visible.end = Math.min(visible.end, box.bottom);
    }
    const rect = element.getBoundingClientRect();
    // Its start first of all.
    let delta = Math.max(0, rect.bottom - visible.end);
    delta = Math.min(delta, rect.top - visible.start);
    if (Math.abs(delta) <= EPSILON) return;
    this.#scroller.scrollBy({
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
    // A nested drawer's content can scroll.
    if (!touch || !this.handleOnly || !this.#scrollLockProperty || this.#inNested(event.target)) {
      return;
    }
    this.#lockedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      far: false
    };
  };
  /**
  * With `@handleOnly` below the highest snap point nothing else cancels a
  * swipe along the axis on the locked content, and iOS then scrolls the
  * page behind it, whatever `overscroll-behavior` says. Decided as in
  * `dragSource`; never drags.
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
  #listenNested(element, add) {
    if (!add) {
      element.removeEventListener('touchstart', this.#onNestedTouchStart);
      element.removeEventListener('touchmove', this.#onNestedTouchMove);
      element.removeEventListener('touchend', this.#onNestedTouchEnd);
      element.removeEventListener('touchcancel', this.#onNestedTouchEnd);
      element.removeEventListener('wheel', this.#onNestedWheel);
      return;
    }
    element.addEventListener('touchstart', this.#onNestedTouchStart, {
      passive: true
    });
    element.addEventListener('touchmove', this.#onNestedTouchMove, {
      passive: false
    });
    element.addEventListener('touchend', this.#onNestedTouchEnd);
    element.addEventListener('touchcancel', this.#onNestedTouchEnd);
    element.addEventListener('wheel', this.#onNestedWheel, {
      passive: false
    });
  }
  /** The outermost nested drawer that `target` is in. */
  #nestedRoot(target) {
    const root = this.#root;
    let found;
    for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
      if (element === root || this.#portals.has(element)) {
        return found;
      }
      if (isDrawerRoot(element)) found = element;
    }
    return undefined;
  }
  /** `composedPath()`, so elements in an open shadow root count too. */
  #nestedPath(event, root) {
    const path = [];
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      path.push(node);
      if (node === root) break;
    }
    return path;
  }
  #onNestedTouchStart = event => {
    const current = this.#nestedTouch;
    // A gesture whose touch is gone ended without its touchend reaching
    // this drawer (e.g. its element was removed): start over.
    if (current && Array.from(event.touches).some(touch => touch.identifier === current.id)) {
      return;
    }
    this.#nestedTouch = undefined;
    const touch = event.changedTouches[0];
    const root = this.#nestedRoot(event.target);
    if (!touch || !root) return;
    const scrollers = [];
    let own = false;
    for (const element of this.#nestedPath(event, root)) {
      const style = getComputedStyle(element);
      if (handlesOwnGesture(element, style)) {
        own = true;
        break;
      }
      // `hidden` too: a locked scroll container can be unlocked meanwhile.
      if (/auto|scroll|hidden/.test(style.overflowX) || /auto|scroll|hidden/.test(style.overflowY)) {
        scrollers.push(element);
      }
    }
    this.#nestedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      scrollers,
      own
    };
  };
  /**
  * A gesture in a nested drawer never scrolls this drawer or the page:
  * unless something in the nested drawer can scroll that way, it is
  * cancelled. Else iOS Safari scrolls the nearest ancestor that can, also
  * past `overscroll-behavior: contain` on an element with nothing to scroll
  * or that is locked. Decided once per gesture, as in `dragSource`.
  */
  #onNestedTouchMove = event => {
    const gesture = this.#nestedTouch;
    if (!gesture || gesture.own || event.touches.length > 1) return;
    const touch = Array.from(event.changedTouches).find(changed => changed.identifier === gesture.id);
    if (!touch) return;
    if (gesture.cancels === undefined) {
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECISION_SLOP) return;
      const vertical = Math.abs(dy) >= Math.abs(dx);
      gesture.cancels = !gesture.scrollers.some(element => canScroll(element, vertical, vertical ? dy : dx));
    }
    if (gesture.cancels && event.cancelable) event.preventDefault();
  };
  #onNestedTouchEnd = event => {
    const gesture = this.#nestedTouch;
    if (gesture && Array.from(event.changedTouches).some(touch => touch.identifier === gesture.id)) {
      this.#nestedTouch = undefined;
    }
  };
  /** As `#onNestedTouchMove` for a wheel. `ctrlKey` is a pinch-zoom. */
  #onNestedWheel = event => {
    if (event.ctrlKey || !event.cancelable) return;
    const root = this.#nestedRoot(event.target);
    if (!root) return;
    // `deltaY` > 0 scrolls as a finger moving up does.
    const dx = -event.deltaX;
    const dy = -event.deltaY;
    if (dx === 0 && dy === 0) return;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    if (!this.#nestedPath(event, root).some(element => canScroll(element, vertical, vertical ? dy : dx))) {
      event.preventDefault();
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
    // One drag at a time.
    this.#drag) {
      return;
    }
    // The rendered offset, not the spring's value, which the render clamps.
    spring.stop();
    this.#stopScrollReset();
    this.#stopMomentum();
    this.#endHold();
    const offset = this.#renderedOffset;
    // Anchored at the touchdown the tray would jump by didPan's threshold,
    // so it starts where it is and catches up over the first frames.
    const scale = this.#screenScale();
    const initial = data.initial;
    let down = this.axis === 'vertical' ? initial?.y : initial?.x;
    let recognisedAt = OPENING_DIRECTION[this.placement] * (position - (down ?? NaN)) / scale;
    if (!Number.isFinite(recognisedAt)) {
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
    // The browser still scrolls a handed-off gesture.
    if (drag.handoff) this.#syncScrollLock();
    this.#velocity.reset();
    this.#scrollVelocity.reset();
    this.#queueState({
      isDragging: true
    });
    this.#follow(drag, drag.lagStart);
    // The finger's velocity, not the catch-up's.
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
    const delta = OPENING_DIRECTION[this.placement] * (position - drag.startPosition) / drag.scale;
    if (!Number.isFinite(delta)) return;
    const now = this.#now();
    const lag = drag.delta - drag.drawn;
    const step = delta - drag.delta;
    // The way the tray catches up: 1 or -1, 0 when it has caught up.
    const way = Math.sign(drag.lagFrom);
    if (drag.holding) {
      if (lag === 0) {
        drag.holding = false;
      } else if (step * lag > 0) {
        // On again, away from the tray: ease the gap from here.
        drag.lagFrom = lag;
        drag.lagStart = now;
        drag.holding = false;
        drag.peak = delta;
      } else {
        const drawn = way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
        drag.lagFrom = delta - drawn;
      }
    } else if (lag !== 0 && (drag.peak - delta) * way > TURN_SLOP / drag.scale) {
      // Back towards the tray, further than a jitter: the tray holds still
      // until the finger reaches it. Easing on would take it past the finger.
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
  * After resistance, so a release past an end doesn't hand the spring more
  * speed than the tray had, and the catch-up adds none.
  */
  #addVelocity(drag, data) {
    const time = this.#timeOf(data.originalEvent);
    this.#velocity.add(time, drag.target);
    if (drag.scroll) {
      this.#scrollVelocity.add(time, this.#splitDrag(drag, drag.delta)[1]);
    }
  }
  #now() {
    return (this.#clock ?? browserClock).now();
  }
  /**
  * While it lags, the tray also moves every frame, so it catches up when
  * the finger holds still. It is never past the finger.
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
  * `[tray, scroll]`. A drag past the highest snap point scrolls the content
  * from script: in iOS Safari a native scroll can't start in a gesture
  * whose touchmoves were cancelled. Back towards close the content scrolls
  * back first. Once the content is reached, the split only depends on
  * `delta`.
  */
  #splitDrag(drag, delta) {
    const at = drag.scrollAt;
    const scroll = drag.scroll;
    if (at === undefined || !scroll) return [delta, 0];
    const scrolled = clamp(delta - at, -scroll.back, scroll.room);
    return [delta - scrolled, scrolled];
  }
  /** Reads layout once per drag. */
  #reachContent(drag) {
    if (drag.scroll !== undefined || drag.scrollAt === undefined || !(drag.drawn > drag.scrollAt)) {
      return;
    }
    drag.scroll = null;
    const vertical = this.axis === 'vertical';
    const sign = -OPENING_DIRECTION[this.placement];
    for (const element of this.#scrollChain(drag.from)) {
      if (!(scrollRange(element, vertical) > EPSILON)) continue;
      const style = this.#unlockedStyle(element);
      if (!scrollsAlong(style, vertical)) continue;
      const {
        min,
        max,
        position
      } = scrollBounds(element, vertical, style);
      const start = clamp(position, min, max);
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
  /** The lock may still be on for this frame, or for a handed-off drag. */
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
  /** `instant`, as `#writeScroll`. */
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
  * The content of a drag goes on after the release like a native scroll
  * view, since it was scrolled from script. Any input on the tray stops it.
  */
  #startMomentum(drag, velocity) {
    const scroll = drag.scroll;
    if (!scroll) return;
    // px/s towards open to scroll px/ms.
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
  /** Returns whether one was running. */
  #stopMomentum() {
    const momentum = this.#momentum;
    momentum?.stop();
    return momentum !== undefined;
  }
  /** As in a native scroll view, a tap that stops momentum doesn't click. */
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
  #stopMomentumOnInput(event) {
    if (event.type === 'pointerdown' || event.type === 'touchstart') {
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
  * The clock's time, not the frame's time stamp: input of the same frame is
  * handled after it, so the tray would move back a little.
  */
  #catchUpFrame = () => {
    const drag = this.#drag;
    if (!drag || this.#destroyed) return;
    drag.frame = undefined;
    const now = this.#now();
    if (drag.holding && !drag.moved) {
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
    // A cancelled pointer has no meaningful position or velocity.
    const type = data.originalEvent?.type;
    const cancelled = type === 'pointercancel' || type === 'touchcancel';
    if (!cancelled) this.onPan(data, source);
    const drag = this.#endDrag();
    const time = this.#timeOf(data.originalEvent);
    // Released while the content scrolls: the tray's velocity from before
    // (in the last samples) would carry it past the snap point.
    const scroll = drag.scroll;
    const scrolling = scroll && drag.scrollAt !== undefined && drag.delta >= drag.scrollAt - scroll.back && drag.delta <= drag.scrollAt + scroll.room;
    const velocity = cancelled || scrolling ? 0 : this.#velocity.velocity(time);
    this.#release(drag.offset, velocity, drag.target);
    if (!cancelled && scrolling) {
      this.#startMomentum(drag, this.#scrollVelocity.velocity(time));
    }
  };
  /**
  * Its pointer events won't arrive any more: settle as on `pointercancel`.
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
  * Controlled, the drawer heads for the active snap point until the parent
  * passes the new one in: the parent always wins. The spring starts at
  * `offset`, where the tray is; the snap point is picked for `released`,
  * where the finger put it (ahead while the tray catches up).
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
  * In a microtask: the hooks run during rendering, where writing rendered
  * tracked state is an error. Batching keeps it coarse: a run that starts
  * and ends in one task never flips `isAnimating`.
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
      const {
        isAnimating,
        progress,
        isDragging
      } = pending;
      if (isAnimating !== undefined && isAnimating !== this.isAnimating) {
        this.isAnimating = isAnimating;
      }
      if (progress !== undefined && progress !== this.progress) {
        this.progress = progress;
      }
      if (isDragging !== undefined && isDragging !== this.isDragging) {
        this.isDragging = isDragging;
      }
      if (pending.openSnapPoints) {
        this.openSnapPoints = pending.openSnapPoints;
      }
    });
  }
  static {
    setComponentTemplate(precompileTemplate("<div class=\"mobile-drawer\" data-placement={{this.placement}} data-header={{if (has-block \"header\") \"\"}} data-closed role={{if this.isModal \"dialog\"}} aria-modal={{if this.modalActive \"true\"}} ...attributes {{lifecycle this.hooks this.placement this.snapPoints this.activeSnapPoint this.isModal}}>\n  {{#if this.showBackdrop}}\n    <div class=\"mobile-drawer__backdrop\" {{lifecycle this.backdropHooks}}></div>\n    <div class=\"mobile-drawer__backdrop-tint\" aria-hidden=\"true\"></div>\n  {{/if}}\n  <div class=\"mobile-drawer__shadow\" aria-hidden=\"true\">\n    <div class=\"mobile-drawer__shadow-edge\"></div>\n    <div class=\"mobile-drawer__shadow-clip\">\n      <div class=\"mobile-drawer__shadow-body\"></div>\n    </div>\n  </div>\n  <div class=\"mobile-drawer__sheet\">\n    <div class=\"mobile-drawer__glass\" aria-hidden=\"true\"></div>\n    <div class=\"mobile-drawer__tray\" tabindex={{if this.isModal \"-1\"}} {{(if this.handleOnly noop (modifier dragSource axis=this.axis pointerTypes=POINTER_TYPES onPointerDown=this.onPointerDown onPanStart=this.onPanStart onPan=this.onPan onPanEnd=this.onPanEnd onTeardown=this.onDragSourceTeardown shouldDrag=this.shouldDrag touchAction=this.trayTouchAction onScroll=this.onTrayScroll onScrollEnd=this.onTrayScrollEnd))}}>\n      {{#let (modifier dragSource axis=this.axis pointerTypes=POINTER_TYPES onPointerDown=this.onPointerDown onPanStart=this.onPanStart onPan=this.onPan onPanEnd=this.onPanEnd onInstall=this.onHandleInstall shouldDrag=this.shouldHandleDrag onTeardown=this.onHandleTeardown) as |handle|}}\n        {{#let (hash snapTo=this.snapTo open=this.open close=this.close activeSnapPoint=this.activeSnapPoint handle=handle Grabber=(component Grabber owner=this.grabberOwner handle=handle activeSnapPoint=this.activeSnapPoint openSnapPoints=this.openSnapPoints) isDragging=this.isDragging isAnimating=this.isAnimating progress=this.progress Nested=(component NestedPortal owner=this.nestedOwner fallback=this.nestedParent)) as |drawer|}}\n          {{!-- The header is at the leading edge, in the DOM order too. --}}\n          {{#if (has-block \"header\")}}\n            {{#if this.headerFirst}}\n              <div class=\"mobile-drawer__header\">\n                {{yield drawer to=\"header\"}}\n              </div>\n            {{/if}}\n          {{/if}}\n          <div class=\"mobile-drawer__content\">\n            {{yield drawer}}\n          </div>\n          {{#if (has-block \"header\")}}\n            {{#unless this.headerFirst}}\n              <div class=\"mobile-drawer__header\">\n                {{yield drawer to=\"header\"}}\n              </div>\n            {{/unless}}\n          {{/if}}\n        {{/let}}\n      {{/let}}\n    </div>\n  </div>\n  <div class=\"mobile-drawer__bar-tint\" aria-hidden=\"true\"></div>\n</div>", {
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
//# sourceMappingURL=mobile-drawer-D3acwMSp.js.map
