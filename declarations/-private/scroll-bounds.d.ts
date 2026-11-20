/**
 * Scroll positions along one axis, also in right-to-left containers. Used by
 * the component and by the iOS overflow lock.
 *
 * @module
 * @internal
 */
/** How far (px) `element` can scroll along the axis in all. */
export declare function scrollRange(element: Element, vertical: boolean): number;
/** Right-to-left horizontal positions run from `-range` to `0`. */
export declare function scrollBounds(element: Element, vertical: boolean, style: {
    direction: string;
}): {
    range: number;
    min: number;
    max: number;
    position: number;
};
export declare function scrollsAlong(style: {
    overflowX: string;
    overflowY: string;
}, vertical: boolean): boolean;
/**
 * Whether `element` can scroll along the axis in the direction a finger that
 * moved `movement` px (positive: down or right) pushes its content.
 */
export declare function canScroll(element: Element, vertical: boolean, movement: number): boolean;
//# sourceMappingURL=scroll-bounds.d.ts.map