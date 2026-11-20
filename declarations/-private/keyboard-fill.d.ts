/**
 * The sheet's colour below a bottom drawer while an on-screen keyboard is
 * open in iOS Safari.
 *
 * To show a focused field, iOS scrolls the visual viewport down in the layout
 * viewport. Safari clips fixed elements to the layout viewport, so the fixed
 * root ends above the bottom of the screen, and the page shows through the
 * translucent URL bar and keyboard in the strip below it. No part of the
 * drawer can paint there.
 *
 * The fill is an element in the document (not fixed, so it is not clipped), a
 * child of `<html>` so that a fixed `<body>` doesn't contain it, with the
 * tray's background and backdrop filter. While it shows, the root gets
 * `data-keyboard`. Other browsers keep client coordinates in the layout
 * viewport, so they never get a strip.
 *
 * Only one drawer shows a fill at a time, else nested bottom drawers would
 * show two at the same place: the innermost drawer that holds the focus, else
 * the drawer that became active last.
 *
 * @module
 * @internal
 */
export declare const KEYBOARD_FILL_CLASS = "mobile-drawer-keyboard-fill";
/** On the drawer's root while the fill shows. */
export declare const KEYBOARD_ATTRIBUTE = "data-keyboard";
/** The part of `VisualViewport` this needs, see `drawerEnvironment`. */
export type ViewportLike = Pick<VisualViewport, 'height' | 'addEventListener' | 'removeEventListener'> & Partial<Pick<VisualViewport, 'scale'>>;
export interface KeyboardFillOptions {
    root: HTMLElement;
    tray: HTMLElement;
    /** A theme may put the tray's blur on this layer instead. */
    glass?: HTMLElement;
    viewport: ViewportLike | null;
    /** Open, from the bottom. */
    active: () => boolean;
    /** Whether focus on `element` keeps the keyboard open. */
    keepsKeyboard: (element: Element) => boolean;
    /** Also through the portals of the yielded `Nested`. */
    contains: (ancestor: Element, node: Node | null | undefined) => boolean;
}
interface Strip {
    top: number;
    height: number;
}
export declare class KeyboardFill {
    #private;
    activation: number;
    constructor(options: KeyboardFillOptions);
    get root(): HTMLElement;
    contains(node: Node | null | undefined): boolean;
    /** Call when the drawer opens or closes; syncs the fills of all drawers. */
    sync: () => void;
    /**
     * Copies the tray's colour to the fill again. It forces a style
     * calculation, so call it only when the colour can change.
     */
    paint(): void;
    destroy(): void;
    /** The strip between the root's bottom and the screen's, in client px. */
    strip(): Strip | undefined;
    show({ top, height }: Strip): void;
    hide(): void;
}
export {};
//# sourceMappingURL=keyboard-fill.d.ts.map