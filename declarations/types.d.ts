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
    /** Whether the user is dragging the drawer. Always `false` for now. */
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
}
//# sourceMappingURL=types.d.ts.map