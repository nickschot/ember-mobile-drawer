import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { registerDestructor } from '@ember/destroyable';
import type { ModifierLike } from '@glint/template';

/** The subset of `didPan`'s event data the drawer reads. */
export interface PanData {
  /** Where the pointer went down. */
  initial?: { x: number; y: number };
  current: { x: number; y: number };
  originalEvent?: Event;
  /** Set on the `onPanStart` of a drag that took over a scroll. */
  handoff?: boolean;
  /**
   * Set on `onPanStart` with arbitration (`shouldDrag`): where the gesture
   * started, the element the finger went down on.
   */
  target?: Element | null;
}

type PanCallback = (data: PanData, element: HTMLElement) => void;

interface DragSourceNamedArgs {
  axis: 'horizontal' | 'vertical';
  pointerTypes: readonly ('touch' | 'mouse' | 'pen')[];
  onPointerDown: (event: PointerEvent, element: HTMLElement) => void;
  onPanStart: PanCallback;
  onPan: PanCallback;
  onPanEnd: PanCallback;
  /** Called once the modifier is on an element (again, if it moved). */
  onInstall?: (element: HTMLElement) => void;
  /** Called when the modifier is torn down, e.g. in the middle of a drag. */
  onTeardown: (element: HTMLElement) => void;
  /**
   * Turns on scroll arbitration (see `DragSourceModifier`): asked once per
   * gesture whether it drags (`true`) or is left to the browser, e.g. to
   * scroll (`false`). `movement` is how far the finger had moved along the
   * axis when the gesture was decided, in client px (positive is down or
   * right); `target` is where the gesture started. Without it every pan
   * along the axis drags, as with plain `didPan`.
   */
  shouldDrag?: (movement: number, target: Element | null) => boolean;
  /**
   * The `touch-action` to use instead of `didPan`'s (`pan-x` for a vertical
   * axis, `pan-y` for a horizontal one). Called whenever `didPan` writes it.
   */
  touchAction?: () => string;
  /**
   * Turns on the scroll handoff (see `DragSourceModifier`): called for every
   * `touchmove` of a gesture that `shouldDrag` decided as a scroll, with how
   * far the finger moved along the axis since the previous one (client px,
   * positive is down or right) and where the gesture started. Returns
   * whether a drag takes over the gesture from here.
   */
  onScroll?: (step: number, target: Element | null) => boolean;
  /** Called once a gesture that `onScroll` was called for ends. */
  onScrollEnd?: () => void;
}

export interface DragSourceSignature {
  Element: HTMLElement;
  Args: { Named: DragSourceNamedArgs };
}

/**
 * The part of ember-gesture-modifiers' `DidPanModifier` this extends: the
 * standard ember-modifier `modify` hook, called with `didPan`'s public named
 * arguments.
 */
interface DidPanModifier {
  modify(
    element: HTMLElement,
    positional: unknown[],
    named: Record<string, unknown>,
  ): void;
}

const DidPan = didPan as unknown as new (
  owner: unknown,
  args: unknown,
) => DidPanModifier;

/** One touch (or pen) gesture on the element, from down until it lifts. */
interface Gesture {
  /** The pointer that started it; more fingers don't start another one. */
  pointerId?: number;
  /**
   * The touch that started it on the element, once touch events arrive. The
   * gesture then lasts until that touch ends: after the browser takes over a
   * scroll (`pointercancel`) touch events keep coming.
   */
  touchId?: number;
  x: number;
  y: number;
  target: Element | null;
  /** Whether it drags; `undefined` until it is decided. */
  drags?: boolean;
  /** Whether `didPan` recognised a pan and the drag started. */
  panning: boolean;
  /** Whether `shouldDrag` decided it as a scroll along the axis. */
  scrolls?: boolean;
  /**
   * Whether a drag took it over from a scroll (see `onScroll`): touch
   * events drive the drag from then on, not `didPan`.
   */
  handoff?: boolean;
  /** The finger's last position, from its last touch event. */
  lastX?: number;
  lastY?: number;
}

/**
 * How far (px) the finger must move along the axis, and further along it
 * than across it, before a gesture is decided. Below the browser's own touch
 * slop, so the decision comes before native scrolling could start.
 */
export const DECISION_SLOP = 4;

const CAPTURE = { capture: true } as const;
const PASSIVE = { passive: true } as const;

