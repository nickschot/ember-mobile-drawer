import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { TouchPointer } from '#src/-private/gesture/touch-pointer.ts';
import {
  DECELERATION_RATE,
  MIN_MOMENTUM_VELOCITY,
} from '#src/-private/gesture/momentum.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';
type Direction = 'up' | 'down' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

const OPENING: Record<Placement, Direction> = {
  bottom: 'up',
  top: 'down',
  left: 'right',
  right: 'left',
};
const CLOSING: Record<Placement, Direction> = {
  bottom: 'down',
  top: 'up',
  left: 'left',
  right: 'right',
};

const STEP = 4;

const vertical = (placement: Placement) =>
  placement === 'bottom' || placement === 'top';

/**
 * Which way the scroll position moves when the finger moves towards open:
 * a finger moving down or right decreases it (also right-to-left).
 */
const openingSign = (placement: Placement): 1 | -1 =>
  placement === 'bottom' || placement === 'right' ? 1 : -1;

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = () => el('.mobile-drawer__tray');

const position = (placement: Placement) =>
  vertical(placement) ? tray().scrollTop : tray().scrollLeft;

const range = (placement: Placement) =>
  vertical(placement)
    ? tray().scrollHeight - tray().clientHeight
    : tray().scrollWidth - tray().clientWidth;

/**
 * Scrolls the tray to the end of its range where a finger moving towards
 * open can scroll it the whole range. A right-to-left `scrollLeft` runs
 * from `-range` to `0`.
 */
function scrollToOpeningStart(placement: Placement, rtl = false): void {
  const length = range(placement);
  const min = rtl ? -length : 0;
  const max = rtl ? 0 : length;
  const value = openingSign(placement) > 0 ? min : max;
  if (vertical(placement)) tray().scrollTop = value;
  else tray().scrollLeft = value;
}

/** The content's bounce past fully open (its inline `translate`, px). */
function contentBounce(placement: Placement): number {
  const content = tray().querySelector<HTMLElement>('.mobile-drawer__content')!;
  const [x = 0, y = 0] = content.style.translate
    .split(' ')
    .map((part) => parseFloat(part) || 0);
  return { bottom: -y, top: y, left: x, right: -x }[placement];
}

/** How far (screen px) the tray moved towards open since `before`. */
function trayShift(placement: Placement, before: DOMRect): number {
  const now = tray().getBoundingClientRect();
  return {
    bottom: before.top - now.top,
    top: now.bottom - before.bottom,
    left: now.right - before.right,
    right: before.left - now.left,
  }[placement];
}

interface Sample {
  /** How far the tray moved towards open since the finger went down. */
  shift: number;
  /** How far the content scrolled the way an opening finger pushes it. */
  scrolled: number;
  bounce: number;
  /** Whether the touchmove was cancelled. */
  prevented: boolean;
}

/**
 * A finger on the tray's content, see `moves`. It moves and measures in
 * layout px: the test container may be scaled.
 */
class Finger {
  pointer: TouchPointer;
  placement: Placement;
  before: DOMRect;
  from: number;
  /** Screen px per layout px. */
  scale: number;

  constructor(target: HTMLElement, placement: Placement) {
    const rect = tray().getBoundingClientRect();
    const container = el('[data-test-container]').getBoundingClientRect();
    const x =
      (Math.max(rect.left, container.left) +
        Math.min(rect.right, container.right)) /
      2;
    const y =
      (Math.max(rect.top, container.top) +
        Math.min(rect.bottom, container.bottom)) /
      2;
    this.pointer = new TouchPointer(target, x, y);
    this.placement = placement;
    this.before = rect;
    this.from = position(placement);
    this.scale = vertical(placement)
      ? rect.height / tray().offsetHeight
      : rect.width / tray().offsetWidth;
    this.pointer.down();
  }

  /**
   * `steps` moves of `size` layout px in `direction`, with a frame of `ms`
   * after each. Returns a sample after each.
   */
  moves(direction: Direction, steps: number, ms = 16, size = STEP): Sample[] {
    const samples: Sample[] = [];
    const step = size * this.scale;
    const [dx, dy] = {
      up: [0, -step],
      down: [0, step],
      left: [-step, 0],
      right: [step, 0],
    }[direction] as [number, number];
    for (let i = 0; i < steps; i++) {
      const prevented = this.pointer.move(dx, dy);
      clock.frame(ms);
      samples.push({ ...this.sample(), prevented });
    }
    return samples;
  }

