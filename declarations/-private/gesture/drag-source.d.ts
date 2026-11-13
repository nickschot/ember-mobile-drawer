import type { ModifierLike } from '@glint/template';
/** The subset of `didPan`'s event data the drawer reads. */
export interface PanData {
    /** Where the pointer went down. */
    initial?: {
        x: number;
        y: number;
    };
    current: {
        x: number;
        y: number;
    };
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
    Args: {
        Named: DragSourceNamedArgs;
    };
}
/**
 * How far (px) the finger must move along the axis, and further along it
 * than across it, before a gesture is decided. Below the browser's own touch
 * slop, so the decision comes before native scrolling could start.
 */
export declare const DECISION_SLOP = 4;
export declare const dragSource: ModifierLike<DragSourceSignature>;
export {};
//# sourceMappingURL=drag-source.d.ts.map