const findTouch = (list: TouchList, id: number | undefined) =>
  id === undefined
    ? undefined
    : Array.from(list).find((touch) => touch.identifier === id);

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
  #element?: HTMLElement;
  #named?: DragSourceNamedArgs;
  #gesture?: Gesture;
  /** Whether the arbitration listeners are on `#element`. */
  #arbitrating = false;

  constructor(owner: unknown, args: unknown) {
    super(owner, args);
    registerDestructor(this, () => {
      const element = this.#element;
      this.#endGesture();
      this.#listen(element, false);
      this.#element = undefined;
      if (element) this.#named?.onTeardown(element);
    });
  }

  #listen(element: HTMLElement | undefined, add: boolean): void {
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
      passive: false,
    });
  }

  #onPointerDown = (event: PointerEvent): void => {
    const element = this.#element;
    const named = this.#named;
    if (!element || !named?.pointerTypes.includes(event.pointerType as 'touch'))
      return;
    if (this.#arbitrating) {
      const gesture = this.#gesture;
      if (!gesture) {
        this.#startGesture({
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          target: event.target as Element | null,
        });
      } else if (gesture.pointerId === undefined) {
        gesture.pointerId = event.pointerId;
      }
    }
    named.onPointerDown(event, element);
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#gesture && this.#gesture.pointerId === event.pointerId) {
      this.#decide(event.clientX, event.clientY);
    }
  };

  #onTouchStart = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    let gesture = this.#gesture;
    // A gesture whose touch is gone ended without its touchend reaching the
    // document, e.g. because the touched element was removed: start over.
    if (
      gesture?.touchId !== undefined &&
      !findTouch(event.touches, gesture.touchId)
    ) {
      if (gesture.handoff) {
        // Its drag ends as on a cancel.
        this.#named?.onPanEnd(
          this.#touchData(
            gesture.lastX ?? gesture.x,
            gesture.lastY ?? gesture.y,
            new Event('touchcancel'),
          ),
          this.#element!,
        );
      }
      this.#endGesture();
      gesture = undefined;
    }
    if (!gesture) {
      this.#startGesture({
        touchId: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        target: event.target as Element | null,
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

  #onTouchMove = (event: TouchEvent): void => {
    const gesture = this.#gesture;
    const touch = findTouch(event.changedTouches, gesture?.touchId);
    if (!gesture || !touch) return;
    const { clientX: x, clientY: y } = touch;
    const lastX = gesture.lastX ?? gesture.x;
    const lastY = gesture.lastY ?? gesture.y;
    gesture.lastX = x;
    gesture.lastY = y;
    const drags = this.#decide(x, y);
    if (drags && event.cancelable) event.preventDefault();
    if (gesture.handoff) {
      if (event.cancelable) event.preventDefault();
      this.#named?.onPan(this.#touchData(x, y, event), this.#element!);
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
    named.onPanStart(
      {
        ...this.#touchData(x, y, event),
        initial: { x, y },
        handoff: true,
        target: gesture.target,
      },
      this.#element!,
    );
  };

  /** `didPan`-like event data for a touch at `x`/`y`. */
  #touchData(x: number, y: number, originalEvent: Event): PanData {
    return { current: { x, y }, originalEvent };
  }

  #onPointerEnd = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (
      gesture &&
      gesture.touchId === undefined &&
      gesture.pointerId === event.pointerId
    ) {
      this.#endGesture();
    }
  };

  #onTouchEnd = (event: TouchEvent): void => {
    const gesture = this.#gesture;
    const touch = findTouch(event.changedTouches, gesture?.touchId);
    if (!gesture || !touch) return;
    if (gesture.handoff) {
      gesture.handoff = false;
      this.#named?.onPanEnd(
        this.#touchData(touch.clientX, touch.clientY, event),
        this.#element!,
      );
    }
    this.#endGesture();
  };

  #startGesture(gesture: Omit<Gesture, 'panning'>): void {
    this.#gesture = { ...gesture, panning: false };
    document.addEventListener('pointerup', this.#onPointerEnd, CAPTURE);
    document.addEventListener('pointercancel', this.#onPointerEnd, CAPTURE);
    document.addEventListener('touchend', this.#onTouchEnd, CAPTURE);
    document.addEventListener('touchcancel', this.#onTouchEnd, CAPTURE);
  }

  #endGesture(): void {
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
  #decide(x: number, y: number, force = false): boolean | undefined {
    const gesture = this.#gesture;
    const named = this.#named;
    if (!gesture || !named?.shouldDrag) return undefined;
    const vertical = named.axis === 'vertical';
    const along = vertical ? y - gesture.y : x - gesture.x;
    const across = vertical ? x - gesture.x : y - gesture.y;
    if (
      gesture.drags === true &&
      !gesture.panning &&
      !force &&
      Math.abs(across) > Math.abs(along)
    ) {
      // Turned sideways before a pan started: leave it to the browser.
      gesture.drags = false;
    }
    if (gesture.drags !== undefined) return gesture.drags;
    if (
      !force &&
      (Math.abs(along) < DECISION_SLOP || Math.abs(across) >= Math.abs(along))
    ) {
      return undefined;
    }
    gesture.drags = named.shouldDrag(along, gesture.target);
    gesture.scrolls = !gesture.drags;
    return gesture.drags;
  }

  override modify(
    element: HTMLElement,
    positional: unknown[],
    named: Record<string, unknown>,
  ): void {
    const args = named as unknown as DragSourceNamedArgs;
    super.modify(element, positional, {
      axis: args.axis,
      pointerTypes: args.pointerTypes,
      onPanStart: (data: PanData) => {
        // Decided here at the latest. Without a gesture (e.g. the pointer
        // went down before arbitration was turned on) the pan drags.
        const gesture = this.#gesture;
        const drags = gesture
          ? this.#decide(data.current.x, data.current.y, true)
          : true;
        if (drags === false) return;
        if (!gesture) {
          args.onPanStart(data, element);
          return;
        }
        gesture.panning = true;
        args.onPanStart({ ...data, target: gesture.target }, element);
      },
      // During a handoff the touch events drive the drag (see above).
      onPan: (data: PanData) => {
        if (!this.#gesture?.handoff) args.onPan(data, element);
      },
      onPanEnd: (data: PanData) => {
        if (!this.#gesture?.handoff) args.onPanEnd(data, element);
      },
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

export const dragSource =
  DragSourceModifier as unknown as ModifierLike<DragSourceSignature>;
