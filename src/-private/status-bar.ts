/**
 * The dim layer for `@transparentStatusBar`. iOS Safari 26+ paints the status
 * bar in one solid colour when a fixed or sticky element is within 4px of the
 * top, or when `<body>` is fixed. So the dim is page content (absolute, as
 * large as the document), and the transparent backdrop only takes pointers.
 *
 * Inserted just before the root: same stacking context and `z-index`. An
 * ancestor that clips, or a scaled one, cuts the dim.
 *
 * @module
 * @internal
 */

export class PageDim {
  readonly element: HTMLElement;
  #observer?: ResizeObserver;

  constructor(root: HTMLElement) {
    const element = document.createElement('div');
    element.className = 'mobile-drawer__dim';
    element.setAttribute('aria-hidden', 'true');
    element.style.zIndex = getComputedStyle(root).zIndex;
    root.before(element);
    this.element = element;
    this.#place();
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.#place());
      this.#observer.observe(document.documentElement);
      this.#observer.observe(document.body);
    }
    window.addEventListener('resize', this.#onResize);
  }

  #onResize = (): void => this.#place();

  #place(): void {
    const { element } = this;
    const html = document.documentElement;
    const { style } = element;
    style.top = '0px';
    style.left = '0px';
    // Without its own size first, so the document can also get smaller.
    style.width = '0px';
    style.height = '0px';
    style.width = `${Math.max(html.scrollWidth, window.innerWidth)}px`;
    style.height = `${Math.max(html.scrollHeight, window.innerHeight)}px`;
    // The containing block can be any positioned (also scaled) ancestor.
    const rect = element.getBoundingClientRect();
    const scale = rect.width / element.offsetWidth || 1;
    const top = (-window.scrollY - rect.top) / scale;
    const left = (-window.scrollX - rect.left) / scale;
    if (Math.abs(top) >= 0.5) style.top = `${top}px`;
    if (Math.abs(left) >= 0.5) style.left = `${left}px`;
  }

  destroy(): void {
    this.#observer?.disconnect();
    window.removeEventListener('resize', this.#onResize);
    this.element.remove();
  }
}
