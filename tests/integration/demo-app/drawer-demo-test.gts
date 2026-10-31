import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, findAll, render } from '@ember/test-helpers';
import DrawerDemo from '../../../demo-app/components/drawer-demo.gts';
import '#src/styles.css';

/**
 * Renders the playground the way a URL does. Tests run as a development build,
 * so a tracked value that is read and then written during render fails Ember's
 * assertion here, as it did for `?points=` in the browser.
 */
async function renderPlayground(search: string) {
  await render(<template><DrawerDemo @search={{search}} /></template>);

  return {
    drawer: find('.mobile-drawer'),
    text: find('.demo-snap-points') as HTMLInputElement,
    error: find('.demo-error')?.textContent?.trim(),
    pressed: findAll('.demo-drawer-content button[aria-pressed]').map(
      (button) => button.getAttribute('aria-pressed'),
    ),
    snapButtons: findAll('[data-snap-point]').length,
    style: find('.demo-playground-drawer')?.getAttribute('style'),
    content: find('.demo-drawer-content'),
    tall: find('.demo-tall-content'),
    handle: (find('input[type="checkbox"]') as HTMLInputElement).checked,
    preset: (find('select:has(option[value="-1"])') as HTMLSelectElement | null)
      ?.value,
  };
}

module('Integration | demo-app | DrawerDemo URL params', function (hooks) {
  setupRenderingTest(hooks);

  test('renders the defaults without params', async function (assert) {
    const state = await renderPlayground('');
    assert.ok(state.drawer, 'the drawer renders');
    assert.strictEqual(state.content?.getAttribute('data-placement'), 'bottom');
    assert.strictEqual(state.text.value, "0, '50%', '100%'");
    assert.strictEqual(state.snapButtons, 3);
    assert.deepEqual(state.pressed, ['true', 'false', 'false']);
    assert.strictEqual(state.style, '--mobile-drawer-backdrop-opacity: 0.4');
    assert.notOk(state.tall);
  });

  test("renders the example from the component's docs", async function (assert) {
    const state = await renderPlayground(
      "?points=0,200,'content'&snap=2&backdrop=0.6",
    );
    assert.ok(state.drawer, 'the drawer renders');
    assert.strictEqual(state.error, undefined);
    assert.strictEqual(state.text.value, "0,200,'content'");
    assert.strictEqual(state.snapButtons, 3);
    assert.deepEqual(
      state.pressed.slice(0, 3),
      ['false', 'false', 'true'],
      'snap point 2 is active',
    );
    assert.strictEqual(state.style, '--mobile-drawer-backdrop-opacity: 0.6');
    assert.strictEqual(state.preset, '-1', 'custom snap points');
  });

  test('renders every param together', async function (assert) {
    const state = await renderPlayground(
      "?placement=left&points=0,'content'&snap=1&handle=1&backdrop=1&tall=1",
    );
    assert.ok(state.drawer, 'the drawer renders');
    assert.strictEqual(state.content?.getAttribute('data-placement'), 'left');
    assert.strictEqual(state.snapButtons, 2);
    assert.deepEqual(state.pressed.slice(0, 2), ['false', 'true']);
    assert.ok(state.tall, 'tall content');
    assert.true(state.handle, 'handle only');
    assert.strictEqual(state.style, '--mobile-drawer-backdrop-opacity: 1');
    assert.strictEqual(state.preset, '1', "matches the preset [0, 'content']");
  });

  test('renders every placement and preset', async function (assert) {
    for (const placement of ['bottom', 'top', 'left', 'right']) {
      for (const [preset, count] of [
        [0, 3],
        [1, 2],
        [2, 4],
      ] as const) {
        const state = await renderPlayground(
          `?placement=${placement}&preset=${preset}&snap=${count - 1}`,
        );
        assert.ok(state.drawer, `${placement} preset ${preset} renders`);
        assert.strictEqual(state.snapButtons, count);
        assert.strictEqual(
          state.pressed.slice(0, count).indexOf('true'),
          count - 1,
          `${placement} preset ${preset}: last snap point active`,
        );
      }
    }
  });

  test('a preset and points together: points win', async function (assert) {
    const state = await renderPlayground('?preset=2&points=0,100&snap=1');
    assert.ok(state.drawer);
    assert.strictEqual(state.snapButtons, 2);
    assert.deepEqual(state.pressed.slice(0, 2), ['false', 'true']);
  });

  test('invalid points show the error and keep the preset', async function (assert) {
    const state = await renderPlayground('?points=nope&snap=1');
    assert.ok(state.drawer, 'the drawer still renders');
    assert.ok(state.error?.includes('nope'), 'shows the error');
    assert.strictEqual(state.text.value, 'nope');
    assert.strictEqual(state.snapButtons, 3, 'keeps the first preset');
  });

  test('?snap must be an integer index in range', async function (assert) {
    for (const snap of ['1.5', '-1', '3', 'abc', '']) {
      const state = await renderPlayground(`?snap=${snap}`);
      assert.ok(state.drawer, `?snap=${snap} renders`);
      assert.strictEqual(
        state.pressed.indexOf('true'),
        0,
        `?snap=${snap} falls back to the first snap point`,
      );
    }
  });

  test('?backdrop must be 0 to 1; empty uses the default', async function (assert) {
    const expected: Record<string, string> = {
      '': '0.4',
      '0': '0',
      '0.6': '0.6',
      '1.5': '0.4',
      abc: '0.4',
    };
    for (const [backdrop, opacity] of Object.entries(expected)) {
      const state = await renderPlayground(`?backdrop=${backdrop}`);
      assert.strictEqual(
        state.style,
        `--mobile-drawer-backdrop-opacity: ${opacity}`,
        `?backdrop=${backdrop}`,
      );
    }
  });
});
