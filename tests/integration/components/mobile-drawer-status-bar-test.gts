import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { MobileDrawer, type SnapPoint, type Placement } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { bodyScrollLocks } from '#src/-private/modal/scroll-lock.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// DRAFT (#113, design B): `@transparentStatusBar`.

const SNAP_POINTS: SnapPoint[] = [0, 200, 400];

class State {
  @tracked active = 0;
  @tracked field = false;
  @tracked placement: Placement = 'bottom';
  @tracked transparent = true;
  onChange = (index: number) => (this.active = index);
}

function root(): HTMLElement {
  return find('[data-test-drawer]') as HTMLElement;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      <MobileDrawer
        @snapPoints={{SNAP_POINTS}}
        @activeSnapPoint={{state.active}}
        @onSnapPointChange={{state.onChange}}
        @placement={{state.placement}}
        @transparentStatusBar={{state.transparent}}
        aria-label="Drawer"
        data-test-drawer
      >
        <p>Content</p>
        {{#if state.field}}
          <input aria-label="Field" />
        {{/if}}
      </MobileDrawer>
    </template>,
  );
}

module(
  'Integration | Component | mobile-drawer | transparent status bar (draft, #113)',
  function (hooks) {
    setupRenderingTest(hooks);

    let clock: FakeClock;

    hooks.beforeEach(function () {
      clock = new FakeClock();
      drawerEnvironment.clock = clock;
      drawerEnvironment.prefersReducedMotion = () => false;
      drawerEnvironment.isIOS = () => true;
    });

    hooks.afterEach(function (assert) {
      delete drawerEnvironment.clock;
      delete drawerEnvironment.prefersReducedMotion;
      delete drawerEnvironment.isIOS;
      assert.strictEqual(bodyScrollLocks(), 0, 'no scroll lock left behind');
      assert.strictEqual(
        document.querySelectorAll('.mobile-drawer__dim').length,
        0,
        'no dim layer left behind',
      );
    });

    async function settle() {
      await settled();
      clock.runUntilIdle();
      await settled();
    }

    test('a bottom drawer without a text field: overflow lock, attribute and dim layer', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      state.active = 2;
      await settle();

      const { body } = document;
      assert.strictEqual(body.style.position, '', '<body> is not fixed');
      assert.strictEqual(body.style.overflow, 'hidden', 'overflow lock');
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent');
      const dim = root().previousElementSibling as HTMLElement;
      assert.true(
        dim.classList.contains('mobile-drawer__dim'),
        'dim before the root',
      );
      assert.strictEqual(dim.getAttribute('aria-hidden'), 'true');
      assert.strictEqual(getComputedStyle(dim).position, 'absolute');
      assert.strictEqual(getComputedStyle(dim).pointerEvents, 'none');
      assert.strictEqual(
        dim.style.getPropertyValue('--mobile-drawer-progress'),
        '1',
      );
      assert.strictEqual(
        Math.round(dim.getBoundingClientRect().top),
        -Math.round(window.scrollY),
        'at the top of the document',
      );
      assert.true(
        dim.offsetHeight >= document.documentElement.scrollHeight - 1,
        'as high as the document',
      );

      state.active = 0;
      await settle();
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');
      assert.dom('.mobile-drawer__dim').doesNotExist('removed once closed');
    });

    test('a drawer with a text field keeps the fixed <body> and the default look', async function (assert) {
      const state = new State();
      state.field = true;
      await renderDrawer(state);
      state.active = 2;
      await settle();

      assert.strictEqual(document.body.style.position, 'fixed');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');
      assert.dom('.mobile-drawer__dim').doesNotExist();
      state.active = 0;
      await settle();
    });

    test('top drawers and drawers without the argument do not change', async function (assert) {
      const state = new State();
      state.placement = 'top';
      await renderDrawer(state);
      state.active = 2;
      await settle();
      assert.strictEqual(
        document.body.style.position,
        'fixed',
        'top: fixed <body>',
      );
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');
      state.active = 0;
      await settle();

      state.placement = 'bottom';
      state.transparent = false;
      await settle();
      state.active = 2;
      await settle();
      assert.strictEqual(
        document.body.style.position,
        'fixed',
        'default: fixed <body>',
      );
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');
      assert.dom('.mobile-drawer__dim').doesNotExist();
      state.active = 0;
      await settle();
    });
  },
);
