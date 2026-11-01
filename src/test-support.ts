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
import { getRootElement, settled } from '@ember/test-helpers';
import { drawerEnvironment } from './-private/environment.ts';
import { VELOCITY_WINDOW } from './-private/gesture/velocity.ts';
import { DECISION_SLOP } from './-private/gesture/drag-source.ts';
import { drawerFor, type DrawerHandle } from './-private/registry.ts';
import { TouchPointer } from './-private/gesture/touch-pointer.ts';
import type { Placement } from './types.ts';

/** A drawer: a selector or an element, see the module docs. */
export type DrawerTarget = string | Element;

/** Options of {@link dragDrawer}. Pass either `to` or `distance`. */
export type DragDrawerOptions = (
  | {
      /**
       * Index into `@snapPoints` of the snap point to drag the drawer to. A
       * release there without `velocity` settles on it.
       */
      to: number;
      distance?: never;
    }
  | {
      /**
       * How far to move the finger along the drawer's axis, in the drawer's
       * px: positive opens, negative closes. Past the first and last snap
       * point the drawer follows with resistance, as it does for a finger.
       */
      distance: number;
      to?: never;
    }
) & {
  /**
   * The velocity at the release, in px/s: positive opens, negative closes.
   * It must go the way the finger moves. Default `0`: the finger stops
   * before it lifts, so the drawer settles on the snap point nearest to
   * where it was let go. A release faster than 400 px/s always moves at
   * least one snap point its way.
   */
  velocity?: number;
};

/** Which way along each client axis opens the drawer. */
const OPENING: Record<Placement, { x: number; y: number }> = {
  bottom: { x: 0, y: -1 },
  top: { x: 0, y: 1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
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

function findDrawer(
  helper: string,
  target: DrawerTarget,
): { element: Element; drawer: DrawerHandle } {
  let element: Element | null;
  if (typeof target === 'string') {
    element = getRootElement().querySelector(target);
    if (!element) {
      throw new Error(
        `${helper}: no element found for '${target}'. Selectors are looked up inside the test's root element; pass an element for a drawer rendered outside it.`,
      );
    }
  } else if (target instanceof Element) {
    element = target;
  } else {
    throw new Error(`${helper}: pass a selector or an element.`);
  }
  const drawer = drawerFor(element);
  if (!drawer) {
    throw new Error(
      `${helper}: ${typeof target === 'string' ? `'${target}'` : 'the element'} is not a <MobileDrawer> or inside one.`,
    );
  }
  return { element, drawer };
}

/**
 * Opens the drawer, like the yielded `open` action: to its largest snap
 * point. When `@activeSnapPoint` is set, this only calls
 * `@onSnapPointChange`; the drawer moves once the new index is passed in.
 * Waits for `settled()`.
 */
export async function openDrawer(
  target: DrawerTarget = '.mobile-drawer',
): Promise<void> {
  findDrawer('openDrawer', target).drawer.open();
  await settled();
}

/**
 * Closes the drawer, like the yielded `close` action: to its smallest snap
 * point. See {@link openDrawer}.
 */
export async function closeDrawer(
  target: DrawerTarget = '.mobile-drawer',
): Promise<void> {
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
export async function dragDrawer(
  target: DrawerTarget,
  options: DragDrawerOptions,
): Promise<void> {
  const { element, drawer } = findDrawer('dragDrawer', target);
  const { to, distance: byDistance, velocity = 0 } = options;
  if ((to === undefined) === (byDistance === undefined)) {
    throw new Error('dragDrawer: pass either `to` or `distance`.');
  }
  if (!Number.isFinite(velocity)) {
    throw new Error(`dragDrawer: \`velocity\` must be a number.`);
  }

  const start = element === drawer.root ? drawer.tray : element;
  const rect = start.getBoundingClientRect();
  const finger = new TouchPointer(
    start,
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  const opening = OPENING[drawer.placement()];

  let time = 0;
  const previousDragTime = drawerEnvironment.dragTime;
  drawerEnvironment.dragTime = () => time;
  try {
    // Catches a running animation, so the offset is where it stays.
    finger.down();
    let distance: number;
    if (to !== undefined) {
      const offset = drawer.offsetOf(to);
      if (offset === undefined) {
        finger.up();
        throw new Error(
          `dragDrawer: ${to} is not an index into @snapPoints, or the drawer has not been measured yet.`,
        );
      }
      distance = offset - drawer.offset();
    } else {
      distance = byDistance!;
    }
    if (!Number.isFinite(distance)) {
      finger.up();
      throw new Error('dragDrawer: `distance` must be a number.');
    }
    if (velocity !== 0 && Math.sign(velocity) !== Math.sign(distance)) {
      finger.up();
      throw new Error(
        `dragDrawer: a release at ${velocity} px/s needs a drag that way, but the drag is ${distance}px.`,
      );
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
      throw new Error(
        'dragDrawer: the gesture did not start a drag. It may have scrolled the content, or, with @handleOnly, `target` is not a handle.',
      );
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
    const steps =
      Math.abs(rest) < 1e-9
        ? 0
        : Math.min(
            MAX_STEPS,
            Math.max(1, Math.ceil(Math.abs(rest) / MAX_STEP)),
          );
    const interval =
      velocity === 0
        ? FRAME
        : (Math.abs(rest / drawer.screenScale()) / steps / Math.abs(velocity)) *
          1000;
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