  sample(): Omit<Sample, 'prevented'> {
    const { placement } = this;
    return {
      shift: trayShift(placement, this.before) / this.scale,
      scrolled: (position(placement) - this.from) * openingSign(placement),
      bounce: contentBounce(placement),
    };
  }
}

class State {
  @tracked placement: Placement = 'bottom';
  @tracked active = 1;
  @tracked handleOnly = false;
  @tracked snapPoints: SnapPoint[] = [0, 200, '100%'];
  @tracked contentSize = 1000;
  @tracked dir: 'ltr' | 'rtl' = 'ltr';
  changes: number[] = [];

  onChange = (index: number) => {
    this.changes.push(index);
    this.active = index;
  };
}

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const sizeStyle = (size: number) =>
  htmlSafe(`width: ${size}px; height: ${size}px`);

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} dir={{state.dir}} data-test-container>
        <MobileDrawer
          @placement={{state.placement}}
          @snapPoints={{state.snapPoints}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          @handleOnly={{state.handleOnly}}
          style="position: absolute"
          as |drawer|
        >
          <div
            style="width: 40px; height: 40px"
            data-test-handle
            {{drawer.handle}}
          ></div>
          <div style={{sizeStyle state.contentSize}} data-test-content></div>
          <output data-test-dragging>{{drawer.isDragging}}</output>
        </MobileDrawer>
      </div>
    </template>,
  );
  clock.runUntilIdle();
  await settled();
}

/** Distance (px) from the snap point at 200px to fully open. */
const toTop = (placement: Placement) => (vertical(placement) ? 400 : 200);

let clock: FakeClock;

