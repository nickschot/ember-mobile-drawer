import type { Placement } from '../types.ts';
/**
 * What the test-support helpers need from a rendered drawer, by root.
 *
 * @internal Not public API; see `ember-mobile-drawer/test-support`.
 */
export interface DrawerHandle {
    readonly root: HTMLElement;
    readonly tray: HTMLElement;
    placement(): Placement;
    /** Whether a drag is in progress (synchronous, unlike `isDragging`). */
    isDragging(): boolean;
    offset(): number;
    /** `undefined` before the drawer is measured. */
    offsetOf(index: number): number | undefined;
    /** Screen px per px of drawer offset. Forces layout. */
    screenScale(): number;
    open(): void;
    close(): void;
}
export declare function registerDrawer(handle: DrawerHandle): void;
export declare function unregisterDrawer(root: Element): void;
/** Not just any element with the `mobile-drawer` class. */
export declare function isDrawerRoot(element: Element): boolean;
/** The innermost drawer whose root is or contains `element`. */
export declare function drawerFor(element: Element): DrawerHandle | undefined;
//# sourceMappingURL=registry.d.ts.map