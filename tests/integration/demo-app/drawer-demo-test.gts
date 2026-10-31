import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, find, findAll, render } from '@ember/test-helpers';
import { drawerEnvironment } from '#src/-private/environment.ts';
import DrawerDemo from '../../../demo-app/components/drawer-demo.gts';
import '#src/styles.css';
// The playground's own stylesheet, applied only while its tests run: it
// styles `:root` and `body`, which would leak into every other test.
import demoStyles from '../../../demo-app/styles.css?raw';

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

module('Integration | demo-app | DrawerDemo controls', function (hooks) {
  setupRenderingTest(hooks);

  let style: HTMLStyleElement;

  hooks.beforeEach(function () {
    style = document.createElement('style');
    style.textContent = demoStyles;
    document.head.append(style);
  });

  hooks.afterEach(function () {
    style.remove();
  });

  test('the backdrop controls toggle @backdrop and @closeOnBackdropClick', async function (assert) {
    await render(<template><DrawerDemo @search="" /></template>);
    const checkbox = (label: string) => {
      const match = findAll('.demo-controls label').find((element) =>
        element.textContent?.includes(label),
      );
      return match!.querySelector('input') as HTMLInputElement;
    };
    const backdrop = '.demo-playground-drawer .mobile-drawer__backdrop';
    const code = () => find('.demo-code code')!.textContent!;

    assert.dom(backdrop).exists();
    assert.true(checkbox('(@backdrop)').checked);
    assert.true(checkbox('(@closeOnBackdropClick)').checked);
    assert.notOk(code().includes('Backdrop'), 'defaults are not in the code');

    await click(checkbox('(@closeOnBackdropClick)'));
    assert.true(code().includes('@closeOnBackdropClick={{false}}'));

    await click(checkbox('(@backdrop)'));
    assert.dom(backdrop).doesNotExist();
    assert.true(checkbox('(@closeOnBackdropClick)').disabled);
    assert.true(code().includes('@backdrop={{false}}'));
    assert.false(code().includes('@closeOnBackdropClick'));
  });

  for (const closeOnBackdropClick of [true, false]) {
    test(`a tap on the backdrop ${closeOnBackdropClick ? 'closes' : 'keeps'} the drawer with tap-to-close ${closeOnBackdropClick ? 'on' : 'off'}`, async function (assert) {
      drawerEnvironment.prefersReducedMotion = () => true;
      try {
        await render(<template><DrawerDemo @search="?snap=1" /></template>);
        if (!closeOnBackdropClick) {
          const label = findAll('.demo-controls label').find((element) =>
            element.textContent?.includes('(@closeOnBackdropClick)'),
          )!;
          await click(label.querySelector('input')!);
        }
        const root = find('.demo-playground-drawer > .mobile-drawer')!;
        assert.dom(root).doesNotHaveAttribute('data-closed', 'open at 50%');

        // Whatever is on top just above the tray is what a finger hits.
        const tray = root.querySelector('.mobile-drawer__tray')!;
        const rect = tray.getBoundingClientRect();
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top - 10,
        );
        assert.strictEqual(
          target,
          root.querySelector('.mobile-drawer__backdrop'),
          'the backdrop is hit, not the page',
        );
        await click(target!);

        if (closeOnBackdropClick) {
          assert.true(root.hasAttribute('data-closed'), 'closed');
        } else {
          assert.dom(root).doesNotHaveAttribute('data-closed', 'still open');
        }
      } finally {
        delete drawerEnvironment.prefersReducedMotion;
      }
    });
  }

  for (const placement of ['bottom', 'top', 'left', 'right'] as const) {
    for (const handle of [false, true]) {
      const mode = handle ? 'with @handleOnly' : 'without @handleOnly';
      test(`${placement}, ${mode}: the grabber stays at the leading edge while the content scrolls`, async function (assert) {
        drawerEnvironment.prefersReducedMotion = () => true;
        try {
          const search = `?placement=${placement}&snap=2&tall=1${handle ? '&handle=1' : ''}`;
          await render(<template><DrawerDemo @search={{search}} /></template>);
          const root = find('.demo-playground-drawer > .mobile-drawer')!;
          const tray = root.querySelector<HTMLElement>('.mobile-drawer__tray')!;
          const grabber = root.querySelector<HTMLElement>('.demo-grabber')!;
          assert.true(
            tray.scrollHeight > tray.clientHeight,
            'the tall content scrolls',
          );
          // A desktop scrollbar runs along a left drawer's leading edge and
          // takes hits; phones have no such scrollbar, so hide it (before
          // measuring: a classic scrollbar also takes layout space).
          tray.style.scrollbarWidth = 'none';
          tray.scrollTop = tray.scrollHeight;
          assert.true(tray.scrollTop > 0, 'scrolled');

          const t = tray.getBoundingClientRect();
          const g = grabber.getBoundingClientRect();
          const visible =
            g.top >= t.top - 1 &&
            g.bottom <= t.bottom + 1 &&
            g.left >= t.left - 4 &&
            g.right <= t.right + 4;
          assert.true(visible, 'in view');
          // Within 16px of the leading edge (the one facing the page).
          const gap = {
            bottom: g.top - t.top,
            top: t.bottom - g.bottom,
            left: t.right - g.right,
            right: g.left - t.left,
          }[placement];
          assert.true(gap < 16, `at the leading edge (${gap}px)`);
          // Nothing scrolled over it: a finger on it hits the grabber.
          const hit = document.elementFromPoint(
            g.left + g.width / 2,
            g.top + g.height / 2,
          );
          assert.strictEqual(hit, grabber, 'on top of the content');
        } finally {
          delete drawerEnvironment.prefersReducedMotion;
        }
      });
    }
  }
});
