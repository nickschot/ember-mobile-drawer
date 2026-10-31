import { module, test } from 'qunit';
import {
  projectOffset,
  resolveSnapPoints,
  selectSnapPoint,
} from '#src/-private/snap-points/index.ts';

const container = 800;
// Snap points at 0, 200, 400 and 800.
const resolved = resolveSnapPoints([0, '25%', '50%', '100%'], { container });
const offsetOf = (
  offset: number,
  velocity: number,
  decelerationRate?: number,
) => selectSnapPoint(resolved, offset, velocity, { decelerationRate }).offset;

module('Unit | snap-points | projectOffset', function () {
  test('does not move without velocity', function (assert) {
    assert.strictEqual(projectOffset(120, 0), 120);
  });

  test('projects roughly a tenth of the velocity with the default rate', function (assert) {
    assert.true(Math.abs(projectOffset(0, 1000) - 99) < 1, 'forwards');
    assert.true(Math.abs(projectOffset(500, -1000) - 401) < 1, 'backwards');
  });

  test('a lower deceleration rate projects less', function (assert) {
    assert.true(projectOffset(0, 1000, 0.9) < projectOffset(0, 1000));
    assert.true(projectOffset(0, 1000) < projectOffset(0, 1000, 0.998));
    assert.strictEqual(projectOffset(50, 1000, 0.5), 51, 'rate 0.5');
  });

  test('throws a RangeError for non-finite input', function (assert) {
    const cases: [number, number, number | undefined, RegExp, string][] = [
      [
        NaN,
        0,
        undefined,
        /offset must be a finite number, got NaN/,
        'NaN offset',
      ],
      [
        Infinity,
        0,
        undefined,
        /offset must be a finite number/,
        'Infinity offset',
      ],
      [
        0,
        NaN,
        undefined,
        /velocity must be a finite number, got NaN/,
        'NaN velocity',
      ],
      [
        0,
        Infinity,
        undefined,
        /velocity must be a finite number, got Infinity/,
        '+Infinity velocity',
      ],
      [
        0,
        -Infinity,
        undefined,
        /velocity must be a finite number, got -Infinity/,
        '-Infinity velocity',
      ],
    ];
    for (const [offset, velocity, rate, message, label] of cases) {
      assert.throws(
        () => projectOffset(offset, velocity, rate),
        (error: Error) =>
          error instanceof RangeError && message.test(error.message),
        label,
      );
    }
  });

  test('throws a RangeError for a deceleration rate outside (0, 1)', function (assert) {
    for (const rate of [NaN, 0, 1, -0.5, 1.5, Infinity]) {
      assert.throws(
        () => projectOffset(0, 100, rate),
        (error: Error) =>
          error instanceof RangeError &&
          /decelerationRate must be a number strictly between 0 and 1/.test(
            error.message,
          ),
        String(rate),
      );
    }
  });
});

