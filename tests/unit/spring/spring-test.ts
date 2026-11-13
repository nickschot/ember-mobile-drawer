import { module, test } from 'qunit';
import {
  DEFAULT_SPRING_CONFIG,
  Spring,
  stepSpring,
  type SpringOptions,
  type SpringState,
} from '#src/-private/spring/spring.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';

/** Initial position, target and velocity, set with `set` and `retarget`. */
interface Start {
  from?: number;
  to?: number;
  velocity?: number;
}

/** A spring that starts at `from` and moves towards `to`. */
function moving(
  spring: Spring,
  { from = 0, to = from, velocity = 0 }: Start,
): Spring {
  spring.set(from, velocity);
  spring.retarget(to);
  return spring;
}

function setup(options: SpringOptions & Start = {}) {
  const clock = new FakeClock();
  const updates: SpringState[] = [];
  const { from, to, velocity, ...rest } = options;
  const spring = new Spring({
    prefersReducedMotion: () => false,
    ...rest,
    clock,
    onUpdate: (state) => updates.push(state),
  });
  moving(spring, { from, to, velocity });
  return { clock, spring, updates };
}

const UNDER_DAMPED = { stiffness: 200, damping: 10, mass: 1 };
const CRITICALLY_DAMPED = { stiffness: 400, damping: 40, mass: 1 };
const OVER_DAMPED = { stiffness: 100, damping: 60, mass: 1 };

