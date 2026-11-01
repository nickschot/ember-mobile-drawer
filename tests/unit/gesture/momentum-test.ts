import { module, test } from 'qunit';
import {
  DECELERATION_RATE,
  MIN_MOMENTUM_VELOCITY,
  Momentum,
  momentumAt,
} from '#src/-private/gesture/momentum.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';

module('Unit | gesture | momentum', function () {
  test('the velocity decays by DECELERATION_RATE per ms', function (assert) {
    assert.deepEqual(momentumAt(1, 0), { distance: 0, velocity: 1 });
    const later = momentumAt(2, 100);
    assert.true(
      Math.abs(later.velocity - 2 * Math.pow(DECELERATION_RATE, 100)) < 1e-9,
    );
    // The distance is the integral of the velocity.
    let sum = 0;
    for (let t = 0; t < 100; t += 0.01)
      sum += 2 * DECELERATION_RATE ** t * 0.01;
    assert.true(Math.abs(later.distance - sum) < 0.01, `${later.distance}`);
    assert.true(
      Math.abs(momentumAt(-1, 1e6).distance - 1 / Math.log(DECELERATION_RATE)) <
        1e-6,
      'it ends at v / ln(rate)',
    );
    assert.deepEqual(momentumAt(1, -5), { distance: 0, velocity: 1 });
  });

  test('writes once per frame until it is slow, then stops', function (assert) {
    const clock = new FakeClock();
    const writes: number[] = [];
    let ended = 0;
    const momentum = new Momentum({
      clock,
      from: 10,
      velocity: 1,
      min: 0,
      max: 10_000,
      write: (position) => writes.push(position),
      onEnd: () => ended++,
    });
    assert.true(momentum.isRunning);
    clock.frame(16);
    assert.strictEqual(writes.length, 1, 'one write per frame');
    assert.true(
      Math.abs(writes[0]! - (10 + momentumAt(1, 16).distance)) < 1e-9,
    );
    clock.runUntilIdle();
    assert.false(momentum.isRunning);
    assert.strictEqual(ended, 1);
    const last = writes.at(-1)!;
    const expected =
      10 + (1 - MIN_MOMENTUM_VELOCITY) / -Math.log(DECELERATION_RATE);
    assert.true(Math.abs(last - expected) < 1, `${last} vs ${expected}`);
    assert.true(
      writes.every((position, i) => i === 0 || position > writes[i - 1]!),
      'it only moves on',
    );
  });

  test('stops at an end of the range', function (assert) {
    const clock = new FakeClock();
    const writes: number[] = [];
    new Momentum({
      clock,
      from: 50,
      velocity: -3,
      min: 0,
      max: 100,
      write: (position) => writes.push(position),
    });
    clock.runUntilIdle();
    assert.strictEqual(writes.at(-1), 0);
    assert.true(writes.every((position) => position >= 0));
  });

  test('stop() stops it where it is', function (assert) {
    const clock = new FakeClock();
    const writes: number[] = [];
    let ended = 0;
    const momentum = new Momentum({
      clock,
      from: 0,
      velocity: 2,
      min: 0,
      max: 10_000,
      write: (position) => writes.push(position),
      onEnd: () => ended++,
    });
    clock.frame(16);
    momentum.stop();
    momentum.stop();
    clock.runUntilIdle();
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(ended, 1, 'onEnd once');
    assert.strictEqual(clock.pendingFrames, 0);
  });
});
