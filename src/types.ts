import type { ModifierLike } from '@glint/template';

export type { SnapPoint } from './-private/snap-points/index.ts';

/**
 * The edge of the screen the drawer is attached to. `left` and `right` are
 * physical: they don't flip under `dir="rtl"`.
 */
export type Placement = 'bottom' | 'top' | 'left' | 'right';

/** What `<MobileDrawer>` yields to its block. */
export interface MobileDrawerApi {
  /**
   * Animates to the snap point at `index` in `@snapPoints`. When the drawer
   * is controlled (`@activeSnapPoint` is set), this only calls
   * `@onSnapPointChange`; the drawer moves once the parent passes the new
   * index back in.
   */
  snapTo: (index: number) => void;
  /**
   * Animates to the snap point with the largest offset. Does nothing before
   * the drawer has been inserted and measured: ordering `'content'` and
   * percentage snap points needs the measured sizes.
   */
  open: () => void;
  /**
   * Animates to the snap point with the smallest offset (usually `0`). Like
   * `open`, does nothing before the drawer has been measured.
   */
  close: () => void;
  /**
   * Index into `@snapPoints` of the snap point the drawer rests at or is
   * moving to.
   */
  activeSnapPoint: number;
  /**
   * Makes an element a drag handle: a gesture that starts on it always
   * drags the drawer and never scrolls the content, at every snap point,
   * also when the content is scrolled. Use it on a grabber or a sticky
   * header. The element gets `touch-action: pan-x` (`pan-y` for `left` and
   * `right`). Taps on buttons in it still work. The handle wins over the
   * elements in it (also a `data-mobile-drawer-scroll` element), except a
   * text field, so keep handles small.
   *
   * Without `@handleOnly` the rest of the tray drags too (and scrolls where
   * the content can scroll). With `@handleOnly={{true}}` dragging only
   * starts on handles, so the rest of the tray keeps its native touch
   * behaviour (e.g. scrolling).
   *
   * ```gts
   * <MobileDrawer as |drawer|>
   *   <header class="sheet-header" {{drawer.handle}}>...</header>
   * </MobileDrawer>
   * ```
   */
  handle: ModifierLike<{ Element: HTMLElement }>;
  /**
   * Whether the user is dragging the drawer: from the moment a pan along the
   * drawer's axis is recognised until the finger lifts. Dragging works with
   * touch and pen input.
   */
  isDragging: boolean;
  /** Whether the drawer is animating towards a snap point. */
  isAnimating: boolean;
  /**
   * How far open the drawer is, from `0` (closed) to `1` (at the largest
   * snap point), at the snap point it rests at or is moving to. It is not
   * updated every frame; for styling that follows the drawer frame by frame
   * use `--mobile-drawer-progress` on `.mobile-drawer__backdrop`.
   */
  progress: number;
}

/** What `@onOpen` and `@onClose` are called with. */
export interface MobileDrawerToggleEvent {
  /**
   * Index into `@snapPoints` of the snap point the drawer is moving to. For
   * `@onClose` always the smallest snap point.
   */
  snapPoint: number;
}

/** What `@onDragStart` is called with. */
export interface MobileDrawerDragStartEvent {
  /** Index into `@snapPoints` of the active snap point when the drag started. */
  snapPoint: number;
  /** How far open the drawer was when the drag started, in px. */
  offset: number;
}

/** What `@onDragEnd` is called with. */
export interface MobileDrawerDragEndEvent {
  /**
   * Index into `@snapPoints` of the snap point the release picked: the one
   * passed to `@onSnapPointChange` when it differs from the active one. When
   * the drawer is controlled, it only moves there once the parent passes it
   * in. A drag that ends without a release (its handle was removed, or
   * `@placement` changed) gives the active snap point, where the drawer
   * stays.
   */
  snapPoint: number;
  /**
   * How far open the drawer was when it was let go, in px: where the finger
   * put it. Right after a drag starts the tray is still catching up with the
   * finger, so it can be a few px behind this.
   */
  offset: number;
  /**
   * The release velocity in px/s along the drawer's axis: positive opens,
   * negative closes. `0` when the drag ended without a release or the
   * browser cancelled the pointer.
   */
  velocity: number;
}