module('Unit | snap-points | selectSnapPoint', function () {
  test('a release at rest settles on the nearest snap point', function (assert) {
    assert.strictEqual(offsetOf(90, 0), 0);
    assert.strictEqual(offsetOf(110, 0), 200);
    assert.strictEqual(offsetOf(650, 0), 800);
  });

  test('a slow drag settles on the nearest snap point', function (assert) {
    assert.strictEqual(offsetOf(210, 50), 200, 'slowly opening');
    assert.strictEqual(offsetOf(390, -50), 400, 'slowly closing');
  });

  test('a moderate release moves to the next snap point', function (assert) {
    assert.strictEqual(offsetOf(220, 1000), 400, 'opening');
    assert.strictEqual(offsetOf(380, -1000), 200, 'closing');
  });

  test('a fast flick skips snap points', function (assert) {
    assert.strictEqual(offsetOf(210, 5000), 800, 'skips 400 when opening');
    assert.strictEqual(
      offsetOf(780, -8000),
      0,
      'skips 400 and 200 when closing',
    );
  });

  test('projections past the ends settle on the first or last snap point', function (assert) {
    assert.strictEqual(offsetOf(700, 10000), 800);
    assert.strictEqual(offsetOf(100, -10000), 0);
  });

  test('the deceleration rate controls how far a flick carries', function (assert) {
    assert.strictEqual(offsetOf(210, 1500), 400, 'default rate');
    assert.strictEqual(offsetOf(210, 1500, 0.998), 800, 'gentler rate');
    assert.strictEqual(offsetOf(210, 1500, 0.5), 200, 'barely any projection');
  });

  test('ties go in the direction of the velocity', function (assert) {
    const twoPoints = resolveSnapPoints([0, 200], { container });
    // With rate 0.5 a velocity of ±1000 px/s projects exactly ±1px.
    const options = { decelerationRate: 0.5 };
    assert.strictEqual(selectSnapPoint(twoPoints, 100, 0).offset, 0, 'at rest');
    assert.strictEqual(
      selectSnapPoint(twoPoints, 99, 1000, options).offset,
      200,
      'opening',
    );
    assert.strictEqual(
      selectSnapPoint(twoPoints, 101, -1000, options).offset,
      0,
      'closing',
    );
  });

  test('always returns the only snap point', function (assert) {
    const single = resolveSnapPoints(['100%'], { container });
    assert.strictEqual(selectSnapPoint(single, 0, -5000), single[0]);
    assert.strictEqual(selectSnapPoint(single, 900, 5000), single[0]);
  });

  test('throws without snap points', function (assert) {
    assert.throws(() => selectSnapPoint([], 0, 0), /zero snap points/);
  });

  test('throws instead of silently picking a snap point on bad input', function (assert) {
    const isRangeError = (error: Error) => error instanceof RangeError;
    assert.throws(() => offsetOf(NaN, 0), isRangeError, 'NaN offset');
    assert.throws(
      () => offsetOf(100, Infinity),
      isRangeError,
      '+Infinity velocity',
    );
    assert.throws(
      () => offsetOf(100, -Infinity),
      isRangeError,
      '-Infinity velocity',
    );
    assert.throws(() => offsetOf(700, 0, NaN), isRangeError, 'NaN rate');
    assert.throws(() => offsetOf(700, 0, 1), isRangeError, 'rate 1');
  });
});

module('Unit | snap-points | selectSnapPoint with flingVelocity', function () {
  const select = (offset: number, velocity: number, flingVelocity?: number) =>
    selectSnapPoint(resolved, offset, velocity, { flingVelocity }).offset;

  test('without it, a short flick can settle against its direction', function (assert) {
    // Projected to ~21 and ~789.
    assert.strictEqual(select(20, 150), 0, 'opening flick closes');
    assert.strictEqual(select(790, -150), 800, 'closing flick opens');
  });

  test('a flick at or above it moves at least one snap point its way', function (assert) {
    assert.strictEqual(select(20, 150, 150), 200, 'opening');
    assert.strictEqual(select(790, -150, 100), 400, 'closing');
    assert.strictEqual(select(400, 1, 0), 800, 'from a snap point');
  });

  test('a release below it uses the projection only', function (assert) {
    assert.strictEqual(select(20, 150, 400), 0);
    assert.strictEqual(select(790, -150, 400), 800);
    assert.strictEqual(select(20, 0, 0), 0, 'at rest');
  });

  test('a projection that already goes its way is kept', function (assert) {
    assert.strictEqual(select(210, 5000, 100), 800, 'still skips');
    assert.strictEqual(select(220, 1000, 100), 400);
  });

  test('past the last snap point it stays there', function (assert) {
    assert.strictEqual(select(800, 500, 100), 800);
    assert.strictEqual(select(850, 500, 100), 800, 'rubber-banded');
    assert.strictEqual(select(-20, -500, 100), 0, 'below the first');
  });

  test('throws a RangeError for an invalid value', function (assert) {
    for (const value of [NaN, -1, Infinity]) {
      assert.throws(
        () => select(100, 0, value),
        (error: Error) =>
          error instanceof RangeError &&
          /flingVelocity must be a finite number >= 0/.test(error.message),
        String(value),
      );
    }
  });
});
