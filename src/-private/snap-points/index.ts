/**
 * Snap-point model for the drawer.
 *
 * Everything in here is a pure function on a single axis: an "offset" is the
 * distance in px the drawer is opened along its axis, from `0` (closed) up to
 * the container size (fully open). Mapping that distance to a placement
 * (left/right/top/bottom) is the component's job.
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
  /** Size of the container the drawer opens in. */
  container: number;
  /**
   * Measured size of the drawer content. Required when any snap point is
   * `'content'`.
   */
  content?: number;
}

/** A snap point resolved to a px offset. */
export interface ResolvedSnapPoint {
  /** Offset in px along the drawer axis, within `[0, container]`. */
  offset: number;
  /**
   * Indices into the original snap point array that resolved to this offset,
   * in ascending order. More than one when several inputs resolve to the same
   * offset (e.g. `'100%'` and `'content'` when the content fills the
   * container). Use {@link findSnapPoint} to map a snap point across a
   * re-resolve (e.g. after a resize).
   */
  indices: number[];
}

/**
 * Offsets closer together than this (in px) are treated as the same snap
 * point. Sub-pixel differences can't be told apart on screen and would only
 * produce unreachable snap points.
 */
const DEDUPE_TOLERANCE = 0.5;

function describe(snapPoint: unknown): string {
  return typeof snapPoint === 'string' ? `'${snapPoint}'` : String(snapPoint);
}

function assertSize(name: string, size: unknown): asserts size is number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new RangeError(
      `ember-mobile-drawer: the ${name} size must be a finite number >= 0, got ${describe(size)}.`,
    );
  }
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `ember-mobile-drawer: ${name} must be a finite number, got ${describe(value)}.`,
    );
  }
}

function resolveOne(
  snapPoint: unknown,
  index: number,
  sizes: SnapPointSizes,
): number {
  const prefix = `ember-mobile-drawer: invalid snap point ${describe(snapPoint)} at index ${index}.`;

  if (typeof snapPoint === 'number') {
    if (!Number.isFinite(snapPoint) || snapPoint < 0) {
      throw new RangeError(
        `${prefix} Pixel snap points must be finite numbers >= 0.`,
      );
    }
    return snapPoint;
  }

  if (snapPoint === 'content') {
    if (sizes.content === undefined) {
      throw new Error(
        `${prefix} 'content' snap points need the measured content size, but none was given.`,
      );
    }
    assertSize('content', sizes.content);
    return sizes.content;
  }

  if (typeof snapPoint === 'string') {
    const trimmed = snapPoint.trim();
    const number = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : '';
    // Number('') is 0, so an empty number part is rejected explicitly.
    const percentage = number === '' ? NaN : Number(number);
    if (!(percentage >= 0 && percentage <= 100)) {
      throw new RangeError(
        `${prefix} Percentage snap points must be between '0%' and '100%', like '50%'.`,
      );
    }
    return (percentage / 100) * sizes.container;
  }

  throw new Error(
    `${prefix} Expected a number (px), a percentage like '50%' or 'content'.`,
  );
}

/**
 * Resolves snap points to px offsets, sorted ascending and de-duplicated.
 *
 * Offsets are clamped to `[0, sizes.container]`: the drawer can't open further
 * than its container, so a px value or `'content'` larger than the container
 * resolves to the container size (and is then de-duplicated with any other
 * snap point at that offset, e.g. `'100%'`).
 *
 * Offsets within half a pixel of each other are merged into one snap point
 * that keeps the indices of all merged inputs. It keeps the container size
 * when one of the merged offsets is exactly the container size, so "fully
 * open" stays exact. Otherwise it keeps the lowest merged offset.
 *
 * @throws RangeError when a size or a px or percentage snap point is
 *   non-finite or out of range.
 * @throws Error when `sizes` is missing, the snap point array is empty, a
 *   snap point is malformed (an unknown string or type), or `'content'` is used
 *   without a content size.
 *
 * @example
 * ```ts
 * resolveSnapPoints([0, '50%', 'content', '100%'], { container: 800, content: 300 });
 * // [
 * //   { offset: 0, indices: [0] },
 * //   { offset: 300, indices: [2] },
 * //   { offset: 400, indices: [1] },
 * //   { offset: 800, indices: [3] },
 * // ]
 * ```
 */
