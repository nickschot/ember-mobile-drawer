import type { ComponentLike, ModifierLike } from '@glint/template';
export type { SnapPoint } from './-private/snap-points/index.ts';
/**
 * The edge of the screen the drawer is attached to. `left` and `right` are
 * physical: they don't flip under `dir="rtl"`.
 */
export type Placement = 'bottom' | 'top' | 'left' | 'right';
/** What `<MobileDrawer>` yields to its block. */
export interface MobileDrawerApi {
    /**
     * Animates to the snap point at `index` in `@snapPoints`. When the drawer
     * is controlled (`@activeSnapPoint` is set), this only calls
     * `@onSnapPointChange`; the drawer moves once the parent passes the new
     * index back in.
     */
    snapTo: (index: number) => void;
    /**
     * Animates to the snap point with the largest offset. Does nothing before
     * the drawer has been inserted and measured: ordering `'content'` and
     * percentage snap points needs the measured sizes.
     */
    open: () => void;
    /**
     * Animates to the snap point with the smallest offset (usually `0`). Like
     * `open`, does nothing before the drawer has been measured.
     */
    close: () => void;
    /**
     * Index into `@snapPoints` of the snap point the drawer rests at or is
     * moving to.
     */
    activeSnapPoint: number;
    /**
     * Makes an element a drag handle: a gesture that starts on it always
     * drags the drawer and never scrolls the content, at every snap point,
     * also when the content is scrolled. Use it on a grabber or a sticky
     * header. The element gets `touch-action: pan-x` (`pan-y` for `left` and
     * `right`). Taps on buttons in it still work. The handle wins over the
     * elements in it (also a `data-mobile-drawer-scroll` element), except a
     * text field, so keep handles small.
     *
     * Without `@handleOnly` the rest of the tray drags too (and scrolls where
     * the content can scroll). With `@handleOnly={{true}}` dragging only
     * starts on handles, so the rest of the tray keeps its native touch
     * behaviour (e.g. scrolling).
     *
     * ```gts
     * <MobileDrawer as |drawer|>
     *   <header class="sheet-header" {{drawer.handle}}>...</header>
     * </MobileDrawer>
     * ```
     */
    handle: ModifierLike<{
        Element: HTMLElement;
    }>;
    /**
     * An accessible grabber, like the grabber of an iOS sheet: a
     * `<button type="button">` with the `handle` modifier, so a drag that
     * starts on it drags the drawer (also with `@handleOnly`). A tap, a
     * click, Enter or Space moves the drawer to the next larger open snap
     * point, and from the largest back to the smallest open one; it never
     * closes the drawer (a snap point at `0` is skipped). With fewer than two
     * open snap points it does nothing. A pointer that dragged the drawer
     * doesn't also click it.
     *
     * For screen readers it is named by `@label` (default
     * `'Sheet grabber'`) and described by the snap point the drawer is at:
     * `@snapPointLabels[index]`, else `'Expanded'` (largest), `'Collapsed'`
     * (smallest of two or more open ones), `'Partly expanded'` (between) or
     * `'Closed'`. After an activation a status element (`role="status"`)
     * right after the button announces the new snap point, once the drawer
     * is there; the text goes when the drawer moves in another way. The
     * button has
     * no styles of its own: give it a class, e.g.
     * `mobile-drawer-theme-ios__grabber`. A modal drawer that opens doesn't
     * focus it (see `@modal`): focus goes to the first other focusable
     * element.
     *
     * ```gts
     * <MobileDrawer @snapPoints={{array 0 "40%" "100%"}} as |drawer|>
     *   <drawer.Grabber class="grabber" data-mobile-drawer-pinned />
     * </MobileDrawer>
     * ```
     */
    Grabber: ComponentLike<{
        Element: HTMLButtonElement;
        Args: {
            /** The accessible name. Default `'Sheet grabber'`. */
            label?: string;
            /**
             * What a screen reader says the drawer is at, one text per snap
             * point, indexed like `@snapPoints`. Missing entries get the default
             * text.
             */
            snapPointLabels?: readonly (string | undefined)[];
        };
    }>;
    /**
     * Whether the user is dragging the drawer: from the moment a pan along the
     * drawer's axis is recognised until the finger lifts. Dragging works with
     * touch and pen input.
     */
    isDragging: boolean;
    /** Whether the drawer is animating towards a snap point. */
    isAnimating: boolean;
    /**
     * How far open the drawer is, from `0` (closed) to `1` (at the largest
     * snap point), at the snap point it rests at or is moving to. It is not
     * updated every frame; for styling that follows the drawer frame by frame
     * use `--mobile-drawer-progress` on `.mobile-drawer__backdrop`.
     */
    progress: number;
    /**
     * Renders a nested drawer outside this drawer's tray, as iOS shows a
     * nested sheet over the whole screen. A drawer inside the tray is clipped
     * by it (the moving tray is the containing block of its fixed elements),
     * so it can't show while this drawer is not fully open.
     *
     * The block renders with `in-element` at the end of `@destination`
     * (default: the parent element of this drawer's root, or of the outermost
     * drawer whose tray this drawer is in, once this drawer is in the DOM; so
     * not in server-rendered HTML), in a `<div class="mobile-drawer-nested">`
     * (`display: contents`). For the drawers, that element is a part of this
     * drawer's tray, as if the nested drawer were inside it: the modal stack
     * order, `data-nested`, `inert`, focus return and the body scroll lock
     * work the same. When this drawer starts to close, it closes the open
     * drawers in it (`close()`); one that stays open hides with this drawer
     * (`data-closed`).
     *
     * ```gts
     * <MobileDrawer aria-label="List" as |drawer|>
     *   <drawer.Nested>
     *     <MobileDrawer aria-label="Details">...</MobileDrawer>
     *   </drawer.Nested>
     * </MobileDrawer>
     * ```
     */
    Nested: ComponentLike<{
        Args: {
            /**
             * The element to render the block in, at its end. Default: the parent
             * element of this drawer's root.
             */
            destination?: Element | null;
        };
        Blocks: {
            default: [];
        };
    }>;
}
/** What `@onOpen` and `@onClose` are called with. */
export interface MobileDrawerToggleEvent {
    /**
     * Index into `@snapPoints` of the snap point the drawer is moving to. For
     * `@onClose` always the smallest snap point.
     */
    snapPoint: number;
}
/** What `@onDragStart` is called with. */
export interface MobileDrawerDragStartEvent {
    /** Index into `@snapPoints` of the active snap point when the drag started. */
    snapPoint: number;
    /** How far open the drawer was when the drag started, in px. */
    offset: number;
}
/** What `@onDragEnd` is called with. */
export interface MobileDrawerDragEndEvent {
    /**
     * Index into `@snapPoints` of the snap point the release picked: the one
     * passed to `@onSnapPointChange` when it differs from the active one. When
     * the drawer is controlled, it only moves there once the parent passes it
     * in. A drag that ends without a release (its handle was removed, or
     * `@placement` changed) gives the active snap point, where the drawer
     * stays.
     */
    snapPoint: number;
    /**
     * How far open the drawer was when it was let go, in px: where the finger
     * put it. Right after a drag starts the tray is still catching up with the
     * finger, so it can be a few px behind this.
     */
    offset: number;
    /**
     * The release velocity in px/s along the drawer's axis: positive opens,
     * negative closes. `0` when the drag ended without a release or the
     * browser cancelled the pointer.
     */
    velocity: number;
}
//# sourceMappingURL=types.d.ts.map