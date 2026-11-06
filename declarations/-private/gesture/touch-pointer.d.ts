/** A touch on the screen that isn't the simulated finger, see `TouchPointer`. */
export interface RestingTouch {
    identifier: number;
    target: EventTarget;
    x: number;
    y: number;
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
export declare class TouchPointer {
    #private;
    readonly target: Element;
    readonly pointerId: number;
    x: number;
    y: number;
    constructor(target: Element, x: number, y: number, { pointerId, resting, }?: {
        pointerId?: number;
        /** Other fingers that rest on the screen the whole time, listed first. */
        resting?: RestingTouch[];
    });
    /** Puts the finger down: `pointerdown` and `touchstart`. */
    down(): void;
    /**
     * Moves the finger by `dx`/`dy`: `pointermove` and `touchmove`. Returns
     * whether the `touchmove` was cancelled (`preventDefault()`), which is
     * what stops the browser from scrolling; `false` without touch events.
     */
    move(dx: number, dy: number): boolean;
    /** Lifts the finger where it is: `pointerup` and `touchend`. */
    up(): void;
    /** The browser takes the gesture over: `pointercancel`, and `touchcancel`. */
    cancel(): void;
}
//# sourceMappingURL=touch-pointer.d.ts.map