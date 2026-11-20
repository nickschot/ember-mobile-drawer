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
  /** Set on `onPanStart`: the element the finger went down on. */
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
   * Asked once per gesture: drag (`true`) or leave it to the browser.
   * `movement` is along the axis in client px (positive is down or right).
   */
  shouldDrag: (movement: number, target: Element | null) => boolean;
  /** Replaces `didPan`'s `touch-action` whenever `didPan` writes it. */
  touchAction?: () => string;
  /**
   * Per `touchmove` of a scrolling gesture, with the step along the axis
   * since the previous one. Returns whether a drag takes the gesture over.
   */
  onScroll?: (step: number, target: Element | null) => boolean;
  /** Called once a gesture that `onScroll` was called for ends. */
  onScrollEnd?: () => void;
}

export interface DragSourceSignature {
  Element: HTMLElement;
  Args: { Named: DragSourceNamedArgs };
}

/** The part of `DidPanModifier` this extends. */
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
   * The gesture lasts until this touch ends: touch events keep coming after
   * the browser takes a scroll over (`pointercancel`).
   */
  touchId?: number;
  x: number;
  y: number;
  target: Element | null;
  /** `undefined` until decided. */
  drags?: boolean;
  /** Whether `didPan` recognised a pan and the drag started. */
  panning: boolean;
  scrolls?: boolean;
  /** A drag took it over from a scroll; touch events drive the drag. */
  handoff?: boolean;
  lastX?: number;
  lastY?: number;
}

/**
 * Px along the axis before a gesture is decided. Below the browser's touch
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
  #element?: HTMLElement;
  #named?: DragSourceNamedArgs;
  #gesture?: Gesture;

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

  /** Decides the gesture once past the slop, or when `force`d by `didPan`. */
  #decide(x: number, y: number, force = false): boolean | undefined {
    const gesture = this.#gesture;
    const named = this.#named;
    if (!gesture || !named) return undefined;
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
        // Decided here at the latest. Without a gesture the pan drags.
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
      onPan: (data: PanData) => {
        if (!this.#gesture?.handoff) args.onPan(data, element);
      },
      onPanEnd: (data: PanData) => {
        if (!this.#gesture?.handoff) args.onPanEnd(data, element);
      },
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

export const dragSource =
  DragSourceModifier as unknown as ModifierLike<DragSourceSignature>;
