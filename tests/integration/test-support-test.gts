import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { closeDrawer, dragDrawer, openDrawer } from '#src/test-support.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

// A 400 x 600 container: on both axes the snap points are at 0, 200 and
// 400 px and the tray is 400 px long.
const SNAP_POINTS: SnapPoint[] = [0, 200, 400];
const OFFSETS = [0, 200, 400];

class State {
  @tracked placement: Placement = 'bottom';
  @tracked active: number | undefined = undefined;
  @tracked handleOnly = false;
  @tracked nested = false;
  changes: number[] = [];

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.active !== undefined) this.active = index;
  };
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const contentStyle = htmlSafe('min-height: 80px; min-width: 80px');

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}}>
        <MobileDrawer
          @placement={{state.placement}}
          @snapPoints={{SNAP_POINTS}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          @handleOnly={{state.handleOnly}}
          style="position: absolute"
          aria-label="Outer"
          data-test-outer
          as |drawer|
        >
          <div style={{contentStyle}}>
            <div
              style="width: 40px; height: 40px"
              data-test-handle
              {{drawer.handle}}
            ></div>
            <button type="button" data-test-open {{on "click" drawer.open}}>
              Open
            </button>
            <output data-test-active>{{drawer.activeSnapPoint}}</output>
            <output data-test-animating>{{drawer.isAnimating}}</output>
            {{#if state.nested}}
              <MobileDrawer
                @snapPoints={{SNAP_POINTS}}
                style="position: absolute"
                aria-label="Inner"
                data-test-inner
                as |inner|
              >
                <div style={{contentStyle}} data-test-inner-content>
                  <output data-test-inner-active>
                    {{inner.activeSnapPoint}}
                  </output>
                </div>
              </MobileDrawer>
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

/** How far open the outer drawer's tray is, in px, from its transform. */
function openOffset(placement: Placement): number {
  const tray = el('[data-test-outer] > .mobile-drawer__tray');
  const { m41, m42 } = new DOMMatrix(getComputedStyle(tray).transform);
  return {
    bottom: 400 - m42,
    top: 400 + m42,
    left: 400 + m41,
    right: 400 - m41,
  }[placement];
}

const near = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= 0.01;

// These tests use the browser's own clock: the helpers wait for the
// animation through `settled()`.
module('Integration | test-support', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    drawerEnvironment.prefersReducedMotion = () => false;
  });

  hooks.afterEach(function () {
    delete drawerEnvironment.prefersReducedMotion;
  });

  test('settled() waits for the animation', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    // `click` waits for `settled()`.
    await click('[data-test-open]');
    assert.true(near(openOffset('bottom'), 400), 'at rest, fully open');
    assert.dom('[data-test-animating]').hasText('false');
  });

  test('openDrawer and closeDrawer', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    await openDrawer();
    assert.true(near(openOffset('bottom'), 400), 'at rest, fully open');
    assert.dom('[data-test-active]').hasText('2');
    assert.dom('[data-test-outer]').doesNotHaveAttribute('data-closed');

    await closeDrawer(el('[data-test-handle]'));
    assert.true(near(openOffset('bottom'), 0), 'at rest, closed');
    assert.dom('[data-test-active]').hasText('0');
    assert.dom('[data-test-outer]').hasAttribute('data-closed');
  });

  test('openDrawer on a controlled drawer only asks the parent', async function (assert) {
    const state = new State();
    state.active = 0;
    state.onChange = (index) => state.changes.push(index);
    await renderDrawer(state);

    await openDrawer('[data-test-outer]');
    assert.deepEqual(state.changes, [2]);
    assert.dom('[data-test-active]').hasText('0');
    assert.true(near(openOffset('bottom'), 0), 'stays closed');
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: dragDrawer to a snap point`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state);

      for (const to of [2, 1, 0, 1]) {
        await dragDrawer('[data-test-outer]', { to });
        assert.dom('[data-test-active]').hasText(String(to));
        assert.true(
          near(openOffset(placement), OFFSETS[to]!),
          `at rest at snap point ${to}: ${openOffset(placement)}`,
        );
      }
    });

    test(`${placement}: dragDrawer by a distance, with a velocity`, async function (assert) {
      const state = new State();
      state.placement = placement;
      await renderDrawer(state);

      // Slowly: settles on the nearest snap point.
      await dragDrawer('[data-test-outer]', { distance: 260 });
      assert.dom('[data-test-active]').hasText('1', '260px is nearest to 200');

      // A flick: past the nearest snap point.
      await dragDrawer('[data-test-outer]', { distance: 30, velocity: 2000 });
      assert.dom('[data-test-active]').hasText('2');

      await dragDrawer('[data-test-outer]', {
        distance: -30,
        velocity: -2000,
      });
      assert.dom('[data-test-active]').hasText('1');
    });
  }

  test('dragDrawer catches a moving drawer', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    el('[data-test-open]').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await dragDrawer('[data-test-outer]', { to: 1 });
    assert.dom('[data-test-active]').hasText('1');
    assert.true(near(openOffset('bottom'), 200));
  });

  test('dragDrawer on a controlled drawer', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    await dragDrawer('[data-test-outer]', { to: 1 });
    assert.deepEqual(state.changes, [1]);
    assert.true(near(openOffset('bottom'), 200));
  });

  test('with @handleOnly, dragDrawer drags from a handle', async function (assert) {
    const state = new State();
    state.handleOnly = true;
    await renderDrawer(state);

    await assert.rejects(
      dragDrawer('[data-test-outer]', { to: 2 }),
      /did not start a drag/,
      'the tray does not drag',
    );
    await settled();
    assert.dom('[data-test-active]').hasText('0');

    await dragDrawer('[data-test-handle]', { to: 2 });
    assert.dom('[data-test-active]').hasText('2');
    assert.true(near(openOffset('bottom'), 400));
  });

  test('the helpers use the innermost drawer', async function (assert) {
    const state = new State();
    state.nested = true;
    await renderDrawer(state);
    await openDrawer('[data-test-outer]');

    await openDrawer('[data-test-inner-content]');
    assert.dom('[data-test-inner-active]').hasText('2');
    assert.dom('[data-test-active]').hasText('2');

    await closeDrawer('[data-test-inner]');
    assert.dom('[data-test-inner-active]').hasText('0');
    assert.dom('[data-test-active]').hasText('2', 'the outer drawer stays');
  });

  test('the helpers report what they cannot do', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    await assert.rejects(
      openDrawer('[data-test-missing]'),
      /openDrawer: no element found for '\[data-test-missing\]'/,
    );
    await render(
      <template>
        <p data-test-plain>Not a drawer</p>
      </template>,
    );
    await assert.rejects(
      closeDrawer('[data-test-plain]'),
      /is not a <MobileDrawer> or inside one/,
    );

    await renderDrawer(state);
    await assert.rejects(
      dragDrawer('[data-test-outer]', { to: 3 }),
      /3 is not an index into @snapPoints/,
    );
    await assert.rejects(
      dragDrawer('[data-test-outer]', { distance: 100, velocity: -500 }),
      /needs a drag that way/,
    );
    await assert.rejects(
      // @ts-expect-error neither `to` nor `distance`
      dragDrawer('[data-test-outer]', {}),
      /pass either `to` or `distance`/,
    );
    await settled();
    assert.dom('[data-test-active]').hasText('0', 'nothing moved');
  });
});
