import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { TouchPointer } from '#src/-private/gesture/touch-pointer.ts';
import {
  KEYBOARD_ATTRIBUTE,
  KEYBOARD_FILL_CLASS,
} from '#src/-private/keyboard-fill.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';
import '#src/themes/ios.css';

/*
 * The header mode (#145): with a `header` block the header is a tray child
 * outside the scroll container, and `.mobile-drawer__content` is the scroll
 * container. A drawer in a 400 x 600 px container, at 200px or fully open,
 * with content of 1000 x 1000 px and a 20 x 20 px header.
 */

type Placement = 'bottom' | 'top' | 'left' | 'right';
type Direction = 'up' | 'down' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

const OPENING: Record<Placement, Direction> = {
  bottom: 'up',
  top: 'down',
  left: 'right',
  right: 'left',
};
const CLOSING: Record<Placement, Direction> = {
  bottom: 'down',
  top: 'up',
  left: 'left',
  right: 'right',
};

const STEP = 4;

const vertical = (placement: Placement) =>
  placement === 'bottom' || placement === 'top';

function el(selector: string): HTMLElement {
  const element = find(selector) ?? document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const root = () => el('[data-test-drawer]');
const tray = () =>
  el('[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__tray');
const header = () =>
  el(
    '[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__tray > .mobile-drawer__header',
  );
const content = () =>
  el(
    '[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__tray > .mobile-drawer__content',
  );

const position = (element: HTMLElement, placement: Placement) =>
  vertical(placement) ? element.scrollTop : element.scrollLeft;

const range = (element: HTMLElement, placement: Placement) =>
  vertical(placement)
    ? element.scrollHeight - element.clientHeight
    : element.scrollWidth - element.clientWidth;

/**
 * Scrolls `element` along the axis to the end that a finger moving
 * `direction` can't scroll past (moving down or right pushes the content
 * towards its start), or to the middle. Right-to-left `scrollLeft` runs from
 * `-range` to `0`.
 */
function scrollTo(
  element: HTMLElement,
  placement: Placement,
  where: Direction | 'middle',
  rtl = false,
): void {
  const length = range(element, placement);
  const min = rtl ? -length : 0;
  const max = rtl ? 0 : length;
  const value =
    where === 'middle'
      ? Math.round((min + max) / 2)
      : where === 'down' || where === 'right'
        ? min
        : max;
  if (vertical(placement)) element.scrollTop = value;
  else element.scrollLeft = value;
}

/** The content's bounce past fully open (its inline `translate`, px). */
function contentBounce(placement: Placement): number {
  const [x = 0, y = 0] = content()
    .style.translate.split(' ')
    .map((part) => parseFloat(part) || 0);
  return { bottom: -y, top: y, left: x, right: -x }[placement];
}

/** How far (screen px) the tray moved towards open since `before`. */
function trayShift(placement: Placement, before: DOMRect): number {
  const now = tray().getBoundingClientRect();
  return {
    bottom: before.top - now.top,
    top: now.bottom - before.bottom,
    left: now.right - before.right,
    right: before.left - now.left,
  }[placement];
}

/** Screen px per layout px: the test container may be scaled. */
const screenScale = () =>
  tray().getBoundingClientRect().width / tray().offsetWidth;

/**
 * A one-finger touch gesture on `target` (in the middle of its visible
 * part): `steps` moves of `STEP` layout px in `direction`, with a frame
 * after each. Returns whether the drawer said it was dragging before the
 * finger lifted.
 */
async function gesture(
  target: HTMLElement,
  direction: Direction,
  steps: number,
  clock: FakeClock,
  options: { lift?: boolean } = {},
): Promise<{ dragging: boolean; finger: TouchPointer }> {
  const rect = target.getBoundingClientRect();
  const box = root().getBoundingClientRect();
  const x =
    (Math.max(rect.left, box.left) + Math.min(rect.right, box.right)) / 2;
  const y =
    (Math.max(rect.top, box.top) + Math.min(rect.bottom, box.bottom)) / 2;
  const finger = new TouchPointer(target, x, y);
  const step = STEP * screenScale();
  const [dx, dy] = {
    up: [0, -step],
    down: [0, step],
    left: [-step, 0],
    right: [step, 0],
  }[direction] as [number, number];
  finger.down();
  for (let i = 0; i < steps; i++) {
    finger.move(dx, dy);
    clock.frame(16);
  }
  await settled();
  const dragging = el('[data-test-dragging]').textContent === 'true';
  if (options.lift !== false) {
    finger.up();
    await settled();
  }
  return { dragging, finger };
}

class State {
  @tracked placement: Placement = 'bottom';
  @tracked active = 2;
  @tracked snapPoints: SnapPoint[] = [0, 200, '100%'];
  @tracked dir: 'ltr' | 'rtl' = 'ltr';
  @tracked header = true;
  @tracked modal = false;
  changes: number[] = [];

  onChange = (index: number) => {
    this.changes.push(index);
    this.active = index;
  };
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const headerStyle = htmlSafe('width: 20px; height: 20px');
const contentStyle = htmlSafe('width: 1000px; height: 1000px');

async function renderDrawer(state: State, clock: FakeClock) {
  if (state.header) {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{containerStyle}} dir={{state.dir}} data-test-container>
          <MobileDrawer
            @placement={{state.placement}}
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @modal={{state.modal}}
            aria-label="Drawer"
            style="position: absolute"
            data-test-drawer
          >
            <:header as |drawer|>
              <div style={{headerStyle}} data-test-header>
                <drawer.Grabber data-test-grabber />
              </div>
            </:header>
            <:default as |drawer|>
              <div style={{contentStyle}} data-test-content>
                <button type="button" data-test-first>First</button>
              </div>
              <button type="button" data-test-last>Last</button>
              <output data-test-dragging>{{drawer.isDragging}}</output>
            </:default>
          </MobileDrawer>
        </div>
      </template>,
    );
  } else {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{containerStyle}} data-test-container>
          <MobileDrawer
            @placement={{state.placement}}
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @modal={{state.modal}}
            aria-label="Drawer"
            style="position: absolute"
            data-test-drawer
            as |drawer|
          >
            <div style={{contentStyle}} data-test-content></div>
            <output data-test-dragging>{{drawer.isDragging}}</output>
          </MobileDrawer>
        </div>
      </template>,
    );
  }
  clock.runUntilIdle();
  await settled();
}

