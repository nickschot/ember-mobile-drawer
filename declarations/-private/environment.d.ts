import type { FrameClock } from './spring/spring.ts';
import type { ViewportLike as KeyboardViewport } from './keyboard-fill.ts';
/**
 * Overrides for the environment the drawer runs in; unset fields use the
 * browser. Read when a drawer is inserted, so set it before rendering.
 *
 * @internal Not public API: for the addon's tests and test-support.
 */
export declare const drawerEnvironment: {
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
};
//# sourceMappingURL=environment.d.ts.map