module(
  'Integration | Component | mobile-drawer | drag to scroll',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      clock = new FakeClock();
      drawerEnvironment.clock = clock;
      drawerEnvironment.prefersReducedMotion = () => false;
    });

    hooks.afterEach(function () {
      delete drawerEnvironment.clock;
      delete drawerEnvironment.prefersReducedMotion;
    });

    const cases: [Placement, boolean][] = [
      ...PLACEMENTS.map((placement): [Placement, boolean] => [
        placement,
        false,
      ]),
      ['left', true],
      ['right', true],
    ];
    for (const [placement, rtl] of cases) {
      const name = `${placement}${rtl ? ' (rtl)' : ''}`;
      test(`${name}: one pan drags the tray to the highest snap point and then scrolls the content`, async function (assert) {
        const state = new State();
        state.placement = placement;
        if (rtl) state.dir = 'rtl';
        await renderDrawer(state);
        scrollToOpeningStart(placement, rtl);
        const steps = toTop(placement) / STEP + 30;

        const finger = new Finger(el('[data-test-content]'), placement);
        const samples = finger.moves(OPENING[placement], steps);
        await settled();
        assert.strictEqual(
          el('[data-test-dragging]').textContent,
          'true',
          'dragging',
        );
        const last = samples.at(-1)!;
        assert.strictEqual(last.shift, toTop(placement), 'the tray is at top');
        assert.strictEqual(
          last.scrolled,
          30 * STEP,
          'the content scrolled the rest of the way, 1:1 with the finger',
        );
        assert.true(
          samples.every((sample) => sample.bounce === 0),
          'the content does not bounce',
        );
        assert.true(
          samples.slice(1).every((sample) => sample.prevented),
          'every decided touchmove is cancelled',
        );
        const firstScroll = samples.findIndex((sample) => sample.scrolled > 0);
        assert.true(
          samples
            .slice(firstScroll)
            .every((sample) => sample.shift === toTop(placement)),
          'the tray stays at the top while the content scrolls',
        );
        // After the catch-up at the start of the drag (#105).
        let jump = 0;
        for (let i = 20; i < samples.length; i++) {
          const a = samples[i - 1]!;
          const b = samples[i]!;
          const moved = b.shift + b.scrolled - (a.shift + a.scrolled);
          jump = Math.max(jump, moved - STEP, -moved);
        }
        assert.true(
          jump <= 0.5,
          `no move is larger than the finger's or against it (${jump})`,
        );

        finger.pointer.up();
        await settled();
        clock.runUntilIdle();
        await settled();
        assert.deepEqual(state.changes, [2], 'settles fully open');
        assert.strictEqual(
          getComputedStyle(tray())[
            vertical(placement) ? 'overflowY' : 'overflowX'
          ],
          'auto',
          'the content is unlocked',
        );
      });
    }

    test('the release goes on with a momentum that slows down like a native scroll view', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      // 0.5 px/ms.
      finger.moves('up', toTop('bottom') / STEP + 20, 8);
      const released = tray().scrollTop;
      assert.strictEqual(released, 20 * STEP, 'scrolled 1:1');
      finger.pointer.up();
      await settled();
      const before = finger.sample().shift;
      const steps: number[] = [];
      let last = released;
      for (let i = 0; i < 5; i++) {
        clock.frame(16);
        steps.push(tray().scrollTop - last);
        last = tray().scrollTop;
      }
      // The browser rounds scroll positions to whole px.
      assert.true(
        steps.every(
          (step, i) => step > 0 && (i === 0 || step <= steps[i - 1]!),
        ),
        `the content goes on (${steps.join(', ')})`,
      );
      assert.true(steps.at(-1)! < steps[0]!, 'and slows down');
      assert.true(
        steps[0]! >= 6 && steps[0]! <= 9,
        `with the release velocity (${steps[0]})`,
      );
      clock.runUntilIdle();
      await settled();
      // v / -ln(rate), less what is left below the stop velocity. The
      // release is a little slower: the finger lifts 8ms after its last move.
      const lnRate = -Math.log(DECELERATION_RATE);
      const expected = (0.5 - MIN_MOMENTUM_VELOCITY) / lnRate;
      const moved = tray().scrollTop - released;
      assert.true(
        moved > expected * 0.85 && moved <= expected,
        `it stops after about ${Math.round(expected)}px (${moved})`,
      );
      assert.strictEqual(clock.pendingFrames, 0, 'no frames left');
      assert.strictEqual(finger.sample().shift, before, 'the tray stays');
      assert.deepEqual(state.changes, [2]);
    });

    test('the momentum stops at the content end and never scrolls the page', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      const end = range('bottom');
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      // 2 px/ms: about 1000px of momentum, more than is left.
      finger.moves('up', toTop('bottom') / STEP + 50, 2);
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(tray().scrollTop, end, 'at the content end');
      assert.strictEqual(contentBounce('bottom'), 0, 'no bounce');
      assert.strictEqual(
        document.scrollingElement?.scrollTop ?? 0,
        0,
        'the page does not scroll',
      );
      assert.strictEqual(clock.pendingFrames, 0, 'stopped');
    });

    for (const how of ['touch', 'wheel'] as const) {
      test(`a new ${how} stops the momentum`, async function (assert) {
        const state = new State();
        await renderDrawer(state);
        const finger = new Finger(el('[data-test-content]'), 'bottom');
        finger.moves('up', toTop('bottom') / STEP + 20, 8);
        finger.pointer.up();
        await settled();
        clock.frame(16);
        clock.frame(16);
        const stopped = tray().scrollTop;
        assert.true(stopped > 20 * STEP, 'the momentum runs');
        const content = el('[data-test-content]');
        if (how === 'touch') {
          new TouchPointer(content, 200, 300, { pointerId: 2 }).down();
        } else {
          content.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, cancelable: true }),
          );
        }
        clock.runUntilIdle();
        assert.strictEqual(tray().scrollTop, stopped, 'the content stops');
      });
    }

    test('with reduced motion there is no momentum', async function (assert) {
      drawerEnvironment.prefersReducedMotion = () => true;
      const state = new State();
      state.active = 2;
      await renderDrawer(state);
      // A scroll handoff (#136) whose drag turns back up: the release stays
      // at the active snap point. (A controlled drawer released towards a
      // new snap point first jumps to its active one with reduced motion,
      // which resets the scroll position.)
      tray().scrollTop = 100;
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      finger.moves('down', 5, 8);
      tray().scrollTop = 0;
      finger.moves('down', 10, 8);
      finger.moves('up', 30, 8);
      const released = tray().scrollTop;
      assert.true(released > 0, 'the content scrolled');
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(tray().scrollTop, released, 'stays where it was');
      assert.deepEqual(state.changes, []);
    });

    test('a finger that stops before it lifts has no momentum', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      finger.moves('up', toTop('bottom') / STEP + 20, 8);
      clock.frame(200);
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(tray().scrollTop, 20 * STEP);
    });

    for (const placement of PLACEMENTS) {
      test(`${placement}: a finger that turns back scrolls the content back first, then drags the tray`, async function (assert) {
        const state = new State();
        state.placement = placement;
        await renderDrawer(state);
        scrollToOpeningStart(placement);
        const finger = new Finger(el('[data-test-content]'), placement);
        finger.moves(OPENING[placement], toTop(placement) / STEP + 20);
        const back = finger.moves(CLOSING[placement], 40);
        const scrolledBack = back.findIndex((sample) => sample.scrolled === 0);
        assert.strictEqual(scrolledBack, 19, 'at the content start after 80px');
        assert.true(
          back
            .slice(0, scrolledBack + 1)
            .every((sample) => sample.shift === toTop(placement)),
          'the tray stays while the content scrolls back',
        );
        assert.deepEqual(
          back.slice(scrolledBack).map((sample) => sample.shift),
          Array.from(
            { length: 40 - scrolledBack },
            (_, i) => toTop(placement) - i * STEP,
          ),
          'then the tray follows the finger 1:1',
        );
        assert.true(
          back.slice(scrolledBack).every((sample) => sample.scrolled === 0),
          'and the content stays at its start',
        );
        assert.true(
          back.every((sample) => sample.prevented),
          'cancelled',
        );
        finger.pointer.up();
        await settled();
        clock.runUntilIdle();
        await settled();
        assert.strictEqual(
          finger.sample().scrolled,
          0,
          'no momentum: the content is at its start',
        );
      });
    }

    test('at the content end, the content bounces past fully open, and a turn back undoes the bounce first', async function (assert) {
      const state = new State();
      state.contentSize = 700;
      await renderDrawer(state);
      const end = range('bottom');
      assert.true(end > 50 && end < 200, `the content can scroll (${end}px)`);
      const past = 100;
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      finger.moves('up', toTop('bottom') / STEP);
      finger.moves('up', 1, 16, end);
      const last = finger.moves('up', past / STEP).at(-1)!;
      assert.strictEqual(tray().scrollTop, end, 'scrolled to the end');
      assert.true(
        last.bounce > 0 && last.bounce < past,
        `then the content bounces, less than the finger (${last.bounce})`,
      );
      const back = finger.moves('down', past / STEP + 5);
      const undone = back[past / STEP - 1]!;
      assert.strictEqual(undone.bounce, 0, 'the bounce is undone first');
      assert.strictEqual(undone.scrolled, end, 'at the end');
      assert.strictEqual(tray().scrollTop, end - 20, 'then the content');
      assert.strictEqual(
        document.scrollingElement?.scrollTop ?? 0,
        0,
        'the page does not scroll',
      );
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
    });

    test('a scroll handoff that turns back towards open scrolls the content again', async function (assert) {
      const state = new State();
      state.active = 2;
      await renderDrawer(state);
      tray().scrollTop = 100;
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      // The browser scrolls the content to its start, then the drag takes
      // over.
      finger.moves('down', 5);
      tray().scrollTop = 0;
      const down = finger.moves('down', 10);
      assert.true(down.at(-1)!.shift < 0, 'the tray follows the finger down');
      const lock = getComputedStyle(tray()).overflowY;
      assert.strictEqual(lock, 'hidden', 'the content is locked');
      finger.moves('up', 20);
      assert.true(tray().scrollTop > 0, 'the content scrolls from script');
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(
        getComputedStyle(tray()).overflowY,
        'auto',
        'unlocked after the release',
      );
    });

    test('a drag from a handle stays a drag past fully open', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      const finger = new Finger(el('[data-test-handle]'), 'bottom');
      const samples = finger.moves('up', toTop('bottom') / STEP + 30);
      assert.strictEqual(tray().scrollTop, 0, 'the content does not scroll');
      assert.true(samples.at(-1)!.bounce > 0, 'it bounces');
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(tray().scrollTop, 0);
    });

    test('with @handleOnly a handle drag stays a drag past fully open', async function (assert) {
      const state = new State();
      state.handleOnly = true;
      await renderDrawer(state);
      const finger = new Finger(el('[data-test-handle]'), 'bottom');
      const samples = finger.moves('up', toTop('bottom') / STEP + 30);
      assert.strictEqual(tray().scrollTop, 0, 'the content does not scroll');
      assert.true(samples.at(-1)!.bounce > 0, 'it bounces');
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
    });

    test('content that cannot scroll keeps the bounce past fully open', async function (assert) {
      const state = new State();
      state.contentSize = 100;
      await renderDrawer(state);
      const finger = new Finger(el('[data-test-content]'), 'bottom');
      const samples = finger.moves('up', toTop('bottom') / STEP + 30);
      assert.true(samples.at(-1)!.bounce > 0, 'it bounces');
      finger.pointer.up();
      await settled();
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, [2]);
    });
  },
);
