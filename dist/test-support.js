import { settled, getRootElement } from '@ember/test-helpers';
import { d as drawerEnvironment, D as DECISION_SLOP, b as VELOCITY_WINDOW, c as drawerFor } from './-private/registry-XpaCNYky.js';

/** A touch on the screen that isn't the simulated finger, see `TouchPointer`. */

/**
 * Whether this browser can construct touch events. Desktop Firefox and
 * Safari can't (no `Touch` constructor); `TouchPointer` then only sends
 * pointer events, which is all the drawer needs to drag.
 */
function canTouch() {
  try {
    new Touch({
      identifier: 0,
      target: document.body
    });
    return typeof TouchEvent === 'function';
  } catch {
    return false;
  }
}

/**
 * One finger on `target`, sending the events a browser sends for touch
 * input: a pointer event and, where the browser can construct them, a touch
 * event for every step. Events are dispatched on `target` only and bubble,
 * as the browser dispatches them on the element the finger went down on.
 * Coordinates are client (screen) px.
 *
 * @internal Shared by `dragDrawer` and the addon's own gesture tests.
 */
class TouchPointer {
  target;
  pointerId;
  x;
  y;
  #resting;
  #touch = canTouch();
  constructor(target, x, y, {
    pointerId = 1,
    resting = []
  } = {}) {
    this.target = target;
    this.x = x;
    this.y = y;
    this.pointerId = pointerId;
    this.#resting = resting;
  }

  /** Puts the finger down: `pointerdown` and `touchstart`. */
  down() {
    this.#pointer('pointerdown');
    this.#touchEvent('touchstart', true);
  }

  /**
   * Moves the finger by `dx`/`dy`: `pointermove` and `touchmove`. Returns
   * whether the `touchmove` was cancelled (`preventDefault()`), which is
   * what stops the browser from scrolling; `false` without touch events.
   */
  move(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.#pointer('pointermove');
    return this.#touchEvent('touchmove', true);
  }

  /** Lifts the finger where it is: `pointerup` and `touchend`. */
  up() {
    this.#pointer('pointerup');
    this.#touchEvent('touchend', false);
  }

  /** The browser takes the gesture over: `pointercancel`, and `touchcancel`. */
  cancel() {
    this.#pointer('pointercancel');
    this.#touchEvent('touchcancel', false);
  }
  #pointer(type) {
    this.target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: type !== 'pointercancel',
      pointerId: this.pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: this.x,
      clientY: this.y
    }));
  }
  #touchEvent(type, down) {
    if (!this.#touch) return false;
    const own = new Touch({
      identifier: this.pointerId,
      target: this.target,
      clientX: this.x,
      clientY: this.y
    });
    const resting = this.#resting.map(({
      identifier,
      target,
      x,
      y
    }) => new Touch({
      identifier,
      target,
      clientX: x,
      clientY: y
    }));
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: type !== 'touchcancel',
      touches: down ? [...resting, own] : resting,
      targetTouches: down ? [own] : [],
      changedTouches: [own]
    });
    this.target.dispatchEvent(event);
    return event.defaultPrevented;
  }
}

/**
 * Test helpers for apps that use `<MobileDrawer>`, for rendering and
 * application tests (`@ember/test-helpers`).
 *
 * ```ts
 * import { openDrawer, closeDrawer, dragDrawer } from 'ember-mobile-drawer/test-support';
 * ```
 *
 * Every helper takes the drawer as a selector (looked up in the test's root
 * element, like `find`) or an element: the drawer's root, or any element in
 * it (the innermost drawer is used). A selector is only looked up inside
 * `getRootElement()`; for a drawer rendered outside it (e.g. with
 * `{{#in-element}}`), pass the element. Each one waits for `settled()`,
 * which waits for the drawer's animations.
 *
 * @module
 */

/** A drawer: a selector or an element, see the module docs. */

/** Options of {@link dragDrawer}. Pass either `to` or `distance`. */

/** Which way along each client axis opens the drawer. */
const OPENING = {
  bottom: {
    x: 0,
    y: -1
  },
  top: {
    x: 0,
    y: 1
  },
  left: {
    x: 1,
    y: 0
  },
  right: {
    x: -1,
    y: 0
  }
};

/**
 * How far (screen px) the finger moves before the drag starts: just past
 * the threshold of `didPan` (10px), so the pan is recognised. The drawer
 * catches up with that distance over the first frames of the drag, so it
 * counts towards the distance dragged.
 */
const RECOGNISE = [DECISION_SLOP, 8, 11];

/** The largest step (screen px) of a drag, and the most steps. */
const MAX_STEP = 10;
const MAX_STEPS = 60;

/** Fake time (ms) between the events of a drag without a velocity. */
const FRAME = 16;
function findDrawer(helper, target) {
  let element;
  if (typeof target === 'string') {
    element = getRootElement().querySelector(target);
    if (!element) {
      throw new Error(`${helper}: no element found for '${target}'. Selectors are looked up inside the test's root element; pass an element for a drawer rendered outside it.`);
    }
  } else if (target instanceof Element) {
    element = target;
  } else {
    throw new Error(`${helper}: pass a selector or an element.`);
  }
  const drawer = drawerFor(element);
  if (!drawer) {
    throw new Error(`${helper}: ${typeof target === 'string' ? `'${target}'` : 'the element'} is not a <MobileDrawer> or inside one.`);
  }
  return {
    element,
    drawer
  };
}

