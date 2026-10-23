import type { FrameClock } from './spring/spring.ts';
/**
 * Overrides for the environment the drawer animates in. Every field is
 * optional; unset fields use the browser defaults of {@link Spring}
 * (`performance.now` + `requestAnimationFrame`, and the
 * `prefers-reduced-motion` media query).
 *
 * Read when a drawer is inserted into the DOM, so set it before rendering.
 *
 * @internal Not public API. The addon's own tests use it to drive animations
 *   frame by frame with a fake clock.
 */
export declare const drawerEnvironment: {
    clock?: FrameClock;
    prefersReducedMotion?: () => boolean;
};
//# sourceMappingURL=environment.d.ts.map