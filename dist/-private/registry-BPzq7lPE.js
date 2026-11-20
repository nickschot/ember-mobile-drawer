import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { registerDestructor } from '@ember/destroyable';

/** The subset of `didPan`'s event data the drawer reads. */

/** The part of `DidPanModifier` this extends. */

const DidPan = didPan;

/** One touch (or pen) gesture on the element, from down until it lifts. */

/**
 * Px along the axis before a gesture is decided. Below the browser's touch
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
 * `didPan` that also reports pointerdown, install and teardown. `didPan`
 * removes its listeners on teardown, so without `onTeardown` a drag whose
 * element goes away (or whose modifier is swapped) would never end.
 *
 * It arbitrates between dragging and native scrolling (`shouldDrag`). A
 * gesture is decided after `DECISION_SLOP` px along the axis, or at the
 * latest when `didPan` recognises a pan, and keeps its decision until the
 * finger lifts. Only a drag that turns sideways before the pan starts is
 * released to the browser.
 *
 * A drag cancels its `touchmove` events: iOS Safari does not reliably honour
 * `touch-action` on a scroll container. Touchmoves before the decision are
 * never cancelled, so swipes across the axis keep working.
 *
 * Scroll handoff (`onScroll`): after the browser takes a scroll over, only
 * (non-cancelable) touch events arrive. `onScroll` can then start a drag
 * where the finger is; touch events drive it until the finger lifts, and
 * `didPan`'s own callbacks are ignored.
 *
 * It relies only on `didPan` being a class-based ember-modifier and on its
 * documented arguments; the gesture tests catch a breaking change.
 *
 * @internal
 */
class DragSourceModifier extends DidPan {
  #element;
  #named;
  #gesture;
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

  /** Decides the gesture once past the slop, or when `force`d by `didPan`. */
  #decide(x, y, force = false) {
    const gesture = this.#gesture;
    const named = this.#named;
    if (!gesture || !named) return undefined;
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
        // Decided here at the latest. Without a gesture the pan drags.
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
      onPan: data => {
        if (!this.#gesture?.handoff) args.onPan(data, element);
      },
      onPanEnd: data => {
        if (!this.#gesture?.handoff) args.onPanEnd(data, element);
      }
    });
    // didPan has just written its own touch-action.
    if (args.touchAction) element.style.touchAction = args.touchAction();
    const installed = this.#element !== element;
    if (installed) {
      this.#endGesture();
      this.#listen(this.#element, false);
      this.#element = element;
      this.#listen(element, true);
    }
    this.#named = args;
    if (installed) args.onInstall?.(element);
  }
}
const dragSource = DragSourceModifier;

/**
 * Overrides for the environment the drawer runs in; unset fields use the
 * browser. Read when a drawer is inserted, so set it before rendering.
 *
 * @internal Not public API: for the addon's tests and test-support.
 */
const drawerEnvironment = {};

/**
 * Ms before the release that count. Long enough to smooth noisy events, short
 * enough that a finger that stopped before lifting has (almost) no velocity.
 */
const VELOCITY_WINDOW = 100;

/** Px/s. Stops events with nearly equal time stamps giving absurd speeds. */
const MAX_VELOCITY = 8000;
/**
 * The average velocity over the last `VELOCITY_WINDOW` ms. Always finite (`0`
 * when unknown): the spring and the snap-point functions throw otherwise.
 */
class VelocityTracker {
  #samples = [];
  reset() {
    this.#samples = [];
  }

  /** A sample older than the previous one is ignored. */
  add(time, position) {
    if (!Number.isFinite(time) || !Number.isFinite(position)) return;
    const last = this.#samples[this.#samples.length - 1];
    if (last && time < last.time) return;
    this.#samples.push({
      time,
      position
    });
    const cutoff = time - VELOCITY_WINDOW;
    const firstInWindow = this.#samples.findIndex(s => s.time >= cutoff);
    if (firstInWindow > 0) this.#samples.splice(0, firstInWindow);
  }

  /** Px/s. */
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
 * What the test-support helpers need from a rendered drawer, by root.
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

/** Not just any element with the `mobile-drawer` class. */
function isDrawerRoot(element) {
  return drawers.has(element);
}

/** The innermost drawer whose root is or contains `element`. */
function drawerFor(element) {
  for (let node = element; node; node = node.parentElement) {
    const handle = drawers.get(node);
    if (handle) return handle;
  }
  return undefined;
}

export { DECISION_SLOP as D, VelocityTracker as V, dragSource as a, VELOCITY_WINDOW as b, drawerFor as c, drawerEnvironment as d, isDrawerRoot as i, registerDrawer as r, unregisterDrawer as u };
//# sourceMappingURL=registry-BPzq7lPE.js.map
