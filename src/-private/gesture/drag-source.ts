import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { registerDestructor } from '@ember/destroyable';
import type { ModifierLike } from '@glint/template';

/** The subset of `didPan`'s event data the drawer reads. */
export interface PanData {
  current: { x: number; y: number };
  originalEvent?: Event;
}

type PanCallback = (data: PanData, element: HTMLElement) => void;

interface DragSourceNamedArgs {
  axis: 'horizontal' | 'vertical';
  pointerTypes: readonly ('touch' | 'mouse' | 'pen')[];
  onPointerDown: (event: PointerEvent, element: HTMLElement) => void;
  onPanStart: PanCallback;
  onPan: PanCallback;
  onPanEnd: PanCallback;
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
 * `onPanStart`; usually the browser takes it over (`pointercancel`) anyway.
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
  };

  #onTouchMove = (event: TouchEvent): void => {
    const gesture = this.#gesture;
    const touch = findTouch(event.changedTouches, gesture?.touchId);
    if (!gesture || !touch) return;
    if (this.#decide(touch.clientX, touch.clientY) && event.cancelable) {
      event.preventDefault();
    }
  };

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
    if (findTouch(event.changedTouches, this.#gesture?.touchId)) {
      this.#endGesture();
    }
  };

  #startGesture(gesture: Omit<Gesture, 'panning'>): void {
    this.#gesture = { ...gesture, panning: false };
    document.addEventListener('pointerup', this.#onPointerEnd, CAPTURE);
    document.addEventListener('pointercancel', this.#onPointerEnd, CAPTURE);
    document.addEventListener('touchend', this.#onTouchEnd, CAPTURE);
    document.addEventListener('touchcancel', this.#onTouchEnd, CAPTURE);
  }

  #endGesture(): void {
    if (!this.#gesture) return;
    this.#gesture = undefined;
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
        if (gesture) gesture.panning = true;
        args.onPanStart(data, element);
      },
      onPan: (data: PanData) => args.onPan(data, element),
      onPanEnd: (data: PanData) => args.onPanEnd(data, element),
    });
    // didPan has just written its own touch-action.
    if (args.touchAction) element.style.touchAction = args.touchAction();

    const arbitrating = args.shouldDrag !== undefined;
    if (this.#element !== element || this.#arbitrating !== arbitrating) {
      this.#endGesture();
      this.#listen(this.#element, false);
      this.#element = element;
      this.#arbitrating = arbitrating;
      this.#listen(element, true);
    }
    this.#named = args;
  }
}

export const dragSource =
  DragSourceModifier as unknown as ModifierLike<DragSourceSignature>;
