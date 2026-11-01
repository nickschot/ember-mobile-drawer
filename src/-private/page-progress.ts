/**
 * Publishes how far the modal drawers are open to the page behind them, for
 * effects such as the iOS theme's page scale.
 *
 * Every element marked with `data-mobile-drawer-page` gets two inline custom
 * properties while a modal drawer outside it is open above its smallest snap
 * point:
 * - `--mobile-drawer-page-progress`: the largest progress of those drawers,
 *   above `0` and at most `1`;
 * - `--mobile-drawer-page-viewport-top`: where the top of the viewport is in
 *   the element, in px (`0` when the element starts at the top of the
 *   viewport, `500px` when the page is scrolled down by 500px), measured
 *   when the element was looked up. Body scrolling is locked while a modal
 *   drawer is open, so it doesn't change after that.
 * It also gets the attribute `data-mobile-drawer-page-active` for that time,
 * for styles that only need to know that the page is behind an open drawer
 * (e.g. the iOS theme's black `<body>`).
 * Otherwise the properties and the attribute are removed, so styles that
 * use the properties (with no fallback) don't apply at all, and e.g. a
 * `transform` on the page doesn't change `position: fixed` content in it
 * while no drawer is open.
 *
 * Only modal drawers from the bottom call this (see the component's
 * `#render`). A drawer inside a marked element never drives that element:
 * the page that contains a drawer can't move without moving the drawer.
 *
 * The marked elements are looked up when the first drawer starts to open
 * and kept until no drawer is open, so the document isn't queried on every
 * frame. While a drawer is open, a `MutationObserver` looks them up again
 * when elements are added or removed, or an element is marked or unmarked
 * (e.g. a route change replaces the page wrapper), and writes the current
 * progress on them at once, also while the drawers are at rest. An element
 * that leaves the list gets its properties and attribute removed.
 *
 * @module
 * @internal
 */

export const PAGE_ATTRIBUTE = 'data-mobile-drawer-page';
export const PAGE_PROGRESS_PROPERTY = '--mobile-drawer-page-progress';
export const PAGE_VIEWPORT_TOP_PROPERTY = '--mobile-drawer-page-viewport-top';

export const PAGE_ACTIVE_ATTRIBUTE = 'data-mobile-drawer-page-active';

interface Page {
  element: HTMLElement;
  /** The value written last; `0` when nothing is written. */
  progress: number;
}

/** Progress (above 0) by drawer root. */
const sources = new Map<Element, number>();
/** The marked elements; `undefined` when they must be looked up again. */
let pages: Page[] | undefined;
/** The pages written so far, also while `pages` is out of date. */
const written = new Map<HTMLElement, Page>();
let observer: MutationObserver | undefined;

function write(page: Page, progress: number): void {
  if (progress === page.progress) return;
  const { element } = page;
  const { style } = element;
  if (progress > 0) {
    if (page.progress === 0) {
      const top = -element.getBoundingClientRect().top;
      style.setProperty(PAGE_VIEWPORT_TOP_PROPERTY, `${top}px`);
      element.setAttribute(PAGE_ACTIVE_ATTRIBUTE, '');
      written.set(element, page);
    }
    style.setProperty(PAGE_PROGRESS_PROPERTY, String(progress));
  } else {
    style.removeProperty(PAGE_PROGRESS_PROPERTY);
    style.removeProperty(PAGE_VIEWPORT_TOP_PROPERTY);
    element.removeAttribute(PAGE_ACTIVE_ATTRIBUTE);
    written.delete(element);
  }
  page.progress = progress;
}

/** Looks up the marked elements, and clears those that are no longer. */
function findPages(): Page[] {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>(`[${PAGE_ATTRIBUTE}]`),
    (element) => written.get(element) ?? { element, progress: 0 },
  );
  for (const page of Array.from(written.values())) {
    if (!found.includes(page)) write(page, 0);
  }
  return found;
}

/** Writes the current progress of the drawers on every page element. */
function writeAll(pages: Page[]): void {
  for (const page of pages) {
    let max = 0;
    for (const [root, value] of sources) {
      if (value > max && !page.element.contains(root)) max = value;
    }
    write(page, max);
  }
}

/**
 * Watches the DOM while a drawer is open: after a change, looks up the page
 * elements again and writes the current progress on them at once, also
 * while the drawers are at rest.
 */
function observe(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    if (sources.size === 0) return;
    pages = findPages();
    writeAll(pages);
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributeFilter: [PAGE_ATTRIBUTE],
  });
}

/**
 * Sets the progress of the drawer with root `source`, from `0` to `1`, and
 * updates the marked page elements. `0` removes the drawer, e.g. when it
 * closes or is destroyed.
 */
export function setPageProgress(source: Element, progress: number): void {
  if (progress > 0) {
    sources.set(source, Math.min(progress, 1));
  } else if (!sources.delete(source)) {
    return;
  }

  if (typeof document === 'undefined') return;
  pages ??= findPages();
  writeAll(pages);

  if (sources.size > 0) {
    observe();
  } else {
    pages = undefined;
    observer?.disconnect();
    observer = undefined;
  }
}
