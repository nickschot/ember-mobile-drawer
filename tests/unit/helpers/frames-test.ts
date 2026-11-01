import { module, test } from 'qunit';
import {
  FRAME_TIME_LIMIT,
  nextFrame,
  nextFrames,
} from '../../helpers/frames.ts';

module('Unit | helpers | frames', function (hooks) {
  let original: (callback: FrameRequestCallback) => number;
  hooks.beforeEach(function () {
    original = window.requestAnimationFrame.bind(window);
  });
  hooks.afterEach(function () {
    window.requestAnimationFrame = original;
  });

  test('the default time limit is 5 s', function (assert) {
    assert.strictEqual(FRAME_TIME_LIMIT, 5000);
  });

  test('it resolves after the given number of frames', async function (assert) {
    let frames = 0;
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        frames++;
        callback(time);
      });
    await nextFrame();
    assert.strictEqual(frames, 1);
    await nextFrames(3);
    assert.strictEqual(frames, 4);
  });

  test('it rejects with a clear error when no frame comes', async function (assert) {
    // A browser that renders no frames: the callback never runs.
    window.requestAnimationFrame = () => 0;
    await assert.rejects(
      nextFrames(2, 20),
      /^Error: No animation frame came in 20 ms \(frame 1 of 2\)\. The browser stopped rendering frames: document\.visibilityState is "\w+", document\.hasFocus\(\) is (true|false)\.$/,
    );
  });
});
