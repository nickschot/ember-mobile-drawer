/**
 * The dim layer for a transparent iOS status bar (`@transparentStatusBar`,
 * #113).
 *
 * iOS Safari 26+ paints the status bar in one solid colour when a fixed or
 * sticky element is within 4px of the top clip line, or when `<body>` is
 * fixed. With `@transparentStatusBar`, the root of a modal drawer starts 5px
 * below the top (see the iOS block of styles.css), the backdrop only takes
 * the pointer events (transparent), and `<body>` isn't fixed (the overflow
 * lock, see `scroll-lock.ts`). The visible dim is this element instead: page
 * content (`position: absolute`, as large as the document), outside every
 * fixed element. Safari then shows the dimmed page, with its gradual blur,
 * in the status bar, with no edge.
 *
 * The element is inserted just before the drawer's root, so it is in the
 * same stacking context with the same `z-index`, and paints below the root
 * (and above an outer drawer, for a nested one). It is moved to the
 * document's origin, whatever its containing block, and sized to the
 * document with a ResizeObserver.
 *
 * Limits: an ancestor of the root that clips (`overflow`) or that is a
 * stacking context below page content cuts or hides the dim. A scaled
 * ancestor scales it too, so it doesn't cover the whole document then.
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

  /** Puts the element at the document's origin, at the document's size. */
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
    // The containing block can be any positioned ancestor of the root, also
    // a scaled one (the scale of the width applies to the offsets too).
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
