import { module, test } from 'qunit';
import { rubberBand } from '#src/-private/snap-points/index.ts';

const dimension = 800;

module('Unit | snap-points | rubberBand', function () {
  test('leaves offsets within the range untouched', function (assert) {
    assert.strictEqual(rubberBand(0, 0, 400, { dimension }), 0);
    assert.strictEqual(rubberBand(250, 0, 400, { dimension }), 250);
    assert.strictEqual(rubberBand(400, 0, 400, { dimension }), 400);
  });

  test('resists past the last snap point with diminishing returns', function (assert) {
    const at = (overshoot: number) =>
      rubberBand(400 + overshoot, 0, 400, { dimension }) - 400;

    assert.true(at(10) > 0 && at(10) < 10, 'moves less than the finger');
    assert.true(Math.abs(at(1) - 0.55) < 0.01, 'starts at the factor');
    assert.true(at(200) - at(100) < at(100) - at(0), 'diminishing returns');
    assert.true(at(100000) < dimension, 'bounded by the dimension');
  });

  test('resists past the first snap point symmetrically', function (assert) {
    const above = rubberBand(500, 100, 400, { dimension }) - 400;
    const below = 100 - rubberBand(0, 100, 400, { dimension });
    assert.true(below > 0 && below < 100);
    assert.true(Math.abs(above - below) < 1e-9);
  });

  test('the factor is configurable', function (assert) {
    const soft = rubberBand(500, 0, 400, { dimension, factor: 1 });
    const stiff = rubberBand(500, 0, 400, { dimension, factor: 0.2 });
    assert.true(stiff < soft);
    assert.strictEqual(
      rubberBand(500, 0, 400, { dimension, factor: 0 }),
      400,
      'factor 0 is a hard stop',
    );
    assert.strictEqual(
      rubberBand(-50, 0, 400, { dimension, factor: 0 }),
      0,
      'at both ends',
    );
  });

  test('works with a single snap point', function (assert) {
    assert.strictEqual(rubberBand(300, 300, 300, { dimension }), 300);
    assert.true(rubberBand(350, 300, 300, { dimension }) > 300);
    assert.true(rubberBand(250, 300, 300, { dimension }) < 300);
  });

  test('is a hard stop with a zero dimension', function (assert) {
    assert.strictEqual(rubberBand(50, 0, 0, { dimension: 0 }), 0);
  });

  test('throws a RangeError for invalid input', function (assert) {
    const throwsRange = (fn: () => number, message: RegExp, label: string) =>
      assert.throws(
        fn,
        (error: Error) =>
          error instanceof RangeError && message.test(error.message),
        label,
      );

    throwsRange(
      () => rubberBand(300, 500, 100, { dimension }),
      /min must be <= max, got min 500 and max 100/,
      'min > max',
    );
    throwsRange(
      () => rubberBand(NaN, 0, 400, { dimension }),
      /offset must be a finite number/,
      'NaN offset',
    );
    throwsRange(
      () => rubberBand(0, -Infinity, 400, { dimension }),
      /min must be a finite number/,
      'infinite min',
    );
    throwsRange(
      () => rubberBand(0, 0, NaN, { dimension }),
      /max must be a finite number/,
      'NaN max',
    );
    throwsRange(
      () => rubberBand(0, 0, 400, { dimension: NaN }),
      /dimension must be a finite number >= 0/,
      'NaN dimension',
    );
    throwsRange(
      () => rubberBand(0, 0, 400, { dimension: -1 }),
      /dimension must be a finite number >= 0/,
      'negative dimension',
    );
    throwsRange(
      () => rubberBand(0, 0, 400, { dimension, factor: -0.5 }),
      /factor must be a finite number >= 0/,
      'negative factor',
    );
  });
});
