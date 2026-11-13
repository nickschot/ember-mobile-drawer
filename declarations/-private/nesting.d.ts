/**
 * The nesting relation between drawers when a nested drawer is not inside
 * the DOM of the drawer around it.
 *
 * A nested drawer inside the outer drawer's tray is clipped by that tray (a
 * transformed element is the containing block of its `position: fixed`
 * descendants), so the yielded `Nested` component renders its block outside
 * the tray, in a "portal" element elsewhere on the page. Each portal is
 * registered here with the element it belongs to: the outer drawer's tray.
 * For the drawers, the portal is then inside that tray: `logicalParent`
 * goes from a portal to the tray instead of to its DOM parent, and
 * `logicallyContains` follows that. Without portals both are the same as
 * the DOM (`parentElement`, `contains`).
 *
 * Events still follow the DOM: a touch in a portal never reaches the outer
 * drawer's tray.
 *
 * @module
 * @internal
 */
/**
 * Registers `portal` as a part of the element `anchor` returns (the outer
 * drawer's tray). A getter: the portal can be in the DOM before the outer
 * drawer knows its tray. Until then the portal's DOM parent counts.
 */
export declare function addPortal(portal: Element, anchor: () => Element | undefined): void;
export declare function removePortal(portal: Element): void;
/**
 * The parent of `node` for the nesting relation: the anchor of a portal,
 * else its DOM parent.
 */
export declare function logicalParent(node: Node): Element | null;
/**
 * Whether `node` is `ancestor` or inside it, also through portals: like
 * `ancestor.contains(node)`, but a portal counts as inside its anchor.
 */
export declare function logicallyContains(ancestor: Element, node: Node | null | undefined): boolean;
/**
 * The portals that are logically inside `element` (also through other
 * portals), but not in its DOM: the parts of the page that belong to it.
 */
export declare function portalsOf(element: Element): Element[];
//# sourceMappingURL=nesting.d.ts.map