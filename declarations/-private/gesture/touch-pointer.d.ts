/** A touch on the screen that isn't the simulated finger. */
export interface RestingTouch {
    identifier: number;
    target: EventTarget;
    x: number;
    y: number;
}
/**
 * One finger on `target`: a pointer event and, where possible, a touch event
 * for every step, all on `target` (as a browser does). Client px.
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
        /** Listed first in `touches`. */
        resting?: RestingTouch[];
    });
    down(): void;
    /** Whether the `touchmove` was cancelled, so the browser won't scroll. */
    move(dx: number, dy: number): boolean;
    up(): void;
    /** As when the browser takes the gesture over. */
    cancel(): void;
}
//# sourceMappingURL=touch-pointer.d.ts.map