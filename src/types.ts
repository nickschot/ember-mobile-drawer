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
   * Makes an element a drag handle when the drawer has `@handleOnly={{true}}`:
   * dragging then only starts on handles, so the rest of the tray keeps its
   * native touch behaviour (e.g. scrolling). Without `@handleOnly` the whole
   * tray drags and this modifier does nothing, so a handle can be marked up
   * either way.
   *
   * ```gts
   * <MobileDrawer @handleOnly={{true}} as |drawer|>
   *   <div class="grabber" {{drawer.handle}}></div>
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
  /** How far open the drawer was when it was let go, in px. */
  offset: number;
  /**
   * The release velocity in px/s along the drawer's axis: positive opens,
   * negative closes. `0` when the drag ended without a release or the
   * browser cancelled the pointer.
   */
  velocity: number;
}