/**
 * Opens the drawer, like the yielded `open` action: to its largest snap
 * point. When `@activeSnapPoint` is set, this only calls
 * `@onSnapPointChange`; the drawer moves once the new index is passed in.
 * Waits for `settled()`.
 */
async function openDrawer(target = '.mobile-drawer') {
  findDrawer('openDrawer', target).drawer.open();
  await settled();
}

/**
 * Closes the drawer, like the yielded `close` action: to its smallest snap
 * point. See {@link openDrawer}.
 */
async function closeDrawer(target = '.mobile-drawer') {
  findDrawer('closeDrawer', target).drawer.close();
  await settled();
}

/**
 * Drags the drawer with one finger (touch pointer events, plus touch events
 * where the browser can construct them) and lets go, then waits for
 * `settled()`. The finger goes down in the middle of `target`: an element in
 * the tray, such as a handle, or the tray when `target` is the drawer's root.
 * With `@handleOnly` pass a handle.
 *
 * It first moves the finger 11px the way it drags, so the drag starts, then
 * on until it has moved the drawer by `distance` from where the finger went
 * down, or to the snap point `to`. The drawer catches up with those 11px
 * over the first frames of the drag. A drag shorter than that goes back to
 * where the finger went down first, and from there by `distance`. A drawer
 * that is animating is caught where it is. Throws when no drag starts, for
 * example because the gesture scrolled the content instead.
 *
 * Fires `@onDragStart` and `@onDragEnd`, and `@onSnapPointChange` when the
 * release picks another snap point.
 *
 * ```ts
 * await dragDrawer('.mobile-drawer', { to: 2 });
 * await dragDrawer('[data-test-grabber]', { distance: -40, velocity: -1000 });
 * ```
 */
async function dragDrawer(target, options) {
  const {
    element,
    drawer
  } = findDrawer('dragDrawer', target);
  const {
    to,
    distance: byDistance,
    velocity = 0
  } = options;
  if (to === undefined === (byDistance === undefined)) {
    throw new Error('dragDrawer: pass either `to` or `distance`.');
  }
  if (!Number.isFinite(velocity)) {
    throw new Error(`dragDrawer: \`velocity\` must be a number.`);
  }
  const start = element === drawer.root ? drawer.tray : element;
  const rect = start.getBoundingClientRect();
  const finger = new TouchPointer(start, rect.left + rect.width / 2, rect.top + rect.height / 2);
  const opening = OPENING[drawer.placement()];
  let time = 0;
  const previousDragTime = drawerEnvironment.dragTime;
  drawerEnvironment.dragTime = () => time;
  try {
    // Catches a running animation, so the offset is where it stays.
    finger.down();
    let distance;
    if (to !== undefined) {
      const offset = drawer.offsetOf(to);
      if (offset === undefined) {
        finger.up();
        throw new Error(`dragDrawer: ${to} is not an index into @snapPoints, or the drawer has not been measured yet.`);
      }
      distance = offset - drawer.offset();
    } else {
      distance = byDistance;
    }
    if (!Number.isFinite(distance)) {
      finger.up();
      throw new Error('dragDrawer: `distance` must be a number.');
    }
    if (velocity !== 0 && Math.sign(velocity) !== Math.sign(distance)) {
      finger.up();
      throw new Error(`dragDrawer: a release at ${velocity} px/s needs a drag that way, but the drag is ${distance}px.`);
    }

    // Start the drag. A drag of 0 starts towards closed: at the highest snap
    // point that drags rather than scrolls when the content is at its start.
    const screen = distance * drawer.screenScale();
    const sign = distance > 0 ? 1 : -1;
    let moved = 0;
    for (const step of RECOGNISE) {
      time += FRAME;
      const by = (step - moved) * sign;
      moved = step;
      finger.move(by * opening.x, by * opening.y);
    }
    if (!drawer.isDragging()) {
      finger.up();
      throw new Error('dragDrawer: the gesture did not start a drag. It may have scrolled the content, or, with @handleOnly, `target` is not a handle.');
    }

    // A drag shorter than that goes back to where the finger went down, and
    // waits there, so the velocity only counts the rest of the drag.
    let rest = screen - sign * moved;
    if (Math.abs(screen) < moved) {
      time += VELOCITY_WINDOW + FRAME;
      finger.move(-sign * moved * opening.x, -sign * moved * opening.y);
      rest = screen;
    }

    // Drag the rest. With a velocity, the fake time between steps makes it.
    const steps = Math.abs(rest) < 1e-9 ? 0 : Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.abs(rest) / MAX_STEP)));
    const interval = velocity === 0 ? FRAME : Math.abs(rest / drawer.screenScale()) / steps / Math.abs(velocity) * 1000;
    for (let i = 0; i < steps; i++) {
      time += interval;
      const by = rest / steps;
      finger.move(by * opening.x, by * opening.y);
    }
    // Without a velocity, hold still before letting go.
    if (velocity === 0) time += VELOCITY_WINDOW + FRAME;
    finger.up();
  } finally {
    drawerEnvironment.dragTime = previousDragTime;
  }
  await settled();
}

export { closeDrawer, dragDrawer, openDrawer };
//# sourceMappingURL=test-support.js.map