export function resolveSnapPoints(
  snapPoints: readonly SnapPoint[],
  sizes: SnapPointSizes,
): ResolvedSnapPoint[] {
  if (!Array.isArray(snapPoints) || snapPoints.length === 0) {
    throw new Error(
      `ember-mobile-drawer: snap points must be a non-empty array, got ${describe(snapPoints)}.`,
    );
  }
  if (typeof sizes !== 'object' || sizes === null) {
    throw new Error(
      `ember-mobile-drawer: resolving snap points needs a sizes object like { container: 800 }, got ${describe(sizes)}.`,
    );
  }
  assertSize('container', sizes.container);

  const sorted = snapPoints
    .map((snapPoint, index) => ({
      offset: Math.min(resolveOne(snapPoint, index, sizes), sizes.container),
      index,
    }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index);

  const resolved: ResolvedSnapPoint[] = [];
  for (const { offset, index } of sorted) {
    const previous = resolved[resolved.length - 1];
    if (previous && offset - previous.offset < DEDUPE_TOLERANCE) {
      previous.indices.push(index);
      previous.indices.sort((a, b) => a - b);
      if (offset === sizes.container) {
        previous.offset = offset;
      }
    } else {
      resolved.push({ offset, indices: [index] });
    }
  }
  return resolved;
}

/**
 * Finds the resolved snap point that the original snap point at `index`
 * resolved to. Use it to keep the drawer at "the same" snap point when the
 * snap points are re-resolved, e.g. after the container is resized.
 *
 * @returns The matching snap point, or `undefined` when `index` is not in
 *   `resolved` (e.g. the snap point array got shorter).
 */
export function findSnapPoint(
  resolved: readonly ResolvedSnapPoint[],
  index: number,
): ResolvedSnapPoint | undefined {
  return resolved.find((snapPoint) => snapPoint.indices.includes(index));
}

/**
 * Default deceleration rate per millisecond, matching iOS
 * `UIScrollView.DecelerationRate.normal`.
 */
export const DEFAULT_DECELERATION_RATE = 0.998;

/**
 * Projects where a release would come to rest if it kept moving and slowed
 * down by exponential decay: each millisecond the velocity is multiplied by
 * `decelerationRate`. Summed over time that adds
 * `velocity / 1000 * rate / (1 - rate)` px, which for the default rate is
 * roughly half the velocity in px/s (a 1000 px/s flick travels ~500px).
 *
 * @param offset Current offset in px.
 * @param velocity Release velocity in px/s along the same axis (positive moves
 *   towards larger offsets).
 * @param decelerationRate Velocity multiplier per ms, strictly between `0` and
 *   `1`. Lower values stop sooner. `0.99` matches iOS `.fast`.
 * @throws RangeError when `offset` or `velocity` is not finite, or
 *   `decelerationRate` is not strictly between `0` and `1`. Callers that
 *   derive velocity from a zero time delta must guard against that themselves.
 */
export function projectOffset(
  offset: number,
  velocity: number,
  decelerationRate: number = DEFAULT_DECELERATION_RATE,
): number {
  assertFinite('offset', offset);
  assertFinite('velocity', velocity);
  if (!(decelerationRate > 0 && decelerationRate < 1)) {
    throw new RangeError(
      `ember-mobile-drawer: decelerationRate must be a number strictly between 0 and 1, got ${describe(decelerationRate)}.`,
    );
  }
  return (
    offset + ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
  );
}

/** Options for {@link selectSnapPoint}. */
export interface SelectSnapPointOptions {
  /** See {@link projectOffset}. Defaults to {@link DEFAULT_DECELERATION_RATE}. */
  decelerationRate?: number;
  /**
   * Speed in px/s, `>= 0`, at or above which a release always moves at least
   * to the next snap point in the direction of the velocity (when there is
   * one), even when the projection lands nearer to a snap point behind it.
   * Without it, a quick but short flick that starts far from the next snap
   * point can settle against the direction the finger moved. Off by default.
   */
  flingVelocity?: number;
}

/**
 * Picks the snap point to settle on after a release: the one nearest to the
 * projected end position (see {@link projectOffset}). A slow release settles
 * on the nearest snap point, a fast flick can skip one or more.
 *
 * When the projected position is exactly halfway between two snap points the
 * one in the direction of the velocity wins (or the lower one when at rest).
 *
 * With {@link SelectSnapPointOptions.flingVelocity}, a release at least that
 * fast never settles against its direction: if the nearest snap point is not
 * beyond `offset` in the direction of the velocity, the first snap point that
 * is beyond it is picked instead.
 *
 * @param resolved Snap points from {@link resolveSnapPoints}; must not be empty.
 * @param offset Offset in px at release.
 * @param velocity Release velocity in px/s.
 * @throws RangeError for non-finite or out of range input, see
 *   {@link projectOffset}.
 * @throws Error when `resolved` is empty.
 */
export function selectSnapPoint(
  resolved: readonly ResolvedSnapPoint[],
  offset: number,
  velocity: number,
  options: SelectSnapPointOptions = {},
): ResolvedSnapPoint {
  const first = resolved[0];
  if (!first) {
    throw new Error(
      'ember-mobile-drawer: cannot select from zero snap points.',
    );
  }
  const { flingVelocity } = options;
  if (
    flingVelocity !== undefined &&
    !(Number.isFinite(flingVelocity) && flingVelocity >= 0)
  ) {
    throw new RangeError(
      `ember-mobile-drawer: flingVelocity must be a finite number >= 0, got ${describe(flingVelocity)}.`,
    );
  }
  const projected = projectOffset(offset, velocity, options.decelerationRate);

  let best = first;
  let bestDistance = Math.abs(first.offset - projected);
  for (const snapPoint of resolved.slice(1)) {
    const distance = Math.abs(snapPoint.offset - projected);
    // Ascending order: on a tie, moving to the higher one only when moving up.
    if (
      distance < bestDistance ||
      (distance === bestDistance && velocity > 0)
    ) {
      best = snapPoint;
      bestDistance = distance;
    }
  }

  if (
    flingVelocity !== undefined &&
    velocity !== 0 &&
    Math.abs(velocity) >= flingVelocity
  ) {
    const forward =
      velocity > 0
        ? resolved.find((snapPoint) => snapPoint.offset > offset)
        : resolved.findLast((snapPoint) => snapPoint.offset < offset);
    const backwards =
      velocity > 0 ? best.offset <= offset : best.offset >= offset;
    if (forward && backwards) best = forward;
  }
  return best;
}

/**
 * Default rubber-band factor, as used by iOS scroll views. Lower is stiffer,
 * `0` disables overscroll entirely.
 */
export const DEFAULT_RUBBER_BAND_FACTOR = 0.55;

/** Options for {@link rubberBand}. */
export interface RubberBandOptions {
  /**
   * Size in px that bounds the overshoot, usually the container size. The
   * overshoot approaches but never reaches this distance. `0` is a hard stop.
   */
  dimension: number;
  /**
   * Resistance factor, `>= 0`. Defaults to
   * {@link DEFAULT_RUBBER_BAND_FACTOR}.
   */
  factor?: number;
}

/**
 * Applies rubber-band resistance to an offset dragged past `[min, max]`
 * (usually the first and last resolved snap point). Inside the range the
 * offset is returned unchanged; outside it the overshoot `x` becomes
 *
 * ```
 * (1 - 1 / (x * factor / dimension + 1)) * dimension
 * ```
 *
 * At first the drawer moves `factor` px for every px the finger moves
 * (`factor`:1). After that it gives diminishing returns the further it is
 * pulled, and the overshoot never exceeds `dimension`.
 *
 * @param offset Raw offset in px (e.g. where the finger is).
 * @param min Lowest allowed offset, e.g. the first snap point.
 * @param max Highest allowed offset, e.g. the last snap point; `>= min`.
 * @throws RangeError when an input is not finite, `min > max`, or `dimension`
 *   or `factor` is negative.
 */
export function rubberBand(
  offset: number,
  min: number,
  max: number,
  { dimension, factor = DEFAULT_RUBBER_BAND_FACTOR }: RubberBandOptions,
): number {
  assertFinite('offset', offset);
  assertFinite('min', min);
  assertFinite('max', max);
  if (min > max) {
    throw new RangeError(
      `ember-mobile-drawer: rubberBand min must be <= max, got min ${min} and max ${max}.`,
    );
  }
  for (const [name, value] of [
    ['dimension', dimension],
    ['factor', factor],
  ] as const) {
    if (!(Number.isFinite(value) && value >= 0)) {
      throw new RangeError(
        `ember-mobile-drawer: rubberBand ${name} must be a finite number >= 0, got ${describe(value)}.`,
      );
    }
  }

  const resist = (overshoot: number): number =>
    factor <= 0 || dimension <= 0
      ? 0
      : (1 - 1 / ((overshoot * factor) / dimension + 1)) * dimension;

  if (offset < min) {
    return min - resist(min - offset);
  }
  if (offset > max) {
    return max + resist(offset - max);
  }
  return offset;
}

/**
 * The inverse of {@link rubberBand}: the raw offset that `rubberBand` turns
 * into `offset`, so a drag that catches a rubber-banded drawer can continue
 * from where it is shown. `rubberBand(unRubberBand(x, ...), ...)` is `x`
 * (within floating point error) for every `x` less than
 * `MAX_BAND_FRACTION * dimension` outside the range.
 *
 * `rubberBand` only approaches `dimension`, and near it the inverse grows
 * without bound. So an overshoot is first clamped to
 * `MAX_BAND_FRACTION * dimension`, which keeps the result finite and
 * moderate: at most `999 * dimension / factor` outside the range. With a
 * `factor` or `dimension` of `0` nothing can be outside the range, so the
 * offset is clamped to it.
 *
 * @throws RangeError for the same input as {@link rubberBand}.
 */
export function unRubberBand(
  offset: number,
  min: number,
  max: number,
  options: RubberBandOptions,
): number {
  // Validates the input the same way.
  rubberBand(offset, min, max, options);
  const { dimension, factor = DEFAULT_RUBBER_BAND_FACTOR } = options;

  const unresist = (overshoot: number): number => {
    if (factor <= 0 || dimension <= 0) return 0;
    const fraction = Math.min(overshoot / dimension, MAX_BAND_FRACTION);
    return (dimension / factor) * (1 / (1 - fraction) - 1);
  };

  if (offset < min) {
    return min - unresist(min - offset);
  }
  if (offset > max) {
    return max + unresist(offset - max);
  }
  return offset;
}

/**
 * The largest fraction of the rubber-band `dimension` that
 * {@link unRubberBand} inverts; larger overshoots are clamped to it.
 */
export const MAX_BAND_FRACTION = 0.999;

/** The rubber-bands below the first and above the last snap point. */
export interface DragBands {
  below: RubberBandOptions;
  above: RubberBandOptions;
}

/**
 * Where a drag puts the drawer when it started at `start` (the offset shown
 * when the finger caught it) and the finger has since moved `delta` px
 * (positive opens).
 *
 * From inside `[min, max]` this is `rubberBand(start + delta)`. A drag that
 * catches the drawer outside the range (e.g. springing back from a
 * rubber-band, or a spring overshoot) continues from where it is shown,
 * without a jump:
 *
 * - towards the range, the drawer follows the finger 1:1 until it is back in
 *   the range, and from there as from inside;
 * - further away from the range, only the band that is left resists: the
 *   increase of the band from where it is. An overshoot at or past the
 *   band's limit (possible after a spring overshoot when the tray is longer
 *   than the largest snap point) then barely moves, but never jumps.
 *
 * @throws RangeError for non-finite input, or band options
 *   {@link rubberBand} rejects.
 */
export function dragOffset(
  start: number,
  delta: number,
  min: number,
  max: number,
  bands: DragBands,
): number {
  assertFinite('start', start);
  assertFinite('delta', delta);
  const { below, above } = bands;
  const raw = start + delta;

  if (start > max && delta > 0) {
    // Further out: the band's increase from its (un-banded) position.
    const from = unRubberBand(start, min, max, above);
    return (
      start +
      rubberBand(from + delta, min, max, above) -
      rubberBand(from, min, max, above)
    );
  }
  if (start < min && delta < 0) {
    const from = unRubberBand(start, min, max, below);
    return (
      start +
      rubberBand(from + delta, min, max, below) -
      rubberBand(from, min, max, below)
    );
  }
  // Towards the range: 1:1 while still outside it.
  if ((start > max && raw > max) || (start < min && raw < min)) {
    return raw;
  }
  return rubberBand(raw, min, max, raw > max ? above : below);
}
