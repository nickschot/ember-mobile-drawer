import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, find, render } from '@ember/test-helpers';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { dragDrawer } from '#src/test-support.ts';
import BottomSheetExample from '../../../demo-app/components/bottom-sheet-example.gts';
import '#src/styles.css';
// The demo's own stylesheet, applied only while these tests run: it styles
// `:root` and `body`, which would leak into every other test.
import demoStyles from '../../../demo-app/styles.css?raw';

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

module('Integration | demo-app | BottomSheetExample', function (hooks) {
  setupRenderingTest(hooks);

  let style: HTMLStyleElement;

  hooks.beforeEach(function () {
    style = document.createElement('style');
    style.textContent = demoStyles;
    document.head.append(style);
    drawerEnvironment.prefersReducedMotion = () => true;
  });

  hooks.afterEach(function () {
    style.remove();
    delete drawerEnvironment.prefersReducedMotion;
  });

  test('the header drags the sheet, also with the list scrolled', async function (assert) {
    await render(<template><BottomSheetExample /></template>);
    await click('button');
    const root = el('.example-sheet');
    const tray = el('.example-sheet .mobile-drawer__tray');
    const header = el('.example-sheet-header');
    assert.strictEqual(header.style.touchAction, 'pan-x');

    await dragDrawer(header, { to: 2 });
    assert.true(
      tray.scrollHeight > tray.clientHeight,
      'fully open, the list scrolls',
    );
    tray.scrollTop = tray.scrollHeight / 2;
    assert.true(tray.scrollTop > 0, 'scrolled');
    const fullyOpen = tray.getBoundingClientRect().top;

    // dragDrawer throws if the gesture scrolls instead of dragging.
    await dragDrawer(header, { to: 1 });
    assert.dom(root).doesNotHaveAttribute('data-closed');
    const halfOpen = tray.getBoundingClientRect().top;
    assert.true(
      halfOpen > fullyOpen + 20,
      `the sheet moved down (${fullyOpen} to ${halfOpen})`,
    );

    await click('.example-sheet-title button');
    assert.true(root.hasAttribute('data-closed'), 'Close still works');
  });
});
