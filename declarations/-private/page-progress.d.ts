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
export declare const PAGE_ATTRIBUTE = "data-mobile-drawer-page";
export declare const PAGE_PROGRESS_PROPERTY = "--mobile-drawer-page-progress";
export declare const PAGE_VIEWPORT_TOP_PROPERTY = "--mobile-drawer-page-viewport-top";
export declare const PAGE_ACTIVE_ATTRIBUTE = "data-mobile-drawer-page-active";
/**
 * Sets the progress of the drawer with root `source`, from `0` to `1`, and
 * updates the marked page elements. `0` removes the drawer, e.g. when it
 * closes or is destroyed.
 */
export declare function setPageProgress(source: Element, progress: number): void;
//# sourceMappingURL=page-progress.d.ts.map