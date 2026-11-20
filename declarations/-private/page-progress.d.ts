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
export declare const PAGE_ATTRIBUTE = "data-mobile-drawer-page";
export declare const PAGE_PROGRESS_PROPERTY = "--mobile-drawer-page-progress";
export declare const PAGE_VIEWPORT_TOP_PROPERTY = "--mobile-drawer-page-viewport-top";
export declare const PAGE_ACTIVE_ATTRIBUTE = "data-mobile-drawer-page-active";
/** `0` removes the drawer, e.g. when it closes or is destroyed. */
export declare function setPageProgress(source: Element, progress: number): void;
//# sourceMappingURL=page-progress.d.ts.map