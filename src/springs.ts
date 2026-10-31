/**
 * Spring settings for `<MobileDrawer @spring>`: presets, and a conversion
 * from the duration and bounce that Apple's frameworks use.
 *
 * @module
 */

import { DEFAULT_SPRING_CONFIG } from './-private/spring/spring.ts';

/**
 * The physical parameters of the spring that moves the drawer to a snap
 * point (`F = -stiffness * x - damping * v`, `a = F / mass`, with x in px and
 * time in seconds). All values must be finite and greater than `0`.
 *
 * Without bounce (critically damped, `damping = 2 * sqrt(stiffness * mass)`)
 * the drawer does not oscillate. It can still overshoot a snap point once
 * when a fast release carries it there. Lower damping bounces.
 */
export interface MobileDrawerSpring {
  /** Spring constant. Higher is faster. */
  stiffness: number;
  /** Damping coefficient. Lower bounces more. */
  damping: number;
  /** Mass. Higher is slower. */
  mass: number;
}

/** What {@link springFromDuration} takes. */
export interface SpringDuration {
  /**
   * The perceptual duration in seconds, as in SwiftUI's
   * `Spring(duration:bounce:)`: the period of the undamped oscillation. It is
   * about the time the spring takes to settle, when it does not bounce.
   * Must be greater than `0`.
   */
  duration: number;
  /**
   * How much the spring bounces, from `0` (no bounce, critically damped) to
   * just below `1` (no damping). Default `0`. Negative values (over-damped
   * springs in SwiftUI) are not supported.
   */
  bounce?: number;
}

/**
 * Converts a duration and a bounce, as in SwiftUI's
 * `Spring(duration:bounce:)` and UIKit's `UIView.animate(springDuration:
 * bounce:)`, to the drawer's spring parameters, with the formulas from
 * Apple's "Animate with springs" (WWDC23):
 *
 * - `mass = 1`
 * - `stiffness = (2π / duration)²`
 * - `damping = 4π × (1 - bounce) / duration`
 *
 * For example `{ duration: 0.5, bounce: 0.3 }` gives a stiffness of 157.9
 * and a damping of 17.6, the values in the documentation of SwiftUI's
 * `Spring`.
 *
 * @throws RangeError when `duration` is not a finite number greater than 0,
 *   or `bounce` is not a number from 0 up to (not including) 1.
 */
export function springFromDuration({
  duration,
  bounce = 0,
}: SpringDuration): MobileDrawerSpring {
  if (!(Number.isFinite(duration) && duration > 0)) {
    throw new RangeError(
      `springFromDuration: duration must be a finite number greater than 0, got ${duration}`,
    );
  }
  if (!(Number.isFinite(bounce) && bounce >= 0 && bounce < 1)) {
    throw new RangeError(
      `springFromDuration: bounce must be a number from 0 up to 1 (not included), got ${bounce}`,
    );
  }
  return Object.freeze({
    stiffness: ((2 * Math.PI) / duration) ** 2,
    damping: (4 * Math.PI * (1 - bounce)) / duration,
    mass: 1,
  });
}

/**
 * Spring presets for `@spring`.
 *
 * - `default`: the drawer's own spring when `@spring` is not set (stiffness
 *   400, damping 40, mass 1: critically damped: it brings a 300px move to
 *   rest in about 0.5s).
 * - `ios`: like an iOS sheet. SwiftUI's `.smooth` preset, which is also
 *   `.spring` without arguments: duration 0.5s, no bounce. Apple does not
 *   document the spring of the system sheet, so this is the closest
 *   documented spring.
 * - `iosSnappy`: SwiftUI's `.snappy`: duration 0.5s, bounce 0.15.
 * - `iosBouncy`: SwiftUI's `.bouncy`: duration 0.5s, bounce 0.3.
 *
 * ```gts
 * import { MobileDrawer, springPresets } from 'ember-mobile-drawer';
 *
 * <template>
 *   <MobileDrawer @spring={{springPresets.ios}} />
 * </template>
 * ```
 */
export const springPresets: Readonly<{
  default: MobileDrawerSpring;
  ios: MobileDrawerSpring;
  iosSnappy: MobileDrawerSpring;
  iosBouncy: MobileDrawerSpring;
}> = Object.freeze({
  default: Object.freeze({
    stiffness: DEFAULT_SPRING_CONFIG.stiffness,
    damping: DEFAULT_SPRING_CONFIG.damping,
    mass: DEFAULT_SPRING_CONFIG.mass,
  }),
  ios: springFromDuration({ duration: 0.5 }),
  iosSnappy: springFromDuration({ duration: 0.5, bounce: 0.15 }),
  iosBouncy: springFromDuration({ duration: 0.5, bounce: 0.3 }),
});
