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

/** Every portal on the page and the element it belongs to. */
const anchors = new Map<Element, () => Element | undefined>();

/**
 * Registers `portal` as a part of the element `anchor` returns (the outer
 * drawer's tray). A getter: the portal can be in the DOM before the outer
 * drawer knows its tray. Until then the portal's DOM parent counts.
 */
export function addPortal(
  portal: Element,
  anchor: () => Element | undefined,
): void {
  anchors.set(portal, anchor);
}

export function removePortal(portal: Element): void {
  anchors.delete(portal);
}

/**
 * The parent of `node` for the nesting relation: the anchor of a portal,
 * else its DOM parent.
 */
export function logicalParent(node: Node): Element | null {
  return (
    (node instanceof Element ? anchors.get(node)?.() : undefined) ??
    node.parentElement
  );
}

/**
 * Whether `node` is `ancestor` or inside it, also through portals: like
 * `ancestor.contains(node)`, but a portal counts as inside its anchor.
 */
export function logicallyContains(
  ancestor: Element,
  node: Node | null | undefined,
): boolean {
  for (let current = node ?? null; current; current = logicalParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * The portals that are logically inside `element` (also through other
 * portals), but not in its DOM: the parts of the page that belong to it.
 */
export function portalsOf(element: Element): Element[] {
  return [...anchors.keys()].filter(
    (portal) => !element.contains(portal) && logicallyContains(element, portal),
  );
}
