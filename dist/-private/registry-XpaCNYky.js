import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { registerDestructor } from '@ember/destroyable';

/** The subset of `didPan`'s event data the drawer reads. */

/**
 * The part of ember-gesture-modifiers' `DidPanModifier` this extends: the
 * standard ember-modifier `modify` hook, called with `didPan`'s public named
 * arguments.
 */

const DidPan = didPan;

/** One touch (or pen) gesture on the element, from down until it lifts. */

/**
 * How far (px) the finger must move along the axis, and further along it
 * than across it, before a gesture is decided. Below the browser's own touch
 * slop, so the decision comes before native scrolling could start.
 */
const DECISION_SLOP = 4;
const CAPTURE = {
  capture: true
};
const PASSIVE = {
  passive: true
};
const findTouch = (list, id) => id === undefined ? undefined : Array.from(list).find(touch => touch.identifier === id);

/**
 * `didPan` that also tells the drawer which element a pan came from, when a
 * pointer goes down on it (before a pan is recognised) and when it is torn
 * down. `didPan` removes its listeners on teardown, so without that a drag
 * whose element is removed (or whose modifier is swapped out, e.g. when
 * `@handleOnly` changes) would never end.
 *
 * With `shouldDrag` it also arbitrates between dragging and native
 * scrolling. A gesture is decided once the finger has moved at least
 * `DECISION_SLOP` px along the axis and further along it than across it, or
 * at the latest when `didPan` recognises a pan. If it turns sideways before
 * `didPan` recognises a pan, a drag decision is released to the browser.
 * Otherwise the gesture keeps its decision until its finger lifts, so a
 * scroll never turns into a drag mid-gesture or the other way around. Only
 * the touch that started on the element counts.
 *
 * Once a gesture is decided as a drag, it calls `preventDefault()` on its
 * cancelable `touchmove` events so the browser doesn't scroll (or start a
 * scroll of an ancestor), whatever the element's `touch-action` says: iOS
 * Safari doesn't reliably honour `touch-action` on a scroll container. That
 * needs a non-passive `touchmove` listener, which is only added with
 * `shouldDrag`. Touchmoves before the decision, and after a drag decision
 * was released to the browser, are never cancelled, so swipes across the
 * axis keep working. A gesture that doesn't drag never reaches
 * `onPanStart` through `didPan`; usually the browser takes it over
 * (`pointercancel`) anyway.
 *
 * Scroll handoff (with `onScroll`): the browser keeps sending a scrolling
 * gesture's `touchmove` events (not cancelable) after it took the gesture
 * over, but no pointer events. For each of them `onScroll` decides whether
 * a drag takes the gesture over, e.g. once the content can't scroll further
 * the way the finger moves. The drag then starts where the finger is (so
 * the tray doesn't jump) and its touch events drive `onPanStart`, `onPan`
 * and `onPanEnd` (with the `touchend`, or a `touchcancel`) until the finger
 * lifts. `didPan`'s own callbacks are ignored during it. The gesture never
 * goes back to a scroll.
 *
 * Extends the modifier class, so it uses `didPan`'s own modifier manager.
 * It relies only on that class being a class-based ember-modifier (its
 * `modify` hook and destructors) and on `didPan`'s documented arguments; the
 * callbacks go in through `onPanStart`/`onPan`/`onPanEnd`. The gesture tests
 * cover this, so a breaking change in a future ember-gesture-modifiers
 * shows up there.
 *
 * @internal
 */
