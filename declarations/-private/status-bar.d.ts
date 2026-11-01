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
export declare class PageDim {
    #private;
    readonly element: HTMLElement;
    constructor(root: HTMLElement);
    destroy(): void;
}
//# sourceMappingURL=status-bar.d.ts.map