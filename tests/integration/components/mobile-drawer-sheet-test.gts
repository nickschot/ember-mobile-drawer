import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, find, render, settled } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type Placement, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import { resizeObserversDelivered } from '../../helpers/resize-observers.ts';
import { drawerFor } from '#src/-private/registry.ts';
import '#src/styles.css';

// The drawer is embedded in a 400 x 600 px container with a page button
// behind it that fills the container. It is not modal, so the page button
// isn't inert and takes the taps that the drawer doesn't. The snap points resolve to 0, 200 and
// 400 px; the tray is 400 px long.
const SNAP_POINTS: SnapPoint[] = [0, 200, 400];
const PROGRESS = '--mobile-drawer-expand-progress';

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const root = () => el('[data-test-drawer]');
const sheet = () => el('[data-test-drawer] > .mobile-drawer__sheet');
const tray = () =>
  el('[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__tray');
const content = () => el('[data-test-content]');

/** The expand progress the component wrote on the sheet, as a number. */
const written = () => Number(sheet().style.getPropertyValue(PROGRESS));

/** How far (px) the tray is open, from its inline transform. */
function openDistance(): number {
  const match = /translate3d\(0px, ([-\d.e]+)px, 0px\)/.exec(
    tray().style.transform,
  );
  if (!match) throw new Error(`Unexpected transform ${tray().style.transform}`);
  return 400 - Number(match[1]);
}

/** Container px per screen px: the test container may be scaled. */
function scale(): number {
  const container = el('[data-test-container]');
  return container.getBoundingClientRect().width / container.offsetWidth;
}

/** The element a tap at `x`/`y` (container px) would hit. */
function hit(x: number, y: number): Element | null {
  const rect = el('[data-test-container]').getBoundingClientRect();
  return document.elementFromPoint(
    rect.left + x * scale(),
    rect.top + y * scale(),
  );
}

/** About ten lines in 400px, so a narrower width wraps it again. */
const TEXT = Array.from({ length: 40 }, (_, i) => `word${i} lorem ipsum`).join(
  ' ',
);

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const pageStyle = htmlSafe('position: absolute; inset: 0');

class State {
  @tracked active = 0;
  @tracked inset: string | undefined;
  @tracked snapPoints: SnapPoint[] = SNAP_POINTS;
  @tracked backdrop: boolean | undefined = false;
  @tracked placement: Placement = 'bottom';
  /** Text that wraps, instead of the 80px block. */
  @tracked text = false;

