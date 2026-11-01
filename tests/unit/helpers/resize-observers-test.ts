import { module, test } from 'qunit';
import { resizeObserversDelivered } from '../../helpers/resize-observers.ts';

module('Unit | Helper | resizeObserversDelivered', function (hooks) {
  const RealResizeObserver = window.ResizeObserver;
  let element: HTMLElement;

  hooks.beforeEach(function () {
    element = document.createElement('div');
    element.style.width = '10px';
    element.style.height = '10px';
    document.body.append(element);
  });

  hooks.afterEach(function () {
    window.ResizeObserver = RealResizeObserver;
    element.remove();
  });

  test('it resolves after an older observer saw a size change', async function (assert) {
    const sizes: number[] = [];
    const older = new ResizeObserver((entries) => {
      for (const entry of entries) sizes.push(entry.contentRect.width);
    });
    older.observe(element);
    await resizeObserversDelivered();
    assert.deepEqual(sizes, [10], 'the initial size');

    // A size change and a new call right after the last one. This code must
    // run after the frame's resize observations, or the browser skips the
    // new observer and reports a "ResizeObserver loop" error.
    element.style.width = '20px';
    await resizeObserversDelivered();
    assert.deepEqual(sizes, [10, 20], 'the new size, in the same frame');
    older.disconnect();
  });

  test('it rejects when no frame comes in time, and stops observing', async function (assert) {
    let disconnected = 0;
    // An observer that never gets a callback, as when no frame comes.
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected++;
      }
    };

    await assert.rejects(
      resizeObserversDelivered(20),
      /^Error: No ResizeObserver delivery within 20 ms$/,
    );
    assert.strictEqual(disconnected, 1, 'disconnected');
  });

  test('it stops observing and clears its timer when it resolves', async function (assert) {
    let disconnected = 0;
    window.ResizeObserver = class {
      #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe() {
        queueMicrotask(() => this.#callback([], this));
      }
      unobserve() {}
      disconnect() {
        disconnected++;
      }
    };

    await resizeObserversDelivered(20);
    // After the time limit, the timer must not disconnect again.
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.strictEqual(disconnected, 1, 'disconnected once');
  });
});
