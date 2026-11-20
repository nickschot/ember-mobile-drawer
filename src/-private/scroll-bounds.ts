/**
 * Scroll positions along one axis, also in right-to-left containers. Used by
 * the component and by the iOS overflow lock.
 *
 * @module
 * @internal
 */

/** Tolerance (px): scroll positions can be fractional. */
const EPSILON = 0.5;

/** How far (px) `element` can scroll along the axis in all. */
export function scrollRange(element: Element, vertical: boolean): number {
  return vertical
    ? element.scrollHeight - element.clientHeight
    : element.scrollWidth - element.clientWidth;
}

/** Right-to-left horizontal positions run from `-range` to `0`. */
export function scrollBounds(
  element: Element,
  vertical: boolean,
  style: { direction: string },
): { range: number; min: number; max: number; position: number } {
  const range = scrollRange(element, vertical);
  const rtl = !vertical && style.direction === 'rtl';
  return {
    range,
    min: rtl ? -range : 0,
    max: rtl ? 0 : range,
    position: vertical ? element.scrollTop : element.scrollLeft,
  };
}

export function scrollsAlong(
  style: { overflowX: string; overflowY: string },
  vertical: boolean,
): boolean {
  const overflow = vertical ? style.overflowY : style.overflowX;
  return overflow === 'auto' || overflow === 'scroll';
}

/**
 * Whether `element` can scroll along the axis in the direction a finger that
 * moved `movement` px (positive: down or right) pushes its content.
 */
export function canScroll(
  element: Element,
  vertical: boolean,
  movement: number,
): boolean {
  const style = getComputedStyle(element);
  if (!scrollsAlong(style, vertical)) return false;
  const { range, min, max, position } = scrollBounds(element, vertical, style);
  if (!(range > EPSILON)) return false;
  // iOS reports positions past the ends while bouncing; those count as ends.
  return movement > 0 ? position > min + EPSILON : position < max - EPSILON;
}