  get wrapperStyle() {
    return htmlSafe(
      this.inset === undefined ? '' : `--mobile-drawer-inset: ${this.inset}`,
    );
  }
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <button type="button" style={{pageStyle}} data-test-page>Page</button>
        <div style={{state.wrapperStyle}}>
          <MobileDrawer
            @snapPoints={{state.snapPoints}}
            @placement={{state.placement}}
            @activeSnapPoint={{state.active}}
            @backdrop={{state.backdrop}}
            @modal={{false}}
            aria-label="Drawer"
            style="position: absolute"
            data-test-drawer
          >
            {{#if state.text}}
              <p style="margin: 0; font: 16px/1.5 sans-serif" data-test-content>
                {{TEXT}}
              </p>
            {{else}}
              <div style="height: 80px" data-test-content>Content</div>
            {{/if}}
          </MobileDrawer>
        </div>
      </div>
    </template>,
  );
}

module('Integration | Component | mobile-drawer | sheet', function (hooks) {
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

  test('the sheet sits between the root and the tray, and takes no pointer events', async function (assert) {
    await renderDrawer(new State());
    assert
      .dom('[data-test-drawer] > .mobile-drawer__sheet')
      .exists({ count: 1 });
    assert
      .dom('[data-test-drawer] > .mobile-drawer__sheet > *')
      .exists({ count: 2 }, 'only the glass layer and the tray are in it');
    assert.strictEqual(getComputedStyle(sheet()).pointerEvents, 'none');
    assert.strictEqual(getComputedStyle(tray()).pointerEvents, 'auto');
    const glass = sheet().firstElementChild!;
    assert.dom(glass).hasClass('mobile-drawer__glass', 'the glass layer first');
    assert.dom(glass).hasAttribute('aria-hidden', 'true');
    assert.strictEqual(
      getComputedStyle(glass).display,
      'none',
      'the base styles hide the glass layer',
    );
    assert.strictEqual(getComputedStyle(glass).pointerEvents, 'none');
  });

  test('the expand progress is 0 up to the second-highest snap point, 1 at the highest, and linear in between', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    assert.strictEqual(written(), 0, 'closed');

    state.active = 1;
    await settle();
    assert.strictEqual(written(), 0, 'at the second-highest snap point');
    assert.dom(root()).doesNotHaveAttribute('data-at-highest');

    state.active = 2;
    await settled();
    let checked = 0;
    while (clock.pendingFrames > 0) {
      clock.frame();
      const open = openDistance();
      const expected = Math.min(Math.max((open - 200) / 200, 0), 1);
      if (open < 400 - 0.5) {
        assert.true(
          Math.abs(written() - expected) < 1e-4,
          `at ${open.toFixed(2)}px: ${written()} is ${expected}`,
        );
        assert.dom(root()).doesNotHaveAttribute('data-at-highest');
        checked++;
      }
    }
    assert.true(checked > 3, `checked ${checked} frames on the way`);
    await settled();
    assert.strictEqual(written(), 1, 'at the highest snap point');
    assert.dom(root()).hasAttribute('data-at-highest');

    state.active = 1;
    await settle();
    assert.strictEqual(written(), 0, 'back');
    assert.dom(root()).doesNotHaveAttribute('data-at-highest');
  });

  test('with one open snap point the expand progress follows the drawer from closed', async function (assert) {
    const state = new State();
    state.snapPoints = [0, 400];
    await renderDrawer(state);
    state.active = 1;
    await settled();
    clock.frame();
    clock.frame();
    const open = openDistance();
    assert.true(open > 0 && open < 400, `on the way (${open}px)`);
    assert.true(Math.abs(written() - open / 400) < 1e-4, `${written()}`);
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(written(), 1);
  });

  test('only the sheet and the tray take the progress: not the root or the content', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settle();
    state.active = 2;
    await settled();
    clock.frame();
    clock.frame();
    clock.frame();
    const value = written();
    assert.true(value > 0 && value < 1, `between (${value})`);
    const computed = (element: Element) =>
      Number(getComputedStyle(element).getPropertyValue(PROGRESS));
    assert.true(Math.abs(computed(sheet()) - value) < 1e-4, 'the sheet');
    assert.true(
      Math.abs(computed(tray()) - value) < 1e-4,
      'the tray, with inherit',
    );
    assert.strictEqual(computed(content()), 0, 'not the content');
    assert.strictEqual(computed(root()), 0, 'not the root');
    assert.strictEqual(
      root().style.getPropertyValue(PROGRESS),
      '',
      'nothing inline on the root',
    );
    assert.strictEqual(
      tray().style.getPropertyValue(PROGRESS),
      '',
      'nothing inline on the tray',
    );
    clock.runUntilIdle();
    await settled();
  });

  test('the backdrop, its tint and the bar tint get both progress values', async function (assert) {
    const state = new State();
    state.backdrop = true;
    await renderDrawer(state);
    state.active = 1;
    await settle();
    for (const name of [
      'mobile-drawer__backdrop',
      'mobile-drawer__backdrop-tint',
      'mobile-drawer__bar-tint',
    ]) {
      const element = el(`[data-test-drawer] > .${name}`);
      assert.strictEqual(
        element.style.getPropertyValue('--mobile-drawer-progress'),
        '0.5',
        `${name}: progress`,
      );
      assert.strictEqual(
        element.style.getPropertyValue(PROGRESS),
        '0',
        `${name}: expand progress`,
      );
    }
    state.active = 2;
    await settle();
    assert.strictEqual(
      el(
        '[data-test-drawer] > .mobile-drawer__bar-tint',
      ).style.getPropertyValue(PROGRESS),
      '1',
    );
  });

