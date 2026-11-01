import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  clearRender,
  find,
  focus,
  render,
  settled,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { bodyScrollLocks } from '#src/-private/modal/scroll-lock.ts';
import { TouchPointer } from '#src/-private/gesture/touch-pointer.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

/**
 * A nested drawer rendered outside the outer drawer's tray with the yielded
 * `Nested` (#118). The drawers are embedded in a 400 x 600 px container.
 */

const OUTER_SNAP_POINTS: SnapPoint[] = [0, '40%', '100%'];
const INNER_SNAP_POINTS: SnapPoint[] = [0, 200];

class State {
  @tracked outer = 1;
  @tracked inner = 0;
  @tracked nestedShown = true;
  /** Render the nested drawer in `[data-test-layer]` instead. */
  @tracked inLayer = false;
  @tracked layer?: Element;

  setOuter = (index: number) => (this.outer = index);
  setInner = (index: number) => (this.inner = index);
  openInner = () => (this.inner = 1);
}

class ThreeLevels {
  @tracked a = 1;
  @tracked b = 1;
  @tracked c = 0;
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px; overflow: hidden',
);
const contentStyle = htmlSafe('height: 600px');
const innerContentStyle = htmlSafe('height: 200px');
// An app element that reuses the drawer's class name (#117 review, N1).
const fakeStyle = htmlSafe(
  'position: static; height: 100px; pointer-events: auto; visibility: visible',
);

