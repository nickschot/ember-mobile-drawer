import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { array } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// A drawer embedded in a 400 x 600 px container, at 40% (240px) of it, with
// content much taller than the container: a button at the top, a field
// with `autofocus` (when asked for) and a button at the end.

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = () => el('[data-test-drawer] > .mobile-drawer__tray');

/**
 * Focuses `element` as the keyboard (`visible`, with a focus ring) or a
 * pointer does: test events are not trusted, so they don't count for the
 * browser's `:focus-visible` heuristics. `focusVisible` isn't in
 * TypeScript's `FocusOptions` yet; the tests check `:focus-visible`.
 */
function focus(
  element: HTMLElement,
  visible: boolean,
  preventScroll = false,
): void {
  element.focus({ focusVisible: visible, preventScroll } as FocusOptions);
}

/**
 * Whether `element` is fully on screen in the drawer: inside both the tray
 * and the drawer's root, along the axis.
 */
function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const trayRect = tray().getBoundingClientRect();
  const root = el('[data-test-drawer]').getBoundingClientRect();
  const top = Math.max(trayRect.top, root.top);
  const bottom = Math.min(trayRect.bottom, root.bottom);
  return rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5;
}

class State {
  @tracked active = 1;
  @tracked modal: boolean | undefined;
  @tracked snapPoints: SnapPoint[] = [0, '40%', '100%'];
  @tracked autofocus = false;
  @tracked nestedShown = false;
  changes: number[] = [];
  opens = 0;
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };

  onOpen = () => this.opens++;
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const fillerStyle = htmlSafe('height: 1200px');
const nestedContentStyle = htmlSafe('height: 80px');

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <button type="button" data-test-trigger>Trigger</button>
        <MobileDrawer
          @snapPoints={{state.snapPoints}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          @onOpen={{state.onOpen}}
          @modal={{state.modal}}
          style="position: absolute"
          aria-label="Drawer"
          data-test-drawer
        >
          <button type="button" data-test-first>First</button>
          <div style={{fillerStyle}}></div>
          {{! template-lint-disable no-autofocus-attribute }}
          <input
            aria-label="Field"
            autofocus={{state.autofocus}}
            data-test-field
          />
          <button type="button" data-test-last>Last</button>
          {{#if state.nestedShown}}
            <MobileDrawer
              @snapPoints={{array 0 80}}
              @activeSnapPoint={{1}}
              @modal={{false}}
              style="position: absolute"
              aria-label="Nested"
              data-test-nested
            >
              <div style={{nestedContentStyle}}>
                <button type="button" data-test-nested-button>Nested</button>
              </div>
            </MobileDrawer>
          {{/if}}
        </MobileDrawer>
      </div>
    </template>,
  );
}

module(
  'Integration | Component | mobile-drawer | keyboard focus off screen',
  function (hooks) {
    setupRenderingTest(hooks);

    let clock: FakeClock;

    hooks.beforeEach(function () {
      clock = new FakeClock();
      drawerEnvironment.clock = clock;
      drawerEnvironment.prefersReducedMotion = () => false;
    });

    hooks.afterEach(function () {
      delete drawerEnvironment.clock;
      delete drawerEnvironment.prefersReducedMotion;
    });

    /** Renders pending changes and runs the animation they start. */
    async function settle() {
      await settled();
      clock.runUntilIdle();
      await settled();
    }

    async function setup(state: State) {
      await renderDrawer(state);
      await settle();
    }

    test('keyboard focus on an element off screen moves the drawer to its highest snap point', async function (assert) {
      const state = new State();
      await setup(state);
      const last = el('[data-test-last]');
      assert.false(isVisible(last), 'off screen at 40%');

      const before = tray().getBoundingClientRect().top;
      focus(last, true);
      assert.true(last.matches(':focus-visible'), 'keyboard focus');
      await settled();
      assert.deepEqual(state.changes, [2], 'asks for the highest snap point');
      // Chrome scrolls the root (`overflow: hidden`) to show the element,
      // which moves the whole drawer up at once.
      assert.strictEqual(
        el('[data-test-drawer]').scrollTop,
        0,
        'the root is back at its start',
      );
      assert.strictEqual(
        tray().getBoundingClientRect().top,
        before,
        'the tray starts its move from where it was',
      );
      assert.true(clock.pendingFrames > 0, 'and animates');

      clock.runUntilIdle();
      await settled();
      assert.dom('[data-test-drawer]').hasAttribute('data-expanded');
      assert.strictEqual(document.activeElement, last, 'keeps focus');
      assert.true(isVisible(last), 'on screen');
      assert.strictEqual(state.opens, 0, 'already open: no @onOpen');
    });

    test('the tray shows the element when it arrives, also after focus without scrolling', async function (assert) {
      const state = new State();
      await setup(state);
      const last = el('[data-test-last]');
      focus(last, true, true);
      assert.strictEqual(tray().scrollTop, 0, 'the browser did not scroll');
      await settled();
      assert.deepEqual(state.changes, [2]);
      assert.false(isVisible(last), 'not yet: the drawer is on its way');

      clock.runUntilIdle();
      await settled();
      assert.true(isVisible(last), 'on screen once it arrives');
      assert.true(tray().scrollTop > 0, 'the tray scrolled to it');
    });

    test('a drawer that opens moves to its highest snap point when its initial focus is off screen', async function (assert) {
      const state = new State();
      state.active = 0;
      state.autofocus = true;
      await renderDrawer(state);
      await settle();
      state.active = 1;
      await settle();

      const field = el('[data-test-field]');
      assert.strictEqual(document.activeElement, field, 'initial focus');
      assert.deepEqual(state.changes, [2]);
      assert.dom('[data-test-drawer]').hasAttribute('data-expanded');
      assert.true(isVisible(field), 'on screen');
    });

    test('a drawer that opens with keyboard focus on a visible first element stays at its snap point', async function (assert) {
      const state = new State();
      state.active = 0;
      await renderDrawer(state);
      await settle();
      focus(el('[data-test-trigger]'), true);
      state.active = 1;
      await settle();

      const first = el('[data-test-first]');
      assert.strictEqual(document.activeElement, first, 'initial focus');
      assert.true(first.matches(':focus-visible'), 'keyboard focus');
      assert.deepEqual(state.changes, []);
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-expanded');
    });

    test('pointer focus on an element off screen does not move the drawer', async function (assert) {
      const state = new State();
      await setup(state);
      const last = el('[data-test-last]');
      focus(last, false);
      assert.false(last.matches(':focus-visible'), 'no keyboard focus');
      await settle();
      assert.deepEqual(state.changes, []);
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-expanded');
    });

    test('keyboard focus on a visible element does not move the drawer', async function (assert) {
      const state = new State();
      await setup(state);
      const first = el('[data-test-first]');
      focus(el('[data-test-last]'), false);
      focus(first, true);
      assert.true(first.matches(':focus-visible'), 'keyboard focus');
      assert.true(isVisible(first), 'on screen');
      await settle();
      assert.deepEqual(state.changes, []);
    });

    test('with reduced motion the drawer jumps to its highest snap point', async function (assert) {
      drawerEnvironment.prefersReducedMotion = () => true;
      const state = new State();
      await renderDrawer(state);
      await settled();
      const last = el('[data-test-last]');
      focus(last, true, true);
      await settled();
      assert.strictEqual(clock.pendingFrames, 0, 'no animation');
      assert.deepEqual(state.changes, [2]);
      assert.dom('[data-test-drawer]').hasAttribute('data-expanded');
      assert.true(isVisible(last), 'on screen at once');
    });

    test('at the highest snap point nothing changes', async function (assert) {
      const state = new State();
      state.active = 2;
      await renderDrawer(state);
      await settle();
      const last = el('[data-test-last]');
      focus(last, true);
      assert.true(isVisible(last), 'the browser scrolled it into view');
      const position = tray().scrollTop;
      await settle();
      assert.deepEqual(state.changes, []);
      assert.strictEqual(tray().scrollTop, position, 'the tray stays');
    });

    test('a controlled drawer whose parent declines stays where it is', async function (assert) {
      const state = new State();
      await setup(state);
      state.accept = false;
      focus(el('[data-test-last]'), true);
      await settle();
      assert.deepEqual(state.changes, [2], 'asked');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-expanded');
    });

    test('a non-modal drawer moves too', async function (assert) {
      const state = new State();
      state.modal = false;
      await setup(state);
      const last = el('[data-test-last]');
      focus(last, true);
      await settle();
      assert.deepEqual(state.changes, [2]);
      assert.true(isVisible(last), 'on screen');
    });

    test('a drawer at its peek does not move', async function (assert) {
      const state = new State();
      state.snapPoints = ['40%', '100%'];
      state.active = 0;
      await setup(state);
      const last = el('[data-test-last]');
      focus(last, true);
      await settle();
      assert.deepEqual(state.changes, []);
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-expanded');
    });

    test('keyboard focus in a nested drawer does not move the drawer around it', async function (assert) {
      const state = new State();
      state.nestedShown = true;
      await setup(state);
      const button = el('[data-test-nested-button]');
      // Without scrolling: the browser would scroll the outer root to show it.
      focus(button, true, true);
      assert.strictEqual(document.activeElement, button, 'focused');
      assert.false(isVisible(button), 'off screen for the outer drawer');
      await settle();
      assert.deepEqual(state.changes, []);
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-expanded');
    });
  },
);
