/**
 * Makes everything on the page except some elements `inert`, for modal
 * drawers: the siblings of each element and of its ancestors up to `<body>`.
 *
 * Counted per element, so drawers can open and close in any order. Only
 * attributes the drawers added are removed: once the app changes `inert` on
 * such an element, it is the app's. Elements added later are not made inert.
 *
 * @module
 * @internal
 */

/** Elements that don't render. */
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'LINK',
  'META',
  'NOSCRIPT',
]);

const counts = new Map<Element, number>();

let observer: MutationObserver | undefined;

/** The drawers stop managing an element whose `inert` someone else changed. */
function handOver(records: MutationRecord[]): void {
  for (const record of records) counts.delete(record.target as Element);
}

/** Handles changes by others before the drawers change attributes. */
function flush(): void {
  if (observer) handOver(observer.takeRecords());
}

function own(change: () => void): void {
  flush();
  change();
  observer?.takeRecords();
}

/** Until the returned (idempotent) function is called. */
export function inertOutside(...elements: Element[]): () => void {
  observer ??=
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(handOver);
  const kept = new Set<Element>();
  for (const element of elements) {
    for (let node: Element | null = element; node; node = node.parentElement) {
      kept.add(node);
    }
  }
  const touched: Element[] = [];
  own(() => {
    for (const element of elements) {
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
      observer?.disconnect();
    }
  };
}