async function renderNested(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <button type="button" data-test-trigger>Trigger</button>
        <div data-test-layer></div>
        <MobileDrawer
          @snapPoints={{OUTER_SNAP_POINTS}}
          @activeSnapPoint={{state.outer}}
          @onSnapPointChange={{state.setOuter}}
          aria-label="Outer"
          style="position: absolute"
          data-test-outer
          as |outer|
        >
          <div style={{contentStyle}} data-test-outer-content>
            <button
              type="button"
              data-test-open-inner
              {{on "click" state.openInner}}
            >Details</button>
            <div class="mobile-drawer" style={{fakeStyle}} data-test-fake>
              Not a drawer
            </div>
            {{#if state.nestedShown}}
              <outer.Nested @destination={{state.layer}}>
                <MobileDrawer
                  @snapPoints={{INNER_SNAP_POINTS}}
                  @activeSnapPoint={{state.inner}}
                  @onSnapPointChange={{state.setInner}}
                  aria-label="Inner"
                  style="position: absolute"
                  data-test-inner
                >
                  <div style={{innerContentStyle}} data-test-inner-content>
                    <button type="button" data-test-inner-button>Inner</button>
                  </div>
                </MobileDrawer>
              </outer.Nested>
            {{/if}}
          </div>
        </MobileDrawer>
      </div>
    </template>,
  );
}

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = (drawer: string) =>
  el(`${drawer} > .mobile-drawer__sheet > .mobile-drawer__tray`);
const active = () => document.activeElement;

/** Where the outer tray is on screen. */
const outerTop = () => tray('[data-test-outer]').getBoundingClientRect().top;

/** The middle of `element`, in client px. */
function middleOf(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

module('Integration | Component | mobile-drawer | Nested', function (hooks) {
  setupRenderingTest(hooks);

  let clock: FakeClock;

  hooks.beforeEach(function () {
    clock = new FakeClock();
    drawerEnvironment.clock = clock;
    drawerEnvironment.prefersReducedMotion = () => false;
  });

  hooks.afterEach(function (assert) {
    delete drawerEnvironment.clock;
    delete drawerEnvironment.prefersReducedMotion;
    // Nothing outlives the drawers of a test.
    assert.strictEqual(bodyScrollLocks(), 0, 'no scroll lock left behind');
    assert.strictEqual(
      document.querySelectorAll('[inert]').length,
      0,
      'nothing left inert',
    );
  });

  /** Renders pending changes and runs the animation they start. */
  async function settle() {
    await settled();
    clock.runUntilIdle();
    await settled();
  }

  async function closeAll(state: State) {
    state.inner = 0;
    state.outer = 0;
    await settle();
  }

  test('renders the block outside the tray, next to the drawer', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();

    const portal = el('.mobile-drawer-nested');
    assert.strictEqual(
      portal.parentElement,
      el('[data-test-container]'),
      'in the parent element of the outer drawer',
    );
    assert.false(
      el('[data-test-outer]').contains(el('[data-test-inner]')),
      'not inside the outer drawer',
    );
    assert.strictEqual(getComputedStyle(portal).display, 'contents');

    state.nestedShown = false;
    await settle();
    assert.dom('.mobile-drawer-nested').doesNotExist('removed with its block');
    await closeAll(state);
  });

  test('the nested drawer shows while the outer drawer is at 40%', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();
    await focus('[data-test-open-inner]');
    state.inner = 1;
    await settle();

    const container = el('[data-test-container]').getBoundingClientRect();
    const sheet = tray('[data-test-inner]').getBoundingClientRect();
    assert.true(sheet.height > 0, 'the sheet has a size');
    assert.true(
      sheet.top >= container.top - 1 && sheet.bottom <= container.bottom + 1,
      `the sheet is on screen (${sheet.top}-${sheet.bottom} in ${container.top}-${container.bottom})`,
    );
    assert.true(
      sheet.bottom > container.bottom - 2,
      'at the bottom of the screen, not of the outer tray',
    );
    const { x, y } = middleOf(el('[data-test-inner-button]'));
    assert.strictEqual(
      document.elementFromPoint(x, y),
      el('[data-test-inner-button]'),
      'its content can be tapped',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-inner-button]')).visibility,
      'visible',
    );
    await closeAll(state);
  });

  test('modal stack, inert, data-nested and focus', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();
    assert.dom('[data-test-outer]').hasAttribute('aria-modal', 'true');
    assert.dom('[data-test-trigger]').hasAttribute('inert', '');
    assert.notOk(
      el('.mobile-drawer-nested').closest('[inert]'),
      'the portal of the nested drawer is not inert',
    );

    await focus('[data-test-open-inner]');
    state.inner = 1;
    await settle();
    assert.dom('[data-test-inner]').hasAttribute('aria-modal', 'true');
    assert.strictEqual(active(), el('[data-test-inner-button]'));
    assert.dom('[data-test-outer]').hasAttribute('inert', '');
    assert.notOk(
      el('[data-test-inner-button]').closest('[inert]'),
      'the nested drawer is not inert',
    );
    assert.dom('[data-test-outer]').hasAttribute('data-nested');
    assert.dom('[data-test-inner]').doesNotHaveAttribute('data-nested');
    assert.strictEqual(bodyScrollLocks(), 2);

    // The nested drawer is in front: Tab wraps in it.
    await triggerKeyEvent('[data-test-inner-button]', 'keydown', 'Tab');
    assert.strictEqual(active(), el('[data-test-inner-button]'));

    // Escape closes the nested drawer first, also from <body>.
    (document.activeElement as HTMLElement).blur();
    await triggerKeyEvent(document.body, 'keydown', 'Escape');
    await settle();
    assert.strictEqual(state.inner, 0, 'the nested drawer closes');
    assert.strictEqual(state.outer, 1, 'the outer drawer stays');
    assert.dom('[data-test-outer]').doesNotHaveAttribute('inert');
    assert.dom('[data-test-outer]').doesNotHaveAttribute('data-nested');
    assert.dom('[data-test-trigger]').hasAttribute('inert', '');
    assert.strictEqual(
      active(),
      el('[data-test-open-inner]'),
      'focus returns to the button in the outer drawer',
    );

    await triggerKeyEvent(document.body, 'keydown', 'Escape');
    await settle();
    assert.strictEqual(state.outer, 0, 'then the outer drawer closes');
    assert.dom('[inert]').doesNotExist();
  });

  test('an outer drawer that opens further stays below the open nested drawer', async function (assert) {
    const state = new State();
    state.outer = 1;
    await renderNested(state);
    await settle();
    state.inner = 1;
    await settle();
    // The outer drawer opens further while the nested drawer is open.
    state.outer = 2;
    await settle();
    assert.dom('[data-test-inner]').hasAttribute('aria-modal', 'true');
    assert.dom('[data-test-outer]').hasAttribute('data-nested');
    await triggerKeyEvent(document.body, 'keydown', 'Escape');
    await settle();
    assert.strictEqual(state.inner, 0, 'the nested drawer is still in front');
    assert.strictEqual(state.outer, 2);
    await closeAll(state);
  });

  test('a closing outer drawer closes the nested drawer with it and frees the page', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();
    await focus('[data-test-open-inner]');
    state.inner = 1;
    await settle();

    // E.g. app code resets the outer drawer only.
    state.outer = 0;
    await settled();
    assert.strictEqual(
      state.inner,
      0,
      'the nested drawer closes when the outer drawer starts to close',
    );
    const top = () => tray('[data-test-inner]').getBoundingClientRect().top;
    const start = top();
    clock.frame();
    clock.frame();
    clock.frame();
    assert.true(top() > start, 'it moves away with the outer drawer');
    await settle();
    assert.dom('[data-test-outer]').hasAttribute('data-closed');
    assert.dom('[data-test-inner]').hasAttribute('data-closed');
    assert.dom('.mobile-drawer-nested').hasAttribute('data-closed');
    assert.dom('[data-test-inner]').doesNotHaveAttribute('aria-modal');
    assert.dom('[inert]').doesNotExist('nothing inert');
    assert.strictEqual(bodyScrollLocks(), 0, 'nothing locked');
    assert.notStrictEqual(
      active(),
      el('[data-test-inner-button]'),
      'focus left the closed drawer',
    );

    // Opening the outer drawer again doesn't open the nested drawer.
    state.outer = 1;
    await settle();
    assert.dom('.mobile-drawer-nested').doesNotHaveAttribute('data-closed');
    assert.dom('[data-test-inner]').hasAttribute('data-closed');
    assert.strictEqual(state.inner, 0);
    await closeAll(state);
  });

  test('a controlled nested drawer that stays open hides with the outer drawer', async function (assert) {
    const state = new State();
    // The parent ignores the nested drawer's close.
    state.setInner = () => state.inner;
    await renderNested(state);
    await settle();
    state.inner = 1;
    await settle();
    state.outer = 0;
    await settle();
    assert.strictEqual(state.inner, 1, 'the app kept it open');
    assert.dom('.mobile-drawer-nested').hasAttribute('data-closed');
    assert.strictEqual(
      getComputedStyle(el('[data-test-inner-button]')).visibility,
      'hidden',
      'hidden with the outer drawer',
    );
    assert.dom('[data-test-inner]').doesNotHaveAttribute('aria-modal');
    // It comes back with the outer drawer, as a drawer in the tray.
    state.outer = 1;
    await settle();
    assert.dom('[data-test-inner]').hasAttribute('aria-modal', 'true');
    await closeAll(state);
  });

  test('three levels: Nested of a drawer inside another tray renders outside every tray', async function (assert) {
    const levels = new ThreeLevels();
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{containerStyle}} data-test-container>
          <MobileDrawer
            @snapPoints={{OUTER_SNAP_POINTS}}
            @activeSnapPoint={{levels.a}}
            aria-label="A"
            style="position: absolute"
            data-test-a
          >
            <div style={{innerContentStyle}}>
              <MobileDrawer
                @snapPoints={{INNER_SNAP_POINTS}}
                @activeSnapPoint={{levels.b}}
                @modal={{false}}
                aria-label="B"
                style="position: absolute"
                data-test-b
                as |b|
              >
                <div style={{innerContentStyle}}>B</div>
                <b.Nested>
                  <MobileDrawer
                    @snapPoints={{INNER_SNAP_POINTS}}
                    @activeSnapPoint={{levels.c}}
                    aria-label="C"
                    style="position: absolute"
                    data-test-c
                  >
                    <div style={{innerContentStyle}}>
                      <button type="button" data-test-c-button>C</button>
                    </div>
                  </MobileDrawer>
                </b.Nested>
              </MobileDrawer>
            </div>
          </MobileDrawer>
        </div>
      </template>,
    );
    await settle();
    levels.c = 1;
    await settle();

    assert.strictEqual(
      el('[data-test-c]').closest('.mobile-drawer-nested')!.parentElement,
      el('[data-test-container]'),
      'next to A, not in its tray',
    );
    const container = el('[data-test-container]').getBoundingClientRect();
    const sheet = tray('[data-test-c]').getBoundingClientRect();
    assert.true(
      sheet.height > 0 &&
        sheet.top >= container.top - 1 &&
        sheet.bottom <= container.bottom + 1,
      `C's sheet is on screen while A is at 40% (${sheet.top}-${sheet.bottom} in ${container.top}-${container.bottom})`,
    );
    const { x, y } = middleOf(el('[data-test-c-button]'));
    assert.strictEqual(
      document.elementFromPoint(x, y),
      el('[data-test-c-button]'),
    );
    assert.dom('[data-test-c]').hasAttribute('aria-modal', 'true');
    assert.dom('[data-test-a]').hasAttribute('data-nested');

    levels.c = 0;
    levels.b = 0;
    levels.a = 0;
    await settle();
  });

  test('@destination: a portal in an element that is inert already is not inert', async function (assert) {
    const state = new State();
    state.nestedShown = false;
    await renderNested(state);
    await settle();
    assert.dom('[data-test-layer]').hasAttribute('inert', '');

    state.layer = el('[data-test-layer]');
    state.nestedShown = true;
    await settle();
    assert.strictEqual(
      el('.mobile-drawer-nested').parentElement,
      el('[data-test-layer]'),
      'in the destination',
    );
    assert.notOk(
      el('[data-test-inner]').closest('[inert]'),
      'the nested drawer is not inert',
    );
    assert.dom('[data-test-trigger]').hasAttribute('inert', '');

    state.inner = 1;
    await settle();
    assert.dom('[data-test-inner]').hasAttribute('aria-modal', 'true');
    assert.dom('[data-test-outer]').hasAttribute('inert', '');

    // Without the portal the layer is inert again.
    state.inner = 0;
    await settle();
    state.nestedShown = false;
    await settle();
    assert.dom('[data-test-layer]').hasAttribute('inert', '');
    await closeAll(state);
  });

  test('a drag in the nested drawer does not move the outer drawer', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();
    state.inner = 1;
    await settle();

    const start = outerTop();
    const content = el('[data-test-inner-content]');
    const { x, y } = middleOf(content);
    const finger = new TouchPointer(content, x, y);
    finger.down();
    const positions: number[] = [];
    for (let i = 0; i < 60; i++) {
      finger.move(0, 4);
      clock.frame();
      positions.push(outerTop());
    }
    finger.up();
    clock.runUntilIdle();
    await settled();
    assert.true(
      positions.every((top) => top === start),
      'the outer drawer stays where it was',
    );
    assert.strictEqual(state.inner, 0, 'the nested drawer closes');
    assert.strictEqual(state.outer, 1, 'the outer drawer stays');
    await closeAll(state);
  });

  test('an element with the class name mobile-drawer in the tray is not a nested drawer', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();

    const start = outerTop();
    const fake = el('[data-test-fake]');
    const { x, y } = middleOf(fake);
    const finger = new TouchPointer(fake, x, y);
    finger.down();
    for (let i = 0; i < 20; i++) {
      finger.move(0, 4);
      clock.frame();
    }
    assert.true(outerTop() > start, 'the outer drawer moves');
    finger.up();
    clock.runUntilIdle();
    await settled();
    await closeAll(state);
  });

  test('teardown of the outer drawer removes the nested drawer', async function (assert) {
    const state = new State();
    await renderNested(state);
    await settle();
    state.inner = 1;
    await settle();
    await clearRender();
    assert.dom('.mobile-drawer-nested').doesNotExist();
    assert.dom('[data-test-inner]').doesNotExist();
  });
});
