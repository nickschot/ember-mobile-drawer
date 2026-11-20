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
    Args: {
        Named: DragSourceNamedArgs;
    };
}
/**
 * Px along the axis before a gesture is decided. Below the browser's touch
 * slop, so the decision comes before native scrolling could start.
 */
export declare const DECISION_SLOP = 4;
export declare const dragSource: ModifierLike<DragSourceSignature>;
export {};
//# sourceMappingURL=drag-source.d.ts.map