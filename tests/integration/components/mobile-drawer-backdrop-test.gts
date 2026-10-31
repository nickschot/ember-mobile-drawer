import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// The drawer is embedded in a 400 x 600 px container with a page button
// behind it that fills the container. The snap points resolve to 0, 200 and
// 400 px, so the top 200 px of the container are never covered by the tray.
const SNAP_POINTS: SnapPoint[] = [0, 200, 400];

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const backdrop = () => el('.mobile-drawer__backdrop');

const opacity = () => Number(getComputedStyle(backdrop()).opacity);

/** Screen coordinates of `x`/`y` (drawer px) inside the container. */
function point(x: number, y: number): { clientX: number; clientY: number } {
  const container = el('[data-test-container]');
  const rect = container.getBoundingClientRect();
  const scale = rect.width / container.offsetWidth;
  return { clientX: rect.left + x * scale, clientY: rect.top + y * scale };
}

/** The element a tap at `x`/`y` (drawer px) in the container would hit. */
function hit(x = 200, y = 50): Element | null {
  const { clientX, clientY } = point(x, y);
  return document.elementFromPoint(clientX, clientY);
}

/**
 * Sends the events of a pointer that goes down on the backdrop at
 * (200, 50), moves to `moves` (offsets from there, in screen px) and lifts,
 * followed by the click a browser sends for it, unless `cancel`.
 */
function gesture(
  moves: [number, number][],
  {
    pointerType = 'touch',
    cancel = false,
  }: { pointerType?: string; cancel?: boolean } = {},
): void {
  const start = point(200, 50);
  const target = backdrop();
  const pointer = (type: string, dx = 0, dy = 0) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        pointerType,
        isPrimary: true,
        clientX: start.clientX + dx,
        clientY: start.clientY + dy,
      }),
    );
  pointer('pointerdown');
  let [dx, dy] = [0, 0];
  for ([dx, dy] of moves) pointer('pointermove', dx, dy);
  if (cancel) {
    pointer('pointercancel', dx, dy);
    return;
  }
  pointer('pointerup', dx, dy);
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: start.clientX + dx,
      clientY: start.clientY + dy,
    }),
  );
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const pageStyle = htmlSafe('position: absolute; inset: 0');
const contentStyle = htmlSafe('height: 80px');
const maxOpacityStyle = (value: number | undefined) =>
  htmlSafe(
    value === undefined ? '' : `--mobile-drawer-backdrop-opacity: ${value}`,
  );

class State {
  @tracked active: number | undefined = 2;
  @tracked backdrop: boolean | undefined;
  @tracked closeOnBackdropClick: boolean | undefined;
  @tracked modal: boolean | undefined;
  @tracked maxOpacity: number | undefined;
  changes: number[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;
  pageClicks = 0;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };

  onPageClick = () => this.pageClicks++;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <button
          type="button"
          style={{pageStyle}}
          data-test-page
          {{on "click" state.onPageClick}}
        >Page</button>
        <div style={{maxOpacityStyle state.maxOpacity}}>
          <MobileDrawer
            @snapPoints={{SNAP_POINTS}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @backdrop={{state.backdrop}}
            @closeOnBackdropClick={{state.closeOnBackdropClick}}
            @modal={{state.modal}}
            aria-label="Drawer"
            style="position: absolute"
            data-test-drawer
            as |drawer|
          >
            <div style={{contentStyle}}>
              <button type="button" data-test-open {{on "click" drawer.open}}>
                Open
              </button>
              <output data-test-active>{{drawer.activeSnapPoint}}</output>
            </div>
          </MobileDrawer>
        </div>
      </div>
    </template>,
  );
}

