import { module, test } from 'qunit';
import {
  VELOCITY_WINDOW,
  VelocityTracker,
} from '#src/-private/gesture/velocity.ts';

module('Unit | gesture | VelocityTracker', function () {
  test('is 0 without samples or with a single sample', function (assert) {
    const tracker = new VelocityTracker();
    assert.strictEqual(tracker.velocity(0), 0, 'no samples');
    tracker.add(0, 100);
    assert.strictEqual(tracker.velocity(0), 0, 'one sample');
  });

  test('averages over the samples in the window, in px/s', function (assert) {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(10, 10);
    tracker.add(20, 30);
    assert.strictEqual(tracker.velocity(20), 1500);

    tracker.reset();
    tracker.add(0, 100);
    tracker.add(50, 50);
    assert.strictEqual(tracker.velocity(50), -1000, 'negative');
  });

  test('is 0 when the samples share a time stamp', function (assert) {
    const tracker = new VelocityTracker();
    tracker.add(16, 0);
    tracker.add(16, 40);
    tracker.add(16, 80);
    const velocity = tracker.velocity(16);
    assert.strictEqual(velocity, 0);
    assert.true(Number.isFinite(velocity));
  });

  test('only counts recent samples', function (assert) {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(50, 500);
    // The finger then rests before lifting.
    tracker.add(300, 500);
    assert.strictEqual(tracker.velocity(300), 0, 'rested before release');

    tracker.reset();
    tracker.add(0, 0);
    tracker.add(VELOCITY_WINDOW, 100);
    tracker.add(VELOCITY_WINDOW * 2, 300);
    assert.strictEqual(
      tracker.velocity(VELOCITY_WINDOW * 2),
      2000,
      'the older half is ignored',
    );
    assert.strictEqual(
      tracker.velocity(VELOCITY_WINDOW * 4),
      0,
      'nothing in the window',
    );
  });

  test('ignores non-finite and out of order samples', function (assert) {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(NaN, 50);
    tracker.add(10, Infinity);
    tracker.add(20, 20);
    tracker.add(5, 1000);
    assert.strictEqual(tracker.velocity(20), 1000);
    assert.strictEqual(tracker.velocity(NaN), 0, 'NaN now');
  });
});
