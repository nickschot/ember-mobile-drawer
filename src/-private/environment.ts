import type { FrameClock } from './spring/spring.ts';
import type { ViewportLike as KeyboardViewport } from './keyboard-fill.ts';

/** The part of `CloseWatcher` (Chromium) the drawer uses. */
export interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null;
  destroy(): void;
}

export type CloseWatcherConstructor = new () => CloseWatcherLike;

/**
 * Overrides for the environment the drawer runs in; unset fields use the
 * browser. Read when a drawer is inserted, so set it before rendering.
 *
 * @internal Not public API: for the addon's tests and test-support.
 */
export const drawerEnvironment: {
  clock?: FrameClock;
  prefersReducedMotion?: () => boolean;
  /** Whether to lock body scrolling the iOS way. */
  isIOS?: () => boolean;
  /**
   * The time (ms) of drag input, for the release velocity: `dragDrawer` sets
   * it, as the time stamp of a synthetic event can't be set.
   */
  dragTime?: () => number;
  /** For `KeyboardFill`: no desktop browser has an on-screen keyboard. */
  visualViewport?: () => KeyboardViewport | null;
  /**
   * `CloseWatcher` for the back gesture, `null` for a browser without it.
   * Read when a drawer becomes modal.
   */
  CloseWatcher?: CloseWatcherConstructor | null;
  /** `navigator.userActivation.isActive`, read when a drawer becomes modal. */
  userActivation?: () => boolean;
} = {};
