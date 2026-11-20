/**
 * The nesting relation between drawers through portals. A transformed tray
 * clips its `position: fixed` descendants, so the yielded `Nested` renders
 * outside the tray, in a portal that counts as inside the tray here. Events
 * still follow the DOM.
 *
 * @module
 * @internal
 */
/**
 * A getter: the portal can be in the DOM before the outer drawer knows its
 * tray. Until then the portal's DOM parent counts.
 */
export declare function addPortal(portal: Element, anchor: () => Element | undefined): void;
export declare function removePortal(portal: Element): void;
export declare function logicalParent(node: Node): Element | null;
/** `ancestor.contains(node)`, but a portal counts as inside its anchor. */
export declare function logicallyContains(ancestor: Element, node: Node | null | undefined): boolean;
/** The portals logically inside `element`, but not in its DOM. */
export declare function portalsOf(element: Element): Element[];
//# sourceMappingURL=nesting.d.ts.map