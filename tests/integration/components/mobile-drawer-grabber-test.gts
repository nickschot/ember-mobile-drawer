import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  find,
  focus,
  render,
  settled,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { a11yAudit } from 'ember-a11y-testing/test-support';
import { pan } from 'ember-gesture-modifiers/test-support';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';
import '#src/themes/ios.css';

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const active = () => document.activeElement;

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const contentStyle = htmlSafe('height: 80px');
/** Tall enough for `pan()`, which pans across the element. */
const grabberStyle = htmlSafe('height: 40px');

class State {
  @tracked active: number | undefined = 1;
  @tracked snapPoints: SnapPoint[] = [0, 200, 400];
  @tracked handleOnly = false;
  @tracked label: string | undefined;
  @tracked snapPointLabels: (string | undefined)[] | undefined;
  @tracked focusable = true;
  @tracked nestedShown = false;
  @tracked nestedActive = 0;
  changes: number[] = [];
  dragStarts = 0;
  nestedChanges: number[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };

  onDragStart = () => this.dragStarts++;

  onNestedChange = (index: number) => {
    this.nestedChanges.push(index);
    this.nestedActive = index;
  };
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div class="mobile-drawer-theme-ios">
        <div style={{containerStyle}} data-test-container>
          <button type="button" data-test-trigger>Trigger</button>
          <MobileDrawer
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @handleOnly={{state.handleOnly}}
            @onDragStart={{state.onDragStart}}
            style="position: absolute"
            aria-labelledby="drawer-title"
            data-test-drawer
            as |drawer|
          >
            <drawer.Grabber
              @label={{state.label}}
              @snapPointLabels={{state.snapPointLabels}}
              class="mobile-drawer-theme-ios__grabber"
              style={{grabberStyle}}
              data-mobile-drawer-pinned
              data-test-grabber
            />
            <div style={{contentStyle}}>
              <h2 id="drawer-title">Title</h2>
              {{#if state.focusable}}
                <button type="button" data-test-first>First</button>
              {{/if}}
              <output data-test-active>{{drawer.activeSnapPoint}}</output>
            </div>
            {{#if state.nestedShown}}
              <MobileDrawer
                @snapPoints={{state.snapPoints}}
                @activeSnapPoint={{state.nestedActive}}
                @onSnapPointChange={{state.onNestedChange}}
                style="position: absolute"
                aria-label="Nested"
                data-test-nested
                as |nested|
              >
                <nested.Grabber
                  style={{grabberStyle}}
                  data-test-nested-grabber
                />
                <div style={{contentStyle}}></div>
              </MobileDrawer>
            {{/if}}
          </MobileDrawer>
        </div>
      </div>
    </template>,
  );
}

/** The text the status element announces, if any. */
const status = () =>
  el('[data-mobile-drawer-grabber-status]').textContent ?? '';

/** The grabber's description: the snap point the drawer is at. */
function description(selector = '[data-test-grabber]'): string {
  const id = el(selector).getAttribute('aria-describedby')!;
  return document.getElementById(id)?.textContent ?? '';
}

/** A click as a tap or a mouse click makes it (`detail` 1). */
function tapClick(element: HTMLElement): void {
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
  );
}

/** A touch tap on `element`: pointerdown, pointerup, then its click. */
function tap(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    pointerId: 7,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  element.dispatchEvent(new PointerEvent('pointerdown', init));
  element.dispatchEvent(new PointerEvent('pointerup', init));
  tapClick(element);
}

module('Integration | Component | mobile-drawer | Grabber', function (hooks) {
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

  test('is a labelled button described by the snap point', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();

    assert
      .dom('[data-test-grabber]')
      .hasTagName('button')
      .hasAttribute('type', 'button')
      .hasAttribute('aria-label', 'Sheet grabber')
      .hasAttribute('data-mobile-drawer-grabber')
      .hasClass('mobile-drawer-theme-ios__grabber', '...attributes apply');
    assert.strictEqual(description(), 'Collapsed');
    assert
      .dom('[data-mobile-drawer-grabber-status]')
      .hasAttribute('role', 'status')
      .hasText('', 'nothing to announce yet');

    state.active = 2;
    await settle();
    assert.strictEqual(description(), 'Expanded', 'follows the drawer');

    state.label = 'Resize';
    state.snapPointLabels = ['Hidden', 'Half', undefined];
    await settle();
    assert.dom('[data-test-grabber]').hasAttribute('aria-label', 'Resize');
    assert.strictEqual(description(), 'Expanded', 'missing labels: default');
    state.active = 1;
    await settle();
    assert.strictEqual(description(), 'Half');
  });

  test('the theme draws it like the <div> grabber', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    const grabber = el('[data-test-grabber]');
    grabber.style.height = '';
    const style = getComputedStyle(grabber);
    assert.strictEqual(style.borderTopWidth, '0px', 'no button border');
    assert.strictEqual(style.height, '4px', 'the bar');
    assert.strictEqual(grabber.offsetHeight, 14, '5px + the 4px bar + 5px');
    assert.strictEqual(
      grabber.getBoundingClientRect().width,
      el('[data-test-drawer] .mobile-drawer__tray').getBoundingClientRect()
        .width,
      'as wide as the tray',
    );
    assert.strictEqual(style.position, 'sticky');
    assert.strictEqual(getComputedStyle(grabber, '::before').width, '58px');
  });

  test('a click cycles through the open snap points and announces each', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    const grabber = el('[data-test-grabber]');

    tapClick(grabber);
    await settle();
    assert.dom('[data-test-active]').hasText('2', 'to the next larger one');
    assert.strictEqual(status(), 'Expanded', 'announced');
    assert.strictEqual(description(), 'Expanded');
    const first = el('[data-mobile-drawer-grabber-status]').firstChild;

    tapClick(grabber);
    await settle();
    assert.dom('[data-test-active]').hasText('1', 'from the largest back down');
    assert.strictEqual(status(), 'Collapsed');

    tapClick(grabber);
    await settle();
    assert.dom('[data-test-active]').hasText('2');
    assert.notStrictEqual(
      el('[data-mobile-drawer-grabber-status]').firstChild,
      first,
      'each announcement is a new text node, also for the same text',
    );
    assert.deepEqual(state.changes, [2, 1, 2], 'never closes');
  });

