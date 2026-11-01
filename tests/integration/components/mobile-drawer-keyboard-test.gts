import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import {
  KEYBOARD_ATTRIBUTE,
  KEYBOARD_FILL_CLASS,
} from '#src/-private/keyboard-fill.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';
import '#src/themes/ios.css';

/*
 * No desktop browser has an on-screen keyboard, so these tests play iOS
 * Safari's part (measured in the iOS 27 simulator, see `KeyboardFill`):
 * when a field gets focus, the visual viewport becomes lower and moves down
 * in the layout viewport, and the client coordinates follow it, so the
 * fixed root moves up (`top` < 0) and ends above the bottom of the screen.
 * A fake visual viewport (`drawerEnvironment.visualViewport`) gives the
 * height and the events; an inline `translate` on the root moves it, as
 * Safari's client coordinates do: its computed `top` (its offset in the
 * layout viewport) stays the same. The drawer
 * renders in `<body>`, outside the scaled test container, so its client
 * coordinates are the window's, as in Safari.
 */

const destination = document.body;

const HEIGHT = 600;
const SNAP_POINTS: SnapPoint[] = [0, '40%', '100%'];

class FakeViewport extends EventTarget {
  height = HEIGHT;
  scale = 1;
}

class State {
  @tracked active = 1;
  @tracked placement: 'bottom' | 'top' = 'bottom';
  @tracked modal = false;
  /** How far iOS moved the visual viewport down (px). */
  @tracked shift = 0;
  @tracked embedded = false;
  @tracked inset = '8px';
  @tracked transparentStatusBar = false;
  /**
   * The root's offset from the top of the layout viewport (px), e.g. the
   * 5px that the iOS CSS gives with `@transparentStatusBar`.
   */
  @tracked offset = 0;
  @tracked fields = true;

  get rootStyle() {
    return htmlSafe(
      [
        `inset: auto; left: 0; width: 400px; height: ${HEIGHT}px`,
        `top: ${this.offset}px`,
        `translate: 0 ${-this.shift}px`,
        this.embedded ? 'position: absolute' : '',
      ].join('; '),
    );
  }

  get wrapperStyle() {
    return htmlSafe(
      `--mobile-drawer-inset: ${this.inset}; --mobile-drawer-background: rgb(10 20 30 / 0.5)`,
    );
  }
}

