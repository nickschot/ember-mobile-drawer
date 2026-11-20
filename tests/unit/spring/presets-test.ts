import { module, test } from 'qunit';
import { springFromDuration, springPresets } from '#src/index.ts';
import {
  DEFAULT_SPRING_CONFIG,
  Spring,
  type SpringState,
} from '#src/-private/spring/spring.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';

/** `actual` rounded to `digits` decimals. */
const round = (actual: number, digits = 2) =>
  Math.round(actual * 10 ** digits) / 10 ** digits;

const dampingRatio = ({
  stiffness,
  damping,
  mass,
}: {
  stiffness: number;
  damping: number;
  mass: number;
}) => damping / (2 * Math.sqrt(stiffness * mass));

/** Runs a 0 -> 300px move and returns the frames and the largest value. */
function run(config: Partial<typeof DEFAULT_SPRING_CONFIG>) {
  const clock = new FakeClock();
  const updates: SpringState[] = [];
  const spring = new Spring({
    ...config,
    clock,
    prefersReducedMotion: () => false,
    onUpdate: (state) => updates.push(state),
  });
  spring.retarget(300);
  void spring.start();
  const frames = clock.runUntilIdle();
  return {
    frames,
    max: Math.max(...updates.map(({ value }) => value)),
    value: spring.value,
  };
}

module('Unit | spring presets', function () {
  test("springFromDuration matches the example in Apple's Spring docs", function (assert) {
    // https://developer.apple.com/documentation/swiftui/spring:
    // Spring(duration: 0.5, bounce: 0.3) -> (mass 1.0, stiffness 157.9,
    // damping 17.6).
    const spring = springFromDuration({ duration: 0.5, bounce: 0.3 });
    assert.strictEqual(spring.mass, 1);
    assert.strictEqual(round(spring.stiffness, 1), 157.9);
    assert.strictEqual(round(spring.damping, 1), 17.6);
  });

  test('springFromDuration: no bounce is critically damped, bounce lowers the damping ratio', function (assert) {
    assert.strictEqual(
      round(dampingRatio(springFromDuration({ duration: 0.4 })), 6),
      1,
    );
    assert.strictEqual(
      round(dampingRatio(springFromDuration({ duration: 0.4, bounce: 0.2 }))),
      0.8,
    );
    // The duration is the period of the undamped oscillation.
    const { stiffness, mass } = springFromDuration({ duration: 0.8 });
    assert.strictEqual(
      round((2 * Math.PI) / Math.sqrt(stiffness / mass), 6),
      0.8,
    );
  });

  test('springFromDuration rejects invalid values', function (assert) {
    for (const duration of [0, -1, NaN, Infinity]) {
      assert.throws(
        () => springFromDuration({ duration }),
        RangeError,
        `duration ${duration}`,
      );
    }
    for (const bounce of [-0.1, 1, 2, NaN]) {
      assert.throws(
        () => springFromDuration({ duration: 0.5, bounce }),
        RangeError,
        `bounce ${bounce}`,
      );
    }
  });

  test('the preset values', function (assert) {
    const values = Object.fromEntries(
      Object.entries(springPresets).map(([name, spring]) => [
        name,
        {
          stiffness: round(spring.stiffness),
          damping: round(spring.damping),
          mass: spring.mass,
          dampingRatio: round(dampingRatio(spring)),
        },
      ]),
    );
    assert.deepEqual(values, {
      default: { stiffness: 400, damping: 40, mass: 1, dampingRatio: 1 },
      // SwiftUI .smooth / default spring: duration 0.5, bounce 0.
      ios: { stiffness: 157.91, damping: 25.13, mass: 1, dampingRatio: 1 },
      // SwiftUI .snappy: duration 0.5, bounce 0.15.
      iosSnappy: {
        stiffness: 157.91,
        damping: 21.36,
        mass: 1,
        dampingRatio: 0.85,
      },
      // SwiftUI .bouncy: duration 0.5, bounce 0.3.
      iosBouncy: {
        stiffness: 157.91,
        damping: 17.59,
        mass: 1,
        dampingRatio: 0.7,
      },
    });
  });

  test('the default preset is the default spring', function (assert) {
    const { stiffness, damping, mass } = DEFAULT_SPRING_CONFIG;
    assert.deepEqual(
      { ...springPresets.default },
      { stiffness, damping, mass },
    );
  });

  test('the presets are frozen', function (assert) {
    assert.true(Object.isFrozen(springPresets));
    for (const spring of Object.values(springPresets)) {
      assert.true(Object.isFrozen(spring));
    }
  });

  test('the presets drive the spring: iOS is slower, the bouncy ones overshoot', function (assert) {
    const results = Object.fromEntries(
      Object.entries(springPresets).map(([name, spring]) => [
        name,
        run(spring),
      ]),
    );
    for (const [name, result] of Object.entries(results)) {
      assert.strictEqual(result.value, 300, `${name} settles on the target`);
    }
    assert.true(
      results.ios!.frames > results.default!.frames,
      'ios takes longer than the default',
    );
    assert.true(results.default!.max <= 300, 'default: no overshoot');
    assert.true(results.ios!.max <= 300, 'ios: no overshoot');
    assert.true(results.iosSnappy!.max > 300, 'iosSnappy overshoots');
    assert.true(
      results.iosBouncy!.max > results.iosSnappy!.max,
      'iosBouncy overshoots more',
    );
  });
});

module('Unit | spring | configure', function () {
  /** A spring at 0 that moves to 300, and its clock. */
  const moving = (config: Partial<typeof DEFAULT_SPRING_CONFIG> = {}) => {
    const clock = new FakeClock();
    const spring = new Spring({
      ...config,
      clock,
      prefersReducedMotion: () => false,
    });
    spring.retarget(300);
    return { clock, spring };
  };

  /** The values of `spring` over 10 frames. */
  const valuesOf = ({ clock, spring }: ReturnType<typeof moving>) => {
    void spring.start();
    const values = [];
    for (let i = 0; i < 10; i++) {
      clock.frame();
      values.push(spring.value);
    }
    return values;
  };

  test('changes the parameters and keeps the rest', function (assert) {
    const spring = new Spring();
    spring.set(10, 5);
    spring.retarget(20);
    spring.configure({ stiffness: 100, damping: undefined });
    assert.strictEqual(spring.value, 10);
    assert.strictEqual(spring.velocity, 5);
    assert.strictEqual(spring.target, 20);

    const configured = moving();
    configured.spring.configure({ stiffness: 100, damping: undefined });
    assert.deepEqual(
      valuesOf(configured),
      valuesOf(moving({ stiffness: 100 })),
      'moves like a spring made with only the new stiffness',
    );
  });

  test('rejects invalid values and keeps the old ones', function (assert) {
    const configured = moving();
    for (const value of [0, -1, NaN, Infinity]) {
      assert.throws(
        () => configured.spring.configure({ stiffness: 100, damping: value }),
        RangeError,
      );
    }
    assert.deepEqual(
      valuesOf(configured),
      valuesOf(moving()),
      'moves like a spring with the defaults',
    );
  });

  test('a run in progress continues with the new parameters', function (assert) {
    const clock = new FakeClock();
    const spring = new Spring({ clock, prefersReducedMotion: () => false });
    spring.retarget(300);
    void spring.start();
    clock.frame();
    spring.configure(springPresets.ios);
    const value = spring.value;
    clock.frame();
    assert.true(spring.value > value, 'still moving');
    clock.runUntilIdle();
    assert.strictEqual(spring.value, 300);
  });
});