  test('three open snap points, in any order', async function (assert) {
    const state = new State();
    state.snapPoints = [400, 0, 100, 200];
    state.active = 2;
    await renderDrawer(state);
    await settle();
    const grabber = el('[data-test-grabber]');
    const seen: string[] = [description()];
    for (let i = 0; i < 3; i++) {
      tapClick(grabber);
      await settle();
      seen.push(`${state.active}: ${status()}`);
    }
    assert.deepEqual(seen, [
      'Collapsed',
      '3: Partly expanded',
      '0: Expanded',
      '2: Collapsed',
    ]);
  });

  test('a peek drawer cycles through its peek too', async function (assert) {
    const state = new State();
    state.snapPoints = [120, 400];
    state.active = 0;
    await renderDrawer(state);
    await settle();
    assert.strictEqual(description(), 'Collapsed');
    tapClick(el('[data-test-grabber]'));
    await settle();
    assert.dom('[data-test-active]').hasText('1');
    tapClick(el('[data-test-grabber]'));
    await settle();
    assert.dom('[data-test-active]').hasText('0');
  });

  test('with one open snap point it does nothing', async function (assert) {
    const state = new State();
    state.snapPoints = [0, 'content'];
    await renderDrawer(state);
    await settle();
    assert.strictEqual(description(), 'Expanded');
    tapClick(el('[data-test-grabber]'));
    await settle();
    assert.deepEqual(state.changes, [], 'no change requested');
    assert.strictEqual(status(), '', 'nothing announced');
  });

