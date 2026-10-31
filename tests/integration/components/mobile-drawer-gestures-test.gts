import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { pan } from 'ember-gesture-modifiers/test-support';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';
type Direction = 'up' | 'down' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

// The drawer is embedded in a 400 x 600 px container, so on both axes the
// snap points are at 0, 200 and 400 px and the tray is 400 px long.
const TRAY_LENGTH = 400;

const CLOSING: Record<Placement, Direction> = {
  bottom: 'down',
  top: 'up',
  left: 'left',
  right: 'right',
};
const OPENING: Record<Placement, Direction> = {
  bottom: 'up',
  top: 'down',
  left: 'right',
  right: 'left',
};

// `pan()` drags across the whole target element in 18 steps, so the size of
// the target sets the distance: from 1px inside one edge to 1px inside the
// other, in screen px. didPan recognises the pan once the finger moved more
// than 10 screen px; the drawer follows from there.
//
// ember-qunit scales the test container to 50%, so screen px are half the
// drawer's px. That also covers keeping the drawer under the finger in a
// scaled container. With that scale a grip of
//   SHORT (82px) moves the drawer ~56px,
//   LONG (162px) moves it ~132px.
const SHORT = 82;
const LONG = 162;
/**
 * Fake ms per pointer event for a flick (`pan()` sends each move twice):
 * a SHORT grip in 18ms, ~4300 px/s.
 */
const FLICK = 0.5;

/** Screen px per CSS px of the test container. */
function containerScale(): number {
  const container = document.querySelector<HTMLElement>('#ember-testing')!;
  return container.getBoundingClientRect().width / container.offsetWidth;
}

/** Drawer px per `pan()` step over a grip of `size`. */
function stepSize(size: number): number {
  return (size * containerScale() - 2) / 18 / containerScale();
}

/** How far `pan()` over a grip of `size` moves the drawer after `steps`. */
function moved(size: number, steps = 18): number {
  const scale = containerScale();
  const step = (size * scale - 2) / 18;
  const recognised = Math.floor(10 / step) + 1;
  return (step * (steps - recognised)) / scale;
}

/** Like `moved`, at the last pointer move (step 17) before the release. */
const movedAtLastMove = (size: number) => moved(size, 17);

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = () => el('.mobile-drawer__tray');

/**
 * How far open the tray is, in px, read from its transform. Unlike a plain
 * distance this keeps its sign past fully open (rubber-banding).
 */
function openOffset(placement: Placement, length = TRAY_LENGTH): number {
  const { m41, m42 } = new DOMMatrix(getComputedStyle(tray()).transform);
  return {
    bottom: length - m42,
    top: length + m42,
    left: length + m41,
    right: length - m41,
  }[placement];
}

const near = (actual: number, expected: number, epsilon = 0.01) =>
  Math.abs(actual - expected) <= epsilon;

/**
 * Calls `callback` for every pointer move `pan()` sends while `during` runs.
 * Registered after the drawer's listeners, so it sees the drawer after it
 * handled the move.
 */
async function onEveryMove(
  callback: () => void,
  during: () => Promise<void>,
): Promise<void> {
  document.addEventListener('pointermove', callback);
  try {
    await during();
  } finally {
    document.removeEventListener('pointermove', callback);
  }
}