  test('without --mobile-drawer-inset the sheet fills the root', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settle();
    const r = root().getBoundingClientRect();
    const s = sheet().getBoundingClientRect();
    assert.deepEqual(
      [s.top, s.right, s.bottom, s.left],
      [r.top, r.right, r.bottom, r.left],
    );
    assert.strictEqual(tray().offsetWidth, 400);
    // The tray's clip moves far out, so it doesn't cut an app's shadow.
    const clip = getComputedStyle(tray()).clipPath;
    assert.true(
      clip.startsWith(
        'polygon(-10000px calc(100% + 1000px), -10000px -10000px',
      ),
      `the tray clips nothing: ${clip}`,
    );
  });

  test('with --mobile-drawer-inset the tray clip has no area above the top edge, and clips nothing at the highest snap point', async function (assert) {
    const state = new State();
    state.inset = '8px';
    await renderDrawer(state);
    state.active = 1;
    await settle();
    const clip = () => getComputedStyle(tray()).clipPath;
    // Above the top edge the tray's own shadow would be a flat band across
    // the sheet, with hard ends at the sheet's sides.
    assert.true(
      clip().startsWith('polygon(8px calc(100% + 1000px), 8px 0px, '),
      `floating: the sides at the inset (${clip()})`,
    );
    assert.notOk(/-\d/.test(clip()), `floating: no point above (${clip()})`);

    state.active = 2;
    await settle();
    assert.true(
      clip().startsWith(
        'polygon(-10000px calc(100% + 1000px), -10000px -10000px',
      ),
      `highest: the clip clips nothing, the whole shadow shows (${clip()})`,
    );
  });

  test('with --mobile-drawer-inset the inset area does not take touches, at the highest snap point the tray does', async function (assert) {
    const state = new State();
    state.inset = '8px';
    await renderDrawer(state);
    state.active = 1;
    await settle();

    const page = el('[data-test-page]');
    assert.strictEqual(hit(4, 500), page, 'left gap: the page');
    assert.strictEqual(hit(396, 500), page, 'right gap: the page');
    assert.strictEqual(hit(200, 596), page, 'bottom gap: the page');
    assert.true(
      tray().contains(hit(12, 500)),
      'just inside the sheet: the tray',
    );
    assert.true(tray().contains(hit(200, 590)), 'just above the gap: the tray');
    assert.strictEqual(hit(200, 380), page, 'above the tray: the page');

    state.active = 2;
    await settle();
    assert.true(tray().contains(hit(4, 500)), 'highest: the edge is the tray');
    assert.true(tray().contains(hit(200, 598)), 'and the bottom');
  });

  test('with --mobile-drawer-inset the tray keeps its length and the closed position shows nothing', async function (assert) {
    const state = new State();
    state.inset = '8px';
    state.backdrop = true;
    await renderDrawer(state);
    state.active = 1;
    await settle();
    assert.strictEqual(openDistance(), 200, 'the snap point is unchanged');
    assert.strictEqual(tray().offsetHeight, 400, 'the tray length too');
    assert.strictEqual(
      tray().offsetWidth,
      400,
      'the tray stays as wide as the root',
    );

    // The last frame of a close, before data-closed hides the drawer.
    state.active = 0;
    await settled();
    while (clock.pendingFrames > 0) {
      clock.frame();
      const t = tray().getBoundingClientRect();
      if (openDistance() <= 0) {
        const r = root().getBoundingClientRect();
        assert.true(
          t.top >= r.bottom - 0.01,
          `closed: no part of the tray in the root (${t.top}, ${r.bottom})`,
        );
      }
    }
    await settled();
    assert.dom(root()).hasAttribute('data-closed');
  });

  // #142: below the lowest open snap point the sheet (its clip, with the
  // inset at the bottom) moves down with the tray, so the visible sheet
  // keeps its shape, as a native iOS sheet that closes.
  test('with --mobile-drawer-inset the sheet moves down as one piece below the lowest open snap point', async function (assert) {
    const state = new State();
    state.inset = '8px';
    await renderDrawer(state);
    state.active = 1;
    await settle();
    // Container px: the visible sheet from the tray's top to the sheet's
    // bottom edge.
    const visible = () =>
      (sheet().getBoundingClientRect().bottom -
        tray().getBoundingClientRect().top) /
      scale();
    const sides = () => {
      const s = sheet().getBoundingClientRect();
      const r = root().getBoundingClientRect();
      return [
        Math.round((s.left - r.left) / scale()),
        Math.round((r.right - s.right) / scale()),
      ];
    };
    assert.strictEqual(Math.round(visible()), 192, '200px open, 8px inset');
    assert.strictEqual(sheet().style.translate, '', 'no move at a snap point');
    assert.strictEqual(tray().style.translate, '');

    for (const [target, label] of [
      [0, 'close'],
      [1, 'reopen'],
    ] as const) {
      state.active = target;
      await settled();
      let frames = 0;
      while (clock.pendingFrames > 0) {
        clock.frame();
        frames++;
        const open = openDistance();
        // Past the snap point (a spring overshoot) the sheet expands.
        if (open > 200) continue;
        assert.true(
          Math.abs(visible() - 192) < 0.2,
          `${label} ${frames} (${open}px open): the sheet keeps its height (${visible()})`,
        );
        assert.deepEqual(sides(), [8, 8], 'and its sides');
        const moved = /^0px ([\d.e-]+)px$/.exec(sheet().style.translate);
        assert.true(
          Math.abs((moved ? Number(moved[1]) : 0) - Math.max(0, 200 - open)) <
            0.01,
          `the sheet moves down by the distance below the snap point (${sheet().style.translate})`,
        );
      }
      assert.true(frames > 5, `the ${label} animates (${frames} frames)`);
      await settled();
    }
    assert.strictEqual(sheet().style.translate, '');
    assert.strictEqual(tray().style.translate, '');

    // Above the lowest open snap point nothing moves the sheet.
    state.active = 2;
    await settled();
    while (clock.pendingFrames > 0) {
      clock.frame();
      assert.strictEqual(sheet().style.translate, '', 'expand: no move');
    }
    await settled();
  });

  test('with --mobile-drawer-inset the first open after the render, with the yielded open(), moves the sheet up as one piece', async function (assert) {
    const insetStyle = htmlSafe('--mobile-drawer-inset: 8px');
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{containerStyle}} data-test-container>
          <div style={{insetStyle}}>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @backdrop={{false}}
              @modal={{false}}
              aria-label="Drawer"
              style="position: absolute"
              data-test-drawer
              as |drawer|
            >
              <div style="height: 80px" data-test-content>Content</div>
              <button type="button" {{on "click" drawer.open}} data-test-open>
                Open
              </button>
            </MobileDrawer>
          </div>
        </div>
      </template>,
    );
    await settle();
    assert.dom(root()).hasAttribute('data-closed');

    await click('[data-test-open]');
    let frames = 0;
    let below = 0;
    while (clock.pendingFrames > 0 && frames < 500) {
      clock.frame();
      frames++;
      const open = openDistance();
      const moved = /^0px ([\d.e-]+)px$/.exec(sheet().style.translate);
      assert.true(
        Math.abs((moved ? Number(moved[1]) : 0) - Math.max(0, 200 - open)) <
          0.01,
        `frame ${frames} (${open}px open): the sheet is moved by the distance below the lowest open snap point (${sheet().style.translate})`,
      );
      // Above the lowest open snap point the sheet grows from its bottom
      // edge, as between any two open snap points.
      if (open > 200) continue;
      below++;
      const visible =
        (sheet().getBoundingClientRect().bottom -
          tray().getBoundingClientRect().top) /
        scale();
      assert.true(
        Math.abs(visible - 192) < 0.2,
        `frame ${frames} (${open}px open): the sheet keeps its height (${visible})`,
      );
    }
    await settled();
    assert.true(below > 1, `frames below the snap point: ${below}`);
    assert.strictEqual(openDistance(), 400, 'open() goes to the highest');
    assert.strictEqual(sheet().style.translate, '');
    assert.strictEqual(tray().style.translate, '');
  });

  test('without --mobile-drawer-inset the sheet does not move, so it does not cut the top shadow', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await settle();
    assert.strictEqual(sheet().style.translate, '', 'closed: no move');
    for (const target of [1, 0, 1]) {
      state.active = target;
      await settled();
      while (clock.pendingFrames > 0) {
        clock.frame();
        assert.strictEqual(sheet().style.translate, '', `to ${target}`);
        assert.strictEqual(tray().style.translate, '');
      }
      await settled();
    }
  });

  test('with --mobile-drawer-inset an inline translate of the app on the tray stays at the snap points', async function (assert) {
    const state = new State();
    state.inset = '8px';
    await renderDrawer(state);
    state.active = 2;
    await settle();
    tray().style.translate = '0px 1px';
    state.active = 1;
    await settle();
    assert.strictEqual(tray().style.translate, '0px 1px');
  });

  for (const placement of ['top', 'left', 'right'] as Placement[]) {
    test(`a closed floating bottom drawer that changes to ${placement} keeps no move of the sheet`, async function (assert) {
      const state = new State();
      state.inset = '8px';
      await renderDrawer(state);
      await settle();
      assert.notStrictEqual(sheet().style.translate, '', 'bottom: moved');

      state.placement = placement;
      await settle();
      state.active = 1;
      await settle();
      const glass = el(
        '[data-test-drawer] > .mobile-drawer__sheet > .mobile-drawer__glass',
      );
      for (const element of [sheet(), tray(), glass]) {
        assert.strictEqual(element.style.translate, '', 'no translate');
      }
      // The part of the tray in the sheet (and in the root).
      const t = tray().getBoundingClientRect();
      const s = sheet().getBoundingClientRect();
      const r = root().getBoundingClientRect();
      const vertical = placement === 'top';
      const shown =
        (vertical
          ? Math.min(t.bottom, s.bottom, r.bottom) -
            Math.max(t.top, s.top, r.top)
          : Math.min(t.right, s.right, r.right) -
            Math.max(t.left, s.left, r.left)) / scale();
      assert.true(
        Math.abs(shown - 200) < 0.5,
        `${placement}: 200px of the tray show (${shown})`,
      );
    });
  }

  for (const snapPoints of [
    [0, 'content'],
    [0, 120, 'content'],
  ] as SnapPoint[][]) {
    test(`with --mobile-drawer-inset and wrapping text, a content snap point doesn't move while the sheet expands: ${JSON.stringify(snapPoints)}`, async function (assert) {
      const state = new State();
      state.inset = '40px';
      state.text = true;
      state.snapPoints = snapPoints;
      await renderDrawer(state);
      const last = snapPoints.length - 1;
      if (last > 1) {
        state.active = 1;
        await settle();
      }
      const handle = drawerFor(root())!;
      const highest = handle.offsetOf(last)!;
      const width = content().getBoundingClientRect().width;
      assert.true(highest > 100, `the content snap point: ${highest}px`);

      state.active = last;
      await settled();
      let previous = handle.offset();
      let frames = 0;
      while (clock.pendingFrames > 0 && frames < 200) {
        clock.frame();
        // The content's resize observations of this frame, as a browser
        // delivers them after layout.
        await resizeObserversDelivered();
        frames++;
        const open = handle.offset();
        assert.strictEqual(
          handle.offsetOf(last),
          highest,
          `frame ${frames}: the highest snap point stays`,
        );
        assert.strictEqual(
          content().getBoundingClientRect().width,
          width,
          `frame ${frames}: the content keeps its width`,
        );
        assert.true(
          open >= previous - 0.5,
          `frame ${frames}: no jump back (${previous} to ${open})`,
        );
        previous = open;
      }
      await settled();
      assert.strictEqual(handle.offset(), highest, 'arrives at the snap point');
      assert.strictEqual(written(), 1);
    });
  }

  module('data-nested', function () {
    class NestedState {
      @tracked first = 0;
      @tracked second = 0;
      @tracked inner = 0;
    }

    async function renderTwo(state: NestedState) {
      await render(
        <template>
          {{! template-lint-disable no-inline-styles }}
          <div style={{containerStyle}}>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @activeSnapPoint={{state.first}}
              aria-label="First"
              style="position: absolute"
              data-test-first
            >
              <p>First</p>
              <MobileDrawer
                @snapPoints={{SNAP_POINTS}}
                @activeSnapPoint={{state.inner}}
                aria-label="Inner"
                data-test-inner
              >
                <p>Inner</p>
              </MobileDrawer>
            </MobileDrawer>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @activeSnapPoint={{state.second}}
              aria-label="Second"
              style="position: absolute"
              data-test-second
            >
              <p>Second</p>
            </MobileDrawer>
          </div>
        </template>,
      );
    }

    test('a drawer is nested while a modal drawer is open in front of it', async function (assert) {
      const state = new NestedState();
      await renderTwo(state);
      state.first = 1;
      await settle();
      assert.dom('[data-test-first]').doesNotHaveAttribute('data-nested');
      assert.dom('[data-test-second]').doesNotHaveAttribute('data-nested');

      state.second = 1;
      await settle();
      assert.dom('[data-test-first]').hasAttribute('data-nested');
      assert
        .dom('[data-test-second]')
        .doesNotHaveAttribute('data-nested', 'the front drawer');

      state.second = 0;
      await settle();
      assert
        .dom('[data-test-first]')
        .doesNotHaveAttribute('data-nested', 'in front again');
    });

    test('a drawer is nested while a modal drawer inside it is open, not the other way round', async function (assert) {
      const state = new NestedState();
      await renderTwo(state);
      state.first = 2;
      await settle();
      state.inner = 1;
      await settle();
      assert.dom('[data-test-first]').hasAttribute('data-nested');
      assert.dom('[data-test-inner]').doesNotHaveAttribute('data-nested');

      state.inner = 0;
      await settle();
      assert.dom('[data-test-first]').doesNotHaveAttribute('data-nested');
    });

    test('nested is only a state attribute: the covered drawer keeps its position', async function (assert) {
      const state = new NestedState();
      await renderTwo(state);
      state.first = 1;
      await settle();
      const first = el('[data-test-first] .mobile-drawer__tray');
      const before = first.getBoundingClientRect();
      state.second = 2;
      await settle();
      const after = first.getBoundingClientRect();
      assert.deepEqual(
        [after.top, after.left, after.width, after.height],
        [before.top, before.left, before.width, before.height],
      );
    });
  });
});
