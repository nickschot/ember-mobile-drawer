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
/** Until the returned (idempotent) function is called. */
export declare function inertOutside(...elements: Element[]): () => void;
//# sourceMappingURL=inert.d.ts.map