/** The overflow along the axis, computed. */
const overflow = (element: HTMLElement, placement: Placement) =>
  getComputedStyle(element)[vertical(placement) ? 'overflowY' : 'overflowX'];

module('Integration | Component | mobile-drawer | header', function (hooks) {
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

  async function settle() {
    await settled();
    clock.runUntilIdle();
    await settled();
  }

  test('without a header block the markup and the scroll container do not change', async function (assert) {
    const state = new State();
    state.header = false;
    await renderDrawer(state, clock);
    assert.dom(root()).doesNotHaveAttribute('data-header');
    assert.dom('.mobile-drawer__header').doesNotExist();
    assert.deepEqual(
      [...tray().children].map((child) => child.className),
      ['mobile-drawer__content'],
    );
    assert.strictEqual(getComputedStyle(tray()).overflowY, 'auto');
    assert.strictEqual(getComputedStyle(content()).overflowY, 'visible');
  });

  test('the header block gets the same API as the default block', async function (assert) {
    const state = new State();
    await renderDrawer(state, clock);
    assert.dom(root()).hasAttribute('data-header', '');
    assert.deepEqual(
      [...tray().children].map((child) => child.className),
      ['mobile-drawer__header', 'mobile-drawer__content'],
      'the header is a tray child before the content',
    );
    assert.dom('[data-test-header]').hasProperty('parentElement', header());
    // The yielded Grabber: a tap moves the drawer to the next snap point.
    el('[data-test-grabber]').click();
    await settle();
    assert.deepEqual(state.changes, [1], 'the Grabber works in the header');
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: the header is at the leading edge, outside the scroll container`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state, clock);
      assert.strictEqual(overflow(tray(), placement), 'hidden', 'tray');
      assert.strictEqual(overflow(content(), placement), 'auto', 'content');
      assert.strictEqual(
        getComputedStyle(content()).overscrollBehaviorY,
        'contain',
        'the content does not scroll the page',
      );
      const trayRect = tray().getBoundingClientRect();
      const rect = header().getBoundingClientRect();
      const leading = {
        bottom: [rect.top, trayRect.top],
        top: [rect.bottom, trayRect.bottom],
        left: [rect.right, trayRect.right],
        right: [rect.left, trayRect.left],
      }[placement];
      assert.true(
        Math.abs(leading[0]! - leading[1]!) < 0.5,
        `at the leading edge (${leading.join(' / ')})`,
      );
      const box = content().getBoundingClientRect();
      const apart = {
        bottom: box.top >= rect.bottom - 0.5,
        top: box.bottom <= rect.top + 0.5,
        left: box.right <= rect.left + 0.5,
        right: box.left >= rect.right - 0.5,
      }[placement];
      assert.true(apart, 'the content is next to the header, not under it');

      scrollTo(content(), placement, 'middle');
      assert.true(position(content(), placement) !== 0, 'the content scrolls');
      assert.deepEqual(
        header().getBoundingClientRect().toJSON(),
        rect.toJSON(),
        'the header does not move',
      );
      assert.strictEqual(tray().scrollTop, 0);
      assert.strictEqual(tray().scrollLeft, 0);
    });

    test(`${placement}: below the highest snap point the content is locked, at the highest it scrolls`, async function (assert) {
      const state = new State();
      state.placement = placement;
      state.active = 1;
      await renderDrawer(state, clock);
      const property = vertical(placement) ? 'overflow-y' : 'overflow-x';
      assert.strictEqual(
        content().style.getPropertyValue(property),
        'hidden',
        'locked below the highest snap point',
      );
      assert.strictEqual(overflow(content(), placement), 'hidden');

      state.active = 2;
      await settle();
      assert.strictEqual(
        content().style.getPropertyValue(property),
        '',
        'unlocked at the highest snap point',
      );
      assert.strictEqual(overflow(content(), placement), 'auto');
    });

    test(`${placement}: a scroll that reaches the content start turns into a drag; elsewhere it scrolls`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state, clock);
      scrollTo(content(), placement, 'middle');
      let result = await gesture(
        el('[data-test-content]'),
        CLOSING[placement],
        10,
        clock,
      );
      assert.false(result.dragging, 'scrolls in the middle');

      scrollTo(content(), placement, CLOSING[placement]);
      const before = tray().getBoundingClientRect();
      result = await gesture(
        el('[data-test-content]'),
        CLOSING[placement],
        vertical(placement) ? 60 : 30,
        clock,
        { lift: false },
      );
      assert.true(result.dragging, 'drags at the content start');
      assert.true(
        trayShift(placement, before) < -40,
        `the tray follows (${trayShift(placement, before)})`,
      );
      result.finger.up();
      await settle();
      assert.strictEqual(state.changes.length, 1, 'settles');
      assert.true(state.changes[0]! < 2, `lower (${state.changes[0]})`);
    });

    test(`${placement}: a gesture on the header drags, also with the content scrolled, and the header stays at the edge past fully open`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state, clock);
      scrollTo(content(), placement, 'middle');
      const scrolled = position(content(), placement);
      const rect = header().getBoundingClientRect();

      let result = await gesture(
        el('[data-test-header]'),
        OPENING[placement],
        20,
        clock,
        { lift: false },
      );
      assert.true(result.dragging, 'towards open: drags');
      assert.true(contentBounce(placement) > 0, 'the content bounces');
      assert.deepEqual(
        header().getBoundingClientRect().toJSON(),
        rect.toJSON(),
        'the header stays at the edge',
      );
      assert.true(
        Number(getComputedStyle(header()).zIndex) >= 1,
        'over the bouncing content',
      );
      result.finger.up();
      await settle();
      assert.strictEqual(contentBounce(placement), 0, 'back');

      const before = tray().getBoundingClientRect();
      result = await gesture(
        el('[data-test-header]'),
        CLOSING[placement],
        20,
        clock,
        { lift: false },
      );
      assert.true(result.dragging, 'towards close: drags');
      assert.true(trayShift(placement, before) < -20, 'the tray moves');
      assert.strictEqual(
        position(content(), placement),
        scrolled,
        'the content does not scroll',
      );
      result.finger.up();
      await settle();
    });
  }

  const cases: [Placement, boolean][] = [
    ...PLACEMENTS.map((placement): [Placement, boolean] => [placement, false]),
    ['left', true],
    ['right', true],
  ];
  for (const [placement, rtl] of cases) {
    test(`${placement}${rtl ? ' (rtl)' : ''}: one pan drags the tray to the highest snap point and then scrolls the content`, async function (assert) {
      const state = new State();
      state.placement = placement;
      state.active = 1;
      if (rtl) state.dir = 'rtl';
      await renderDrawer(state, clock);
      // Where a finger moving towards open can scroll the whole range.
      scrollTo(content(), placement, CLOSING[placement], rtl);
      const from = position(content(), placement);
      // 200px (left, right) or 400px to fully open, then 30 steps more.
      const steps = (vertical(placement) ? 400 : 200) / STEP + 30;
      const result = await gesture(
        el('[data-test-content]'),
        OPENING[placement],
        steps,
        clock,
        { lift: false },
      );
      assert.true(result.dragging, 'dragging');
      assert.strictEqual(
        Math.abs(position(content(), placement) - from),
        30 * STEP,
        'the content scrolls the rest of the way, 1:1',
      );
      assert.strictEqual(contentBounce(placement), 0, 'no bounce');
      assert.strictEqual(tray().scrollTop, 0, 'the tray does not scroll');
      assert.strictEqual(tray().scrollLeft, 0);
      result.finger.up();
      await settle();
      assert.deepEqual(state.changes, [2], 'settles fully open');
    });
  }

  for (const placement of ['bottom', 'top'] as const) {
    test(`${placement}: leaving the highest snap point scrolls the content back to its scroll start`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state, clock);
      assert.strictEqual(content().scrollTop, 0, 'opens at scrollTop 0');
      scrollTo(content(), placement, 'middle');
      state.active = 1;
      await settle();
      assert.strictEqual(
        content().scrollTop,
        placement === 'top' ? range(content(), placement) : 0,
        'at the scroll start (the content end for a top drawer)',
      );
      assert.strictEqual(tray().scrollTop, 0, 'the tray does not scroll');
    });
  }

  test('keyboard focus on an element off screen moves the drawer up and scrolls the content to it, under the header', async function (assert) {
    const state = new State();
    state.active = 1;
    await renderDrawer(state, clock);
    const last = el('[data-test-last]');
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }),
    );
    last.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    await settle();
    assert.deepEqual(state.changes, [2], 'moves to the highest snap point');
    assert.true(content().scrollTop > 0, 'the content scrolled to it');
    assert.strictEqual(tray().scrollTop, 0, 'the tray did not scroll');
    const rect = last.getBoundingClientRect();
    const box = content().getBoundingClientRect();
    assert.true(
      rect.top >= header().getBoundingClientRect().bottom - 0.5 &&
        rect.bottom <= box.bottom + 0.5,
      'it shows below the header',
    );
  });

  test('a modal drawer focuses its tray; the header is in the focus trap', async function (assert) {
    const state = new State();
    state.modal = true;
    await renderDrawer(state, clock);
    assert.dom(tray()).hasAttribute('tabindex', '-1');
    const grabber = el('[data-test-grabber]');
    assert.true(tray().contains(grabber), 'the header is in the tray');
    assert.true(
      tray().contains(document.activeElement),
      'the initial focus is in the tray',
    );
    el('[data-test-first]').focus();
    grabber.focus();
    assert.strictEqual(document.activeElement, grabber, 'focusable');
  });

  test('iOS theme: the header is transparent below the highest snap point and opaque at it', async function (assert) {
    const state = new State();
    state.active = 1;
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          class="mobile-drawer-theme-ios"
          style="position: relative; width: 400px; height: 600px; --mobile-drawer-background: rgb(10 20 30 / 0.5)"
        >
          <MobileDrawer
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @modal={{false}}
            style="position: absolute"
            data-test-drawer
          >
            <:header as |drawer|>
              <drawer.Grabber class="mobile-drawer-theme-ios__grabber" />
            </:header>
            <:default>
              <div style="height: 1000px"></div>
            </:default>
          </MobileDrawer>
        </div>
      </template>,
    );
    await settle();
    const grabber = el('.mobile-drawer-theme-ios__grabber');
    assert.strictEqual(
      getComputedStyle(header()).backgroundColor,
      'rgba(0, 0, 0, 0)',
      'transparent below the highest snap point',
    );
    assert.strictEqual(
      getComputedStyle(grabber).backgroundColor,
      'rgba(0, 0, 0, 0)',
      'the strip has no background of its own',
    );

    state.active = 2;
    await settle();
    assert.dom(root()).hasAttribute('data-at-highest');
    const opaque = getComputedStyle(header()).backgroundColor;
    assert.true(
      /^(rgb\(10, 20, 30\)|color\(srgb [\d.]+ [\d.]+ [\d.]+\))$/.test(opaque),
      `opaque at the highest snap point (${opaque})`,
    );
    assert.strictEqual(
      getComputedStyle(header(), '::after').content,
      '""',
      'with the rim',
    );
    assert.strictEqual(
      getComputedStyle(grabber).backgroundColor,
      'rgba(0, 0, 0, 0)',
    );
  });
});

class FakeViewport extends EventTarget {
  height = 600;
  scale = 1;
}

module(
  'Integration | Component | mobile-drawer | header | keyboard',
  function (hooks) {
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

    hooks.afterEach(function () {
      delete drawerEnvironment.clock;
      delete drawerEnvironment.prefersReducedMotion;
      delete drawerEnvironment.visualViewport;
    });

    test('the keyboard fill works for a field in the header and in the content', async function (assert) {
      class KeyboardState {
        @tracked shift = 0;
        get rootStyle() {
          return htmlSafe(
            `inset: auto; left: 0; top: 0; width: 400px; height: 600px; translate: 0 ${-this.shift}px`,
          );
        }
      }
      const state = new KeyboardState();
      const destination = document.body;
      const snapPoints: SnapPoint[] = [0, '40%', '100%'];
      await render(
        <template>
          {{#in-element destination insertBefore=null}}
            <div class="mobile-drawer-theme-ios">
              <MobileDrawer
                @snapPoints={{snapPoints}}
                @activeSnapPoint={{1}}
                @modal={{false}}
                aria-label="Drawer"
                style={{state.rootStyle}}
                data-test-drawer
              >
                <:header>
                  <input
                    type="search"
                    aria-label="Search"
                    data-test-header-field
                  />
                </:header>
                <:default>
                  <input type="text" aria-label="Name" data-test-field />
                  {{! template-lint-disable no-inline-styles }}
                  <div style="height: 1000px"></div>
                </:default>
              </MobileDrawer>
            </div>
          {{/in-element}}
        </template>,
      );
      clock.runUntilIdle();
      await settled();
      const fills = () => document.querySelectorAll(`.${KEYBOARD_FILL_CLASS}`);

      for (const selector of [
        '[data-test-header-field]',
        '[data-test-field]',
      ]) {
        el(selector).focus();
        viewport.height = 300;
        state.shift = 250;
        await settled();
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        assert.strictEqual(fills().length, 1, `${selector}: one fill`);
        assert.dom(root()).hasAttribute(KEYBOARD_ATTRIBUTE);

        viewport.height = 600;
        state.shift = 0;
        await settled();
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
        assert.strictEqual(fills().length, 0, `${selector}: gone`);
      }
      (document.activeElement as HTMLElement | null)?.blur();
    });
  },
);
