/**
 * Publishes how far the modal drawers are open to the page elements behind
 * them (`data-mobile-drawer-page`), for effects such as the iOS page scale.
 *
 * The viewport top is measured once: body scrolling is locked while a modal
 * drawer is open. With no drawer open, the properties and the attribute are
 * removed, so e.g. a page `transform` doesn't change `position: fixed`
 * content then. A drawer inside a marked element never drives it: the page
 * can't move without moving the drawer.
 *
 * The marked elements are cached while a drawer is open, so the document
 * isn't queried every frame; a `MutationObserver` refreshes them (e.g. a
 * route change replaces the page wrapper).
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
  /** `0` when nothing is written. */
  progress: number;
}

const sources = new Map<Element, number>();
let pages: Page[] | undefined;
/** Also while `pages` is out of date. */
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

function writeAll(pages: Page[]): void {
  for (const page of pages) {
    let max = 0;
    for (const [root, value] of sources) {
      if (value > max && !page.element.contains(root)) max = value;
    }
    write(page, max);
  }
}

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

/** `0` removes the drawer, e.g. when it closes or is destroyed. */
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
