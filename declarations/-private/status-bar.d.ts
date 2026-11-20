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
export declare class PageDim {
    #private;
    readonly element: HTMLElement;
    constructor(root: HTMLElement);
    destroy(): void;
}
//# sourceMappingURL=status-bar.d.ts.map