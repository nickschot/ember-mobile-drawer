/** A touch on the screen that isn't the simulated finger. */
export interface RestingTouch {
  identifier: number;
  target: EventTarget;
  x: number;
  y: number;
}

/** Desktop Firefox and Safari can't; pointer events are enough to drag. */
function canTouch(): boolean {
  try {
    new Touch({ identifier: 0, target: document.body });
    return typeof TouchEvent === 'function';
  } catch {
    return false;
  }
}

/**
 * One finger on `target`: a pointer event and, where possible, a touch event
 * for every step, all on `target` (as a browser does). Client px.
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
      /** Listed first in `touches`. */
      resting?: RestingTouch[];
    } = {},
  ) {
    this.target = target;
    this.x = x;
    this.y = y;
    this.pointerId = pointerId;
    this.#resting = resting;
  }

  down(): void {
    this.#pointer('pointerdown');
    this.#touchEvent('touchstart', true);
  }

  /** Whether the `touchmove` was cancelled, so the browser won't scroll. */
  move(dx: number, dy: number): boolean {
    this.x += dx;
    this.y += dy;
    this.#pointer('pointermove');
    return this.#touchEvent('touchmove', true);
  }

  up(): void {
    this.#pointer('pointerup');
    this.#touchEvent('touchend', false);
  }

  /** As when the browser takes the gesture over. */
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