function el(selector: string): HTMLElement {
  const element = find(selector) ?? document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const root = () => el('[data-test-drawer]');
const sheet = () => el('[data-test-drawer] > .mobile-drawer__sheet');
const tray = () =>
  el('[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__tray');
const fills = () => document.querySelectorAll(`.${KEYBOARD_FILL_CLASS}`);
const fill = () => el(`.${KEYBOARD_FILL_CLASS}`);

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      {{#in-element destination insertBefore=null}}
        <div class="mobile-drawer-theme-ios" style={{state.wrapperStyle}}>
          <MobileDrawer
            @placement={{state.placement}}
            @snapPoints={{SNAP_POINTS}}
            @activeSnapPoint={{state.active}}
            @modal={{state.modal}}
            @transparentStatusBar={{state.transparentStatusBar}}
            aria-label="Drawer"
            style={{state.rootStyle}}
            data-test-drawer
          >
            {{#if state.fields}}
              <input type="text" aria-label="First" data-test-field />
              <input type="text" aria-label="Second" data-test-second />
            {{/if}}
            <button type="button" data-test-button>Button</button>
            <div style="height: 1000px"></div>
          </MobileDrawer>
        </div>
      {{/in-element}}
    </template>,
  );
}

module('Integration | Component | mobile-drawer | keyboard', function (hooks) {
  setupRenderingTest(hooks);

  let clock: FakeClock;
  let viewport: FakeViewport;

  hooks.beforeEach(function () {
    clock = new FakeClock();
    viewport = new FakeViewport();
    drawerEnvironment.clock = clock;
    drawerEnvironment.prefersReducedMotion = () => false;
    drawerEnvironment.visualViewport = () => viewport;
  });

  hooks.afterEach(function (assert) {
    delete drawerEnvironment.clock;
    delete drawerEnvironment.prefersReducedMotion;
    delete drawerEnvironment.visualViewport;
    delete drawerEnvironment.isIOS;
    assert.strictEqual(fills().length, 0, 'no fill outlives the test');
  });

  async function settle() {
    await settled();
    clock.runUntilIdle();
    await settled();
  }

  /** iOS Safari opens the keyboard: the visual viewport shrinks and moves. */
  async function openKeyboard(state: State, keyboard = 300, shift = 250) {
    viewport.height = HEIGHT - keyboard;
    state.shift = shift;
    await settled();
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
  }

  async function closeKeyboard(state: State) {
    viewport.height = HEIGHT;
    state.shift = 0;
    await settled();
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
  }

  for (const modal of [false, true]) {
    test(`${modal ? 'modal' : 'not modal'}: the sheet's colour fills the strip below the root while the keyboard is open`, async function (assert) {
      const state = new State();
      state.modal = modal;
      await renderDrawer(state);
      await settle();
      assert.strictEqual(fills().length, 0, 'no fill without a keyboard');
      assert.dom(root()).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);
      const field = el('[data-test-field]');
      field.focus();
      const before = field.getBoundingClientRect().top;

      await openKeyboard(state);
      assert.strictEqual(fills().length, 1, 'one fill');
      assert.strictEqual(fill().parentElement, document.documentElement);
      assert.dom(fill()).hasAttribute('aria-hidden', 'true');
      assert.strictEqual(getComputedStyle(fill()).pointerEvents, 'none');
      const rootRect = root().getBoundingClientRect();
      const rect = fill().getBoundingClientRect();
      assert.true(
        Math.abs(rect.top - rootRect.bottom) < 0.5,
        `from the bottom of the root (${rect.top} / ${rootRect.bottom})`,
      );
      assert.true(
        Math.abs(rect.height - 250) < 0.5,
        `to the bottom of the screen (${rect.height})`,
      );
      assert.strictEqual(
        getComputedStyle(fill()).backgroundColor,
        getComputedStyle(tray()).backgroundColor,
        'the tray colour',
      );
      assert.strictEqual(
        getComputedStyle(fill()).zIndex,
        getComputedStyle(root()).zIndex,
      );
      assert.dom(root()).hasAttribute(KEYBOARD_ATTRIBUTE);
      assert.strictEqual(
        field.getBoundingClientRect().top - before,
        -250,
        'the field moves only with the root (as iOS moves it)',
      );
      // The floating sheet meets the fill: no inset, no bottom radius.
      const sheetRect = sheet().getBoundingClientRect();
      assert.strictEqual(sheetRect.bottom, rootRect.bottom);
      assert.strictEqual(sheetRect.left, rootRect.left);
      assert.strictEqual(
        getComputedStyle(sheet()).borderBottomLeftRadius,
        '0px',
      );
      assert.strictEqual(getComputedStyle(tray()).clipPath, 'none');
      // The theme's blur is on the glass layer (#135): the fill takes it
      // from there, and the layer meets the fill too.
      const glass = el(
        '[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__glass',
      );
      assert.strictEqual(getComputedStyle(tray()).backdropFilter, 'none');
      assert.strictEqual(
        getComputedStyle(fill()).backdropFilter,
        'blur(30px) saturate(1.8)',
        "the glass layer's blur",
      );
      assert.strictEqual(
        glass.getBoundingClientRect().bottom,
        tray().getBoundingClientRect().bottom,
        'the glass layer ends with the tray',
      );

      // Safari scrolls the visual viewport again (e.g. a lower field).
      state.shift = 200;
      await settled();
      viewport.dispatchEvent(new Event('scroll'));
      assert.true(
        Math.abs(fill().getBoundingClientRect().height - 200) < 0.5,
        'follows the visual viewport',
      );
      assert.true(
        Math.abs(
          fill().getBoundingClientRect().top -
            root().getBoundingClientRect().bottom,
        ) < 0.5,
      );

      await closeKeyboard(state);
      assert.strictEqual(fills().length, 0, 'gone when the keyboard closes');
      assert.dom(root()).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);
      assert.notStrictEqual(
        getComputedStyle(sheet()).borderBottomLeftRadius,
        '0px',
        'the floating sheet is back',
      );
    });
  }

  test('@transparentStatusBar: a drawer with a field keeps the fixed <body>, so no offset and no dim layer while the fill shows', async function (assert) {
    drawerEnvironment.isIOS = () => true;
    const state = new State();
    state.modal = true;
    state.transparentStatusBar = true;
    state.active = 0;
    await renderDrawer(state);
    await settle();
    state.active = 1;
    await settle();
    assert.strictEqual(document.body.style.position, 'fixed', 'fixed lock');
    assert.dom(root()).doesNotHaveAttribute('data-status-bar');
    assert.dom('.mobile-drawer__dim').doesNotExist();

    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 1, 'the fill shows');
    assert.dom(root()).hasAttribute(KEYBOARD_ATTRIBUTE);
    assert.dom(root()).doesNotHaveAttribute('data-status-bar');
    assert.dom('.mobile-drawer__dim').doesNotExist();
    const rect = fill().getBoundingClientRect();
    assert.true(
      Math.abs(rect.top - root().getBoundingClientRect().bottom) < 0.5,
      'from the bottom of the root',
    );

    await closeKeyboard(state);
    assert.strictEqual(fills().length, 0);
    state.active = 0;
    await settle();
    assert.strictEqual(document.body.style.position, '', 'lock released');
  });

  test('@transparentStatusBar: with the 5px offset the fill still reaches the bottom of the screen (#124)', async function (assert) {
    drawerEnvironment.isIOS = () => true;
    const state = new State();
    state.modal = true;
    state.transparentStatusBar = true;
    state.fields = false;
    state.active = 0;
    await renderDrawer(state);
    await settle();
    state.active = 1;
    await settle();
    assert.notStrictEqual(document.body.style.position, 'fixed', 'no fix');
    assert.dom(root()).hasAttribute('data-status-bar', 'transparent');
    // The iOS CSS moves the root 5px down; Chrome doesn't apply it.
    state.offset = 5;
    await settled();

    // A field that the drawer adds after it opens keeps the overflow lock.
    state.fields = true;
    await settle();
    assert.dom(root()).hasAttribute('data-status-bar', 'transparent');
    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 1, 'the fill shows');
    const rootRect = root().getBoundingClientRect();
    const rect = fill().getBoundingClientRect();
    assert.true(
      Math.abs(rect.top - rootRect.bottom) < 0.5,
      `from the bottom of the root (${rect.top} / ${rootRect.bottom})`,
    );
    // The screen ends 250px below the root's bottom (the layout viewport
    // moved up 250px), whatever the root's offset in it.
    assert.true(
      Math.abs(rect.height - 250) < 0.5,
      `to the bottom of the screen, no gap (${rect.height})`,
    );

    state.shift = 200;
    await settled();
    viewport.dispatchEvent(new Event('scroll'));
    assert.true(
      Math.abs(fill().getBoundingClientRect().height - 200) < 0.5,
      'follows the visual viewport',
    );

    await closeKeyboard(state);
    assert.strictEqual(fills().length, 0, 'no fill at the offset alone');
    state.active = 0;
    await settle();
  });

  test('focus that leaves the fields hides the fill at once; focus on another field keeps it', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 1);

    el('[data-test-second]').focus();
    assert.strictEqual(fills().length, 1, 'another field: the keyboard stays');

    // The keyboard's Done button: focus goes nowhere. Safari moves the root
    // back before the visual viewport's events.
    el('[data-test-second]').blur();
    assert.strictEqual(fills().length, 0, 'hidden at once');
    assert.dom(root()).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);

    el('[data-test-field]').focus();
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 1, 'back with the next event');

    el('[data-test-button]').focus();
    assert.strictEqual(fills().length, 0, 'a button: the keyboard closes');
    await closeKeyboard(state);
  });

  test('the fill goes when the drawer closes, and when it is destroyed', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 1);

    state.active = 0;
    await settle();
    assert.strictEqual(fills().length, 0, 'closed');

    state.active = 1;
    await settle();
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 1, 'open again, keyboard still open');

    await render(
      <template>
        {{! nothing }}
      </template>,
    );
    assert.strictEqual(fills().length, 0, 'destroyed');
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 0, 'no listener left');
  });

  test('at full height the fill also shows, with the same colour', async function (assert) {
    const state = new State();
    state.active = 2;
    await renderDrawer(state);
    await settle();
    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 1);
    assert.strictEqual(
      getComputedStyle(fill()).backgroundColor,
      getComputedStyle(tray()).backgroundColor,
    );
    await closeKeyboard(state);
    assert.strictEqual(fills().length, 0);
  });

  test('the fill takes the new tray colour when the drawer moves to its highest snap point', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    el('[data-test-field]').focus();
    await openKeyboard(state);
    const glass = getComputedStyle(fill()).backgroundColor;
    assert.strictEqual(glass, getComputedStyle(tray()).backgroundColor);

    state.active = 2;
    await settle();
    const opaque = getComputedStyle(tray()).backgroundColor;
    assert.notStrictEqual(opaque, glass, 'the theme made the tray opaque');
    assert.strictEqual(getComputedStyle(fill()).backgroundColor, opaque);
    await closeKeyboard(state);
  });

  test('with a nested drawer only the drawer with the focused field shows a fill, and all fills go at once', async function (assert) {
    const state = new State();
    const nested = new State();
    nested.active = 1;
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        {{#in-element destination insertBefore=null}}
          <div class="mobile-drawer-theme-ios" style={{state.wrapperStyle}}>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @activeSnapPoint={{state.active}}
              @modal={{false}}
              aria-label="Outer"
              style={{state.rootStyle}}
              data-test-drawer
              as |drawer|
            >
              <input type="text" aria-label="Outer field" data-test-field />
              <button type="button" data-test-button>Button</button>
              <drawer.Nested>
                <MobileDrawer
                  @snapPoints={{SNAP_POINTS}}
                  @activeSnapPoint={{nested.active}}
                  @modal={{false}}
                  aria-label="Inner"
                  style={{nested.rootStyle}}
                  data-test-inner
                >
                  <input
                    type="text"
                    aria-label="Inner field"
                    data-test-inner-field
                  />
                </MobileDrawer>
              </drawer.Nested>
            </MobileDrawer>
          </div>
        {{/in-element}}
      </template>,
    );
    await settle();
    const outer = root();
    const inner = el('[data-test-inner]');

    el('[data-test-inner-field]').focus();
    viewport.height = HEIGHT - 300;
    state.shift = 250;
    nested.shift = 250;
    await settled();
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 1, 'one fill');
    assert.dom(inner).hasAttribute(KEYBOARD_ATTRIBUTE, '', 'the inner one');
    assert.dom(outer).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);

    el('[data-test-field]').focus();
    viewport.dispatchEvent(new Event('scroll'));
    assert.strictEqual(fills().length, 1, 'still one fill');
    assert.dom(outer).hasAttribute(KEYBOARD_ATTRIBUTE, '', 'now the outer one');
    assert.dom(inner).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);

    el('[data-test-inner-field]').focus();
    viewport.dispatchEvent(new Event('scroll'));
    assert.dom(inner).hasAttribute(KEYBOARD_ATTRIBUTE);

    // The keyboard's Done button: focus leaves the inner drawer for nothing.
    el('[data-test-inner-field]').blur();
    assert.strictEqual(fills().length, 0, 'every fill goes at once');
    assert.dom(outer).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);
    assert.dom(inner).doesNotHaveAttribute(KEYBOARD_ATTRIBUTE);

    // The inner drawer closes while the keyboard is open for the outer one.
    el('[data-test-field]').focus();
    viewport.dispatchEvent(new Event('resize'));
    assert.dom(outer).hasAttribute(KEYBOARD_ATTRIBUTE);
    nested.active = 0;
    await settle();
    assert.strictEqual(fills().length, 1);
    assert.dom(outer).hasAttribute(KEYBOARD_ATTRIBUTE);

    viewport.height = HEIGHT;
    state.shift = 0;
    nested.shift = 0;
    await settled();
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 0);
  });

  test('no fill where the root stays in place (other browsers), for a top drawer, an embedded drawer or a pinch zoom', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    el('[data-test-field]').focus();

    // Chrome: the visual viewport shrinks, the client coordinates don't move.
    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    assert.strictEqual(fills().length, 0, 'root not moved');

    // A pinch zoom moves the visual viewport too.
    viewport.scale = 2;
    await openKeyboard(state);
    assert.strictEqual(fills().length, 0, 'zoomed in');
    viewport.scale = 1;
    await closeKeyboard(state);

    state.embedded = true;
    await settled();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 0, 'embedded');
    await closeKeyboard(state);
    state.embedded = false;

    state.placement = 'top';
    await settle();
    el('[data-test-field]').focus();
    await openKeyboard(state);
    assert.strictEqual(fills().length, 0, 'top drawer');
    await closeKeyboard(state);
  });
});
