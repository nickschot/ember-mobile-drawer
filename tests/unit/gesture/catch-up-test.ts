import { module, test } from 'qunit';
import {
  CATCH_UP_DURATION,
  CATCH_UP_SPEED,
  catchUpDuration,
  catchUpLag,
} from '#src/-private/gesture/catch-up.ts';

module('Unit | gesture | catch-up', function () {
  test('starts at the full distance and ends at 0', function (assert) {
    assert.strictEqual(catchUpLag(12, 0), 12);
    assert.strictEqual(catchUpLag(-12, 0), -12);
    assert.strictEqual(catchUpLag(12, -5), 12, 'before the start');
    assert.strictEqual(catchUpLag(12, CATCH_UP_DURATION), 0);
    assert.strictEqual(catchUpLag(12, 10_000), 0);
    assert.strictEqual(catchUpLag(-12, CATCH_UP_DURATION), 0);
  });

  test('eases monotonically, never faster than CATCH_UP_SPEED', function (assert) {
    for (const distance of [5, 12, -15, 50, -200]) {
      const duration = catchUpDuration(distance);
      let previous = catchUpLag(distance, 0);
      let fastest = 0;
      let monotonic = true;
      for (let time = 1; time <= Math.ceil(duration); time++) {
        const lag = catchUpLag(distance, time);
        if (Math.abs(lag) > Math.abs(previous)) monotonic = false;
        if (Math.sign(lag) === -Math.sign(distance)) monotonic = false;
        fastest = Math.max(fastest, Math.abs(previous - lag));
        previous = lag;
      }
      assert.true(monotonic, `${distance}: towards 0, without overshoot`);
      assert.strictEqual(previous, 0, `${distance}: caught up`);
      assert.true(
        fastest <= CATCH_UP_SPEED + 1e-9,
        `${distance}: at most ${CATCH_UP_SPEED} px/ms (${fastest})`,
      );
    }
  });

  test('starts gently, so the first frame moves the tray only a little', function (assert) {
    // 16ms into catching up 15px: less than 1.5px.
    assert.true(15 - catchUpLag(15, 16) < 1.5);
  });

  test('takes CATCH_UP_DURATION, longer for a large distance', function (assert) {
    assert.strictEqual(catchUpDuration(0), CATCH_UP_DURATION);
    assert.strictEqual(catchUpDuration(15), CATCH_UP_DURATION);
    assert.strictEqual(catchUpDuration(-48), (1.5 * 48) / CATCH_UP_SPEED);
    assert.true(catchUpDuration(48) > CATCH_UP_DURATION);
  });

  test('is finite for non-finite input', function (assert) {
    assert.strictEqual(catchUpLag(NaN, 10), 0);
    assert.strictEqual(catchUpLag(Infinity, 10), 0);
    assert.strictEqual(catchUpLag(12, NaN), 0);
    assert.strictEqual(catchUpLag(0, 10), 0);
    assert.strictEqual(catchUpDuration(Infinity), CATCH_UP_DURATION);
  });
});