module('Integration | Component | mobile-drawer | backdrop', function (hooks) {
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

  test('the opacity follows the drawer to each snap point', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    for (const [index, expected] of [0, 0.2, 0.4].entries()) {
      state.active = index;
      await settle();
      assert.true(
        Math.abs(opacity() - expected) < 1e-6,
        `snap point ${index}: ${opacity()} is ${expected}`,
      );
    }

    state.maxOpacity = 0.8;
    await settled();
    assert.true(
      Math.abs(opacity() - 0.8) < 1e-6,
      '--mobile-drawer-backdrop-opacity sets the max opacity',
    );

    state.active = 1;
    await settled();
    clock.frame();
    clock.frame();
    assert.true(
      opacity() > 0.4 && opacity() < 0.8,
      `follows every frame between snap points (${opacity()})`,
    );
    await settle();
    assert.true(Math.abs(opacity() - 0.4) < 1e-6, 'half open');
  });

  test('uncontrolled, a tap on the backdrop closes the drawer', async function (assert) {
    const state = new State();
    state.active = undefined;
    await renderDrawer(state);
    await click('[data-test-open]');
    await settle();
    assert.dom('[data-test-active]').hasText('2');

    gesture([[3, 4]]);
    await settle();

    assert.deepEqual(state.changes, [2, 0]);
    assert.dom('[data-test-active]').hasText('0');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert.strictEqual(state.pageClicks, 0, 'the page got no click');
  });

  test('controlled, a tap on the backdrop asks the parent', async function (assert) {
    const state = new State();
    state.accept = false;
    await renderDrawer(state);

    await click('.mobile-drawer__backdrop');
    await settle();
    assert.deepEqual(state.changes, [0], 'asks to close');
    assert.dom('[data-test-active]').hasText('2', 'the parent said no');
    assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');

    state.accept = true;
    await click('.mobile-drawer__backdrop');
    await settle();
    assert.deepEqual(state.changes, [0, 0]);
    assert.dom('[data-test-active]').hasText('0');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
  });

  test('a tap while the drawer opens turns it around', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);
    state.active = 2;
    await settled();
    clock.frame();
    clock.frame();
    assert.true(opacity() > 0, 'opening');

    gesture([]);
    await settle();
    assert.deepEqual(state.changes, [0]);
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
  });

  for (const pointerType of ['touch', 'mouse']) {
    test(`${pointerType}: a drag that starts on the backdrop is not a tap`, async function (assert) {
      const state = new State();
      await renderDrawer(state);

      gesture(
        [
          [0, 6],
          [0, 30],
        ],
        { pointerType },
      );
      await settle();
      assert.deepEqual(state.changes, [], 'not closed after a drag');

      // Out and back again: still a drag.
      gesture(
        [
          [40, 0],
          [2, 0],
        ],
        { pointerType },
      );
      await settle();
      assert.deepEqual(state.changes, [], 'not closed after a round trip');

      // A pointer the browser took over (e.g. to scroll) gets no click.
      gesture([], { pointerType, cancel: true });
      await settle();
      assert.deepEqual(state.changes, [], 'not closed after a cancel');

      // A little wobble is still a tap.
      gesture(
        [
          [4, 3],
          [6, 5],
        ],
        { pointerType },
      );
      await settle();
      assert.deepEqual(state.changes, [0], 'closed after a tap');
      assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    });
  }

  test('a pointer whose click never reaches the backdrop leaves no state behind', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    const tray = el('.mobile-drawer__tray');
    const root = el('[data-test-drawer]');
    const start = point(200, 50);
    const end = point(200, 500);
    const pointer = (target: HTMLElement, type: string, at = start) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          clientX: at.clientX,
          clientY: at.clientY,
        }),
      );

    // A mouse dragged from the backdrop onto the tray: the browser sends the
    // click to their common ancestor, the root, not to the backdrop.
    pointer(backdrop(), 'pointerdown');
    pointer(tray, 'pointermove', end);
    pointer(tray, 'pointerup', end);
    root.dispatchEvent(new MouseEvent('click', { bubbles: true, ...end }));
    await settle();
    assert.deepEqual(state.changes, [], 'the drag did not close it');

    // A click without a pointer (e.g. assistive technology) still closes.
    backdrop().click();
    await settle();
    assert.deepEqual(state.changes, [0], 'the next click closes');

    // Same after a touch the browser cancelled to scroll.
    state.active = 2;
    await settle();
    gesture([[0, 30]], { cancel: true });
    backdrop().click();
    await settle();
    assert.deepEqual(state.changes, [0, 0], 'a click after a cancel closes');
  });

  test('a touch on the backdrop does not hold a running animation', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);
    state.active = 2;
    await settled();
    clock.frame();

    const start = point(200, 50);
    backdrop().dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 3,
        pointerType: 'touch',
        isPrimary: true,
        ...start,
      }),
    );
    assert.true(clock.pendingFrames > 0, 'still animating');
    backdrop().dispatchEvent(
      new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId: 3,
        pointerType: 'touch',
        isPrimary: true,
        ...start,
      }),
    );
    await settle();
    assert.dom('[data-test-active]').hasText('2');
    assert.true(Math.abs(opacity() - 0.4) < 1e-6, 'fully open');
  });

  test('@closeOnBackdropClick={{false}} keeps the drawer open on a tap', async function (assert) {
    const state = new State();
    state.closeOnBackdropClick = false;
    await renderDrawer(state);

    gesture([]);
    await click('.mobile-drawer__backdrop');
    await settle();
    assert.deepEqual(state.changes, []);
    assert.dom('[data-test-active]').hasText('2');
    assert.strictEqual(hit(), backdrop(), 'the backdrop still blocks the page');
    assert.strictEqual(state.pageClicks, 0);

    state.closeOnBackdropClick = true;
    await settled();
    await click('.mobile-drawer__backdrop');
    await settle();
    assert.deepEqual(state.changes, [0], 'can be turned back on');
  });

  test('@backdrop={{false}} renders no backdrop and leaves the page interactive', async function (assert) {
    const state = new State();
    state.backdrop = false;
    // Non-modal: a modal drawer makes the page inert, backdrop or not.
    state.modal = false;
    state.active = 0;
    await renderDrawer(state);
    assert.dom('.mobile-drawer__backdrop').doesNotExist();

    state.active = 2;
    await settle();
    assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
    assert.strictEqual(hit(), el('[data-test-page]'), 'the page is hit');
    assert.strictEqual(
      hit(200, 500),
      el('[data-test-open]').closest('.mobile-drawer__tray'),
      'the tray still is',
    );

    // Turning it on shows it at the current progress right away.
    state.backdrop = true;
    await settled();
    assert.dom('[data-test-drawer] > .mobile-drawer__backdrop').exists();
    assert.true(Math.abs(opacity() - 0.4) < 1e-6, 'at the current progress');
    assert.strictEqual(hit(), backdrop(), 'and blocks the page');

    // And off again mid-animation without errors.
    state.active = 1;
    await settled();
    clock.frame();
    state.backdrop = false;
    await settle();
    assert.dom('.mobile-drawer__backdrop').doesNotExist();
    assert.dom('[data-test-active]').hasText('1');
  });

  test('a closed drawer, or one at progress 0, never blocks the page', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert.strictEqual(hit(), el('[data-test-page]'), 'closed');
    assert.strictEqual(backdrop().style.pointerEvents, 'none');

    // Shown but at progress 0 (e.g. the last frame of closing, before
    // `data-closed` is set): still not in the way.
    el('[data-test-drawer]').removeAttribute('data-closed');
    assert.strictEqual(hit(), el('[data-test-page]'), 'at progress 0');

    state.active = 2;
    await settled();
    clock.frame();
    assert.strictEqual(backdrop().style.pointerEvents, '', 'opening');
    assert.strictEqual(hit(), backdrop(), 'blocks the page while open');

    state.active = 0;
    await settle();
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert.strictEqual(hit(), el('[data-test-page]'), 'closed again');
    await click('[data-test-page]');
    assert.strictEqual(state.pageClicks, 1, 'the page can be clicked');
  });
});