class State {
  @tracked placement: Placement = 'bottom';
  @tracked active: number | undefined = 2;
  @tracked handleOnly = false;
  @tracked grip = SHORT;
  @tracked snapPoints: SnapPoint[] = [0, 200, 400];
  @tracked showHandle = true;
  changes: number[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const gripStyle = (size: number) =>
  htmlSafe(`width: ${size}px; height: ${size}px`);

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}}>
        <MobileDrawer
          @placement={{state.placement}}
          @snapPoints={{state.snapPoints}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          @handleOnly={{state.handleOnly}}
          style="position: absolute"
          as |drawer|
        >
          <div style={{gripStyle state.grip}} data-test-grip></div>
          {{#if state.showHandle}}
            <div
              style="width: 40px; height: 40px"
              data-test-handle
              {{drawer.handle}}
            ></div>
          {{/if}}
          <output data-test-active>{{drawer.activeSnapPoint}}</output>
          <output data-test-dragging>{{drawer.isDragging}}</output>
        </MobileDrawer>
      </div>
    </template>,
  );
}

module('Integration | Component | mobile-drawer | gestures', function (hooks) {
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

  /**
   * Lets fake time pass with every pointer move `pan()` sends (it sends each
   * move twice), so the release has a velocity. Without this the fake clock
   * stands still during a pan and every release has velocity 0.
   */
  function advanceTimeWhilePanning(msPerEvent: number): () => void {
    const advance = () => (clock.time += msPerEvent);
    document.addEventListener('pointermove', advance, { capture: true });
    return () =>
      document.removeEventListener('pointermove', advance, { capture: true });
  }

  for (const placement of PLACEMENTS) {
    test(`${placement}: dragging maps the finger to the drawer`, async function (assert) {
      const state = new State();
      state.placement = placement;
      state.active = 1;
      state.grip = LONG;
      await renderDrawer(state);
      assert.strictEqual(openOffset(placement), 200);

      let last = 200;
      await onEveryMove(
        () => (last = openOffset(placement)),
        () => pan('[data-test-grip]', OPENING[placement]),
      );
      assert.true(
        near(last, 200 + movedAtLastMove(LONG)),
        `opens 1:1 while moving ${OPENING[placement]} (${last})`,
      );
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, [2], 'settles on the nearest: 400');
      assert.strictEqual(openOffset(placement), 400);

      await onEveryMove(
        () => (last = openOffset(placement)),
        () => pan('[data-test-grip]', CLOSING[placement]),
      );
      assert.true(
        near(last, 400 - movedAtLastMove(LONG)),
        `closes 1:1 while moving ${CLOSING[placement]} (${last})`,
      );
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, [2, 1], 'settles on the nearest: 200');
      assert.strictEqual(openOffset(placement), 200);
    });
  }

  test('a slow drag settles on the nearest snap point', async function (assert) {
    // The fake clock stands still during `pan()`, so every pointer event has
    // the same time: the release velocity must be 0, not NaN or Infinity
    // (which would make the spring and snap-point functions throw).
    const state = new State();
    await renderDrawer(state);

    await pan('[data-test-grip]', 'down');
    assert.dom('[data-test-dragging]').hasText('false');
    assert.true(
      near(openOffset('bottom'), 400 - moved(SHORT)),
      'released where the finger left it',
    );
    assert.deepEqual(state.changes, [], 'not far enough for 200');
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 400, 'back at 400');

    state.grip = LONG;
    await settled();
    await pan('[data-test-grip]', 'down');
    assert.deepEqual(state.changes, [1], 'past halfway to 200');
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 200);
  });

  test('a flick skips a snap point', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    const stop = advanceTimeWhilePanning(FLICK);
    try {
      // The same distance as the slow drag that returned to 400, but in
      // 18ms: ~4300 px/s.
      await pan('[data-test-grip]', 'down');
    } finally {
      stop();
    }

    assert.deepEqual(state.changes, [0], 'skips 200');
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(openOffset('bottom'), 0);
    assert.dom('.mobile-drawer').hasAttribute('data-closed');
  });

  test('catching an animation continues from where it is without a jump', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    state.active = 2;
    await settled();
    clock.frame();
    clock.frame();
    clock.frame();
    const before = openOffset('bottom');
    assert.true(before > 0 && before < 400, `mid-animation (${before})`);

    const seen: number[] = [];
    const dragging: string[] = [];
    await onEveryMove(
      () => {
        seen.push(openOffset('bottom'));
        dragging.push(el('[data-test-dragging]').textContent ?? '');
      },
      () => pan('[data-test-grip]', 'down'),
    );

    assert.strictEqual(seen[0], before, 'starts where the animation was');
    const step = stepSize(SHORT);
    const jumps = seen.slice(1).map((value, i) => value - seen[i]!);
    assert.true(
      jumps.every((jump) => jump <= 0 && jump >= -step - 0.01),
      `follows the finger step by step (${jumps.map((j) => j.toFixed(2)).join(', ')})`,
    );
    assert.true(dragging.includes('true'), 'isDragging while dragging');
    assert.dom('[data-test-dragging]').hasText('false', 'not after');

    clock.runUntilIdle();
    await settled();
    const settledAt = openOffset('bottom');
    assert.true(
      settledAt === 0 || settledAt === 200 || settledAt === 400,
      `settles on a snap point (${settledAt})`,
    );
  });

  test('dragging past the last snap point rubber-bands and springs back', async function (assert) {
    const state = new State();
    state.grip = LONG;
    await renderDrawer(state);

    let max = 0;
    await onEveryMove(
      () => (max = Math.max(max, openOffset('bottom'))),
      () => pan('[data-test-grip]', 'up'),
    );
    const released = openOffset('bottom');
    assert.true(max > 400, `pulled past fully open (${max})`);
    assert.true(
      released - 400 < moved(LONG) * 0.55,
      `with resistance (${released - 400}px for ${moved(LONG)}px)`,
    );
    assert.dom('.mobile-drawer').doesNotHaveAttribute('data-closed');

    clock.frame();
    const first = openOffset('bottom');
    assert.true(
      first <= released && first > 400,
      `springs back from where it was released (${first})`,
    );
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 400);
    assert.deepEqual(state.changes, [], 'stays at 400');
  });

  test('a long pull past fully open shows at most ~24px of overshoot', async function (assert) {
    const state = new State();
    // The grip has to fit in the 400px tray, or the tray grows.
    state.grip = 340;
    state.showHandle = false;
    await renderDrawer(state);

    let max = 0;
    await onEveryMove(
      () => (max = Math.max(max, openOffset('bottom'))),
      () => pan('[data-test-grip]', 'up'),
    );
    assert.true(moved(340) > 250, `a long pull (${moved(340)}px)`);
    assert.true(max > 410, `still rubber-bands (${max - 400}px)`);
    assert.true(max <= 424, `capped at about 24px (${max - 400}px)`);
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 400);
  });

  for (const [end, snapPoints, active, direction] of [
    ['fully open', [0, 200, 400], 2, 'up'],
    ['the first snap point', [100, 200, 400], 0, 'down'],
  ] as const) {
    test(`catching the spring-back past ${end} follows 1:1 back in`, async function (assert) {
      const state = new State();
      state.snapPoints = [...snapPoints];
      state.active = active;
      state.grip = LONG;
      await renderDrawer(state);
      const rest = snapPoints[active];

      await pan('[data-test-grip]', direction);
      clock.frame();
      const before = openOffset('bottom');
      const inward = direction === 'up' ? 'down' : 'up';
      const sign = direction === 'up' ? -1 : 1;

      const seen: number[] = [];
      await onEveryMove(
        () => seen.push(openOffset('bottom')),
        () => pan('[data-test-handle]', inward),
      );
      const after = openOffset('bottom');

      assert.strictEqual(seen[0], before, 'caught where it was');
      assert.true(
        near(after, before + sign * moved(40)),
        `moved ${(after - before).toFixed(2)}px for ${(sign * moved(40)).toFixed(2)}px of finger`,
      );
      assert.true(
        direction === 'up' ? after > rest : after < rest,
        `still past the end (${after})`,
      );
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(openOffset('bottom'), rest);
    });

    test(`catching the spring-back past ${end} continues outwards without a jump`, async function (assert) {
      const state = new State();
      state.snapPoints = [...snapPoints];
      state.active = active;
      state.grip = LONG;
      await renderDrawer(state);
      const rest = snapPoints[active];

      await pan('[data-test-grip]', direction);
      clock.frame();
      const before = openOffset('bottom');
      assert.true(
        direction === 'up' ? before > rest : before < rest,
        `springing back past the end (${before} vs ${rest})`,
      );

      // A short pan on the (40px) handle, which is part of the tray.
      const seen: number[] = [];
      await onEveryMove(
        () => seen.push(openOffset('bottom')),
        () => pan('[data-test-handle]', direction),
      );

      assert.strictEqual(seen[0], before, 'caught where it was');
      const sign = direction === 'up' ? 1 : -1;
      const step = stepSize(40);
      const jumps = seen.slice(1).map((value, i) => (value - seen[i]!) * sign);
      assert.true(
        jumps.every((jump) => jump >= -1e-9 && jump <= step + 0.01),
        `moves a little, the finger's way (${jumps.map((j) => j.toFixed(3)).join(', ')})`,
      );
      assert.true(
        (seen[seen.length - 1]! - before) * sign > 0,
        'moved further past the end',
      );
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(openOffset('bottom'), rest, 'and springs back');
    });
  }

  test('catching an overshoot past the band limit still follows the finger', async function (assert) {
    // The tray (~360px of content) is longer than the largest snap point,
    // so a spring overshoot past 200 is shown in full, beyond the 24px band.
    const state = new State();
    state.snapPoints = [0, 100, 200];
    state.active = 1;
    state.grip = 300;
    await renderDrawer(state);
    const length = parseFloat(getComputedStyle(tray()).height);
    assert.true(length > 250, `a long tray (${length}px)`);
    const offset = () => openOffset('bottom', length);

    const stop = advanceTimeWhilePanning(FLICK);
    try {
      await pan('[data-test-grip]', 'up');
    } finally {
      stop();
    }
    clock.frame();
    clock.frame();
    clock.frame();
    const before = offset();
    assert.true(before - 200 >= 24, `overshooting by ${before - 200}px`);

    const seen: number[] = [];
    await onEveryMove(
      () => seen.push(offset()),
      () => pan('[data-test-handle]', 'down'),
    );
    const after = offset();
    assert.strictEqual(seen[0], before, 'caught where it was');
    assert.true(
      near(after, before - moved(40)),
      `follows the finger back in (${after - before} for ${-moved(40)})`,
    );

    clock.frame();
    const again = offset();
    assert.true(again - 200 >= 24, `still past the limit (${again - 200}px)`);
    const out: number[] = [];
    await onEveryMove(
      () => out.push(offset()),
      () => pan('[data-test-handle]', 'up'),
    );
    assert.strictEqual(out[0], again, 'caught where it was');
    assert.true(
      out.every(
        (value, i) =>
          Number.isFinite(value) && value >= (out[i - 1] ?? value) - 1e-9,
      ) && out[out.length - 1]! - again < 1,
      `barely moves further out, never back (${out.map((v) => (v - again).toFixed(3)).join(', ')})`,
    );

    clock.runUntilIdle();
    await settled();
    assert.strictEqual(offset(), 200);
  });

  test('a touch holds a running animation and lifting resumes it', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);
    state.active = 2;
    await settled();
    clock.frame();
    clock.frame();
    const before = openOffset('bottom');

    const grip = el('[data-test-grip]');
    const send = (type: string) =>
      grip.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
        }),
      );
    send('pointerdown');
    assert.strictEqual(clock.pendingFrames, 0, 'held');
    clock.frame();
    assert.strictEqual(openOffset('bottom'), before, 'stays where it is');

    // A resize meanwhile (the content grows) doesn't move it either.
    state.grip = LONG;
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(openOffset('bottom'), before, 'not moved by a resize');

    send('pointerup');
    assert.true(clock.pendingFrames > 0, 'resumes');
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(openOffset('bottom'), 400);
    assert.dom('[data-test-active]').hasText('2');
  });

  test('removing the handle mid-drag settles the drag', async function (assert) {
    const state = new State();
    state.handleOnly = true;
    await renderDrawer(state);

    let removed = false;
    await onEveryMove(
      () => {
        if (!removed && openOffset('bottom') < 395) {
          removed = true;
          state.showHandle = false;
        }
      },
      () => pan('[data-test-handle]', 'down'),
    );
    await settled();
    assert.true(removed, 'removed mid-drag');
    assert.dom('[data-test-dragging]').hasText('false');
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 400, 'settled on a snap point');

    state.active = 0;
    await settled();
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(openOffset('bottom'), 0, 'still follows the parent');
    assert.dom('.mobile-drawer').hasAttribute('data-closed');
  });

  test('toggling @handleOnly mid-drag settles the drag', async function (assert) {
    const state = new State();
    state.grip = LONG;
    await renderDrawer(state);

    let toggled = false;
    await onEveryMove(
      () => {
        if (!toggled && openOffset('bottom') < 300) {
          toggled = true;
          state.handleOnly = true;
        }
      },
      () => pan('[data-test-grip]', 'down'),
    );
    await settled();
    assert.true(toggled, 'toggled mid-drag');
    assert.dom('[data-test-dragging]').hasText('false');
    clock.runUntilIdle();
    await settled();
    const settledAt = openOffset('bottom');
    assert.true(
      settledAt === 200 || settledAt === 400,
      `settled on a snap point (${settledAt})`,
    );
    assert.strictEqual(tray().style.touchAction, '', 'tray no longer drags');

    state.active = 0;
    await settled();
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 0, 'still follows the parent');
  });

  test('dragging below the first snap point keeps the tray closed', async function (assert) {
    const state = new State();
    state.active = 1;
    state.grip = 302;
    await renderDrawer(state);

    let min = Infinity;
    await onEveryMove(
      () => (min = Math.min(min, openOffset('bottom'))),
      () => pan('[data-test-grip]', 'down'),
    );
    assert.strictEqual(min, 0, 'never pushed further than closed');
    assert.dom('.mobile-drawer').doesNotHaveAttribute('data-closed');
    clock.runUntilIdle();
    await settled();
    assert.deepEqual(state.changes, [0]);
    assert.dom('.mobile-drawer').hasAttribute('data-closed');
  });

  test('controlled, a release asks the parent and follows its answer', async function (assert) {
    const state = new State();
    state.accept = false;
    await renderDrawer(state);

    const stop = advanceTimeWhilePanning(FLICK);
    try {
      await pan('[data-test-grip]', 'down');
    } finally {
      stop();
    }
    assert.deepEqual(state.changes, [0], 'asks for 0');
    assert.dom('[data-test-active]').hasText('2');
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(openOffset('bottom'), 400, 'rejected: back to 400');

    state.accept = true;
    const stopAgain = advanceTimeWhilePanning(FLICK);
    try {
      await pan('[data-test-grip]', 'down');
    } finally {
      stopAgain();
    }
    assert.deepEqual(state.changes, [0, 0]);
    clock.runUntilIdle();
    await settled();
    assert.dom('[data-test-active]').hasText('0');
    assert.strictEqual(openOffset('bottom'), 0, 'accepted');
  });

  test('uncontrolled, a release changes the snap point and calls back', async function (assert) {
    const state = new State();
    state.active = undefined;
    state.accept = false;
    await renderDrawer(state);
    // Uncontrolled drawers start at index 0; open it first.
    state.active = 2;
    await settled();
    clock.runUntilIdle();
    state.active = undefined;
    await settled();

    state.grip = LONG;
    await settled();
    await pan('[data-test-grip]', 'down');
    clock.runUntilIdle();
    await settled();

    assert.deepEqual(state.changes, [1]);
    assert.dom('[data-test-active]').hasText('1');
    assert.strictEqual(openOffset('bottom'), 200);
  });

  test('with @handleOnly only handles start a drag', async function (assert) {
    const state = new State();
    state.handleOnly = true;
    await renderDrawer(state);

    assert.strictEqual(
      tray().style.touchAction,
      '',
      'the tray keeps its native touch behaviour',
    );
    assert.strictEqual(el('[data-test-handle]').style.touchAction, 'pan-x');

    await pan('[data-test-grip]', 'down');
    clock.runUntilIdle();
    assert.strictEqual(openOffset('bottom'), 400, 'the tray does not drag');

    await pan('[data-test-handle]', 'down');
    assert.true(openOffset('bottom') < 400, 'the handle drags');
    clock.runUntilIdle();
    await settled();
    assert.strictEqual(openOffset('bottom'), 400, 'not far enough for 200');

    state.handleOnly = false;
    await settled();
    assert.strictEqual(
      tray().style.touchAction,
      'pan-x pan-y',
      'the tray drags (and scrolls: it is fully open)',
    );
    assert.strictEqual(
      el('[data-test-handle]').style.touchAction,
      '',
      'the handle is a plain element',
    );
  });

  test('without @handleOnly a handle is part of the tray', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    let last = 400;
    await onEveryMove(
      () => (last = openOffset('bottom')),
      () => pan('[data-test-handle]', 'down'),
    );
    // A second pan modifier on the handle would move the drawer twice.
    assert.true(
      near(last, 400 - movedAtLastMove(40)),
      `follows the finger once (${last})`,
    );
  });

  test('mouse input does not drag', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await pan('[data-test-grip]', 'down', 'mouse');
    assert.strictEqual(clock.pendingFrames, 0);
    assert.strictEqual(openOffset('bottom'), 400);
  });

  test('changing the placement mid-drag ends the drag', async function (assert) {
    const state = new State();
    state.grip = LONG;
    await renderDrawer(state);

    let switched = false;
    await onEveryMove(
      () => {
        if (!switched && openOffset('bottom') < 380) {
          switched = true;
          state.placement = 'left';
        }
      },
      () => pan('[data-test-grip]', 'down'),
    );
    await settled();
    clock.runUntilIdle();
    assert.true(switched);
    assert.dom('[data-test-dragging]').hasText('false');
    assert.strictEqual(openOffset('left'), 400, 'at the active snap point');
    assert.deepEqual(state.changes, []);
  });
});
