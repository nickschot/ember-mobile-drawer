import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  find,
  render,
  resetOnerror,
  settled,
  setupOnerror,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import {
  MobileDrawer,
  springPresets,
  type MobileDrawerApi,
  type MobileDrawerSpring,
  type SnapPoint,
} from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// A 400 x 600 px container with 80px of content: the snap points resolve to
// 0, 300 and 600 px.
const SNAP_POINTS: SnapPoint[] = [0, '50%', '100%'];
const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const contentStyle = htmlSafe('height: 80px');

class State {
  @tracked spring: Partial<MobileDrawerSpring> | undefined;
  api?: MobileDrawerApi;
  capture = (api: MobileDrawerApi) => {
    this.api = api;
  };
}

function openDistance(): number {
  const tray = find('.mobile-drawer__tray') as HTMLElement;
  const matrix = new DOMMatrix(getComputedStyle(tray).transform);
  return 600 - matrix.m42;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}}>
        <MobileDrawer
          @snapPoints={{SNAP_POINTS}}
          @spring={{state.spring}}
          aria-label="Sheet"
          style="position: absolute"
          as |drawer|
        >
          {{state.capture drawer}}
          <div style={{contentStyle}}></div>
        </MobileDrawer>
      </div>
    </template>,
  );
}

module('Integration | Component | mobile-drawer | @spring', function (hooks) {
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

  /** Moves to `index` and returns the frames and the largest open distance. */
  async function move(state: State, index: number) {
    state.api!.snapTo(index);
    // Uncontrolled: the drawer starts moving when it renders again.
    await settled();
    let max = 0;
    let frames = 0;
    while (clock.pendingFrames > 0) {
      clock.frame();
      frames++;
      max = Math.max(max, openDistance());
    }
    await settled();
    return { frames, max, end: openDistance() };
  }

  test('without @spring the drawer uses the default spring', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    const unset = await move(state, 1);

    state.spring = springPresets.default;
    await settled();
    await move(state, 0);
    const preset = await move(state, 1);

    assert.strictEqual(unset.end, 300);
    assert.strictEqual(preset.frames, unset.frames, 'same number of frames');
  });

  test('springPresets.ios moves the drawer more slowly, without overshoot', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    const defaults = await move(state, 1);
    await move(state, 0);

    state.spring = springPresets.ios;
    await settled();
    const ios = await move(state, 1);

    assert.strictEqual(ios.end, 300, 'settles on the snap point');
    assert.true(ios.frames > defaults.frames, 'takes more frames');
    assert.true(ios.max <= 300, 'no overshoot');
  });

  test('springPresets.iosBouncy overshoots a snap point and comes back', async function (assert) {
    const state = new State();
    state.spring = springPresets.iosBouncy;
    await renderDrawer(state);
    const bouncy = await move(state, 1);

    assert.true(bouncy.max > 300, `overshoots (max ${bouncy.max})`);
    assert.strictEqual(bouncy.end, 300, 'settles on the snap point');
  });

  test('a partial @spring keeps the defaults for the other keys, and a change applies from the next animation', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    const defaults = await move(state, 1);
    await move(state, 0);

    // Stiffness 1600 with the default damping (40) is under-damped, so it
    // overshoots.
    state.spring = { stiffness: 1600 };
    await settled();
    const stiff = await move(state, 1);
    assert.true(stiff.max > 300, 'under-damped with the default damping');
    await move(state, 0);

    state.spring = undefined;
    await settled();
    const back = await move(state, 1);
    assert.strictEqual(back.frames, defaults.frames, 'back to the defaults');
  });

  test('an invalid value fails an assertion', async function (assert) {
    const errors: unknown[] = [];
    setupOnerror((error) => errors.push(error));
    try {
      const state = new State();
      state.spring = { damping: 0 };
      await renderDrawer(state);
    } finally {
      resetOnerror();
    }

    assert.strictEqual(errors.length, 1);
    assert.true(
      /@spring\.damping must be a finite number greater than 0, got 0/.test(
        String(errors[0]),
      ),
      String(errors[0]),
    );
  });
});
