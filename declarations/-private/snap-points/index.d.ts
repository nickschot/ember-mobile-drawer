/**
 * Snap-point model: pure functions on one axis. An "offset" is how far (px)
 * the drawer is open, from `0` (closed) to the container size.
 *
 * @module
 */
/**
 * A snap point as passed in by the user:
 *
 * - a number: an offset in px, e.g. `0` or `240`;
 * - a percentage string: a fraction of the container size, e.g. `'50%'`;
 * - `'content'`: the measured size of the drawer content.
 *
 * The type only checks the shape. The runtime check in
 * {@link resolveSnapPoints} is the source of truth: px values must be finite
 * and `>= 0`, and percentages must be between `0%` and `100%`. The number
 * part of a percentage is parsed with `Number()`, so every numeric form the
 * type accepts (such as `'.5%'` or `'1e1%'`) also works at runtime.
 *
 * @example
 * ```ts
 * const snapPoints: SnapPoint[] = [0, '50%', 'content', '100%'];
 * ```
 */
export type SnapPoint = number | `${number}%` | 'content';
/** The sizes snap points are resolved against, in px along the drawer axis. */
export interface SnapPointSizes {
    container: number;
    /** Required when any snap point is `'content'`. */
    content?: number;
}
/** A snap point resolved to a px offset. */
export interface ResolvedSnapPoint {
    /** Within `[0, container]`. */
    offset: number;
    /** Ascending indices of all inputs that resolved to this offset. */
    indices: number[];
}
/**
 * Resolves snap points to px offsets, sorted ascending, clamped to the
 * container and de-duplicated. A merged snap point keeps the container size
 * if one of its offsets is exactly that, so "fully open" stays exact;
 * otherwise its lowest offset.
 *
 * @throws RangeError for a non-finite or out-of-range size or snap point.
 * @throws Error for an empty array, a malformed snap point, or `'content'`
 *   without a content size.
 */
export declare function resolveSnapPoints(snapPoints: readonly SnapPoint[], sizes: SnapPointSizes): ResolvedSnapPoint[];
/** The resolved snap point that the input at `index` resolved to. */
export declare function findSnapPoint(resolved: readonly ResolvedSnapPoint[], index: number): ResolvedSnapPoint | undefined;
/**
 * Where a release at `velocity` (px/s) comes to rest with exponential decay
 * at `DECELERATION_RATE`: about a tenth of the velocity further.
 *
 * @throws RangeError when `offset` or `velocity` is not finite.
 */
export declare function projectOffset(offset: number, velocity: number): number;
export interface SelectSnapPointOptions {
    /**
     * Px/s at or above which a release moves at least to the next snap point in
     * its direction, so a short quick flick never settles against the finger.
     */
    flingVelocity?: number;
}
/**
 * The snap point nearest to the projected rest position; on a tie, the one in
 * the direction of the velocity (the lower one at rest). `resolved` must not
 * be empty.
 */
export declare function selectSnapPoint(resolved: readonly ResolvedSnapPoint[], offset: number, velocity: number, options?: SelectSnapPointOptions): ResolvedSnapPoint;
export interface RubberBandOptions {
    /** Px the overshoot approaches but never reaches. `0` is a hard stop. */
    dimension: number;
}
/**
 * Rubber-band resistance outside `[min, max]`: an overshoot `x` becomes
 * `(1 - 1 / (x * factor / dimension + 1)) * dimension`.
 */
export declare function rubberBand(offset: number, min: number, max: number, { dimension }: RubberBandOptions): number;
/**
 * The inverse of `rubberBand`. It grows without bound near `dimension`, so
 * the overshoot is clamped to `MAX_BAND_FRACTION` of it.
 */
export declare function unRubberBand(offset: number, min: number, max: number, { dimension }: RubberBandOptions): number;
export interface DragBands {
    below: RubberBandOptions;
    above: RubberBandOptions;
}
/**
 * Where a drag from `start` (the offset shown when caught) puts the drawer
 * after `delta` px. A drag that catches the drawer outside `[min, max]`
 * continues without a jump: 1:1 towards the range, and only the rest of the
 * band resists further out.
 */
export declare function dragOffset(start: number, delta: number, min: number, max: number, bands: DragBands): number;
//# sourceMappingURL=index.d.ts.map