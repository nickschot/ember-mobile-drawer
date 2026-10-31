/**
 * Makes everything on the page except one element `inert`, for modal
 * drawers.
 *
 * "Everything except `element`" are the siblings of `element` and of each of
 * its ancestors up to `<body>`: the smallest set of subtrees that covers the
 * page without covering `element`. Each sibling gets the `inert` attribute,
 * which removes it from the tab order, from pointer and find-in-page
 * interaction and from the accessibility tree.
 *
 * Counted per element, so drawers can open and close in any order: an
 * element only loses `inert` once every drawer that made it inert let go.
 * Elements that were already inert are left alone. Elements added to the
 * page later (e.g. a toast appended to `<body>`) are not made inert.
 *
 * @module
 * @internal
 */

/** Elements that don't render, so there is no point in making them inert. */
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'LINK',
  'META',
  'NOSCRIPT',
]);

/** How many drawers made each element inert. */
const counts = new Map<Element, number>();

/**
 * Makes every element on the page outside `element` inert, until the
 * returned function is called. Calling it more than once does nothing.
 */
export function inertOutside(element: Element): () => void {
  const touched: Element[] = [];
  for (
    let node: Element = element;
    node.parentElement && node !== document.body;
    node = node.parentElement
  ) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || SKIP.has(sibling.tagName)) continue;
      const count = counts.get(sibling);
      if (count === undefined) {
        // Inert already, by the app: not ours to undo.
        if (sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
      }
      counts.set(sibling, (count ?? 0) + 1);
      touched.push(sibling);
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const sibling of touched) {
      const count = counts.get(sibling)! - 1;
      if (count > 0) {
        counts.set(sibling, count);
      } else {
        counts.delete(sibling);
        sibling.removeAttribute('inert');
      }
    }
  };
}
