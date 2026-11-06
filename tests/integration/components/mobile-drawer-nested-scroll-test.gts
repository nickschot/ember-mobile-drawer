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

/**
 * A gesture that starts in a nested drawer scrolls only that drawer (#119):
 * never the outer drawer's content (or the page). The browser scrolls when
 * a `touchmove` isn't cancelled, so the tests check which touchmoves are
 * cancelled (`preventDefault()`), and which wheels.
 *
 * - `dom`: the nested drawer is in the outer drawer's tray. iOS Safari
 *   scrolls the outer tray when nothing in the nested drawer can scroll the
 *   way the finger moves (its backdrop, content that doesn't overflow or is
 *   locked), also past `overscroll-behavior: contain`.
 * - `portal`: the nested drawer is in the yielded `Nested`, outside the
 *   outer tray. Its swipes can't reach the outer tray, but they would chain
 *   to the page.
 *
 * Modal drawers run with the fixed iOS scroll lock (#71), as on the
 * maintainer's iPhone.
 */

type Mode = 'dom' | 'portal';
type Placement = 'bottom' | 'right';

class State {
  @tracked mode: Mode = 'dom';
  @tracked placement: Placement = 'bottom';
  @tracked modal = true;
  @tracked outer = 2;
  @tracked inner = 1;
  @tracked outerHandleOnly = false;
  @tracked innerHandleOnly = false;
  /** Whether the nested drawer is rendered (in `Nested` mode). */
  @tracked nestedShown = true;
  outerSnapPoints: SnapPoint[] = [0, 200, 400];
  innerSnapPoints: SnapPoint[] = [0, 150];

  setOuter = (index: number) => (this.outer = index);
  setInner = (index: number) => (this.inner = index);
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px; overflow: hidden',
);
const wrapperStyle = htmlSafe(
  'position: relative; width: 400px; height: 200px; overflow: hidden',
);
// The outer tray scrolls at its highest snap point.
const outerContentStyle = htmlSafe('height: 1200px');
const boxStyle = htmlSafe('height: 100px; overflow-y: auto');
const boxContentStyle = htmlSafe('height: 400px');
const rowStyle = htmlSafe(
  'display: flex; width: 150px; height: 24px; overflow: hidden',
);
const wideStyle = htmlSafe('flex: none; width: 100px; overflow-x: auto');
const wideContentStyle = htmlSafe('width: 400px; height: 20px');
const noTouchStyle = htmlSafe('flex: none; height: 20px; touch-action: none');

/**
 * A web component with a horizontal scroller in its open shadow root
 * (review N2 of #148).
 */
class ShadowScroller extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<div style="width: 60px; overflow-x: auto"><div style="width: 400px; height: 20px">Wide</div></div>';
  }
}
if (!customElements.get('nested-shadow-scroller')) {
  customElements.define('nested-shadow-scroller', ShadowScroller);
}

/** The content of each nested drawer. */
const InnerContent = <template>
  {{! template-lint-disable no-inline-styles }}
  <p data-test-inner-static>Inner</p>
  <div style={{boxStyle}} data-mobile-drawer-scroll data-test-inner-box>
    <div style={{boxContentStyle}}>List</div>
  </div>
  {{! One clipped row, so the nested tray itself has nothing to scroll. }}
  <div style={{rowStyle}}>
    <div style={{wideStyle}} data-test-inner-wide>
      <div style={{wideContentStyle}}>Wide</div>
    </div>
    <nested-shadow-scroller data-test-inner-shadow />
    <input type="range" aria-label="Volume" data-test-control="range" />
    <select aria-label="Size" data-test-control="select">
      <option>S</option>
    </select>
    <textarea aria-label="Note" data-test-control="textarea"></textarea>
    <div contenteditable="true" data-test-control="contenteditable">Edit</div>
    <div draggable="true" data-test-control="draggable">Drag</div>
    <div style={{noTouchStyle}} data-test-control="touch-action-none">Draw</div>
  </div>
</template>;

