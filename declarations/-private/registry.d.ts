import type { Placement } from '../types.ts';
/**
 * What the test-support helpers need from a rendered drawer. They only get
 * the DOM, so each drawer registers this for its root element.
 *
 * @internal Not public API; see `ember-mobile-drawer/test-support`.
 */
export interface DrawerHandle {
    /** The `.mobile-drawer` root element. */
    readonly root: HTMLElement;
    /** The `.mobile-drawer__tray` element. */
    readonly tray: HTMLElement;
    placement(): Placement;
    /** Whether a drag is in progress (synchronous, unlike `isDragging`). */
    isDragging(): boolean;
    /** How far open the tray is rendered, in px. */
    offset(): number;
    /**
     * The offset (px open) of the snap point at `index`, or `undefined` before
     * the drawer has been measured or for an index that doesn't exist.
     */
    offsetOf(index: number): number | undefined;
    /** Screen px per px of drawer offset. Forces layout. */
    screenScale(): number;
    /** The yielded `open` and `close` actions. */
    open(): void;
    close(): void;
}
export declare function registerDrawer(handle: DrawerHandle): void;
export declare function unregisterDrawer(root: Element): void;
/**
 * The drawer whose root is `element` or contains it: the innermost one, for
 * nested drawers.
 */
export declare function drawerFor(element: Element): DrawerHandle | undefined;
//# sourceMappingURL=registry.d.ts.map