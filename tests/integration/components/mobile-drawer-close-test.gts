import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import {
  MobileDrawer,
  springPresets,
  type MobileDrawerApi,
  type MobileDrawerDragEndEvent,
  type MobileDrawerSpring,
  type MobileDrawerToggleEvent,
  type SnapPoint,
} from '#src/index.ts';
import { dragDrawer } from '#src/test-support.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { Spring } from '#src/-private/spring/spring.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// The size of an iPhone screen: '40%' resolves to 337.6 px.
const HEIGHT = 844;
const FRAME = 16;

class State {
  @tracked snapPoints: SnapPoint[] = [0, '40%', '100%'];
  @tracked spring: Partial<MobileDrawerSpring> | undefined;
  @tracked contentHeight = 80;
  api?: MobileDrawerApi;
  log: string[] = [];
  dragEnds: MobileDrawerDragEndEvent[] = [];
  capture = (api: MobileDrawerApi) => {
    this.api = api;
  };
  onOpen = ({ snapPoint }: MobileDrawerToggleEvent) =>
    this.log.push(`open:${snapPoint}`);
  onClose = ({ snapPoint }: MobileDrawerToggleEvent) =>
    this.log.push(`close:${snapPoint}`);
  onDragEnd = (event: MobileDrawerDragEndEvent) => this.dragEnds.push(event);
}

const containerStyle = htmlSafe(
  `position: relative; width: 390px; height: ${HEIGHT}px`,
);
const contentStyle = (height: number) => htmlSafe(`height: ${height}px`);

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}}>
        <MobileDrawer
          @snapPoints={{state.snapPoints}}
          @spring={{state.spring}}
          @onOpen={{state.onOpen}}
          @onClose={{state.onClose}}
          @onDragEnd={{state.onDragEnd}}
          aria-label="Sheet"
          style="position: absolute"
          as |drawer|
        >
          {{state.capture drawer}}
          <div style={{contentStyle state.contentHeight}}></div>
        </MobileDrawer>
      </div>
    </template>,
  );
}

function root(): HTMLElement {
  return find('.mobile-drawer') as HTMLElement;
}

function tray(): HTMLElement {
  return find('.mobile-drawer__tray') as HTMLElement;
}

/** The rendered open distance (px) of the tray, which is `HEIGHT` long. */
function openDistance(): number {
  const matrix = new DOMMatrix(getComputedStyle(tray()).transform);
  return HEIGHT - matrix.m42;
}

/**
 * The values that a spring which aims exactly at `to` renders, one per
 * frame, as the drawer did before #162.
 */
function reference(
  config: Partial<MobileDrawerSpring> | undefined,
  from: number,
  to: number,
  velocity = 0,
): number[] {
  const clock = new FakeClock();
  const values: number[] = [];
  const spring = new Spring({
    ...config,
    clock,
    prefersReducedMotion: () => false,
    onUpdate: ({ value }) => values.push(value),
  });
  spring.set(from, velocity);
  spring.retarget(to);
  void spring.start();
  clock.runUntilIdle(FRAME);
  return values;
}