async function renderNested(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <MobileDrawer
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
          {{#if (isDom state.mode)}}
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
              >
                <InnerContent />
              </MobileDrawer>
            </div>
          {{else if state.nestedShown}}
            <outer.Nested>
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
              >
                <InnerContent />
              </MobileDrawer>
            </outer.Nested>
          {{/if}}
          <div style={{outerContentStyle}} data-test-outer-content>Outer</div>
        </MobileDrawer>
      </div>
    </template>,
  );
}

const isDom = (mode: Mode) => mode === 'dom';

class ThreeLevels {
  @tracked mode: Mode = 'dom';
  snapPoints: SnapPoint[] = [0, 150];
  outerSnapPoints: SnapPoint[] = [0, 400];
}

async function renderThreeLevels(state: ThreeLevels) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
        <MobileDrawer
          @snapPoints={{state.outerSnapPoints}}
          @activeSnapPoint={{1}}
          aria-label="A"
          style="position: absolute"
          as |a|
        >
          {{#if (isDom state.mode)}}
            <div style={{wrapperStyle}}>
              <MobileDrawer
                @snapPoints={{state.snapPoints}}
                @activeSnapPoint={{1}}
                aria-label="B"
                style="position: absolute"
              >
                <div style={{wrapperStyle}}>
                  <MobileDrawer
                    @snapPoints={{state.snapPoints}}
                    @activeSnapPoint={{1}}
                    aria-label="C"
                    style="position: absolute"
                    data-test-c
                  >
                    <div
                      style={{boxStyle}}
                      data-mobile-drawer-scroll
                      data-test-c-box
                    >
                      <div style={{boxContentStyle}}>List</div>
                    </div>
                  </MobileDrawer>
                </div>
              </MobileDrawer>
            </div>
          {{else}}
            <a.Nested>
              <MobileDrawer
                @snapPoints={{state.snapPoints}}
                @activeSnapPoint={{1}}
                aria-label="B"
                style="position: absolute"
                as |b|
              >
                <b.Nested>
                  <MobileDrawer
                    @snapPoints={{state.snapPoints}}
                    @activeSnapPoint={{1}}
                    aria-label="C"
                    style="position: absolute"
                    data-test-c
                  >
                    <div
                      style={{boxStyle}}
                      data-mobile-drawer-scroll
                      data-test-c-box
                    >
                      <div style={{boxContentStyle}}>List</div>
                    </div>
                  </MobileDrawer>
                </b.Nested>
              </MobileDrawer>
            </a.Nested>
          {{/if}}
          <div style={{outerContentStyle}}>A</div>
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

/** Screen px per finger move. */
const STEP = 4;

/**
 * One finger on `target` that moves `steps` times `STEP` px along
 * `[dx, dy]`. Returns whether each touchmove was cancelled.
 */
function swipe(
  target: HTMLElement,
  [dx, dy]: [number, number],
  steps = 6,
): boolean[] {
  const rect = target.getBoundingClientRect();
  const finger = new TouchPointer(
    target,
    (rect.left + rect.right) / 2,
    (rect.top + rect.bottom) / 2,
  );
  const cancelled: boolean[] = [];
  finger.down();
  for (let i = 0; i < steps; i++) {
    cancelled.push(finger.move(dx * STEP, dy * STEP));
  }
  finger.up();
  return cancelled;
}

/**
 * One finger on `target` that moves by each of `steps` (client px). Returns
 * whether each touchmove was cancelled. `resting`: a second finger that
 * rests on `target` the whole time.
 */
function moves(
  target: HTMLElement,
  steps: [number, number][],
  { resting = false } = {},
): boolean[] {
  const rect = target.getBoundingClientRect();
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  const finger = new TouchPointer(target, x, y, {
    resting: resting ? [{ identifier: 9, target, x: x + 20, y }] : [],
  });
  finger.down();
  const cancelled = steps.map(([dx, dy]) => finger.move(dx, dy));
  finger.up();
  return cancelled;
}

/**
 * As `swipe`, with composed touch events (as the browser sends them), on
 * an element in a shadow root.
 */
function composedSwipe(
  target: Element,
  [dx, dy]: [number, number],
  steps = 6,
): boolean[] {
  const rect = target.getBoundingClientRect();
  let x = (rect.left + rect.right) / 2;
  let y = (rect.top + rect.bottom) / 2;
  const send = (type: string) => {
    const touch = new Touch({
      identifier: 1,
      target,
      clientX: x,
      clientY: y,
    });
    const down = type !== 'touchend';
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: down ? [touch] : [],
      targetTouches: down ? [touch] : [],
      changedTouches: [touch],
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  send('touchstart');
  const cancelled: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    x += dx * STEP;
    y += dy * STEP;
    cancelled.push(send('touchmove'));
  }
  send('touchend');
  return cancelled;
}

/** A wheel on `target`; returns whether it was cancelled. */
function wheel(
  target: HTMLElement,
  deltaY: number,
  options: WheelEventInit = {},
): boolean {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
    ...options,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const UP: [number, number] = [0, -1];
const DOWN: [number, number] = [0, 1];
const LEFT: [number, number] = [-1, 0];
const RIGHT: [number, number] = [1, 0];

/** The elements that handle their own touch gestures (review B1 of #148). */
const CONTROLS = [
  'range',
  'select',
  'textarea',
  'contenteditable',
  'draggable',
  'touch-action-none',
] as const;

/** A list in the middle of its scroll range: it scrolls both ways. */
function scrollBox(): HTMLElement {
  const box = el('[data-test-inner-box]');
  box.scrollTop = 100;
  return box;
}

module(
  'Integration | Component | mobile-drawer | nested scroll',
  function (hooks) {
    setupRenderingTest(hooks);

    let clock: FakeClock;

    hooks.beforeEach(function () {
      clock = new FakeClock();
      drawerEnvironment.clock = clock;
      drawerEnvironment.prefersReducedMotion = () => false;
      drawerEnvironment.isIOS = () => true;
    });

    hooks.afterEach(function () {
      delete drawerEnvironment.clock;
      delete drawerEnvironment.prefersReducedMotion;
      delete drawerEnvironment.isIOS;
    });

    async function setup(options: Partial<State>): Promise<State> {
      const state = new State();
      Object.assign(state, options);
      await renderNested(state);
      clock.runUntilIdle();
      await settled();
      return state;
    }

    for (const mode of ['dom', 'portal'] as const) {
      for (const placement of ['bottom', 'right'] as const) {
        for (const modal of [true, false]) {
          const name = `${placement} ${mode === 'dom' ? 'in the outer tray' : 'in Nested'}, ${modal ? 'modal' : 'non-modal'}`;
          const base = { mode, placement, modal };

          for (const outerHandleOnly of [false, true]) {
            for (const outer of [2, 1]) {
              const variant = `outer at ${outer}${outerHandleOnly ? ', outer @handleOnly' : ''}`;

              test(`${name}, ${variant}: a swipe on the nested list scrolls it`, async function (assert) {
                await setup({ ...base, outer, outerHandleOnly });
                const box = scrollBox();
                assert.strictEqual(
                  swipe(box, UP).filter(Boolean).length,
                  0,
                  'up: no touchmove cancelled',
                );
                assert.strictEqual(
                  swipe(box, DOWN).filter(Boolean).length,
                  0,
                  'down: no touchmove cancelled',
                );
                assert.false(wheel(box, 40), 'a wheel scrolls it');
              });
            }
          }

          if (modal) {
            test(`${name}: a swipe or wheel on the nested backdrop scrolls nothing`, async function (assert) {
              await setup(base);
              const backdrop = el(
                '[data-test-inner] > .mobile-drawer__backdrop',
              );
              assert.deepEqual(
                swipe(backdrop, UP),
                [true, true, true, true, true, true],
                'up: every touchmove cancelled',
              );
              assert.deepEqual(
                swipe(backdrop, DOWN),
                [true, true, true, true, true, true],
                'down: every touchmove cancelled',
              );
              assert.true(wheel(backdrop, 40), 'the wheel is cancelled');
            });
          }

          test(`${name}: a swipe at the end of the nested list scrolls nothing`, async function (assert) {
            await setup(base);
            const box = el('[data-test-inner-box]');
            box.scrollTop = box.scrollHeight;
            // The finger moves up: the list can't scroll further down. A
            // bottom drawer at its highest snap point drags (and bounces)
            // then; a side drawer leaves a vertical swipe alone.
            assert.true(swipe(box, UP)[0], 'the first touchmove is cancelled');
            // A bottom drawer bounces back.
            clock.runUntilIdle();
            await settled();
            assert.true(wheel(box, 40), 'the wheel is cancelled');
            box.scrollTop = 0;
            assert.false(wheel(box, 40), 'it scrolls the other way');
          });

          if (placement === 'bottom') {
            for (const control of CONTROLS) {
              test(`${name}: a swipe on a ${control} is left to it`, async function (assert) {
                await setup(base);
                const element = el(`[data-test-control="${control}"]`);
                for (const [label, way] of [
                  ['left', LEFT],
                  ['right', RIGHT],
                ] as const) {
                  assert.strictEqual(
                    swipe(element, way).filter(Boolean).length,
                    0,
                    `${label}: no touchmove cancelled`,
                  );
                }
              });
            }

            test(`${name}: a horizontal scroller in the nested drawer scrolls`, async function (assert) {
              await setup(base);
              const wide = el('[data-test-inner-wide]');
              assert.strictEqual(
                swipe(wide, LEFT).filter(Boolean).length,
                0,
                'left: it can scroll, no touchmove cancelled',
              );
              assert.true(
                swipe(wide, RIGHT)[0],
                'right: at its start, cancelled',
              );
            });

            test(`${name}: a scroller in a shadow root in the nested drawer scrolls`, async function (assert) {
              await setup(base);
              const scroller = el('[data-test-inner-shadow]').shadowRoot!
                .firstElementChild!;
              assert.strictEqual(
                composedSwipe(scroller, LEFT).filter(Boolean).length,
                0,
                'left: it can scroll, no touchmove cancelled',
              );
              assert.true(
                composedSwipe(scroller, RIGHT)[0],
                'right: at its start, cancelled',
              );
            });
          }

          test(`${name}: the direction is decided after the slop, from the start`, async function (assert) {
            await setup(base);
            const box = scrollBox();
            // A first step that is a little sideways, then up: the list
            // scrolls.
            assert.deepEqual(
              moves(box, [
                [3, -2],
                [0, -4],
                [-1, -4],
                [0, -4],
              ]),
              [false, false, false, false],
              'no touchmove cancelled',
            );
          });

          if (modal) {
            test(`${name}: a multi-touch gesture on the nested backdrop is left alone`, async function (assert) {
              await setup(base);
              const backdrop = el(
                '[data-test-inner] > .mobile-drawer__backdrop',
              );
              assert.deepEqual(
                moves(
                  backdrop,
                  [
                    [0, -4],
                    [0, -4],
                    [0, -4],
                  ],
                  {
                    resting: true,
                  },
                ),
                [false, false, false],
              );
              assert.false(
                wheel(backdrop, 40, { ctrlKey: true }),
                'a pinch-zoom wheel (Ctrl) is not cancelled',
              );
            });
          }

          test(`${name}, inner @handleOnly: a swipe on nested content that can't scroll scrolls nothing`, async function (assert) {
            await setup({ ...base, innerHandleOnly: true });
            const content = el('[data-test-inner-static]');
            for (const [label, way] of [
              ['up', UP],
              ['down', DOWN],
            ] as const) {
              assert.true(
                swipe(content, way).every(Boolean),
                `${label}: every touchmove cancelled`,
              );
            }
            assert.true(wheel(content, 40), 'the wheel is cancelled');
          });
        }
      }
    }

    test("the outer drawer's own content still scrolls", async function (assert) {
      await setup({ mode: 'dom' });
      const content = el('[data-test-outer-content]');
      assert.strictEqual(swipe(content, UP).filter(Boolean).length, 0, 'swipe');
      assert.false(wheel(content, 40), 'wheel');
    });

    test('the portal listeners are removed with the nested drawer', async function (assert) {
      const state = await setup({ mode: 'portal' });
      const portal = el('.mobile-drawer-nested');
      const removed: string[] = [];
      const remove = portal.removeEventListener.bind(portal);
      portal.removeEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        removed.push(type);
        remove(type, listener, options);
      };
      state.nestedShown = false;
      await settled();
      clock.runUntilIdle();
      await settled();
      for (const type of ['touchstart', 'touchmove', 'touchend', 'wheel']) {
        assert.true(removed.includes(type), `${type} removed`);
      }
    });

    for (const mode of ['dom', 'portal'] as const) {
      test(`three levels (${mode === 'dom' ? 'each in the tray of the one around it' : 'each in Nested'}): a gesture in the innermost drawer scrolls only it`, async function (assert) {
        const state = new ThreeLevels();
        state.mode = mode;
        await renderThreeLevels(state);
        clock.runUntilIdle();
        await settled();
        const backdrop = el('[data-test-c] > .mobile-drawer__backdrop');
        assert.true(swipe(backdrop, UP)[0], 'its backdrop: cancelled');
        assert.true(wheel(backdrop, 40), 'a wheel on its backdrop: cancelled');
        const box = el('[data-test-c-box]');
        box.scrollTop = 100;
        assert.strictEqual(
          swipe(box, UP).filter(Boolean).length,
          0,
          'its list scrolls',
        );
        assert.false(wheel(box, 40), 'a wheel on its list scrolls it');
      });
    }
  },
);
