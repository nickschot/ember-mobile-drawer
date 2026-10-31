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
 * Otherwise both properties are removed, so styles that use them (with no
 * fallback) don't apply at all, and e.g. a `transform` on the page doesn't
 * change `position: fixed` content in it while no drawer is open.
 *
 * A drawer inside a marked element never drives that element: the page
 * that contains a drawer can't move without moving the drawer.
 *
 * The marked elements are looked up when the first drawer starts to open
 * and kept until no drawer is open, so the document isn't queried on every
 * frame.
 *
 * @module
 * @internal
 */

export const PAGE_ATTRIBUTE = 'data-mobile-drawer-page';
export const PAGE_PROGRESS_PROPERTY = '--mobile-drawer-page-progress';
export const PAGE_VIEWPORT_TOP_PROPERTY = '--mobile-drawer-page-viewport-top';

interface Page {
  element: HTMLElement;
  /** The value written last; `0` when nothing is written. */
  progress: number;
}

/** Progress (above 0) by drawer root. */
const sources = new Map<Element, number>();
let pages: Page[] | undefined;

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

  if (!pages) {
    if (typeof document === 'undefined') return;
    pages = Array.from(
      document.querySelectorAll<HTMLElement>(`[${PAGE_ATTRIBUTE}]`),
      (element) => ({ element, progress: 0 }),
    );
  }

  for (const page of pages) {
    let max = 0;
    for (const [root, value] of sources) {
      if (value > max && !page.element.contains(root)) max = value;
    }
    if (max === page.progress) continue;
    const { style } = page.element;
    if (max > 0) {
      if (page.progress === 0) {
        const top = -page.element.getBoundingClientRect().top;
        style.setProperty(PAGE_VIEWPORT_TOP_PROPERTY, `${top}px`);
      }
      style.setProperty(PAGE_PROGRESS_PROPERTY, String(max));
    } else {
      style.removeProperty(PAGE_PROGRESS_PROPERTY);
      style.removeProperty(PAGE_VIEWPORT_TOP_PROPERTY);
    }
    page.progress = max;
  }

  if (sources.size === 0) pages = undefined;
}
