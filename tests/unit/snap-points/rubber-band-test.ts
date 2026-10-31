import { module, test } from 'qunit';
import {
  dragOffset,
  rubberBand,
  unRubberBand,
} from '#src/-private/snap-points/index.ts';

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

module('Unit | snap-points | unRubberBand', function () {
  test('undoes rubberBand on both ends', function (assert) {
    for (const raw of [-900, -100, -1, 0, 50, 399, 400, 401, 450, 1000, 5000]) {
      const banded = rubberBand(raw, 0, 400, { dimension });
      const back = unRubberBand(banded, 0, 400, { dimension });
      assert.true(
        Math.abs(back - raw) < 1e-6,
        `${raw} -> ${banded} -> ${back}`,
      );
    }
    for (const raw of [0, 50, 99, 300, 420]) {
      const banded = rubberBand(raw, 100, 400, { dimension: 24 });
      const back = unRubberBand(banded, 100, 400, { dimension: 24 });
      assert.true(Math.abs(back - raw) < 1e-6, `small dimension: ${raw}`);
    }
  });

  test('leaves offsets within the range untouched', function (assert) {
    assert.strictEqual(unRubberBand(250, 0, 400, { dimension }), 250);
  });

  test('stays finite and moderate at and beyond the dimension', function (assert) {
    const at = unRubberBand(400 + dimension, 0, 400, { dimension });
    const beyond = unRubberBand(400 + 2 * dimension, 0, 400, { dimension });
    assert.true(Number.isFinite(at) && at > 400);
    assert.strictEqual(beyond, at);
    // Clamped to MAX_BAND_FRACTION of the band: 999 * dimension / factor.
    assert.true(at - 400 <= (1000 * dimension) / 0.55, `${at}`);

    const small = unRubberBand(400 + 30, 0, 400, { dimension: 24 });
    assert.true(small - 400 < 50_000, `small band (${small})`);
  });

  test('clamps to the range without resistance', function (assert) {
    assert.strictEqual(unRubberBand(450, 0, 400, { dimension: 0 }), 400);
    assert.strictEqual(unRubberBand(-50, 0, 400, { dimension, factor: 0 }), 0);
  });

  test('throws a RangeError for invalid input', function (assert) {
    assert.throws(
      () => unRubberBand(NaN, 0, 400, { dimension }),
      (error: Error) => error instanceof RangeError,
    );
  });
});

module('Unit | snap-points | dragOffset', function () {
  // Like the drawer: a stiff band past the last snap point.
  const bands = { below: { dimension: 600 }, above: { dimension: 24 } };
  const drag = (start: number, delta: number) =>
    dragOffset(start, delta, 100, 400, bands);
  const near = (actual: number, expected: number, epsilon = 1e-9) =>
    Math.abs(actual - expected) <= epsilon;

  test('from inside the range it is the rubber-banded finger', function (assert) {
    assert.strictEqual(drag(250, 0), 250);
    assert.strictEqual(drag(250, 100), 350, '1:1 inside');
    assert.strictEqual(drag(250, 200), rubberBand(450, 100, 400, bands.above));
    assert.strictEqual(drag(250, -200), rubberBand(50, 100, 400, bands.below));
  });

  test('caught past the last snap point, it follows 1:1 back in', function (assert) {
    assert.strictEqual(drag(419, 0), 419, 'no jump');
    assert.strictEqual(drag(419, -10), 409, '1:1 while outside');
    assert.strictEqual(drag(419, -19), 400, 'back at the last snap point');
    assert.strictEqual(drag(419, -119), 300, 'and on inside');
    assert.strictEqual(
      drag(419, -400),
      rubberBand(19, 100, 400, bands.below),
      'into the band at the other end',
    );
  });

  test('caught past the first snap point, it follows 1:1 back in', function (assert) {
    assert.strictEqual(drag(80, 0), 80, 'no jump');
    assert.strictEqual(drag(80, 15), 95);
    assert.strictEqual(drag(80, 120), 200);
  });

  test('further out, only the remaining band resists', function (assert) {
    const above = drag(419, 10);
    assert.true(above > 419 && above < 424, `above (${above})`);
    assert.true(
      near(
        above,
        rubberBand(
          unRubberBand(419, 100, 400, bands.above) + 10,
          100,
          400,
          bands.above,
        ),
      ),
      'the band continues where it is',
    );
    const below = drag(80, -10);
    assert.true(below < 80 && below > 70, `below (${below})`);
  });

  test('caught at or past the band limit, it never jumps', function (assert) {
    for (const start of [424, 430, 500]) {
      assert.strictEqual(drag(start, 0), start, `${start}: no jump`);
      const out = drag(start, 100);
      assert.true(
        Number.isFinite(out) && out >= start && out < start + 1,
        `${start}: barely moves further out (${out})`,
      );
      assert.strictEqual(drag(start, -20), start - 20, `${start}: 1:1 back in`);
    }
  });

  test('throws a RangeError for non-finite input', function (assert) {
    assert.throws(() => drag(NaN, 0), RangeError);
    assert.throws(() => drag(0, Infinity), RangeError);
  });
});
