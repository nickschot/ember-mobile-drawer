import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  clearRender,
  click,
  find,
  render,
  settled,
  waitUntil,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { registerWarnHandler } from '@ember/debug';
import { MobileDrawer } from '#src/index.ts';
import type { SnapPoint } from '#src/-private/snap-points/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

// The drawer is embedded in a 400 x 600 px container (see `renderDrawer`) with
// 100 x 80 px of content, so these resolve to:
//   bottom/top:  0, 80, 300, 600
//   left/right:  0, 100, 200, 400
const SNAP_POINTS: SnapPoint[] = [0, 'content', '50%', '100%'];
const OFFSETS: Record<'vertical' | 'horizontal', number[]> = {
  vertical: [0, 80, 300, 600],
  horizontal: [0, 100, 200, 400],
};

function axis(placement: Placement): 'vertical' | 'horizontal' {
  return placement === 'bottom' || placement === 'top'
    ? 'vertical'
    : 'horizontal';
}

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = () => el('.mobile-drawer__tray');

/** The tray's rendered translation as `"x y"` in px. */
function translation(): string {
  const matrix = new DOMMatrix(getComputedStyle(tray()).transform);
  return `${matrix.m41 + 0} ${matrix.m42 + 0}`;
}

/** The translation the CSS contract asks for at `offset` px open. */
function expectedTranslation(
  placement: Placement,
  trayLength: number,
  offset: number,
): string {
  const distance = trayLength - offset;
  return {
    bottom: `0 ${distance}`,
    top: `0 ${-distance + 0}`,
    left: `${-distance + 0} 0`,
    right: `${distance} 0`,
  }[placement];
}

/** How far open the tray is along its axis, in px, read from the transform. */
function openDistance(placement: Placement, trayLength: number): number {
  const matrix = new DOMMatrix(getComputedStyle(tray()).transform);
  const distance =
    placement === 'left' || placement === 'right' ? matrix.m41 : matrix.m42;
  return trayLength - Math.abs(distance);
}

function backdropProgress(): number {
  return Number(
    el('.mobile-drawer__backdrop').style.getPropertyValue(
      '--mobile-drawer-progress',
    ),
  );
}

const containerStyle = (height: number, hidden: boolean) =>
  htmlSafe(
    `position: relative; width: 400px; height: ${height}px${hidden ? '; display: none' : ''}`,
  );
const contentStyle = (height: number) =>
  htmlSafe(`width: 100px; height: ${height}px`);

