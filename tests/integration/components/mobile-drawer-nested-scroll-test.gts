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
                <p data-test-inner-static>Inner</p>
                <div
                  style={{boxStyle}}
                  data-mobile-drawer-scroll
                  data-test-inner-box
                >
                  <div style={{boxContentStyle}}>List</div>
                </div>
              </MobileDrawer>
            </div>
          {{else}}
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
                <p data-test-inner-static>Inner</p>
                <div
                  style={{boxStyle}}
                  data-mobile-drawer-scroll
                  data-test-inner-box
                >
                  <div style={{boxContentStyle}}>List</div>
                </div>
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

/** A wheel on `target`; returns whether it was cancelled. */
function wheel(target: HTMLElement, deltaY: number): boolean {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const UP: [number, number] = [0, -1];
const DOWN: [number, number] = [0, 1];

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
  },
);
