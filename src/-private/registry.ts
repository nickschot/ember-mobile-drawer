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

const drawers = new WeakMap<Element, DrawerHandle>();

export function registerDrawer(handle: DrawerHandle): void {
  drawers.set(handle.root, handle);
}

export function unregisterDrawer(root: Element): void {
  drawers.delete(root);
}

/** Not just any element with the `mobile-drawer` class. */
export function isDrawerRoot(element: Element): boolean {
  return drawers.has(element);
}

/** The innermost drawer whose root is or contains `element`. */
export function drawerFor(element: Element): DrawerHandle | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const handle = drawers.get(node);
    if (handle) return handle;
  }
  return undefined;
}