module('Unit | spring', function () {
  test('defaults are critically damped', function (assert) {
    const { stiffness, damping, mass } = DEFAULT_SPRING_CONFIG;
    assert.strictEqual(damping, 2 * Math.sqrt(stiffness * mass));
  });

  for (const [name, config] of [
    ['under-damped', UNDER_DAMPED],
    ['critically damped', CRITICALLY_DAMPED],
    ['over-damped', OVER_DAMPED],
  ] as const) {
    test(`${name}: settles exactly at the target`, async function (assert) {
      const { clock, spring, updates } = setup({ ...config, from: 0, to: 300 });

      const promise = spring.start();
      assert.true(spring.isAnimating);
      const frames = clock.runUntilIdle();

      assert.true(frames > 1, 'animates over several frames');
      await promise;
      assert.strictEqual(spring.value, 300);
      assert.strictEqual(spring.velocity, 0);
      assert.false(spring.isAnimating);
      assert.deepEqual(updates.at(-1), { value: 300, velocity: 0 });
    });
  }

  test('defaults settle a 300px move in well under a second', function (assert) {
    const { clock, spring } = setup({ from: 0, to: 300 });
    void spring.start();
    const frames = clock.runUntilIdle(16);
    assert.true(frames * 16 < 700, `took ${frames * 16}ms`);
  });

  test('under-damped overshoots the target', function (assert) {
    const { clock, spring, updates } = setup({
      ...UNDER_DAMPED,
      from: 0,
      to: 300,
    });
    void spring.start();
    clock.runUntilIdle();

    const max = Math.max(...updates.map((u) => u.value));
    assert.true(max > 300, `max ${max} overshoots 300`);
  });

  test('critically damped does not overshoot from rest', function (assert) {
    const { clock, spring, updates } = setup({
      ...CRITICALLY_DAMPED,
      from: 0,
      to: 300,
    });
    void spring.start();
    clock.runUntilIdle(4);

    const max = Math.max(...updates.map((u) => u.value));
    assert.true(max <= 300, `max ${max} stays at or below 300`);
    assert.true(
      updates.every((u, i) => i === 0 || u.value >= updates[i - 1]!.value),
      'moves monotonically',
    );
  });

  test('critically damped overshoots once on a fast fling towards the target', function (assert) {
    // Documented behaviour: with the defaults (w0 = 20/s) a release velocity
    // above ~20 x distance px/s overshoots once, then settles without bouncing.
    const { clock, spring, updates } = setup({
      from: 290,
      to: 300,
      velocity: 3000,
    });
    void spring.start();
    clock.runUntilIdle(1);

    const max = Math.max(...updates.map((u) => u.value));
    assert.true(max > 340, `max ${max} overshoots by tens of px`);
    const peak = updates.findIndex((u) => u.value === max);
    assert.true(
      updates.slice(peak).every((u) => u.value >= 300),
      'returns without crossing the target again',
    );
  });

  test('over-damped does not overshoot', function (assert) {
    const { clock, spring, updates } = setup({
      ...OVER_DAMPED,
      from: 0,
      to: 300,
    });
    void spring.start();
    clock.runUntilIdle(4);

    const max = Math.max(...updates.map((u) => u.value));
    assert.true(max <= 300, `max ${max} stays at or below 300`);
  });

  test('initial velocity is respected', function (assert) {
    // At the target already, but thrown upwards: it must move before settling.
    const { clock, spring, updates } = setup({
      from: 0,
      to: 0,
      velocity: -2000,
    });
    void spring.start();
    clock.frame(16);

    assert.true(updates[0]!.value < 0, 'moves in the direction of velocity');
    clock.runUntilIdle();
    assert.strictEqual(spring.value, 0);
  });

  test('initial velocity towards the target arrives sooner', function (assert) {
    const still = setup({ from: 0, to: 300 });
    const thrown = setup({ from: 0, to: 300, velocity: 3000 });
    void still.spring.start();
    void thrown.spring.start();
    still.clock.frame(50);
    thrown.clock.frame(50);

    assert.true(thrown.spring.value > still.spring.value);
  });

  test('set() hands over position and velocity', function (assert) {
    const { clock, spring, updates } = setup({ to: 0 });
    spring.set(120, -800);
    assert.strictEqual(spring.value, 120);
    assert.strictEqual(spring.velocity, -800);

    void spring.start();
    clock.frame(1);
    assert.true(updates[0]!.value < 120, 'continues with the given velocity');
  });

  test('retarget keeps velocity continuous', async function (assert) {
    const { stiffness, damping, mass } = DEFAULT_SPRING_CONFIG;
    // A fast fling towards 300, retargeted mid-flight to the opposite side.
    const { clock, spring } = setup({ from: 0, to: 300, velocity: 4000 });
    const promise = spring.start();
    clock.frame(16);
    clock.frame(16);

    const before = { value: spring.value, velocity: spring.velocity };
    assert.true(before.velocity > 1000, `moving fast (${before.velocity}px/s)`);

    spring.retarget(-300);
    assert.strictEqual(spring.target, -300);
    clock.frame(1);

    // The velocity right after the retarget follows from the carried-over
    // state under the new target; it did not reset or jump.
    const expected = stepSpring(
      before.value + 300,
      before.velocity,
      0.001,
      DEFAULT_SPRING_CONFIG,
    );
    assert.true(
      Math.abs(spring.velocity - expected.velocity) < 1e-6,
      'continues from the carried-over state',
    );
    const acceleration =
      (stiffness * Math.abs(before.value + 300) +
        damping * Math.abs(before.velocity)) /
      mass;
    const change = Math.abs(spring.velocity - before.velocity);
    assert.true(
      change <= acceleration * 0.001 * 1.1,
      `velocity changed by ${change}px/s over 1ms, bounded by acceleration`,
    );
    assert.true(change < before.velocity * 0.2, 'no discontinuity');
    assert.true(spring.value > before.value, 'momentum carries it forward');

    clock.runUntilIdle();
    await promise;
    assert.strictEqual(
      spring.value,
      -300,
      'the original promise resolves at the new target',
    );
  });

  test('retarget while idle does not start the spring', function (assert) {
    const { clock, spring } = setup({ from: 0, to: 0 });
    spring.retarget(100);
    assert.false(spring.isAnimating);
    assert.strictEqual(clock.pendingFrames, 0);
    assert.strictEqual(spring.value, 0);
  });

  test('is frame-rate independent', function (assert) {
    const at60 = setup({ ...UNDER_DAMPED, from: 0, to: 300, velocity: 500 });
    const at240 = setup({ ...UNDER_DAMPED, from: 0, to: 300, velocity: 500 });
    void at60.spring.start();
    void at240.spring.start();

    for (let i = 0; i < 12; i++) at60.clock.frame(1000 / 60);
    for (let i = 0; i < 48; i++) at240.clock.frame(1000 / 240);

    assert.true(Math.abs(at60.spring.value - at240.spring.value) < 1e-6);
    assert.true(Math.abs(at60.spring.velocity - at240.spring.velocity) < 1e-6);
  });

  for (const [name, config] of [
    ['under-damped', UNDER_DAMPED],
    ['critically damped', CRITICALLY_DAMPED],
    ['over-damped', OVER_DAMPED],
  ] as const) {
    test(`${name}: irregular frames match one step over the total time`, function (assert) {
      const { clock, spring } = setup({
        ...config,
        from: 0,
        to: 300,
        velocity: 500,
      });
      void spring.start();

      // Deterministic irregular intervals between 1 and 41ms.
      const intervals = [16, 4, 33, 1, 41, 8, 17, 25, 2, 12, 39, 7];
      const total = intervals.reduce((sum, ms) => sum + ms, 0);
      for (const ms of intervals) clock.frame(ms);

      assert.true(spring.isAnimating, 'still moving, so nothing snapped');
      const expected = stepSpring(-300, 500, total / 1000, config);
      assert.true(
        Math.abs(spring.value - (300 + expected.displacement)) < 1e-9,
        'position matches',
      );
      assert.true(
        Math.abs(spring.velocity - expected.velocity) < 1e-9,
        'velocity matches',
      );
    });
  }

  test('stepSpring is continuous across the critical-damping boundary', function (assert) {
    const critical = stepSpring(-300, 2000, 0.05, CRITICALLY_DAMPED);
    for (const factor of [1 - 2e-6, 1 + 2e-6]) {
      const near = stepSpring(-300, 2000, 0.05, {
        ...CRITICALLY_DAMPED,
        damping: CRITICALLY_DAMPED.damping * factor,
      });
      assert.true(
        Math.abs(near.displacement - critical.displacement) < 1e-3,
        `displacement at damping x ${factor}`,
      );
      assert.true(
        Math.abs(near.velocity - critical.velocity) < 1e-2,
        `velocity at damping x ${factor}`,
      );
    }
  });

  test('stepSpring stays accurate for very large damping', function (assert) {
    // r1 = -zeta * w + w * sqrt(zeta² - 1) cancels to 0 here; the stable form
    // keeps the (very slow) motion towards the target.
    const { displacement } = stepSpring(100, 0, 1, {
      stiffness: 400,
      damping: 1e9,
      mass: 1,
    });
    assert.true(displacement < 100 && displacement > 99.99, `${displacement}`);
  });

  test('is stable at large time deltas', async function (assert) {
    for (const config of [UNDER_DAMPED, CRITICALLY_DAMPED, OVER_DAMPED]) {
      const { clock, spring, updates } = setup({
        ...config,
        from: 0,
        to: 300,
        velocity: 5000,
      });
      const promise = spring.start();
      clock.frame(16);
      clock.frame(60_000); // e.g. a backgrounded tab

      assert.true(updates.every((u) => Number.isFinite(u.value)));
      await promise;
      assert.strictEqual(spring.value, 300);
    }
  });

  test('ignores frames timestamped before start', function (assert) {
    const { clock, spring } = setup({ from: 0, to: 300 });
    void spring.start();
    clock.frame(-5);
    assert.strictEqual(spring.value, 0);
    assert.true(spring.isAnimating);
  });

  test('reduced motion jumps to the target', async function (assert) {
    const { clock, spring, updates } = setup({
      from: 0,
      to: 300,
      velocity: 1000,
      prefersReducedMotion: () => true,
    });

    const promise = spring.start();
    assert.strictEqual(spring.value, 300, 'jumps synchronously');
    assert.false(spring.isAnimating);
    assert.strictEqual(clock.pendingFrames, 0, 'no frames scheduled');
    assert.deepEqual(updates, [{ value: 300, velocity: 0 }]);
    await promise;
  });

  test('start() at rest on the target resolves immediately', async function (assert) {
    const { clock, spring } = setup({ from: 300, to: 300 });
    await spring.start();
    assert.strictEqual(spring.value, 300);
    assert.strictEqual(clock.pendingFrames, 0);
  });

  test('start() while animating returns the same promise', function (assert) {
    const { spring } = setup({ from: 0, to: 300 });
    assert.strictEqual(spring.start(), spring.start());
  });

  test('stop() freezes the spring and resolves', async function (assert) {
    const { clock, spring, updates } = setup({ from: 0, to: 300 });
    const promise = spring.start();
    clock.frame(16);
    clock.frame(16);
    const { value, velocity } = spring;

    spring.stop();
    assert.false(spring.isAnimating);
    assert.strictEqual(clock.pendingFrames, 0, 'cancels the next frame');
    await promise;
    assert.strictEqual(spring.value, value, 'keeps its position');
    assert.strictEqual(spring.velocity, velocity, 'keeps its velocity');

    const count = updates.length;
    clock.frame(16);
    assert.strictEqual(updates.length, count, 'no updates after stop');

    spring.stop(); // no-op when idle
  });

  test('stop() from onUpdate ends the run', async function (assert) {
    const clock = new FakeClock();
    const spring: Spring = new Spring({
      clock,
      prefersReducedMotion: () => false,
      onUpdate: () => spring.stop(),
    });
    moving(spring, { to: 300 });
    const promise = spring.start();
    clock.frame(16);

    assert.strictEqual(clock.pendingFrames, 0);
    await promise;
    assert.false(spring.isAnimating);
    assert.notStrictEqual(spring.value, 300, 'stopped on the way');
  });

  test('can be restarted after stop()', async function (assert) {
    const { clock, spring } = setup({ from: 0, to: 300 });
    void spring.start();
    clock.frame(16);
    spring.stop();

    const promise = spring.start();
    clock.runUntilIdle();
    await promise;
    assert.strictEqual(spring.value, 300);
  });

  test('stepSpring matches the closed-form critically damped solution', function (assert) {
    // x(t) = (x0 + (v0 + w x0) t) e^(-w t), with w = sqrt(k / m) = 20.
    const { displacement } = stepSpring(-100, 0, 0.1, CRITICALLY_DAMPED);
    const expected = (-100 + 20 * -100 * 0.1) * Math.exp(-2);
    assert.true(Math.abs(displacement - expected) < 1e-9);
  });

  module('invalid input', function () {
    for (const [name, options] of [
      ['mass 0', { mass: 0 }],
      ['negative mass', { mass: -1 }],
      ['stiffness 0', { stiffness: 0 }],
      ['negative stiffness', { stiffness: -1 }],
      ['damping 0 (never settles)', { damping: 0 }],
      ['negative damping', { damping: -5 }],
      ['NaN mass', { mass: NaN }],
      ['infinite stiffness', { stiffness: Infinity }],
      ['rest threshold 0', { restDisplacementThreshold: 0 }],
      ['NaN rest velocity threshold', { restVelocityThreshold: NaN }],
    ] as const) {
      test(`constructor rejects ${name}`, function (assert) {
        assert.throws(() => setup(options), RangeError);
      });
    }

    test('retarget() rejects non-finite targets and keeps animating', async function (assert) {
      const { clock, spring } = setup({ from: 0, to: 300 });
      const promise = spring.start();
      clock.frame(16);

      assert.throws(() => spring.retarget(NaN), RangeError);
      assert.throws(() => spring.retarget(-Infinity), RangeError);
      assert.strictEqual(spring.target, 300, 'target unchanged');

      clock.runUntilIdle();
      await promise;
      assert.strictEqual(spring.value, 300);
    });

    test('set() rejects non-finite values without changing state', function (assert) {
      const { spring } = setup({ from: 10, velocity: 5 });
      assert.throws(() => spring.set(NaN), RangeError);
      assert.throws(() => spring.set(0, Infinity), RangeError);
      assert.strictEqual(spring.value, 10);
      assert.strictEqual(spring.velocity, 5);
    });

    test('a non-finite step ends the run, keeping the last finite state', async function (assert) {
      const { clock, spring } = setup({ from: 0, to: 300 });
      const promise = spring.start();
      clock.frame(16);
      const { value, velocity } = spring;

      clock.frame(Infinity); // dt = Infinity gives NaN in the solver

      assert.false(spring.isAnimating);
      assert.strictEqual(clock.pendingFrames, 0, 'no runaway frame loop');
      await promise;
      assert.strictEqual(spring.value, value);
      assert.strictEqual(spring.velocity, velocity);
    });
  });

  module('errors from callbacks', function () {
    test('a throwing onUpdate ends the run and rethrows', async function (assert) {
      const clock = new FakeClock();
      let shouldThrow = true;
      const spring = new Spring({
        clock,
        prefersReducedMotion: () => false,
        onUpdate: () => {
          if (shouldThrow) throw new Error('boom');
        },
      });
      moving(spring, { to: 300 });
      const promise = spring.start();

      assert.throws(() => clock.frame(16), /boom/);
      assert.false(spring.isAnimating);
      assert.strictEqual(clock.pendingFrames, 0);
      await promise;

      shouldThrow = false;
      const next = spring.start();
      assert.notStrictEqual(next, promise, 'a new run can start');
      clock.runUntilIdle();
      await next;
      assert.strictEqual(spring.value, 300);
    });

    test('a throwing onUpdate on settle still resolves', async function (assert) {
      const clock = new FakeClock();
      const spring = new Spring({
        clock,
        prefersReducedMotion: () => false,
        onUpdate: ({ value }) => {
          if (value === 300) throw new Error('boom');
        },
      });
      moving(spring, { to: 300 });
      const promise = spring.start();

      assert.throws(() => clock.runUntilIdle(), /boom/);
      assert.false(spring.isAnimating);
      assert.strictEqual(clock.pendingFrames, 0);
      await promise;
      assert.strictEqual(spring.value, 300);
    });
  });

  module('re-entrancy from the final onUpdate', function () {
    test('retarget() ends the run at the old target', async function (assert) {
      const clock = new FakeClock();
      let retargeted = false;
      const spring: Spring = new Spring({
        clock,
        prefersReducedMotion: () => false,
        onUpdate: ({ value }) => {
          if (value === 300 && !retargeted) {
            retargeted = true;
            spring.retarget(500);
          }
        },
      });
      moving(spring, { to: 300 });
      const promise = spring.start();
      clock.runUntilIdle();

      await promise;
      assert.strictEqual(spring.value, 300);
      assert.strictEqual(spring.target, 500);
      assert.false(spring.isAnimating, 'retarget does not start');
    });

    test('start() begins a new run towards the new target', async function (assert) {
      const clock = new FakeClock();
      let next: Promise<unknown> | undefined;
      const spring: Spring = new Spring({
        clock,
        prefersReducedMotion: () => false,
        onUpdate: ({ value }) => {
          if (value === 300 && !next) {
            spring.retarget(500);
            next = spring.start();
          }
        },
      });
      moving(spring, { to: 300 });
      const first = spring.start();
      clock.runUntilIdle();

      assert.notStrictEqual(next, first);
      await first;
      await next;
      assert.strictEqual(spring.value, 500);
    });
  });
});