  test('the status text goes when the drawer moves in another way', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    const grabber = el('[data-test-grabber]');

    tapClick(grabber);
    await settle();
    assert.strictEqual(status(), 'Expanded', 'announced');

    // The app (as a drag or the backdrop does) moves the drawer.
    state.active = 1;
    await settle();
    assert.strictEqual(status(), '', 'cleared: no stale text');
    state.active = 2;
    await settle();
    assert.strictEqual(status(), '', 'and it does not come back');

    // Escape closes it: also cleared.
    tapClick(grabber);
    await settle();
    assert.strictEqual(status(), 'Collapsed');
    await triggerKeyEvent(grabber, 'keydown', 'Escape');
    await settle();
    assert.dom('[data-test-active]').hasText('0');
    assert.strictEqual(status(), '');
  });

  test('a controlled parent that answers later: announced on arrival', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    state.accept = false;
    tapClick(el('[data-test-grabber]'));
    await settle();
    assert.strictEqual(status(), '', 'not there yet');
    state.active = 2;
    await settle();
    assert.strictEqual(status(), 'Expanded', 'announced when it gets there');
  });

  test('a controlled parent that refuses: nothing announced', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    state.accept = false;
    tapClick(el('[data-test-grabber]'));
    await settle();
    // The app moves the drawer elsewhere, then to the asked snap point.
    state.active = 0;
    await settle();
    state.active = 2;
    await settle();
    assert.strictEqual(status(), '', 'the old request is not announced');
  });

  test('a controlled drawer is asked to move', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    state.accept = false;
    tapClick(el('[data-test-grabber]'));
    await settle();
    assert.deepEqual(state.changes, [2]);
    assert.dom('[data-test-active]').hasText('1', 'the parent decides');
  });

  test('keyboard: in the tab order, activated by Enter and Space', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await focus('[data-test-trigger]');
    state.active = 1;
    await settle();
    assert.strictEqual(
      active(),
      el('[data-test-first]'),
      'opening does not focus the grabber',
    );

    // Tab from the last tabbable element wraps to the first: the grabber.
    await triggerKeyEvent('[data-test-first]', 'keydown', 'Tab');
    const grabber = el('[data-test-grabber]');
    assert.strictEqual(active(), grabber, 'Tab reaches it');

    // Enter and Space on a focused <button> fire a click with `detail` 0;
    // synthetic key events don't, so dispatch that click.
    grabber.click();
    await settle();
    assert.dom('[data-test-active]').hasText('2');
    assert.strictEqual(active(), grabber, 'focus stays on it');
    grabber.click();
    await settle();
    assert.dom('[data-test-active]').hasText('1');

    // Escape on it still closes the drawer.
    await triggerKeyEvent(grabber, 'keydown', 'Escape');
    await settle();
    assert.dom('[data-test-active]').hasText('0');
  });

  test('initial focus falls back to the tray when only the grabber is focusable', async function (assert) {
    const state = new State();
    state.focusable = false;
    await renderDrawer(state);
    await focus('[data-test-trigger]');
    state.active = 1;
    await settle();
    assert.strictEqual(active(), el('[data-test-drawer] .mobile-drawer__tray'));
    state.active = 0;
    await settle();
  });

  for (const handleOnly of [false, true]) {
    const mode = handleOnly ? 'with @handleOnly' : 'without @handleOnly';

    test(`${mode}: a drag on it drags, and its click doesn't cycle`, async function (assert) {
      const state = new State();
      state.handleOnly = handleOnly;
      state.active = 2;
      await renderDrawer(state);
      await settle();
      const grabber = el('[data-test-grabber]');
      assert.strictEqual(grabber.style.touchAction, 'pan-x', 'a handle');

      const tray = el('[data-test-drawer] .mobile-drawer__tray');
      const before = tray.getBoundingClientRect().top;
      let lowest = before;
      const onMove = () =>
        (lowest = Math.max(lowest, tray.getBoundingClientRect().top));
      document.addEventListener('pointermove', onMove);
      try {
        await pan(grabber, 'down');
      } finally {
        document.removeEventListener('pointermove', onMove);
      }
      assert.strictEqual(state.dragStarts, 1, 'a drag started');
      assert.true(
        lowest > before + 10,
        `the tray followed (${lowest - before}px)`,
      );
      // A browser may still fire a click on the button after the drag.
      tapClick(grabber);
      await settle();
      assert.deepEqual(state.changes, [], 'a short drag: no cycle, no move');
      assert.dom('[data-test-active]').hasText('2');
      assert.strictEqual(status(), '', 'nothing announced');

      // A tap after that counts again.
      tap(grabber);
      await settle();
      assert.deepEqual(state.changes, [1], 'a tap cycles');
      assert.strictEqual(status(), 'Collapsed');
    });
  }

  test('a nested drawer’s grabber moves only that drawer', async function (assert) {
    const state = new State();
    state.active = 2;
    state.nestedShown = true;
    state.nestedActive = 1;
    await renderDrawer(state);
    await settle();
    tapClick(el('[data-test-nested-grabber]'));
    await settle();
    assert.deepEqual(state.nestedChanges, [2]);
    assert.deepEqual(state.changes, [], 'the outer drawer stays');
    assert.strictEqual(description('[data-test-nested-grabber]'), 'Expanded');
    state.nestedActive = 0;
    await settle();
  });

  test('passes an axe audit, closed and open', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);
    await settle();
    await a11yAudit(el('[data-test-container]'));
    state.active = 1;
    await settle();
    tapClick(el('[data-test-grabber]'));
    await settle();
    await a11yAudit(el('[data-test-container]'));
    assert.ok(true, 'no violations');
    state.active = 0;
    await settle();
  });
});
