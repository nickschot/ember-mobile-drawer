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
  springFromDuration,
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

  /**
   * Opens the drawer to the highest snap point and returns the tray's
   * `overflow-y` (the scroll lock) after each change, from the start, with
   * the largest open distance and the frame count.
   */
  async function openToTop(state: State) {
    const tray = find('.mobile-drawer__tray') as HTMLElement;
    const locks = [tray.style.overflowY];
    const record = () => {
      const value = tray.style.overflowY;
      if (value !== locks[locks.length - 1]) locks.push(value);
    };
    state.api!.snapTo(2);
    await settled();
    record();
    let max = 0;
    let frames = 0;
    while (clock.pendingFrames > 0) {
      clock.frame();
      frames++;
      record();
      max = Math.max(max, openDistance());
    }
    await settled();
    record();
    return { locks, max, frames, end: openDistance() };
  }

  for (const [name, spring] of [
    ['springPresets.iosBouncy', springPresets.iosBouncy],
    [
      'springFromDuration({ duration: 0.5, bounce: 0.5 })',
      springFromDuration({ duration: 0.5, bounce: 0.5 }),
    ],
  ] as const) {
    test(`${name}: the content unlocks once at the highest snap point and stays unlocked while the spring bounces`, async function (assert) {
      const state = new State();
      state.spring = spring;
      await renderDrawer(state);
      const { locks, max, end } = await openToTop(state);

      assert.deepEqual(
        locks,
        ['hidden', ''],
        'locked below the top, then unlocked once',
      );
      assert.strictEqual(max, 600, 'the rendered tray never passes its edge');
      assert.strictEqual(end, 600, 'settles at the top');
    });
  }

  test('a bouncy spring still bounces at a snap point below the top, and leaves the top again when asked', async function (assert) {
    const state = new State();
    state.spring = springPresets.iosBouncy;
    await renderDrawer(state);
    await openToTop(state);

    const down = await move(state, 1);
    assert.true(down.max <= 600);
    assert.strictEqual(down.end, 300, 'leaves the top');
    const tray = find('.mobile-drawer__tray') as HTMLElement;
    assert.strictEqual(tray.style.overflowY, 'hidden', 'locked again');
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
