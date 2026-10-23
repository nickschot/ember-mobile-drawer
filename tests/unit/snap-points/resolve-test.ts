import { module, test } from 'qunit';
import {
  findSnapPoint,
  resolveSnapPoints,
  type SnapPoint,
} from '#src/-private/snap-points/index.ts';

module('Unit | snap-points | resolveSnapPoints', function () {
  test('resolves px, percentages and content', function (assert) {
    assert.deepEqual(
      resolveSnapPoints([0, '50%', 'content', '100%'], {
        container: 800,
        content: 300,
      }),
      [
        { offset: 0, indices: [0] },
        { offset: 300, indices: [2] },
        { offset: 400, indices: [1] },
        { offset: 800, indices: [3] },
      ],
    );
  });

  test('parses the number part of a percentage like Number()', function (assert) {
    assert.deepEqual(
      resolveSnapPoints(['.5%', '1e1%', ' 25 %'], { container: 800 }).map(
        (s) => s.offset,
      ),
      [4, 80, 200],
      "'.5%' and '1e1%' are accepted, as the type allows them",
    );
  });

  test('supports fractional percentages', function (assert) {
    assert.deepEqual(resolveSnapPoints(['12.5%'], { container: 800 }), [
      { offset: 100, indices: [0] },
    ]);
  });

  test('sorts ascending and keeps original indices', function (assert) {
    assert.deepEqual(resolveSnapPoints(['100%', 200, 0], { container: 600 }), [
      { offset: 0, indices: [2] },
      { offset: 200, indices: [1] },
      { offset: 600, indices: [0] },
    ]);
  });

  test('de-duplicates snap points that resolve to the same offset', function (assert) {
    assert.deepEqual(
      resolveSnapPoints([0, '100%', 400, 'content', 0, 400.2], {
        container: 400,
        content: 400,
      }),
      [
        { offset: 0, indices: [0, 4] },
        { offset: 400, indices: [1, 2, 3, 5] },
      ],
      'exact and sub-pixel duplicates are merged, indices ascending',
    );
  });

  test('keeps the container size exact when merging near it', function (assert) {
    assert.deepEqual(
      resolveSnapPoints(['100%', 799.7], { container: 800 }),
      [{ offset: 800, indices: [0, 1] }],
      "'100%' + 799.7px",
    );
    assert.deepEqual(
      resolveSnapPoints([799.7, 'content'], { container: 800, content: 900 }),
      [{ offset: 800, indices: [0, 1] }],
      'content clamped to the container + 799.7px',
    );
    assert.deepEqual(
      resolveSnapPoints([399.7, 400], { container: 800 }),
      [{ offset: 399.7, indices: [0, 1] }],
      'away from the container size the lowest offset is kept',
    );
  });

  test('keeps snap points that are at least half a pixel apart', function (assert) {
    assert.deepEqual(
      resolveSnapPoints([100, 100.5], { container: 400 }).map((s) => s.offset),
      [100, 100.5],
    );
  });

  test('clamps content larger than the container to the container size', function (assert) {
    assert.deepEqual(
      resolveSnapPoints([0, 'content', '100%'], {
        container: 500,
        content: 900,
      }),
      [
        { offset: 0, indices: [0] },
        { offset: 500, indices: [1, 2] },
      ],
    );
  });

  test('clamps px snap points larger than the container', function (assert) {
    assert.deepEqual(resolveSnapPoints([0, 1000], { container: 500 }), [
      { offset: 0, indices: [0] },
      { offset: 500, indices: [1] },
    ]);
  });

  test('resolves a single snap point', function (assert) {
    assert.deepEqual(resolveSnapPoints(['100%'], { container: 300 }), [
      { offset: 300, indices: [0] },
    ]);
  });

  test('resolves against a zero-size container', function (assert) {
    assert.deepEqual(resolveSnapPoints([0, '50%', 200], { container: 0 }), [
      { offset: 0, indices: [0, 1, 2] },
    ]);
  });

  test('throws helpful errors for invalid input', function (assert) {
    const sizes = { container: 400 };
    const invalid = (snapPoints: unknown[], message: RegExp, label: string) =>
      assert.throws(
        () => resolveSnapPoints(snapPoints as SnapPoint[], sizes),
        message,
        label,
      );

    assert.throws(
      () => resolveSnapPoints([], sizes),
      /snap points must be a non-empty array/,
      'empty array',
    );
    invalid([-10], /invalid snap point -10 at index 0.*>= 0/, 'negative px');
    invalid([0, NaN], /invalid snap point NaN at index 1/, 'NaN');
    invalid([Infinity], /invalid snap point Infinity/, 'Infinity');
    invalid(['150%'], /'150%'.*between '0%' and '100%'/, 'percentage > 100');
    invalid(['-5%'], /'-5%'/, 'negative percentage');
    invalid(['50'], /'50'.*like '50%'/, 'string without %');
    invalid(['half'], /'half'/, 'unknown string');
    invalid(['%'], /'%'/, 'percentage without a number');
    invalid(['0x%'], /'0x%'/, 'malformed number');
    invalid([null], /invalid snap point null.*Expected a number/, 'null');
    invalid(
      ['content'],
      /'content' snap points need the measured content size/,
      'content without size',
    );
    assert.throws(
      () => resolveSnapPoints(['content'], { container: 400, content: -1 }),
      /content size must be a finite number >= 0/,
      'negative content size',
    );
    assert.throws(
      () => resolveSnapPoints([0], { container: NaN }),
      /container size must be a finite number >= 0/,
      'invalid container size',
    );
  });

  test('throws RangeErrors for non-finite or negative sizes', function (assert) {
    const isRangeError = (error: Error) => error instanceof RangeError;
    for (const container of [NaN, Infinity, -Infinity, -1]) {
      assert.throws(
        () => resolveSnapPoints([0], { container }),
        isRangeError,
        `container ${container}`,
      );
    }
    for (const content of [NaN, Infinity, -1]) {
      assert.throws(
        () => resolveSnapPoints(['content'], { container: 400, content }),
        isRangeError,
        `content ${content}`,
      );
    }
    assert.throws(
      () => resolveSnapPoints([Infinity], { container: 400 }),
      isRangeError,
      'px Infinity',
    );
    assert.throws(
      () => resolveSnapPoints(['Infinity%' as SnapPoint], { container: 400 }),
      isRangeError,
      "'Infinity%'",
    );
  });

  test('throws a clear error without a sizes object', function (assert) {
    assert.throws(
      () =>
        resolveSnapPoints([0], undefined as unknown as { container: number }),
      (error: Error) =>
        !(error instanceof TypeError) &&
        /needs a sizes object like \{ container: 800 \}, got undefined/.test(
          error.message,
        ),
    );
  });
});

module('Unit | snap-points | findSnapPoint', function () {
  test('maps an original index across a re-resolve', function (assert) {
    const snapPoints: SnapPoint[] = [0, 'content', '50%', '100%'];
    const before = resolveSnapPoints(snapPoints, {
      container: 800,
      content: 300,
    });
    const after = resolveSnapPoints(snapPoints, {
      container: 400,
      content: 300,
    });

    assert.strictEqual(findSnapPoint(before, 2)?.offset, 400);
    assert.strictEqual(
      findSnapPoint(after, 2)?.offset,
      200,
      'the 50% snap point moved and changed position in the sorted order',
    );
    assert.strictEqual(findSnapPoint(after, 1)?.offset, 300);
    assert.strictEqual(findSnapPoint(after, 7), undefined, 'unknown index');
  });

  test('finds merged duplicates by any of their indices', function (assert) {
    const resolved = resolveSnapPoints([0, 'content', '100%'], {
      container: 400,
      content: 600,
    });
    assert.strictEqual(findSnapPoint(resolved, 1), findSnapPoint(resolved, 2));
  });
});
