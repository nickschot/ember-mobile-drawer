/**
 * The sheet's colour below a bottom drawer while an on-screen keyboard is
 * open in iOS Safari.
 *
 * When a field gets focus, iOS Safari scrolls the visual viewport up in the
 * layout viewport to show the field above the keyboard. Fixed elements stay
 * in the layout viewport, and Safari clips them to it (also with negative
 * insets): so the drawer's fixed root ends that far above the bottom of the
 * screen, at about the level of Safari's floating URL bar, and above the
 * top of the keyboard. Safari's URL bar, its keyboard accessory bar and the
 * keyboard are translucent, and in the strip between the root and the
 * bottom of the screen the page shows through them instead of the sheet.
 * No part of the drawer can paint there.
 *
 * Measured in the iOS 27 simulator (iPhone 17, layout viewport 714px): a
 * field in a sheet at 40% gets focus, the visual viewport becomes 384px
 * high and moves 310px down in the layout viewport (`offsetTop`), and the
 * client coordinates (`getBoundingClientRect`) follow the visual viewport.
 * So the fixed root is at `top: -310px` and ends 404px below the top of the
 * visual viewport, 20px below its bottom. The keyboard starts about 80px
 * lower; the screen ends 310px lower. At full height the field is near the
 * top, the visual viewport doesn't move and there is no strip.
 *
 * This fills that strip: an element in the document (not fixed, so Safari
 * doesn't clip it), a child of `<html>`, so that a fixed `<body>` (the iOS
 * scroll lock) doesn't contain it, from the bottom of the root to the
 * bottom of the screen, with the tray's background colour and backdrop
 * filter (or the glass layer's, see `glass`). It doesn't take pointer events and is hidden from assistive
 * technology. While it shows, the root gets `data-keyboard`, so the
 * floating sheet goes to the edges and the bottom of the root and meets
 * it (see styles.css). It changes nothing that is in the drawer: the field
 * and the content don't move.
 *
 * The strip is as high as the layout viewport's top is above the visual
 * viewport's: the screen is as high as the layout viewport, and the root
 * ends at its bottom. That is the root's computed `top` (its offset in the
 * layout viewport, e.g. 5px with `@transparentStatusBar`, #124) minus the
 * top of its client rect; `-top` of the client rect alone would make the
 * fill that offset too short. Other browsers (e.g. Chrome) keep the client
 * coordinates in the layout viewport, so the root's client top is its
 * computed `top` there, also with a keyboard open, and nothing is filled.
 * Only while the visual viewport is lower than the root, the page isn't
 * zoomed in (a pinch zoom also moves the visual viewport) and the root is
 * `position: fixed` (an embedded drawer's root is in the page, and can be
 * above the viewport because the page is scrolled).
 *
 * Only one drawer shows a fill at a time: with nested drawers (also those
 * rendered with the yielded `Nested`), the outer drawer is an open bottom
 * drawer too, and two fills would show at the same place. Of the drawers
 * that can show one, the innermost drawer that contains the focused
 * element shows it; if none contains it, the drawer that became active
 * last. Every change (a viewport event, a drawer that opens or closes, a
 * focusout) syncs all of them. A focusout in any drawer to an element that
 * doesn't keep the keyboard open hides every fill at once.
 *
 * @module
 * @internal
 */
/** The class of the fill element, a child of `<html>`. */
export declare const KEYBOARD_FILL_CLASS = "mobile-drawer-keyboard-fill";
/** On the drawer's root while the fill shows. */
export declare const KEYBOARD_ATTRIBUTE = "data-keyboard";
/** The part of `VisualViewport` this needs, see `drawerEnvironment`. */
export type ViewportLike = Pick<VisualViewport, 'height' | 'addEventListener' | 'removeEventListener'> & Partial<Pick<VisualViewport, 'scale'>>;
export interface KeyboardFillOptions {
    root: HTMLElement;
    tray: HTMLElement;
    /**
     * The sheet's `.mobile-drawer__glass` layer, if any. A theme may put the
     * tray's blur on it (see styles.css); the fill then takes the blur from
     * it.
     */
    glass?: HTMLElement;
    /** The visual viewport, or `null` where there is none. */
    viewport: ViewportLike | null;
    /** Whether the drawer can need the fill now: open, from the bottom. */
    active: () => boolean;
    /**
     * Whether focus on `element` keeps an on-screen keyboard open (a field
     * the user edits).
     */
    keepsKeyboard: (element: Element) => boolean;
    /**
     * Whether `node` belongs to `ancestor`, also through the portals of the
     * yielded `Nested` (which are outside its DOM).
     */
    contains: (ancestor: Element, node: Node | null | undefined) => boolean;
}
interface Strip {
    top: number;
    height: number;
}
export declare class KeyboardFill {
    #private;
    /** When it became active last, see `activations`. */
    activation: number;
    constructor(options: KeyboardFillOptions);
    get root(): HTMLElement;
    /** Whether the fill shows. */
    get showing(): boolean;
    /** Whether `node` belongs to this drawer. */
    contains(node: Node | null | undefined): boolean;
    /**
     * Listens to the visual viewport while the drawer is active, and shows,
     * moves or hides the fills of all drawers. Call it when the drawer opens
     * or closes; the viewport's own `resize` and `scroll` events call it too.
     */
    sync: () => void;
    /**
     * Copies the tray's colour to the fill again, e.g. after the drawer moved
     * to a snap point where a theme changes it. Does nothing while the fill
     * is hidden. It forces a style calculation, so the component only calls
     * it when the colour can change: when the expand progress or
     * `data-expanded` changes.
     */
    paint(): void;
    destroy(): void;
    /**
     * The strip between the root's bottom and the screen's, in client px, or
     * `undefined` if there is none or the drawer is not active.
     */
    strip(): Strip | undefined;
    show({ top, height }: Strip): void;
    hide(): void;
}
export {};
//# sourceMappingURL=keyboard-fill.d.ts.map