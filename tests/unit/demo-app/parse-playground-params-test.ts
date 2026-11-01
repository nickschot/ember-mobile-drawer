import { module, test } from 'qunit';
import { parsePlaygroundParams } from '../../../demo-app/lib/parse-playground-params.ts';

module('Unit | demo-app | parsePlaygroundParams', function () {
  test('defaults', function (assert) {
    const state = parsePlaygroundParams('');
    assert.strictEqual(state.placement, 'bottom');
    assert.strictEqual(state.preset, 0);
    assert.deepEqual(state.snapPoints, [0, '50%', '100%']);
    assert.strictEqual(state.active, 0);
    assert.strictEqual(state.backdropOpacity, 0.4);
    assert.false(state.handleOnly);
    assert.false(state.tall);
    assert.strictEqual(state.spring, 'default');
  });

  test('?spring picks a spring preset by name', function (assert) {
    assert.strictEqual(parsePlaygroundParams('?spring=ios').spring, 'ios');
    assert.strictEqual(
      parsePlaygroundParams('?spring=iosBouncy').spring,
      'iosBouncy',
    );
    assert.strictEqual(
      parsePlaygroundParams('?spring=android').spring,
      'default',
    );
  });

  test("the docs' example", function (assert) {
    const state = parsePlaygroundParams(
      "?points=0,200,'content'&snap=2&backdrop=0.6",
    );
    assert.deepEqual(state.snapPoints, [0, 200, 'content']);
    assert.strictEqual(state.preset, -1);
    assert.strictEqual(state.active, 2);
    assert.strictEqual(state.backdropOpacity, 0.6);
    assert.strictEqual(state.snapPointsError, undefined);
  });

  test('rejects a non-integer ?snap instead of rounding it', function (assert) {
    assert.strictEqual(parsePlaygroundParams('?snap=1.5').active, 0);
    assert.strictEqual(parsePlaygroundParams('?snap=1').active, 1);
  });

  test('an empty ?backdrop is the default, not 0', function (assert) {
    assert.strictEqual(
      parsePlaygroundParams('?backdrop=').backdropOpacity,
      0.4,
    );
    assert.strictEqual(parsePlaygroundParams('?backdrop=0').backdropOpacity, 0);
  });
});
