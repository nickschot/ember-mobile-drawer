/** A touch on the screen that isn't the simulated finger, see `TouchPointer`. */
export interface RestingTouch {
  identifier: number;
  target: EventTarget;
  x: number;
  y: number;
}

/**
 * Whether this browser can construct touch events. Desktop Firefox and
 * Safari can't (no `Touch` constructor); `TouchPointer` then only sends
 * pointer events, which is all the drawer needs to drag.
 */
function canTouch(): boolean {
  try {
    new Touch({ identifier: 0, target: document.body });
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
export class TouchPointer {
  readonly target: Element;
  readonly pointerId: number;
  x: number;
  y: number;
  #resting: RestingTouch[];
  #touch = canTouch();

  constructor(
    target: Element,
    x: number,
    y: number,
    {
      pointerId = 1,
      resting = [],
    }: {
      pointerId?: number;
      /** Other fingers that rest on the screen the whole time, listed first. */
      resting?: RestingTouch[];
    } = {},
  ) {
    this.target = target;
    this.x = x;
    this.y = y;
    this.pointerId = pointerId;
    this.#resting = resting;
  }

  /** Puts the finger down: `pointerdown` and `touchstart`. */
  down(): void {
    this.#pointer('pointerdown');
    this.#touchEvent('touchstart', true);
  }

  /**
   * Moves the finger by `dx`/`dy`: `pointermove` and `touchmove`. Returns
   * whether the `touchmove` was cancelled (`preventDefault()`), which is
   * what stops the browser from scrolling; `false` without touch events.
   */
  move(dx: number, dy: number): boolean {
    this.x += dx;
    this.y += dy;
    this.#pointer('pointermove');
    return this.#touchEvent('touchmove', true);
  }

  /** Lifts the finger where it is: `pointerup` and `touchend`. */
  up(): void {
    this.#pointer('pointerup');
    this.#touchEvent('touchend', false);
  }

  /** The browser takes the gesture over: `pointercancel`, and `touchcancel`. */
  cancel(): void {
    this.#pointer('pointercancel');
    this.#touchEvent('touchcancel', false);
  }

  #pointer(type: string): void {
    this.target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: type !== 'pointercancel',
        pointerId: this.pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX: this.x,
        clientY: this.y,
      }),
    );
  }

  #touchEvent(type: string, down: boolean): boolean {
    if (!this.#touch) return false;
    const own = new Touch({
      identifier: this.pointerId,
      target: this.target,
      clientX: this.x,
      clientY: this.y,
    });
    const resting = this.#resting.map(
      ({ identifier, target, x, y }) =>
        new Touch({ identifier, target, clientX: x, clientY: y }),
    );
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: type !== 'touchcancel',
      touches: down ? [...resting, own] : resting,
      targetTouches: down ? [own] : [],
      changedTouches: [own],
    });
    this.target.dispatchEvent(event);
    return event.defaultPrevented;
  }
}