class State {
  @tracked placement: Placement = 'bottom';
  @tracked snapPoints: SnapPoint[] = SNAP_POINTS;
  @tracked active: number | undefined = 0;
  @tracked height = 600;
  @tracked contentHeight = 80;
  @tracked hidden = false;
  changes: number[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div
        style={{containerStyle state.height state.hidden}}
        data-test-container
      >
        <MobileDrawer
          @placement={{state.placement}}
          @snapPoints={{state.snapPoints}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          style="position: absolute"
          data-test-drawer
          as |drawer|
        >
          <div style={{contentStyle state.contentHeight}} data-test-content>
            <button
              type="button"
              data-test-snap-to="2"
              {{on "click" (fn drawer.snapTo 2)}}
            >Half</button>
            <button type="button" data-test-open {{on "click" drawer.open}}>
              Open
            </button>
            <button type="button" data-test-close {{on "click" drawer.close}}>
              Close
            </button>
            <output data-test-active>{{drawer.activeSnapPoint}}</output>
            <output data-test-animating>{{drawer.isAnimating}}</output>
            <output data-test-dragging>{{drawer.isDragging}}</output>
            <output data-test-progress>{{drawer.progress}}</output>
          </div>
        </MobileDrawer>
      </div>
    </template>,
  );
}

/** Warnings about invalid snap points, collected per test. */
let warnings: string[] = [];
registerWarnHandler((message, options, next) => {
  if (options?.id === 'ember-mobile-drawer.invalid-snap-point') {
    warnings.push(message);
  } else {
    next(message, options);
  }
});

module('Integration | Component | mobile-drawer', function (hooks) {
  setupRenderingTest(hooks);

  let clock: FakeClock;

  hooks.beforeEach(function () {
    warnings = [];
    clock = new FakeClock();
    drawerEnvironment.clock = clock;
    drawerEnvironment.prefersReducedMotion = () => false;
  });

  hooks.afterEach(function () {
    delete drawerEnvironment.clock;
    delete drawerEnvironment.prefersReducedMotion;
  });

  test('it renders the markup contract and yields its block', async function (assert) {
    await render(
      <template>
        <MobileDrawer data-test-drawer class="custom">
          <p data-test-block>Drawer content</p>
        </MobileDrawer>
      </template>,
    );

    assert.dom('[data-test-drawer]').hasClass('mobile-drawer');
    assert.dom('[data-test-drawer]').hasClass('custom');
    assert.dom('[data-test-drawer]').hasAttribute('data-placement', 'bottom');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert
      .dom('[data-test-drawer] > .mobile-drawer__backdrop')
      .exists({ count: 1 });
    assert
      .dom(
        '[data-test-drawer] > .mobile-drawer__tray > .mobile-drawer__content > [data-test-block]',
      )
      .hasText('Drawer content');
  });

  test('it starts closed at index 0 without animating', async function (assert) {
    const state = new State();
    state.active = undefined;
    await renderDrawer(state);

    assert.dom('[data-test-active]').hasText('0');
    assert.dom('[data-test-animating]').hasText('false');
    assert.dom('[data-test-dragging]').hasText('false');
    assert.dom('[data-test-progress]').hasText('0');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert.strictEqual(translation(), '0 600');
    assert.strictEqual(clock.pendingFrames, 0, 'no animation');
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: the tray is translated to each snap point`, async function (assert) {
      drawerEnvironment.prefersReducedMotion = () => true;
      const state = new State();
      state.placement = placement;
      await renderDrawer(state);

      assert
        .dom('[data-test-drawer]')
        .hasAttribute('data-placement', placement);

      const offsets = OFFSETS[axis(placement)];
      const trayLength = offsets[offsets.length - 1]!;
      for (const [index, offset] of offsets.entries()) {
        state.active = index;
        await settled();

        assert.strictEqual(
          translation(),
          expectedTranslation(placement, trayLength, offset),
          `snap point ${index} (${offset}px)`,
        );
        assert.strictEqual(
          backdropProgress(),
          offset / trayLength,
          `backdrop progress at ${index}`,
        );
        if (index === 0) {
          assert.dom('[data-test-drawer]').hasAttribute('data-closed');
        } else {
          assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
        }
      }
    });
  }

  test('without a snap point larger than the content, the tray keeps its natural size', async function (assert) {
    drawerEnvironment.prefersReducedMotion = () => true;
    const state = new State();
    state.snapPoints = [0, 40, 'content'];
    state.active = 1;
    await renderDrawer(state);

    assert.strictEqual(getComputedStyle(tray()).height, '80px');
    assert.strictEqual(tray().style.height, '');
    assert.strictEqual(translation(), '0 40');
  });

  test('changing @activeSnapPoint animates to it without calling back', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    state.active = 2;
    await settled();

    assert.dom('[data-test-animating]').hasText('true');
    assert.dom('[data-test-active]').hasText('2');
    assert.dom('[data-test-progress]').hasText('0.5', 'progress of the target');
    assert.strictEqual(translation(), '0 600', 'not moved before a frame');

    clock.frame();
    assert
      .dom('[data-test-drawer]')
      .doesNotHaveAttribute('data-closed', 'shown on the first frame');
    const first = openDistance('bottom', 600);
    clock.frame();
    clock.frame();
    const later = openDistance('bottom', 600);
    assert.true(first > 0 && first < later && later < 300, 'moves gradually');
    assert.true(
      backdropProgress() > 0 && backdropProgress() < 0.5,
      'backdrop follows every frame',
    );
    await settled();
    assert
      .dom('[data-test-progress]')
      .hasText('0.5', 'yielded progress is not updated per frame');

    clock.runUntilIdle();
    await settled();

    assert.strictEqual(translation(), '0 300');
    assert.dom('[data-test-animating]').hasText('false');
    assert.deepEqual(state.changes, [], 'no callback for outside changes');
  });

  test('snapTo, open and close call back and animate once the parent accepts', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    await click('[data-test-snap-to]');
    assert.deepEqual(state.changes, [2]);
    assert.true(clock.pendingFrames > 0, 'animating');
    clock.runUntilIdle();
    assert.strictEqual(translation(), '0 300');

    await click('[data-test-open]');
    clock.runUntilIdle();
    await settled();
    assert.deepEqual(state.changes, [2, 3]);
    assert.strictEqual(translation(), '0 0');
    assert.dom('[data-test-progress]').hasText('1');

    await click('[data-test-close]');
    clock.runUntilIdle();
    await settled();
    assert.deepEqual(state.changes, [2, 3, 0]);
    assert.strictEqual(translation(), '0 600');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');
    assert.dom('[data-test-progress]').hasText('0');
  });

  test('the drawer never fights the parent', async function (assert) {
    const state = new State();
    state.accept = false;
    state.active = 1;
    await renderDrawer(state);

    await click('[data-test-open]');

    assert.deepEqual(state.changes, [3], 'asks the parent');
    assert.strictEqual(clock.pendingFrames, 0, 'but does not move');
    assert.strictEqual(translation(), '0 520');
    assert.dom('[data-test-active]').hasText('1');
  });

  test('uncontrolled, it manages its own snap point and still calls back', async function (assert) {
    const state = new State();
    state.active = undefined;
    state.accept = false;
    await renderDrawer(state);

    await click('[data-test-snap-to]');
    clock.runUntilIdle();
    await settled();

    assert.deepEqual(state.changes, [2]);
    assert.dom('[data-test-active]').hasText('2');
    assert.strictEqual(translation(), '0 300');

    await click('[data-test-close]');
    clock.runUntilIdle();
    await settled();
    assert.dom('[data-test-active]').hasText('0');
    assert.strictEqual(translation(), '0 600');
  });

  test('a retarget during an animation continues from the current position', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    state.active = 3;
    await settled();
    clock.frame();
    clock.frame();
    const before = openDistance('bottom', 600);

    state.active = 1;
    await settled();
    assert.strictEqual(openDistance('bottom', 600), before, 'no jump');

    clock.runUntilIdle();
    await settled();
    assert.strictEqual(translation(), '0 520');
  });

  test('a resize keeps the drawer at the same snap point without a jump', async function (assert) {
    const state = new State();
    state.active = 2; // 50%
    await renderDrawer(state);
    assert.strictEqual(translation(), '0 300');

    state.height = 800;
    await settled();
    await waitUntil(() => translation() !== '0 300');

    assert.strictEqual(translation(), '0 400', 'at 50% of 800');
    assert.strictEqual(clock.pendingFrames, 0, 'without animating');
    await settled();
    assert.dom('[data-test-animating]').hasText('false');
    assert.dom('[data-test-progress]').hasText('0.5');
  });

  test('a content size change keeps a content snap point', async function (assert) {
    const state = new State();
    state.active = 1; // content
    await renderDrawer(state);
    assert.strictEqual(translation(), '0 520');

    state.contentHeight = 120;
    await settled();
    await waitUntil(() => translation() !== '0 520');

    assert.strictEqual(translation(), '0 480');
    assert.strictEqual(clock.pendingFrames, 0, 'without animating');
  });

  test('a resize during an animation retargets it', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    state.active = 2;
    await settled();
    clock.frame();
    const before = openDistance('bottom', 600);

    state.height = 800;
    await settled();
    await waitUntil(() => tray().style.height === '800px');

    assert.strictEqual(
      openDistance('bottom', 800),
      before,
      'the visible open distance is unchanged',
    );
    clock.runUntilIdle();
    assert.strictEqual(translation(), '0 400');
  });

  test('changing the placement jumps to the snap point on the new axis', async function (assert) {
    const state = new State();
    state.active = 2;
    await renderDrawer(state);

    state.placement = 'right';
    await settled();

    assert.strictEqual(clock.pendingFrames, 0);
    assert.strictEqual(tray().style.height, '');
    assert.strictEqual(tray().style.width, '400px');
    assert.strictEqual(translation(), '200 0');
  });

  test('teardown stops animations and observers', async function (assert) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const disconnect = ResizeObserver.prototype.disconnect;
    let disconnected = 0;
    ResizeObserver.prototype.disconnect = function (this: ResizeObserver) {
      disconnected++;
      disconnect.call(this);
    };

    try {
      const state = new State();
      await renderDrawer(state);
      state.active = 3;
      await settled();
      clock.frame();
      assert.true(clock.pendingFrames > 0, 'animating');

      await clearRender();

      assert.strictEqual(clock.pendingFrames, 0, 'no frames left');
      assert.strictEqual(disconnected, 1, 'resize observer disconnected');
    } finally {
      ResizeObserver.prototype.disconnect = disconnect;
    }
  });

  test('with reduced motion it jumps to the snap point', async function (assert) {
    drawerEnvironment.prefersReducedMotion = () => true;
    const state = new State();
    await renderDrawer(state);

    state.active = 3;
    await settled();

    assert.strictEqual(clock.pendingFrames, 0);
    assert.strictEqual(translation(), '0 0');
    assert.dom('[data-test-animating]').hasText('false');
    assert.dom('[data-test-progress]').hasText('1');
  });

  test('dropping @activeSnapPoint keeps the current snap point', async function (assert) {
    const state = new State();
    state.active = 2;
    await renderDrawer(state);

    state.active = undefined;
    await settled();

    assert.strictEqual(clock.pendingFrames, 0, 'does not move');
    assert.strictEqual(translation(), '0 300');
    assert.dom('[data-test-active]').hasText('2');

    await click('[data-test-open]');
    clock.runUntilIdle();
    await settled();
    assert.dom('[data-test-active]').hasText('3', 'now uncontrolled');
    assert.strictEqual(translation(), '0 0');
  });

  test('passing @activeSnapPoint to an uncontrolled drawer animates to it', async function (assert) {
    const state = new State();
    state.active = undefined;
    state.accept = false;
    await renderDrawer(state);
    await click('[data-test-snap-to]');
    clock.runUntilIdle();
    assert.strictEqual(translation(), '0 300');

    state.active = 1;
    await settled();
    assert.true(clock.pendingFrames > 0, 'animates');
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(translation(), '0 520');
    assert.dom('[data-test-active]').hasText('1');
  });

  test('an out of range @activeSnapPoint is clamped with a warning', async function (assert) {
    drawerEnvironment.prefersReducedMotion = () => true;
    const state = new State();
    state.active = 3;
    await renderDrawer(state);

    // The parent shrinks @snapPoints before it updates @activeSnapPoint.
    state.snapPoints = [0, '50%'];
    await settled();

    assert.dom('[data-test-active]').hasText('1');
    assert.strictEqual(translation(), '0 0', 'at 50%, the largest snap point');
    assert.strictEqual(warnings.length, 1, 'warns once');
    assert.true(warnings[0]?.includes('got 3. Using 1 instead.'));

    state.active = 1;
    await settled();
    assert.strictEqual(warnings.length, 1, 'no warning once it is valid');

    state.active = -1;
    await settled();
    assert.dom('[data-test-active]').hasText('0');
    assert.strictEqual(warnings.length, 2);
  });

  test('a non-integer @activeSnapPoint is rounded to the nearest index', async function (assert) {
    const state = new State();
    state.active = 1.6;
    await renderDrawer(state);

    assert.dom('[data-test-active]').hasText('2');
    assert.strictEqual(translation(), '0 300');
    assert.strictEqual(warnings.length, 1);

    state.active = NaN;
    await settled();
    assert.dom('[data-test-active]').hasText('0');
  });

  test('a hidden drawer is measured once it gets a size', async function (assert) {
    const state = new State();
    state.hidden = true;
    state.active = 2;
    await renderDrawer(state);

    assert.strictEqual(tray().style.transform, '', 'nothing written');
    assert.strictEqual(tray().style.height, '', 'no explicit size');
    assert.dom('[data-test-drawer]').hasAttribute('data-closed');

    state.active = 3;
    await settled();
    assert.strictEqual(clock.pendingFrames, 0, 'no animation while hidden');

    state.hidden = false;
    await settled();
    await waitUntil(() => tray().style.transform !== '');

    assert.strictEqual(translation(), '0 0');
    assert.strictEqual(tray().style.height, '600px');
    assert.strictEqual(clock.pendingFrames, 0, 'without animating');
    assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
  });
});