module('Integration | Component | mobile-drawer | close', function (hooks) {
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

  /** Runs the frames of the animation; returns the open distance of each. */
  async function frames(): Promise<number[]> {
    await settled();
    const offsets: number[] = [];
    while (clock.pendingFrames > 0) {
      clock.frame(FRAME);
      offsets.push(openDistance());
    }
    await settled();
    return offsets;
  }

  async function moveTo(state: State, index: number): Promise<number[]> {
    state.api!.snapTo(index);
    return frames();
  }

  const SPRINGS: [string, Partial<MobileDrawerSpring> | undefined, number][] = [
    // Native iOS: a sheet is off the screen after about 0.27 s.
    ['springPresets.ios', springPresets.ios, 300],
    ['the default spring', undefined, 200],
  ];

  for (const [name, spring, limit] of SPRINGS) {
    test(`${name}: a close from 40% leaves the screen while it still moves`, async function (assert) {
      const state = new State();
      state.spring = spring;
      await renderDrawer(state);
      await moveTo(state, 1);
      assert.strictEqual(openDistance(), 337.6, 'open at 40%');
      state.log = [];

      state.api!.close();
      await settled();
      assert.deepEqual(state.log, ['close:0'], '@onClose when it starts');
      assert.false(root().hasAttribute('data-closed'), 'shows while moving');
      const offsets = await frames();

      const time = offsets.length * FRAME;
      const before = reference(spring, 337.6, 0).length * FRAME;
      assert.true(time <= limit, `closed after ${time} ms (limit ${limit})`);
      assert.true(
        time < before / 2,
        `${time} ms, less than half of ${before} ms when aimed at 0`,
      );
      const step = offsets.at(-3)! - offsets.at(-2)!;
      assert.true(step > 3, `moves ${step} px per frame just before 0`);
      assert.true(
        offsets.every(
          (offset, i) => offset >= 0 && offset <= (offsets[i - 1] ?? 337.6),
        ),
        'never past closed, never back',
      );

      assert.strictEqual(openDistance(), 0, 'at closed');
      assert.true(root().hasAttribute('data-closed'), 'data-closed');
      assert.false(state.api!.isAnimating, 'isAnimating is false');
      assert.strictEqual(state.api!.activeSnapPoint, 0);
      assert.strictEqual(clock.pendingFrames, 0, 'no more frames');
      assert.deepEqual(state.log, ['close:0'], 'no more events');
    });

    test(`${name}: moves between open snap points and opening do not change`, async function (assert) {
      const state = new State();
      state.spring = spring;
      await renderDrawer(state);

      const open = await moveTo(state, 1);
      const up = await moveTo(state, 2);
      const down = await moveTo(state, 1);

      const near = (actual: number[], expected: number[]) =>
        actual.length === expected.length &&
        actual.every((value, i) => Math.abs(value - expected[i]!) < 0.01);
      assert.true(near(open, reference(spring, 0, 337.6)), 'opening');
      // The tray stays at the highest snap point once it is within 0.5 px.
      const top = reference(spring, 337.6, 844);
      const arrived = top.findIndex((value) => value >= 843.5);
      top.fill(844, arrived);
      assert.true(near(up, top), 'up');
      assert.true(near(down, reference(spring, 844, 337.6)), 'down');
    });
  }

  test('a close to a peek (smallest snap point not 0) does not change', async function (assert) {
    const state = new State();
    state.snapPoints = [100, '40%', '100%'];
    state.spring = springPresets.ios;
    await renderDrawer(state);
    await moveTo(state, 1);

    const offsets = await moveTo(state, 0);

    const expected = reference(springPresets.ios, 337.6, 100);
    assert.strictEqual(offsets.length, expected.length, 'same frames');
    assert.true(
      offsets.every((value, i) => Math.abs(value - expected[i]!) < 0.01),
      'same offsets',
    );
    assert.strictEqual(openDistance(), 100);
    assert.false(root().hasAttribute('data-closed'));
  });

  test('a drag release that picks closed leaves the screen while it still moves', async function (assert) {
    const state = new State();
    state.spring = springPresets.ios;
    await renderDrawer(state);
    await moveTo(state, 1);

    await dragDrawer('.mobile-drawer', { distance: -100, velocity: -800 });
    const [end] = state.dragEnds;
    assert.strictEqual(end?.snapPoint, 0, 'picks closed');
    const offsets = await frames();

    const before = reference(
      springPresets.ios,
      end!.offset,
      0,
      end!.velocity,
    ).length;
    assert.true(
      offsets.length < before / 2,
      `${offsets.length} frames, less than half of ${before}`,
    );
    const step = offsets.at(-3)! - offsets.at(-2)!;
    assert.true(step > 3, `moves ${step} px per frame just before 0`);
    assert.true(
      offsets.every((offset) => offset >= 0),
      'never past closed',
    );
    assert.strictEqual(openDistance(), 0);
    assert.true(root().hasAttribute('data-closed'));
    assert.false(state.api!.isAnimating);
  });

  test('with reduced motion a close still jumps to closed', async function (assert) {
    drawerEnvironment.prefersReducedMotion = () => true;
    const state = new State();
    await renderDrawer(state);
    await moveTo(state, 1);
    assert.strictEqual(openDistance(), 337.6, 'open without a frame');

    state.api!.close();
    await settled();

    assert.strictEqual(openDistance(), 0, 'at closed without a frame');
    assert.true(root().hasAttribute('data-closed'));
    assert.false(state.api!.isAnimating);
  });

  test('the scroll reset of a close ends at the scroll start', async function (assert) {
    const state = new State();
    state.contentHeight = 3000;
    state.spring = springPresets.ios;
    await renderDrawer(state);
    await moveTo(state, 2);
    tray().scrollTop = 500;
    assert.strictEqual(tray().scrollTop, 500, 'scrolled');

    state.api!.close();
    await frames();

    assert.strictEqual(tray().scrollTop, 0, 'back at the start');
    assert.strictEqual(openDistance(), 0);
    assert.true(root().hasAttribute('data-closed'));
  });

  test('without a fake clock, settled() waits for the end of a close', async function (assert) {
    delete drawerEnvironment.clock;
    const state = new State();
    state.spring = springPresets.ios;
    await renderDrawer(state);
    state.api!.snapTo(1);
    await settled();
    assert.strictEqual(openDistance(), 337.6, 'open');

    state.api!.close();
    await settled();

    assert.strictEqual(openDistance(), 0);
    assert.true(root().hasAttribute('data-closed'));
    assert.false(state.api!.isAnimating);
  });
});
