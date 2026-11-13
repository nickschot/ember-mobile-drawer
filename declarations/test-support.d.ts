/** A drawer: a selector or an element, see the module docs. */
export type DrawerTarget = string | Element;
/** Options of {@link dragDrawer}. Pass either `to` or `distance`. */
export type DragDrawerOptions = ({
    /**
     * Index into `@snapPoints` of the snap point to drag the drawer to. A
     * release there without `velocity` settles on it.
     */
    to: number;
    distance?: never;
} | {
    /**
     * How far to move the finger along the drawer's axis, in the drawer's
     * px: positive opens, negative closes. Past the first and last snap
     * point the drawer follows with resistance, as it does for a finger.
     */
    distance: number;
    to?: never;
}) & {
    /**
     * The velocity at the release, in px/s: positive opens, negative closes.
     * It must go the way the finger moves. Default `0`: the finger stops
     * before it lifts, so the drawer settles on the snap point nearest to
     * where it was let go. A release faster than 400 px/s always moves at
     * least one snap point its way.
     */
    velocity?: number;
};
/**
 * Opens the drawer, like the yielded `open` action: to its largest snap
 * point. When `@activeSnapPoint` is set, this only calls
 * `@onSnapPointChange`; the drawer moves once the new index is passed in.
 * Waits for `settled()`.
 */
export declare function openDrawer(target?: DrawerTarget): Promise<void>;
/**
 * Closes the drawer, like the yielded `close` action: to its smallest snap
 * point. See {@link openDrawer}.
 */
export declare function closeDrawer(target?: DrawerTarget): Promise<void>;
/**
 * Drags the drawer with one finger (touch pointer events, plus touch events
 * where the browser can construct them) and lets go, then waits for
 * `settled()`. The finger goes down in the middle of `target`: an element in
 * the tray, such as a handle, or the tray when `target` is the drawer's root.
 * With `@handleOnly` pass a handle.
 *
 * It first moves the finger 11px the way it drags, so the drag starts, then
 * on until it has moved the drawer by `distance` from where the finger went
 * down, or to the snap point `to`. The drawer catches up with those 11px
 * over the first frames of the drag. A drag shorter than that goes back to
 * where the finger went down first, and from there by `distance`. A drawer
 * that is animating is caught where it is. Throws when no drag starts, for
 * example because the gesture scrolled the content instead.
 *
 * Fires `@onDragStart` and `@onDragEnd`, and `@onSnapPointChange` when the
 * release picks another snap point.
 *
 * ```ts
 * await dragDrawer('.mobile-drawer', { to: 2 });
 * await dragDrawer('[data-test-grabber]', { distance: -40, velocity: -1000 });
 * ```
 */
export declare function dragDrawer(target: DrawerTarget, options: DragDrawerOptions): Promise<void>;
//# sourceMappingURL=test-support.d.ts.map