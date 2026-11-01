/**
 * Makes everything on the page except some elements `inert`, for modal
 * drawers: the drawer's root and the portals of the drawers nested in it
 * (see `nesting.ts`).
 *
 * "Everything except the elements" are the siblings of each element and of
 * each of its ancestors up to `<body>`, except the elements and their
 * ancestors: the smallest set of subtrees that covers the page without
 * covering one of the elements. Each sibling gets the `inert` attribute,
 * which removes it from the tab order, from pointer and find-in-page
 * interaction and from the accessibility tree.
 *
 * Counted per element, so drawers can open and close in any order: an
 * element only loses `inert` once every drawer that made it inert let go.
 * Only attributes the drawers added are removed:
 * - elements that were already inert are left alone;
 * - once the app sets (or removes) `inert` on an element a drawer made
 *   inert, the attribute is the app's, and the drawers stop managing it.
 *   A `MutationObserver` on those elements notices that.
 * Elements added to the page later (e.g. a toast appended to `<body>`) are
 * not made inert.
 *
 * @module
 * @internal
 */
/**
 * Makes every element on the page outside `elements` inert, until the
 * returned function is called. Calling it more than once does nothing.
 */
export declare function inertOutside(...elements: Element[]): () => void;
//# sourceMappingURL=inert.d.ts.map