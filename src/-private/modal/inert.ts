/**
 * Makes everything on the page except some elements `inert`, for modal
 * drawers: the drawer's root and the portals of the drawers nested in it
 * (see `nesting.ts`).
 *
 * "Everything except the elements" are the siblings of each element and of
 * each of its ancestors up to `<body>`, except the elements and their
 * ancestors: the smallest set of subtrees that covers the page without
 * covering one of the elements. Each sibling gets the `inert` attribute,
 * which removes it from the tab order, from pointer and find-in-page
 * interaction and from the accessibility tree.
 *
 * Counted per element, so drawers can open and close in any order: an
 * element only loses `inert` once every drawer that made it inert let go.
 * Only attributes the drawers added are removed:
 * - elements that were already inert are left alone;
 * - once the app sets (or removes) `inert` on an element a drawer made
 *   inert, the attribute is the app's, and the drawers stop managing it.
 *   A `MutationObserver` on those elements notices that.
 * Elements added to the page later (e.g. a toast appended to `<body>`) are
 * not made inert.
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

/** How many drawers made each element inert, for the elements they manage. */
const counts = new Map<Element, number>();

let observer: MutationObserver | undefined;

/**
 * Hands every element whose `inert` attribute someone else changed over to
 * that someone: the drawers stop managing it.
 */
function handOver(records: MutationRecord[]): void {
  for (const record of records) counts.delete(record.target as Element);
}

/**
 * Takes the pending records of changes by others, so they are handled before
 * the drawers change attributes themselves.
 */
function flush(): void {
  if (observer) handOver(observer.takeRecords());
}

/** Runs `change` without its own mutations counting as someone else's. */
function own(change: () => void): void {
  flush();
  change();
  observer?.takeRecords();
}

/**
 * Makes every element on the page outside `elements` inert, until the
 * returned function is called. Calling it more than once does nothing.
 */
export function inertOutside(...elements: Element[]): () => void {
  observer ??=
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(handOver);
  // The elements and their ancestors: never inert.
  const kept = new Set<Element>();
  for (const element of elements) {
    for (let node: Element | null = element; node; node = node.parentElement) {
      kept.add(node);
    }
  }
  const touched: Element[] = [];
  own(() => {
    for (const element of elements) {
      // Inside another one of the elements: covered by that one.
      if (
        elements.some((other) => other !== element && other.contains(element))
      ) {
        continue;
      }
      for (
        let node: Element = element;
        node.parentElement && node !== document.body;
        node = node.parentElement
      ) {
        for (const sibling of node.parentElement.children) {
          if (
            kept.has(sibling) ||
            touched.includes(sibling) ||
            SKIP.has(sibling.tagName)
          ) {
            continue;
          }
          const count = counts.get(sibling);
          if (count === undefined) {
            // Inert already, by the app: not ours to undo.
            if (sibling.hasAttribute('inert')) continue;
            sibling.setAttribute('inert', '');
            observer?.observe(sibling, {
              attributes: true,
              attributeFilter: ['inert'],
            });
          }
          counts.set(sibling, (count ?? 0) + 1);
          touched.push(sibling);
        }
      }
    }
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    own(() => {
      for (const sibling of touched) {
        const count = counts.get(sibling);
        // Handed over to the app, or never ours.
        if (count === undefined) continue;
        if (count > 1) {
          counts.set(sibling, count - 1);
        } else {
          counts.delete(sibling);
          sibling.removeAttribute('inert');
        }
      }
    });
    if (counts.size === 0) {
      // Stop observing the elements that are no longer managed.
      observer?.disconnect();
    }
  };
}
