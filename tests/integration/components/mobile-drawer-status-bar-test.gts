import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { MobileDrawer, type SnapPoint, type Placement } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { bodyScrollLocks } from '#src/-private/modal/scroll-lock.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// `@transparentStatusBar` (#113). The tests run in Chrome, so the iOS CSS
// (the 5px offset) doesn't apply; they check the lock, the attribute and the
// dim layer.

const SNAP_POINTS: SnapPoint[] = [0, 200, 400];
const PEEK_SNAP_POINTS: SnapPoint[] = [120, 400];

class State {
  @tracked active = 0;
  @tracked snapPoints: SnapPoint[] = SNAP_POINTS;
  @tracked field = false;
  @tracked placement: Placement = 'bottom';
  @tracked transparent = true;
  @tracked nestedShown = false;
  @tracked nestedActive = 0;
  @tracked nestedField = false;
  onChange = (index: number) => (this.active = index);
  onNestedChange = (index: number) => (this.nestedActive = index);
}

function el(selector: string): HTMLElement {
  return find(selector) as HTMLElement;
}

/** The dim layer just before the root of `selector`, if any. */
function dimOf(selector: string): HTMLElement | undefined {
  const previous = el(selector).previousElementSibling;
  return previous instanceof HTMLElement &&
    previous.classList.contains('mobile-drawer__dim')
    ? previous
    : undefined;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      <MobileDrawer
        @snapPoints={{state.snapPoints}}
        @activeSnapPoint={{state.active}}
        @onSnapPointChange={{state.onChange}}
        @placement={{state.placement}}
        @transparentStatusBar={{state.transparent}}
        aria-label="Drawer"
        data-test-drawer
        as |drawer|
      >
        <p>Content</p>
        {{#if state.field}}
          <input aria-label="Field" />
        {{/if}}
        {{#if state.nestedShown}}
          <drawer.Nested>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @activeSnapPoint={{state.nestedActive}}
              @onSnapPointChange={{state.onNestedChange}}
              aria-label="Nested"
              data-test-nested
            >
              <p>Nested</p>
              {{#if state.nestedField}}
                <input aria-label="Nested field" />
              {{/if}}
            </MobileDrawer>
          </drawer.Nested>
        {{/if}}
      </MobileDrawer>
    </template>,
  );
}

module(
  'Integration | Component | mobile-drawer | transparent status bar',
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
      assert.strictEqual(document.body.style.position, '', '<body> restored');
      assert.strictEqual(document.body.style.overflow, '');
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
      const dim = dimOf('[data-test-drawer]')!;
      assert.ok(dim, 'dim layer before the root');
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

    test('while it closes, the dim layer stays and fades; it goes at [data-closed]', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      state.active = 2;
      await settle();

      state.active = 0;
      await settled();
      clock.frame();
      clock.frame();
      assert.strictEqual(bodyScrollLocks(), 0, 'the lock goes at once');
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent')
        .doesNotHaveAttribute('data-closed');
      const dim = dimOf('[data-test-drawer]')!;
      assert.ok(dim, 'the dim layer stays while the drawer moves');
      const progress = Number(
        dim.style.getPropertyValue('--mobile-drawer-progress'),
      );
      assert.true(progress > 0 && progress < 1, `fading (${progress})`);

      clock.runUntilIdle();
      await settled();
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-closed')
        .doesNotHaveAttribute('data-status-bar');
      assert.false(dim.isConnected, 'dim layer removed');
    });

    test('at a peek (no lock) the offset and the dim layer go until it opens again', async function (assert) {
      const state = new State();
      state.snapPoints = PEEK_SNAP_POINTS;
      await renderDrawer(state);
      await settle();
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');

      state.active = 1;
      await settle();
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent');
      assert.ok(dimOf('[data-test-drawer]'));

      state.active = 0;
      await settle();
      assert.strictEqual(bodyScrollLocks(), 0);
      assert
        .dom('[data-test-drawer]')
        .doesNotHaveAttribute('data-closed', 'still visible at its peek')
        .doesNotHaveAttribute('data-status-bar');
      assert.notOk(dimOf('[data-test-drawer]'), 'no dim layer at the peek');

      state.active = 1;
      await settle();
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent');
      assert.ok(dimOf('[data-test-drawer]'), 'back when it opens again');

      state.active = 0;
      await settle();
      assert.notOk(dimOf('[data-test-drawer]'));
    });

    test('a nested drawer shares the overflow lock and gets its own dim layer', async function (assert) {
      const state = new State();
      state.nestedShown = true;
      await renderDrawer(state);
      state.active = 2;
      await settle();
      state.nestedActive = 2;
      await settle();

      assert.strictEqual(bodyScrollLocks(), 2);
      assert.strictEqual(document.body.style.position, '');
      assert
        .dom('[data-test-nested]')
        .hasAttribute('data-status-bar', 'transparent');
      const outerDim = dimOf('[data-test-drawer]');
      const nestedDim = dimOf('[data-test-nested]');
      assert.ok(outerDim);
      assert.ok(nestedDim);
      assert.notStrictEqual(outerDim, nestedDim);
      assert.true(
        Boolean(
          el('[data-test-drawer]').compareDocumentPosition(nestedDim!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        'the nested dim layer comes after the outer root, so it dims it',
      );

      state.nestedActive = 0;
      await settle();
      assert.notOk(dimOf('[data-test-nested]'), 'nested dim layer removed');
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent', 'the outer one stays');
      state.active = 0;
      await settle();
    });

    test('a nested drawer with a text field changes the lock to the fixed <body>', async function (assert) {
      const state = new State();
      state.nestedShown = true;
      await renderDrawer(state);
      state.active = 2;
      await settle();
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-status-bar', 'transparent');

      // The field renders with the nested drawer's content when it opens.
      state.nestedField = true;
      state.nestedActive = 2;
      await settle();
      assert.strictEqual(document.body.style.position, 'fixed');
      assert.strictEqual(document.body.style.overflow, '');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-status-bar');
      assert.dom('[data-test-nested]').doesNotHaveAttribute('data-status-bar');
      assert.dom('.mobile-drawer__dim').doesNotExist('both dim layers gone');

      state.nestedActive = 0;
      await settle();
      state.active = 0;
      await settle();
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
