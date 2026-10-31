import { module, test } from 'qunit';
import {
  formatSnapPoints,
  parseSnapPoints,
} from '../../../demo-app/lib/parse-snap-points.ts';

module('Unit | demo-app | parseSnapPoints', function () {
  test('parses px, percentages and content, with or without quotes', function (assert) {
    assert.deepEqual(parseSnapPoints("0, 120, 'content', '90%'"), {
      snapPoints: [0, 120, 'content', '90%'],
    });
    assert.deepEqual(parseSnapPoints('[0, "50%", "100%"]'), {
      snapPoints: [0, '50%', '100%'],
    });
    assert.deepEqual(parseSnapPoints(' 0 ,240px, 33.5%, content '), {
      snapPoints: [0, 240, '33.5%', 'content'],
    });
  });

  test('rejects what the drawer would not accept', function (assert) {
    for (const text of [
      '',
      '[]',
      '0,,1',
      '-10',
      '101%',
      '1e3',
      'auto',
      '50 %',
      '20000',
      "alert('x')",
      '0,1,2,3,4,5,6,7,8',
    ]) {
      const result = parseSnapPoints(text);
      assert.strictEqual(result.snapPoints, undefined, `rejects ${text}`);
      assert.strictEqual(typeof result.error, 'string');
    }
  });

  test('formats snap points back to the input syntax', function (assert) {
    const text = formatSnapPoints([0, 120, 'content', '90%']);
    assert.strictEqual(text, "0, 120, 'content', '90%'");
    assert.deepEqual(parseSnapPoints(text), {
      snapPoints: [0, 120, 'content', '90%'],
    });
  });
});
