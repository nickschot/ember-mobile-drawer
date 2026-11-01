import type { FrameClock } from './spring/spring.ts';

/**
 * Overrides for the environment the drawer runs in. Every field is optional;
 * unset fields use the browser defaults: those of {@link Spring}
 * (`performance.now` + `requestAnimationFrame`, and the
 * `prefers-reduced-motion` media query) and, for the body scroll lock, iOS
 * detection from `navigator`.
 *
 * Read when a drawer is inserted into the DOM, so set it before rendering.
 *
 * @internal Not public API. The addon's own tests use it to drive animations
 *   frame by frame with a fake clock, and to try the iOS scroll lock. The
 *   test-support helpers set `dragTime`.
 */
export const drawerEnvironment: {
  clock?: FrameClock;
  prefersReducedMotion?: () => boolean;
  /** Whether to lock body scrolling the iOS way, see `lockBodyScroll`. */
  isIOS?: () => boolean;
  /**
   * SPIKE (#113): which iOS scroll lock to use. `'fixed'` (the default) fixes
   * `<body>`; `'overflow'` doesn't, see `lockBodyScroll`.
   */
  iosScrollLock?: 'fixed' | 'overflow';
  /**
   * The time (ms) of drag input, for the release velocity, instead of the
   * event's time stamp or the clock. Read on every pointer event of a drag.
   * `dragDrawer` from `ember-mobile-drawer/test-support` sets it while it
   * drags, so it can release at a given velocity: the time stamp of a
   * synthetic event can't be set.
   */
  dragTime?: () => number;
} = {};