class DragSourceModifier extends DidPan {
  #element;
  #named;
  #gesture;
  /** Whether the arbitration listeners are on `#element`. */
  #arbitrating = false;
  constructor(owner, args) {
    super(owner, args);
    registerDestructor(this, () => {
      const element = this.#element;
      this.#endGesture();
      this.#listen(element, false);
      this.#element = undefined;
      if (element) this.#named?.onTeardown(element);
    });
  }
  #listen(element, add) {
    if (!element) return;
    if (!add) {
      element.removeEventListener('pointerdown', this.#onPointerDown);
      element.removeEventListener('pointermove', this.#onPointerMove);
      element.removeEventListener('touchstart', this.#onTouchStart);
      element.removeEventListener('touchmove', this.#onTouchMove);
      return;
    }
    element.addEventListener('pointerdown', this.#onPointerDown, PASSIVE);
    if (!this.#arbitrating) return;
    element.addEventListener('pointermove', this.#onPointerMove, PASSIVE);
    element.addEventListener('touchstart', this.#onTouchStart, PASSIVE);
    // Not passive: a drag cancels its touchmoves so the browser won't scroll.
    element.addEventListener('touchmove', this.#onTouchMove, {
      passive: false
    });
  }
  #onPointerDown = event => {
    const element = this.#element;
    const named = this.#named;
    if (!element || !named?.pointerTypes.includes(event.pointerType)) return;
    if (this.#arbitrating) {
      const gesture = this.#gesture;
      if (!gesture) {
        this.#startGesture({
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          target: event.target
        });
      } else if (gesture.pointerId === undefined) {
        gesture.pointerId = event.pointerId;
      }
    }
    named.onPointerDown(event, element);
  };
  #onPointerMove = event => {
    if (this.#gesture && this.#gesture.pointerId === event.pointerId) {
      this.#decide(event.clientX, event.clientY);
    }
  };
  #onTouchStart = event => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    let gesture = this.#gesture;
    // A gesture whose touch is gone ended without its touchend reaching the
    // document, e.g. because the touched element was removed: start over.
    if (gesture?.touchId !== undefined && !findTouch(event.touches, gesture.touchId)) {
      if (gesture.handoff) {
        // Its drag ends as on a cancel.
        this.#named?.onPanEnd(this.#touchData(gesture.lastX ?? gesture.x, gesture.lastY ?? gesture.y, new Event('touchcancel')), this.#element);
      }
      this.#endGesture();
      gesture = undefined;
    }
    if (!gesture) {
      this.#startGesture({
        touchId: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        target: event.target
      });
    } else if (gesture.touchId === undefined) {
      gesture.touchId = touch.identifier;
    }
    const current = this.#gesture;
    if (current?.touchId === touch.identifier) {
      current.lastX = touch.clientX;
      current.lastY = touch.clientY;
    }
  };
  #onTouchMove = event => {
    const gesture = this.#gesture;
    const touch = findTouch(event.changedTouches, gesture?.touchId);
    if (!gesture || !touch) return;
    const {
      clientX: x,
      clientY: y
    } = touch;
    const lastX = gesture.lastX ?? gesture.x;
    const lastY = gesture.lastY ?? gesture.y;
    gesture.lastX = x;
    gesture.lastY = y;
    const drags = this.#decide(x, y);
    if (drags && event.cancelable) event.preventDefault();
    if (gesture.handoff) {
      if (event.cancelable) event.preventDefault();
      this.#named?.onPan(this.#touchData(x, y, event), this.#element);
      return;
    }
    const named = this.#named;
    if (drags !== false || !gesture.scrolls || !named?.onScroll) return;
    const step = named.axis === 'vertical' ? y - lastY : x - lastX;
    if (step === 0 || !named.onScroll(step, gesture.target)) return;
    // From here the drag follows the finger, from where it is now.
    gesture.handoff = true;
    gesture.panning = true;
    if (event.cancelable) event.preventDefault();
    named.onPanStart({
      ...this.#touchData(x, y, event),
      initial: {
        x,
        y
      },
      handoff: true,
      target: gesture.target
    }, this.#element);
  };

  /** `didPan`-like event data for a touch at `x`/`y`. */
  #touchData(x, y, originalEvent) {
    return {
      current: {
        x,
        y
      },
      originalEvent
    };
  }
  #onPointerEnd = event => {
    const gesture = this.#gesture;
    if (gesture && gesture.touchId === undefined && gesture.pointerId === event.pointerId) {
      this.#endGesture();
    }
  };
  #onTouchEnd = event => {
    const gesture = this.#gesture;
    const touch = findTouch(event.changedTouches, gesture?.touchId);
    if (!gesture || !touch) return;
    if (gesture.handoff) {
      gesture.handoff = false;
      this.#named?.onPanEnd(this.#touchData(touch.clientX, touch.clientY, event), this.#element);
    }
    this.#endGesture();
  };
  #startGesture(gesture) {
    this.#gesture = {
      ...gesture,
      panning: false
    };
    document.addEventListener('pointerup', this.#onPointerEnd, CAPTURE);
    document.addEventListener('pointercancel', this.#onPointerEnd, CAPTURE);
    document.addEventListener('touchend', this.#onTouchEnd, CAPTURE);
    document.addEventListener('touchcancel', this.#onTouchEnd, CAPTURE);
  }
  #endGesture() {
    const gesture = this.#gesture;
    if (!gesture) return;
    this.#gesture = undefined;
    if (gesture.scrolls) this.#named?.onScrollEnd?.();
    document.removeEventListener('pointerup', this.#onPointerEnd, CAPTURE);
    document.removeEventListener('pointercancel', this.#onPointerEnd, CAPTURE);
    document.removeEventListener('touchend', this.#onTouchEnd, CAPTURE);
    document.removeEventListener('touchcancel', this.#onTouchEnd, CAPTURE);
  }

  /**
   * Whether the current gesture drags, deciding it now if the finger at
   * `x`/`y` is past the slop, or when `force`d (`didPan` recognised a pan).
   * `undefined` while undecided.
   */
  #decide(x, y, force = false) {
    const gesture = this.#gesture;
    const named = this.#named;
    if (!gesture || !named?.shouldDrag) return undefined;
    const vertical = named.axis === 'vertical';
    const along = vertical ? y - gesture.y : x - gesture.x;
    const across = vertical ? x - gesture.x : y - gesture.y;
    if (gesture.drags === true && !gesture.panning && !force && Math.abs(across) > Math.abs(along)) {
      // Turned sideways before a pan started: leave it to the browser.
      gesture.drags = false;
    }
    if (gesture.drags !== undefined) return gesture.drags;
    if (!force && (Math.abs(along) < DECISION_SLOP || Math.abs(across) >= Math.abs(along))) {
      return undefined;
    }
    gesture.drags = named.shouldDrag(along, gesture.target);
    gesture.scrolls = !gesture.drags;
    return gesture.drags;
  }
  modify(element, positional, named) {
    const args = named;
    super.modify(element, positional, {
      axis: args.axis,
      pointerTypes: args.pointerTypes,
      onPanStart: data => {
        // Decided here at the latest. Without a gesture (e.g. the pointer
        // went down before arbitration was turned on) the pan drags.
        const gesture = this.#gesture;
        const drags = gesture ? this.#decide(data.current.x, data.current.y, true) : true;
        if (drags === false) return;
        if (!gesture) {
          args.onPanStart(data, element);
          return;
        }
        gesture.panning = true;
        args.onPanStart({
          ...data,
          target: gesture.target
        }, element);
      },
      // During a handoff the touch events drive the drag (see above).
      onPan: data => {
        if (!this.#gesture?.handoff) args.onPan(data, element);
      },
      onPanEnd: data => {
        if (!this.#gesture?.handoff) args.onPanEnd(data, element);
      }
    });
    // didPan has just written its own touch-action.
    if (args.touchAction) element.style.touchAction = args.touchAction();
    const arbitrating = args.shouldDrag !== undefined;
    const installed = this.#element !== element;
    if (installed || this.#arbitrating !== arbitrating) {
      this.#endGesture();
      this.#listen(this.#element, false);
      this.#element = element;
      this.#arbitrating = arbitrating;
      this.#listen(element, true);
    }
    this.#named = args;
    if (installed) args.onInstall?.(element);
  }
}
const dragSource = DragSourceModifier;

/**
 * Overrides for the environment the drawer runs in. Every field is optional;
 * unset fields use the browser defaults: those of {@link Spring}
 * (`performance.now` + `requestAnimationFrame`, and the
 * `prefers-reduced-motion` media query) and, for the body scroll lock, iOS
 * detection from `navigator`.
 *
 * Read when a drawer is inserted into the DOM, so set it before rendering.
 *
 * @internal Not public API. The addon's own tests use it to drive animations
 *   frame by frame with a fake clock, and to try the iOS scroll lock. The
 *   test-support helpers set `dragTime`.
 */
const drawerEnvironment = {};

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
const VELOCITY_WINDOW = 100;

/**
 * The largest velocity reported, in px/s. Faster than any real flick; it
 * stops events with nearly equal time stamps (e.g. coalesced or replayed
 * events) from producing absurd speeds.
 */
const MAX_VELOCITY = 8000;
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
class VelocityTracker {
  #samples = [];

  /** Forgets all samples. */
  reset() {
    this.#samples = [];
  }

  /**
   * Adds a sample. `time` is in ms and must not go backwards; a sample older
   * than the previous one is ignored.
   */
  add(time, position) {
    if (!Number.isFinite(time) || !Number.isFinite(position)) return;
    const last = this.#samples[this.#samples.length - 1];
    if (last && time < last.time) return;
    this.#samples.push({
      time,
      position
    });
    // Drop samples that have left the window.
    const cutoff = time - VELOCITY_WINDOW;
    const firstInWindow = this.#samples.findIndex(s => s.time >= cutoff);
    if (firstInWindow > 0) this.#samples.splice(0, firstInWindow);
  }

  /**
   * The average velocity in px/s over the samples taken within
   * {@link VELOCITY_WINDOW} ms before `now`, or `0` when that can't be
   * determined.
   */
  velocity(now) {
    if (!Number.isFinite(now)) return 0;
    const cutoff = now - VELOCITY_WINDOW;
    const samples = this.#samples.filter(s => s.time >= cutoff && s.time <= now);
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return 0;
    const dt = last.time - first.time;
    if (!(dt > 0)) return 0;
    const velocity = (last.position - first.position) / dt * 1000;
    if (!Number.isFinite(velocity)) return 0;
    return Math.min(Math.max(velocity, -MAX_VELOCITY), MAX_VELOCITY);
  }
}

/**
 * What the test-support helpers need from a rendered drawer. They only get
 * the DOM, so each drawer registers this for its root element.
 *
 * @internal Not public API; see `ember-mobile-drawer/test-support`.
 */

const drawers = new WeakMap();
function registerDrawer(handle) {
  drawers.set(handle.root, handle);
}
function unregisterDrawer(root) {
  drawers.delete(root);
}

/**
 * The drawer whose root is `element` or contains it: the innermost one, for
 * nested drawers.
 */
function drawerFor(element) {
  for (let node = element; node; node = node.parentElement) {
    const handle = drawers.get(node);
    if (handle) return handle;
  }
  return undefined;
}

export { DECISION_SLOP as D, VelocityTracker as V, dragSource as a, VELOCITY_WINDOW as b, drawerFor as c, drawerEnvironment as d, registerDrawer as r, unregisterDrawer as u };
//# sourceMappingURL=registry-XpaCNYky.js.map
