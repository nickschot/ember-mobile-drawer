/**
 * The nesting relation between drawers through portals. A transformed tray
 * clips its `position: fixed` descendants, so the yielded `Nested` renders
 * outside the tray, in a portal that counts as inside the tray here. Events
 * still follow the DOM.
 *
 * @module
 * @internal
 */

const anchors = new Map<Element, () => Element | undefined>();

/**
 * A getter: the portal can be in the DOM before the outer drawer knows its
 * tray. Until then the portal's DOM parent counts.
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

export function logicalParent(node: Node): Element | null {
  return (
    (node instanceof Element ? anchors.get(node)?.() : undefined) ??
    node.parentElement
  );
}

/** `ancestor.contains(node)`, but a portal counts as inside its anchor. */
export function logicallyContains(
  ancestor: Element,
  node: Node | null | undefined,
): boolean {
  for (let current = node ?? null; current; current = logicalParent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** The portals logically inside `element`, but not in its DOM. */
export function portalsOf(element: Element): Element[] {
  return [...anchors.keys()].filter(
    (portal) => !element.contains(portal) && logicallyContains(element, portal),
  );
}
