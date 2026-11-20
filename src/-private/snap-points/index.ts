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

/** Px: closer offsets are one snap point (else one would be unreachable). */
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
 * Resolves snap points to px offsets, sorted ascending, clamped to the
 * container and de-duplicated. A merged snap point keeps the container size
 * if one of its offsets is exactly that, so "fully open" stays exact;
 * otherwise its lowest offset.
 *
 * @throws RangeError for a non-finite or out-of-range size or snap point.
 * @throws Error for an empty array, a malformed snap point, or `'content'`
 *   without a content size.
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

/** The resolved snap point that the input at `index` resolved to. */
export function findSnapPoint(
  resolved: readonly ResolvedSnapPoint[],
  index: number,
): ResolvedSnapPoint | undefined {
  return resolved.find((snapPoint) => snapPoint.indices.includes(index));
}

/**
 * Per millisecond, as iOS `UIScrollView.DecelerationRate.fast`. `.normal`
 * (`0.998`) projects five times as far and skips snap points on small sheets.
 */
const DECELERATION_RATE = 0.99;

/**
 * Where a release at `velocity` (px/s) comes to rest with exponential decay
 * at `DECELERATION_RATE`: about a tenth of the velocity further.
 *
 * @throws RangeError when `offset` or `velocity` is not finite.
 */
export function projectOffset(offset: number, velocity: number): number {
  assertFinite('offset', offset);
  assertFinite('velocity', velocity);
  return (
    offset + ((velocity / 1000) * DECELERATION_RATE) / (1 - DECELERATION_RATE)
  );
}

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
export function selectSnapPoint(
  resolved: readonly ResolvedSnapPoint[],
  offset: number,
  velocity: number,
  options: SelectSnapPointOptions = {},
): ResolvedSnapPoint {
  const first = resolved[0]!;
  const { flingVelocity } = options;
  const projected = projectOffset(offset, velocity);

  let best = first;
  let bestDistance = Math.abs(first.offset - projected);
  for (const snapPoint of resolved.slice(1)) {
    const distance = Math.abs(snapPoint.offset - projected);
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

/** Rubber-band resistance factor, as used by iOS scroll views. */
const DEFAULT_RUBBER_BAND_FACTOR = 0.55;

export interface RubberBandOptions {
  /** Px the overshoot approaches but never reaches. `0` is a hard stop. */
  dimension: number;
}

/**
 * Rubber-band resistance outside `[min, max]`: an overshoot `x` becomes
 * `(1 - 1 / (x * factor / dimension + 1)) * dimension`.
 */
export function rubberBand(
  offset: number,
  min: number,
  max: number,
  { dimension }: RubberBandOptions,
): number {
  const factor = DEFAULT_RUBBER_BAND_FACTOR;
  const resist = (overshoot: number): number =>
    dimension <= 0
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
 * The inverse of `rubberBand`. It grows without bound near `dimension`, so
 * the overshoot is clamped to `MAX_BAND_FRACTION` of it.
 */
export function unRubberBand(
  offset: number,
  min: number,
  max: number,
  { dimension }: RubberBandOptions,
): number {
  const factor = DEFAULT_RUBBER_BAND_FACTOR;
  const unresist = (overshoot: number): number => {
    if (dimension <= 0) return 0;
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

const MAX_BAND_FRACTION = 0.999;

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
export function dragOffset(
  start: number,
  delta: number,
  min: number,
  max: number,
  bands: DragBands,
): number {
  const { below, above } = bands;
  const raw = start + delta;

  if (start > max ? delta > 0 : start < min && delta < 0) {
    // Further out: the band's increase from its (un-banded) position.
    const band = start > max ? above : below;
    const from = unRubberBand(start, min, max, band);
    return (
      start +
      rubberBand(from + delta, min, max, band) -
      rubberBand(from, min, max, band)
    );
  }
  // Towards the range: 1:1 while still outside it.
  if ((start > max && raw > max) || (start < min && raw < min)) {
    return raw;
  }
  return rubberBand(raw, min, max, raw > max ? above : below);
}
