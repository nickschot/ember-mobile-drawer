import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { TouchPointer } from '#src/-private/gesture/touch-pointer.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'left' | 'right';

/**
 * Outer and inner placements. On one axis the inner drawer closes the way
 * the outer one closes (bottom in bottom) or opens (right in left, left in
 * right; there the outer one would bounce past fully open). Each inner
 * drawer shows at both open snap points of the outer one.
 */
const PAIRS: [Placement, Placement][] = [
  ['bottom', 'bottom'],
  ['bottom', 'left'],
  ['left', 'right'],
  ['right', 'left'],
];

const CLOSES_TOWARDS: Record<Placement, [number, number]> = {
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Screen px per finger move. */
const STEP = 4;

class State {
  @tracked outer = 2;
  @tracked inner = 1;
  @tracked outerPlacement: Placement = 'bottom';
  @tracked placement: Placement = 'bottom';
  @tracked outerHandleOnly = false;
  @tracked innerHandleOnly = false;
  @tracked modal = true;
  outerSnapPoints: SnapPoint[] = [0, 200, 400];
  innerSnapPoints: SnapPoint[] = [0, 150];

  setOuter = (index: number) => (this.outer = index);
  setInner = (index: number) => (this.inner = index);
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
// At the top of the outer drawer's content, so it shows at both of its
// open snap points.
const wrapperStyle = htmlSafe(
  'position: relative; width: 400px; height: 200px; overflow: hidden',
);
const gripStyle = htmlSafe('height: 100px');

async function renderNested(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <MobileDrawer
          @placement={{state.outerPlacement}}
          @snapPoints={{state.outerSnapPoints}}
          @activeSnapPoint={{state.outer}}
          @onSnapPointChange={{state.setOuter}}
          @handleOnly={{state.outerHandleOnly}}
          @modal={{state.modal}}
          aria-label="Outer"
          style="position: absolute"
          data-test-outer
          as |outer|
        >
          <div style={{wrapperStyle}}>
            <MobileDrawer
              @placement={{state.placement}}
              @snapPoints={{state.innerSnapPoints}}
              @activeSnapPoint={{state.inner}}
              @onSnapPointChange={{state.setInner}}
              @handleOnly={{state.innerHandleOnly}}
              @modal={{state.modal}}
              aria-label="Inner"
              style="position: absolute"
              data-test-inner
              as |inner|
            >
              <div data-test-inner-handle {{inner.handle}}>Inner handle</div>
              <p data-test-inner-content>Inner</p>
              <output data-test-inner-dragging>{{inner.isDragging}}</output>
            </MobileDrawer>
          </div>
          <div style={{gripStyle}} data-test-outer-grip></div>
          <div data-test-outer-handle {{outer.handle}}>Outer handle</div>
          <output data-test-outer-dragging>{{outer.isDragging}}</output>
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

const outerTray = () =>
  el('[data-test-outer] > .mobile-drawer__sheet > .mobile-drawer__tray');
const outerContent = () =>
  el(
    '[data-test-outer] > .mobile-drawer__sheet > .mobile-drawer__tray > .mobile-drawer__content',
  );
const innerTray = () => el('[data-test-inner] .mobile-drawer__tray');

/** Where the outer drawer shows: its tray's and its content's position. */
function outerPosition(): string {
  const tray = outerTray().getBoundingClientRect();
  const content = outerContent().getBoundingClientRect();
  return `${tray.left},${tray.top} ${content.left},${content.top}`;
}

/** Where the inner tray is in the outer tray, in screen px. */
function innerPosition(): { x: number; y: number } {
  const inner = innerTray().getBoundingClientRect();
  const outer = outerTray().getBoundingClientRect();
  return { x: inner.left - outer.left, y: inner.top - outer.top };
}

/** The middle of the visible part of `element`, in client px. */
function middleOf(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  // The container, and the inner drawer's wrapper for an element in it.
  const wrapper = el('[data-test-inner]').parentElement!;
  const clips = [el('[data-test-container]'), wrapper]
    .filter((clip) => clip !== wrapper || wrapper.contains(element))
    .map((clip) => clip.getBoundingClientRect());
  const left = Math.max(rect.left, ...clips.map((clip) => clip.left));
  const right = Math.min(rect.right, ...clips.map((clip) => clip.right));
  const top = Math.max(rect.top, ...clips.map((clip) => clip.top));
  const bottom = Math.min(rect.bottom, ...clips.map((clip) => clip.bottom));
  if (right - left < 4 || bottom - top < 4) {
    throw new Error('The target does not show');
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * One finger on `target` that moves `steps` times `STEP` screen px along
 * `[dx, dy]`, with fake frames in between. Returns the outer drawer's
 * position after every move, and how far the inner tray moved in the outer
 * tray along the way (screen px, the largest distance seen).
 */
async function drag(
  clock: FakeClock,
  target: HTMLElement,
  [dx, dy]: [number, number],
  steps: number,
): Promise<{ outer: string[]; innerMoved: number; cancelled: boolean[] }> {
  const { x, y } = middleOf(target);
  const finger = new TouchPointer(target, x, y);
  const start = innerPosition();
  const outer: string[] = [];
  const cancelled: boolean[] = [];
  let innerMoved = 0;
  finger.down();
  for (let i = 0; i < steps; i++) {
    cancelled.push(finger.move(dx * STEP, dy * STEP));
    clock.frame();
    outer.push(outerPosition());
    const now = innerPosition();
    innerMoved = Math.max(
      innerMoved,
      Math.abs(now.x - start.x),
      Math.abs(now.y - start.y),
    );
  }
  finger.up();
  clock.runUntilIdle();
  await settled();
  return { outer, innerMoved, cancelled };
}

module(
  'Integration | Component | mobile-drawer | nested drag',
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

    for (const [outerPlacement, placement] of PAIRS) {
      for (const modal of [true, false]) {
        for (const outerActive of [2, 1]) {
          for (const outerHandleOnly of [false, true]) {
            for (const innerHandleOnly of [false, true]) {
              const name = `${placement} in ${outerPlacement}, ${modal ? 'modal' : 'non-modal'}, outer at ${outerActive}${outerHandleOnly ? ', outer @handleOnly' : ''}${innerHandleOnly ? ', inner @handleOnly' : ''}`;

              test(`${name}: a drag in the inner drawer past its closed position moves only the inner drawer`, async function (assert) {
                const state = new State();
                state.outerPlacement = outerPlacement;
                state.placement = placement;
                state.modal = modal;
                state.outer = outerActive;
                state.outerHandleOnly = outerHandleOnly;
                state.innerHandleOnly = innerHandleOnly;
                await renderNested(state);
                clock.runUntilIdle();
                await settled();

                // Twice the inner drawer's length (150px, 75 screen px at the
                // test container's 50% scale) and more: past its closed
                // position.
                const start = outerPosition();
                const result = await drag(
                  clock,
                  el(
                    innerHandleOnly
                      ? '[data-test-inner-handle]'
                      : '[data-test-inner-content]',
                  ),
                  CLOSES_TOWARDS[placement],
                  60,
                );

                assert.true(
                  result.outer.every((position) => position === start),
                  `the outer drawer stays where it was (${start} -> ${result.outer.find((p) => p !== start) ?? 'same'})`,
                );
                assert.true(
                  result.innerMoved > 40,
                  `the inner drawer moves (${result.innerMoved}px)`,
                );
                assert.strictEqual(state.inner, 0, 'the inner drawer closes');
                assert.strictEqual(state.outer, outerActive, 'the outer stays');
                assert.strictEqual(
                  outerPosition(),
                  start,
                  'also after release',
                );
              });
            }
          }
        }
      }
    }

    test('the outer drawer still drags from its own area', async function (assert) {
      const state = new State();
      await renderNested(state);
      clock.runUntilIdle();
      await settled();

      const start = outerPosition();
      const result = await drag(
        clock,
        el('[data-test-outer-grip]'),
        [0, 1],
        20,
      );
      assert.notStrictEqual(
        result.outer[result.outer.length - 1],
        start,
        'the outer drawer moves',
      );
      assert.strictEqual(
        result.innerMoved,
        0,
        'the inner tray moves with the outer tray',
      );
      assert.strictEqual(state.outer, 1, 'the outer drawer settles lower');
      assert.strictEqual(state.inner, 1, 'the inner drawer stays open');
    });

    test('the outer drawer still drags from its own handle', async function (assert) {
      const state = new State();
      state.outerHandleOnly = true;
      await renderNested(state);
      clock.runUntilIdle();
      await settled();

      const start = outerPosition();
      const result = await drag(
        clock,
        el('[data-test-outer-handle]'),
        [0, 1],
        20,
      );
      assert.notStrictEqual(
        result.outer[result.outer.length - 1],
        start,
        'the outer drawer moves',
      );
      assert.strictEqual(state.outer, 1, 'the outer drawer settles lower');
      assert.strictEqual(state.inner, 1, 'the inner drawer stays open');
    });

    test('a touch on the inner drawer does not hold the outer drawer while it moves', async function (assert) {
      const state = new State();
      state.outer = 1;
      await renderNested(state);
      clock.runUntilIdle();
      await settled();

      state.outer = 2;
      await settled();
      clock.frame();
      clock.frame();
      const before = outerPosition();
      const content = el('[data-test-inner-content]');
      const { x, y } = middleOf(content);
      const finger = new TouchPointer(content, x, y);
      finger.down();
      clock.frame();
      clock.frame();
      assert.notStrictEqual(
        outerPosition(),
        before,
        'the outer drawer goes on',
      );
      finger.up();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(state.outer, 2);
    });
  },
);
