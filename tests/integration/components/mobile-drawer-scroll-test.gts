import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { pan } from 'ember-gesture-modifiers/test-support';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import { DECISION_SLOP } from '#src/-private/gesture/drag-source.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';
type Direction = 'up' | 'down' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

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

const vertical = (placement: Placement) =>
  placement === 'bottom' || placement === 'top';

/**
 * The end of the content's scroll range that a finger moving `direction`
 * can't scroll past: moving down or right pushes the content towards its
 * start, moving up or left towards its end.
 */
const blockedEnd = (direction: Direction): 'start' | 'end' =>
  direction === 'down' || direction === 'right' ? 'start' : 'end';

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

const tray = () => el('.mobile-drawer__tray');

/** Scrolls `element` along the drawer's axis to its start, middle or end. */
function scrollTo(
  element: HTMLElement,
  placement: Placement,
  where: 'start' | 'middle' | 'end',
): void {
  const range = vertical(placement)
    ? element.scrollHeight - element.clientHeight
    : element.scrollWidth - element.clientWidth;
  const position = { start: 0, middle: Math.round(range / 2), end: range }[
    where
  ];
  if (vertical(placement)) element.scrollTop = position;
  else element.scrollLeft = position;
}

const scrollPosition = (element: HTMLElement, placement: Placement) =>
  vertical(placement) ? element.scrollTop : element.scrollLeft;

/**
 * How far the tray is on screen from where it was in `before`, in screen px
 * along the axis, positive when it moved towards open.
 */
function trayShift(placement: Placement, before: DOMRect): number {
  const now = tray().getBoundingClientRect();
  return {
    bottom: before.top - now.top,
    top: now.bottom - before.bottom,
    left: now.right - before.right,
    right: before.left - now.left,
  }[placement];
}

interface GestureResult {
  /** How far the tray moved by the last move (see `trayShift`). */
  shift: number;
  /** Whether the drawer said it was dragging at the last move. */
  dragging: boolean;
  /** `defaultPrevented` of every `touchmove`. */
  prevented: boolean[];
}

const STEP = 4;

/**
 * A one-finger gesture on `target`, as a browser sends it for touch input:
 * pointer events and touch events, `steps` moves of 4 screen px each in
 * `direction`, after the moves in `path` (screen px) and `sideways` moves
 * across it. `during(step)` runs after each move. With `outside`, another
 * finger rests outside the drawer the whole time. Unlike `pan()`, events are
 * only dispatched on the target, the finger starts in the middle of the
 * visible tray and ends where it was.
 */
async function gesture(
  target: HTMLElement,
  direction: Direction,
  steps: number,
  options: {
    path?: [number, number][];
    outside?: boolean;
    sideways?: number;
    during?: (step: number) => void;
    then?: { direction: Direction; steps: number };
    /** Where the finger goes down, instead of the middle of the tray. */
    start?: { x: number; y: number };
  } = {},
): Promise<GestureResult> {
  const container = el('[data-test-container]').getBoundingClientRect();
  const rect = tray().getBoundingClientRect();
  let x =
    (Math.max(rect.left, container.left) +
      Math.min(rect.right, container.right)) /
    2;
  let y =
    (Math.max(rect.top, container.top) +
      Math.min(rect.bottom, container.bottom)) /
    2;
  if (options.start) ({ x, y } = options.start);
  const before = rect;
  const pointerId = 1;

  const touchAt = () =>
    new Touch({ identifier: pointerId, target, clientX: x, clientY: y });
  // Another finger resting on the page outside the drawer, listed first.
  const outside = options.outside
    ? [
        new Touch({
          identifier: 9,
          target: document.body,
          clientX: 1,
          clientY: 1,
        }),
      ]
    : [];
  const pointer = (type: string) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
      }),
    );
  const touch = (type: string, down: boolean) => {
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: down ? [...outside, touchAt()] : outside,
      targetTouches: down ? [touchAt()] : [],
      changedTouches: [touchAt()],
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const prevented: boolean[] = [];
  const move = (dx: number, dy: number) => {
    x += dx;
    y += dy;
    pointer('pointermove');
    prevented.push(touch('touchmove', true));
  };
  const delta = (d: Direction): [number, number] =>
    ({
      up: [0, -STEP],
      down: [0, STEP],
      left: [-STEP, 0],
      right: [STEP, 0],
    })[d] as [number, number];
  const across = (d: Direction): [number, number] =>
    d === 'up' || d === 'down' ? [STEP, 0] : [0, STEP];

  pointer('pointerdown');
  touch('touchstart', true);
  for (const [dx, dy] of options.path ?? []) move(dx, dy);
  for (let i = 0; i < (options.sideways ?? 0); i++) move(...across(direction));
  let step = 0;
  for (let i = 0; i < steps; i++) {
    move(...delta(direction));
    options.during?.(++step);
  }
  if (options.then) {
    for (let i = 0; i < options.then.steps; i++) {
      move(...delta(options.then.direction));
      options.during?.(++step);
    }
  }
  await settled();
  const result = {
    shift: trayShift(
      (el('.mobile-drawer').dataset['placement'] as Placement | undefined) ??
        'bottom',
      before,
    ),
    dragging: el('[data-test-dragging]').textContent === 'true',
    prevented,
  };
  pointer('pointerup');
  touch('touchend', false);
  await settled();
  return result;
}

class State {
  @tracked placement: Placement = 'bottom';
  @tracked active = 2;
  @tracked handleOnly = false;
  @tracked snapPoints: SnapPoint[] = [0, 200, '100%'];
  /** Size of the content block, in px on both axes. */
  @tracked contentSize = 1000;
  @tracked nested = false;
  /** Size of a block after the nested scrollers, in px. */
  @tracked filler = 0;
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
const scrollerStyle = htmlSafe(
  'width: 300px; height: 150px; overflow: auto; overscroll-behavior: contain',
);

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}} data-test-container>
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
          {{#if state.nested}}
            <div
              style={{scrollerStyle}}
              data-mobile-drawer-scroll
              data-test-nested
            >
              <div style={{sizeStyle 1000}} data-test-nested-content></div>
            </div>
            <div style={{scrollerStyle}} data-test-unmarked>
              <div style={{sizeStyle 1000}} data-test-unmarked-content></div>
            </div>
            <div style={{sizeStyle 60}} data-test-outside></div>
            <div style={{sizeStyle state.filler}}></div>
          {{else}}
            <div style={{sizeStyle state.contentSize}} data-test-content></div>
          {{/if}}
          <output data-test-dragging>{{drawer.isDragging}}</output>
        </MobileDrawer>
      </div>
    </template>,
  );
  clock.runUntilIdle();
  await settled();
}

let clock: FakeClock;

module(
  'Integration | Component | mobile-drawer | scroll vs drag',
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

    for (const placement of PLACEMENTS) {
      const axisPan = vertical(placement) ? 'pan-x' : 'pan-y';

      test(`${placement}: at the highest snap point the content scrolls and the tray may pan both ways`, async function (assert) {
        const state = new State();
        state.placement = placement;
        await renderDrawer(state);
        assert.strictEqual(tray().style.touchAction, 'pan-x pan-y');

        scrollTo(tray(), placement, 'middle');
        const scrolled = scrollPosition(tray(), placement);
        for (const direction of [CLOSING[placement], OPENING[placement]]) {
          const result = await gesture(
            el('[data-test-content]'),
            direction,
            10,
          );
          assert.false(result.dragging, `${direction}: not dragging`);
          assert.strictEqual(result.shift, 0, `${direction}: the tray stays`);
          assert.false(
            result.prevented.some(Boolean),
            `${direction}: touchmoves are left to the browser`,
          );
        }
        // The browser scrolls; synthetic events don't, so nothing moved.
        assert.strictEqual(scrollPosition(tray(), placement), scrolled);
        clock.runUntilIdle();
        assert.deepEqual(state.changes, []);
      });

      test(`${placement}: at the highest snap point and the content's end, dragging towards close moves the drawer`, async function (assert) {
        const state = new State();
        state.placement = placement;
        await renderDrawer(state);
        scrollTo(tray(), placement, blockedEnd(CLOSING[placement]));

        const result = await gesture(
          el('[data-test-content]'),
          CLOSING[placement],
          30,
        );
        assert.true(result.dragging, 'dragging');
        assert.true(result.shift < -80, `the tray follows (${result.shift})`);
        assert.true(
          result.prevented.length > 0 && result.prevented.every(Boolean),
          'every touchmove is cancelled, so the content does not scroll',
        );
        clock.runUntilIdle();
        await settled();
        assert.deepEqual(state.changes, [1], 'settles lower');
      });

      test(`${placement}: at the highest snap point and the content's end, dragging towards open rubber-bands`, async function (assert) {
        const state = new State();
        state.placement = placement;
        await renderDrawer(state);
        scrollTo(tray(), placement, blockedEnd(OPENING[placement]));

        const result = await gesture(
          el('[data-test-content]'),
          OPENING[placement],
          30,
        );
        assert.true(result.dragging, 'dragging');
        assert.true(
          result.shift > 0 && result.shift < 24,
          `pulled a little past fully open (${result.shift})`,
        );
        assert.true(result.prevented.every(Boolean), 'touchmoves cancelled');
        clock.runUntilIdle();
        await settled();
        assert.deepEqual(state.changes, []);
      });

      test(`${placement}: below the highest snap point every gesture drags`, async function (assert) {
        const state = new State();
        state.placement = placement;
        state.active = 1;
        await renderDrawer(state);
        assert.strictEqual(
          tray().style.touchAction,
          axisPan,
          'the browser may only pan across the axis',
        );
        scrollTo(tray(), placement, 'middle');

        const opening = await gesture(
          el('[data-test-content]'),
          OPENING[placement],
          12,
        );
        assert.true(opening.dragging, 'towards open drags');
        assert.true(opening.shift > 20, `expands (${opening.shift})`);
        assert.true(
          opening.prevented.length > 0 && opening.prevented.every(Boolean),
          'touchmoves are cancelled, not left to touch-action',
        );
        clock.runUntilIdle();
        await settled();
        assert.deepEqual(state.changes, [], 'not far enough for the next one');

        const closing = await gesture(
          el('[data-test-content]'),
          CLOSING[placement],
          12,
        );
        assert.true(closing.dragging, 'towards close drags too');
        assert.true(closing.shift < -20, `closes (${closing.shift})`);
        assert.true(closing.prevented.every(Boolean), 'touchmoves cancelled');
      });

      test(`${placement}: below the highest snap point the tray and marked scrollers can't scroll along the axis`, async function (assert) {
        const state = new State();
        state.placement = placement;
        state.nested = true;
        state.filler = 1000;
        await renderDrawer(state);
        const nested = el('[data-test-nested]');
        const unmarked = el('[data-test-unmarked]');
        const [along, across] = vertical(placement)
          ? (['overflowY', 'overflowX'] as const)
          : (['overflowX', 'overflowY'] as const);
        const overflow = (
          element: HTMLElement,
          which: 'overflowX' | 'overflowY',
        ) => getComputedStyle(element)[which];

        assert.strictEqual(overflow(tray(), along), 'auto', 'top: tray');
        assert.strictEqual(overflow(nested, along), 'auto', 'top: marked');
        scrollTo(tray(), placement, 'middle');
        scrollTo(nested, placement, 'middle');
        const trayScroll = scrollPosition(tray(), placement);
        const nestedScroll = scrollPosition(nested, placement);
        assert.true(trayScroll > 0 && nestedScroll > 0, 'scrolled');

        state.active = 1;
        await settled();
        clock.frame();
        assert.strictEqual(
          overflow(tray(), along),
          'hidden',
          'locked as soon as it leaves the top',
        );
        clock.runUntilIdle();
        assert.strictEqual(overflow(tray(), along), 'hidden', 'tray locked');
        assert.strictEqual(overflow(nested, along), 'hidden', 'marked locked');
        assert.strictEqual(overflow(tray(), across), 'auto', 'tray: across');
        assert.strictEqual(overflow(nested, across), 'auto', 'marked: across');
        assert.strictEqual(
          overflow(unmarked, along),
          'auto',
          'unmarked scrollers are left alone',
        );
        assert.strictEqual(
          scrollPosition(tray(), placement),
          trayScroll,
          'tray keeps its scroll position',
        );
        assert.strictEqual(scrollPosition(nested, placement), nestedScroll);

        const result = await gesture(
          el('[data-test-nested-content]'),
          OPENING[placement],
          12,
        );
        assert.true(result.dragging, 'a gesture on the marked scroller drags');
        assert.true(result.prevented.every(Boolean));
        clock.runUntilIdle();
        await settled();

        state.active = 2;
        await settled();
        clock.frame();
        assert.strictEqual(overflow(tray(), along), 'hidden', 'until the top');
        clock.runUntilIdle();
        assert.strictEqual(overflow(tray(), along), 'auto', 'unlocked');
        assert.strictEqual(overflow(nested, along), 'auto');
        assert.strictEqual(
          nested.style.overflow,
          'auto',
          "the scroller's own inline overflow is back",
        );
        assert.strictEqual(scrollPosition(tray(), placement), trayScroll);
        assert.strictEqual(scrollPosition(nested, placement), nestedScroll);
      });

      test(`${placement}: half open, a drag that turns sideways before it starts is released`, async function (assert) {
        const state = new State();
        state.placement = placement;
        state.active = 1;
        await renderDrawer(state);
        // 5px along the axis decides a drag; didPan only starts one past
        // 10px. The swipe then goes across, e.g. a carousel.
        const across: Direction = vertical(placement) ? 'right' : 'down';
        const lean: [number, number] = vertical(placement) ? [0, -5] : [-5, 0];
        const result = await gesture(el('[data-test-content]'), across, 10, {
          path: [lean],
        });
        assert.true(result.prevented[0], 'decided to drag');
        assert.false(
          result.prevented.slice(2).some(Boolean),
          'released once it went sideways',
        );
        assert.false(result.dragging, 'never dragged');
        assert.strictEqual(result.shift, 0);
      });

      for (const active of [1, 2]) {
        const where = active === 2 ? 'fully open' : 'half open';
        test(`${placement}: ${where}, a swipe across the axis that leans along it is left to the browser`, async function (assert) {
          const state = new State();
          state.placement = placement;
          state.active = active;
          await renderDrawer(state);
          scrollTo(tray(), placement, 'middle');
          // First moves as [along, across]; the swipe then goes across.
          const leans: [number, number][] = [
            [1, 0],
            [3, -1],
            [-2, -2],
            [-1, 0],
            [-2, -1],
          ];
          const across: Direction = vertical(placement) ? 'left' : 'up';
          for (const [along, sideways] of leans) {
            const result = await gesture(
              el('[data-test-content]'),
              across,
              12,
              {
                path: [
                  vertical(placement) ? [sideways, along] : [along, sideways],
                ],
              },
            );
            assert.false(
              result.prevented.some(Boolean),
              `lean ${along},${sideways}: no touchmove cancelled`,
            );
            assert.false(result.dragging, `lean ${along},${sideways}: no drag`);
            assert.strictEqual(result.shift, 0);
          }
        });
      }

      test(`${placement}: touch-action follows whether the drawer is fully open`, async function (assert) {
        const state = new State();
        state.placement = placement;
        state.active = 0;
        await renderDrawer(state);
        assert.strictEqual(tray().style.touchAction, axisPan, 'closed');
        state.active = 2;
        await settled();
        clock.frame();
        assert.strictEqual(tray().style.touchAction, axisPan, 'opening');
        clock.runUntilIdle();
        assert.strictEqual(tray().style.touchAction, 'pan-x pan-y', 'open');
        state.active = 1;
        await settled();
        clock.frame();
        assert.strictEqual(tray().style.touchAction, axisPan, 'closing');
      });
    }

    test('a gesture that scrolls never turns into a drag, even at the scroll start', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'middle');

      let dragging = false;
      const result = await gesture(el('[data-test-content]'), 'down', 40, {
        during: (step) => {
          // The browser scrolls the content (with momentum) to the top.
          if (step === 5) tray().scrollTop = 0;
          dragging ||= el('[data-test-dragging]').textContent === 'true';
        },
      });
      await settled();
      assert.false(dragging || result.dragging, 'never dragged');
      assert.strictEqual(result.shift, 0, 'the tray stayed');
      assert.false(result.prevented.some(Boolean), 'left to the browser');
      assert.strictEqual(tray().scrollTop, 0, 'at the scroll start now');

      const next = await gesture(el('[data-test-content]'), 'down', 30);
      assert.true(next.dragging, 'the next gesture drags');
      assert.true(next.shift < -80, `moves the drawer (${next.shift})`);
    });

    test('half open, a fast first touchmove from near the tray edge decides and is cancelled', async function (assert) {
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      const handle = el('[data-test-handle]');
      const rect = handle.getBoundingClientRect();
      const top = tray().getBoundingClientRect().top;
      // A grabber-like spot about 12px below the tray's top edge. The first
      // touchmove jumps 25px straight up, past the tray's edge, before iOS
      // could have seen a slower start.
      const start = { x: rect.left + rect.width / 2, y: top + 12 };
      const result = await gesture(handle, 'up', 10, {
        start,
        path: [[0, -25]],
      });
      assert.true(result.prevented[0], 'the very first touchmove is cancelled');
      assert.true(result.prevented.every(Boolean), 'and every one after it');
      assert.true(result.dragging, 'drags');
      assert.true(result.shift > 30, `the drawer follows (${result.shift})`);
    });

    test('a drag keeps dragging when the finger turns around', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');

      const result = await gesture(el('[data-test-content]'), 'down', 30, {
        then: { direction: 'up', steps: 20 },
      });
      assert.true(result.dragging, 'still dragging');
      assert.true(
        // 30 steps down, 20 back up: 40 screen px down, less didPan's 10px.
        result.shift < -20 && result.shift > -40,
        `the tray followed back up (${result.shift})`,
      );
      assert.true(result.prevented.every(Boolean), 'never scrolls');
    });

    test('the direction is decided along the axis, not by a sideways start', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');

      const result = await gesture(el('[data-test-content]'), 'down', 30, {
        sideways: 2,
      });
      // 8px sideways first: undecided until the finger has moved further
      // down than sideways (the 5th move), then it drags.
      assert.false(result.prevented[0], 'the sideways moves are left alone');
      assert.false(result.prevented[3], 'not yet further down than sideways');
      assert.true(result.prevented.slice(4).every(Boolean), 'then it drags');
      assert.true(result.dragging);
    });

    test('a drawer whose content fits always drags', async function (assert) {
      const state = new State();
      state.contentSize = 100;
      await renderDrawer(state);

      const down = await gesture(el('[data-test-content]'), 'down', 30);
      assert.true(down.dragging, 'towards close');
      clock.runUntilIdle();
      await settled();
      state.active = 2;
      await settled();
      clock.runUntilIdle();
      const up = await gesture(el('[data-test-content]'), 'up', 10);
      assert.true(up.dragging, 'towards open');
    });

    test('a marked nested scroll container scrolls first', async function (assert) {
      const state = new State();
      state.nested = true;
      state.snapPoints = [0, 200, 'content'];
      await renderDrawer(state);
      assert.strictEqual(
        tray().scrollHeight,
        tray().clientHeight,
        'the tray itself does not scroll',
      );
      const nested = el('[data-test-nested]');
      nested.scrollTop = 100;

      const inside = await gesture(
        el('[data-test-nested-content]'),
        'down',
        30,
      );
      assert.false(inside.dragging, 'inside it, the gesture scrolls it');
      assert.strictEqual(inside.shift, 0);
      assert.false(inside.prevented.some(Boolean));

      const outside = await gesture(el('[data-test-outside]'), 'down', 30);
      assert.true(outside.dragging, 'outside it, the gesture drags');
      clock.runUntilIdle();
      await settled();
      state.active = 2;
      await settled();
      clock.runUntilIdle();

      nested.scrollTop = 0;
      const atStart = await gesture(
        el('[data-test-nested-content]'),
        'down',
        30,
      );
      assert.true(atStart.dragging, 'at its scroll start, the gesture drags');
      clock.runUntilIdle();
      await settled();
      state.active = 2;
      await settled();
      clock.runUntilIdle();

      const up = await gesture(el('[data-test-nested-content]'), 'up', 10);
      assert.false(up.dragging, 'towards its end, it scrolls');
    });

    test('an unmarked nested scroll container does not take part', async function (assert) {
      const state = new State();
      state.nested = true;
      state.snapPoints = [0, 200, 'content'];
      await renderDrawer(state);
      el('[data-test-unmarked]').scrollTop = 100;

      const result = await gesture(
        el('[data-test-unmarked-content]'),
        'down',
        30,
      );
      assert.true(result.dragging, 'drags');
      assert.true(result.prevented.every(Boolean));
    });

    test('a touch on a moving drawer holds it, and a gesture then drags', async function (assert) {
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'middle');
      state.active = 2;
      await settled();
      clock.frame();
      clock.frame();
      assert.true(clock.pendingFrames > 0, 'opening');

      const result = await gesture(el('[data-test-content]'), 'down', 20);
      assert.true(
        result.dragging,
        'caught below the highest snap point: drags',
      );
      assert.true(result.prevented.every(Boolean), 'touchmoves cancelled');
    });

    test('dragging down from the top locks the content once it leaves the top', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');
      const locks: string[] = [];
      await gesture(el('[data-test-content]'), 'down', 10, {
        during: () => locks.push(getComputedStyle(tray()).overflowY),
      });
      assert.strictEqual(locks[0], 'auto', 'at the top before the drag');
      assert.strictEqual(locks[locks.length - 1], 'hidden', 'below it');
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, [], 'springs back to the top');
      assert.strictEqual(getComputedStyle(tray()).overflowY, 'auto');
    });

    test('data-expanded marks resting at or heading for the highest snap point', async function (assert) {
      const root = () => el('.mobile-drawer');
      const expanded = () => root().hasAttribute('data-expanded');
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      assert.false(expanded(), 'at rest half open');

      state.active = 2;
      await settled();
      clock.frame();
      assert.true(expanded(), 'set as soon as it heads for the top');
      clock.runUntilIdle();
      assert.true(expanded(), 'at rest at the top');

      // Small movements at the top: down a little and back up.
      scrollTo(tray(), 'bottom', 'start');
      const during: boolean[] = [];
      const wobble = await gesture(el('[data-test-content]'), 'down', 8, {
        then: { direction: 'up', steps: 8 },
        during: () => during.push(expanded()),
      });
      assert.true(wobble.dragging, 'dragged');
      assert.true(during.every(Boolean), 'kept during the drag');
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, []);
      assert.true(expanded(), 'back at the top');

      const down: boolean[] = [];
      await gesture(el('[data-test-content]'), 'down', 40, {
        during: () => down.push(expanded()),
      });
      assert.true(down.every(Boolean), 'kept until the drag is released');
      assert.deepEqual(state.changes, [1], 'released towards half open');
      assert.false(expanded(), 'removed on release');
      clock.runUntilIdle();
      assert.false(expanded());

      state.active = 0;
      await settled();
      clock.runUntilIdle();
      assert.false(expanded(), 'closed');
    });

    test('data-expanded is not set when the highest snap point is closed', async function (assert) {
      const state = new State();
      state.snapPoints = [0];
      state.active = 0;
      await renderDrawer(state);
      assert.false(el('.mobile-drawer').hasAttribute('data-expanded'));
    });

    test('a marked scroller added below the highest snap point is locked when touched', async function (assert) {
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      const added = document.createElement('div');
      added.setAttribute('data-mobile-drawer-scroll', '');
      added.style.cssText = 'height: 100px; overflow-y: scroll';
      const inner = document.createElement('div');
      inner.style.height = '500px';
      added.append(inner);
      el('.mobile-drawer__content').prepend(added);
      assert.strictEqual(getComputedStyle(added).overflowY, 'scroll');

      const result = await gesture(inner, 'up', 10);
      assert.strictEqual(getComputedStyle(added).overflowY, 'hidden');
      assert.true(result.dragging);

      state.active = 2;
      await settled();
      clock.runUntilIdle();
      assert.strictEqual(added.style.overflowY, 'scroll', 'restored');
      added.remove();
    });

    test('with @handleOnly the content is locked below the highest snap point too', async function (assert) {
      const state = new State();
      state.active = 1;
      state.handleOnly = true;
      await renderDrawer(state);
      assert.strictEqual(
        getComputedStyle(tray()).overflowY,
        'hidden',
        'half open: locked',
      );
      assert.strictEqual(tray().style.touchAction, '', 'not a drag source');

      const content = await gesture(el('[data-test-content]'), 'up', 12);
      assert.false(content.dragging, 'the content does not drag');
      const handle = await gesture(el('[data-test-handle]'), 'up', 30);
      assert.true(handle.dragging, 'the handle drags');
      clock.runUntilIdle();
      await settled();
      assert.deepEqual(state.changes, [2], 'opened fully');
      assert.strictEqual(getComputedStyle(tray()).overflowY, 'auto', 'open');

      state.handleOnly = false;
      await settled();
      state.active = 1;
      await settled();
      clock.runUntilIdle();
      assert.strictEqual(getComputedStyle(tray()).overflowY, 'hidden');
    });

    for (const placement of PLACEMENTS) {
      test(`${placement}: with @handleOnly at 50%, a swipe along the axis is cancelled without dragging`, async function (assert) {
        const state = new State();
        state.placement = placement;
        state.active = 1;
        state.handleOnly = true;
        await renderDrawer(state);

        for (const direction of [OPENING[placement], CLOSING[placement]]) {
          const result = await gesture(
            el('[data-test-content]'),
            direction,
            12,
          );
          assert.true(
            result.prevented.length > 0 && result.prevented.every(Boolean),
            `${direction}: touchmoves cancelled, so the page can't scroll`,
          );
          assert.false(result.dragging, `${direction}: no drag`);
          assert.strictEqual(result.shift, 0, `${direction}: the tray stays`);
        }

        // Sideways, also with a slight lean along the axis first.
        const across: Direction = vertical(placement) ? 'left' : 'up';
        for (const [along, sideways] of [
          [0, 0],
          [3, -1],
          [-2, -2],
        ] as [number, number][]) {
          const result = await gesture(el('[data-test-content]'), across, 12, {
            path: [vertical(placement) ? [sideways, along] : [along, sideways]],
          });
          assert.false(
            result.prevented.some(Boolean),
            `across, lean ${along},${sideways}: left to the browser`,
          );
        }

        // Decided along the axis, then sideways before 10px: released.
        const lean: [number, number] = vertical(placement) ? [0, -5] : [-5, 0];
        const turned = await gesture(
          el('[data-test-content]'),
          vertical(placement) ? 'right' : 'down',
          10,
          { path: [lean] },
        );
        assert.true(turned.prevented[0], 'decided along the axis');
        assert.false(
          turned.prevented.slice(2).some(Boolean),
          'released once it went sideways',
        );
        clock.runUntilIdle();
        await settled();
        assert.deepEqual(state.changes, [], 'never moved the drawer');
      });
    }

    test('with @handleOnly at the highest snap point, content swipes are left to the browser', async function (assert) {
      const state = new State();
      state.handleOnly = true;
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'middle');
      for (const direction of ['up', 'down'] as const) {
        const result = await gesture(el('[data-test-content]'), direction, 12);
        assert.false(result.prevented.some(Boolean), `${direction}: scrolls`);
        assert.false(result.dragging);
      }
    });

    test('the scroll lock follows the placement', async function (assert) {
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      assert.strictEqual(getComputedStyle(tray()).overflowY, 'hidden');

      state.placement = 'left';
      await settled();
      clock.runUntilIdle();
      assert.strictEqual(tray().style.overflowY, '', 'vertical lock removed');
      assert.strictEqual(getComputedStyle(tray()).overflowX, 'hidden');
    });

    test('an app that rewrites a locked inline style is locked again, and keeps its own value', async function (assert) {
      const state = new State();
      state.nested = true;
      state.active = 1;
      await renderDrawer(state);
      const nested = el('[data-test-nested]');
      assert.strictEqual(nested.style.overflowY, 'hidden', 'locked');

      // The app rewrites the whole inline style (like a `style=` binding).
      nested.style.cssText =
        'width: 300px; height: 150px; overflow: scroll; overscroll-behavior: contain';
      nested.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, deltaY: 10 }),
      );
      assert.strictEqual(nested.style.overflowY, 'hidden', 'a wheel relocks');

      nested.style.overflowY = 'auto';
      el('[data-test-nested-content]').dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'mouse',
        }),
      );
      assert.strictEqual(nested.style.overflowY, 'hidden', 'a pointer relocks');

      state.active = 2;
      await settled();
      clock.runUntilIdle();
      assert.strictEqual(
        nested.style.overflowY,
        'auto',
        "unlocked to the app's latest value",
      );

      state.active = 1;
      await settled();
      clock.runUntilIdle();
      nested.style.overflowY = 'scroll';
      state.active = 2;
      await settled();
      clock.runUntilIdle();
      assert.strictEqual(
        nested.style.overflowY,
        'scroll',
        "a value the app set while locked isn't overwritten on unlock",
      );
    });

    test('a marked scroller added while locked is locked when focus moves into it', async function (assert) {
      const state = new State();
      state.active = 1;
      await renderDrawer(state);
      const added = document.createElement('div');
      added.setAttribute('data-mobile-drawer-scroll', '');
      added.style.cssText = 'height: 100px; overflow-y: auto';
      const input = document.createElement('input');
      added.append(input);
      el('.mobile-drawer__content').prepend(added);
      input.focus();
      assert.strictEqual(added.style.overflowY, 'hidden');
      added.remove();
    });

    test('a slight move along the axis does not decide the gesture', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');

      const result = await gesture(el('[data-test-content]'), 'down', 10, {
        path: [[0, 3]],
      });
      assert.false(result.prevented[0], `under ${DECISION_SLOP}px: undecided`);
      assert.true(result.prevented.slice(1).every(Boolean), 'then it drags');
      assert.true(result.dragging);
    });

    test('a drag that turns sideways before it starts is released', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');

      // 5px down decides a drag; didPan only starts one past 10px.
      const result = await gesture(el('[data-test-content]'), 'right', 10, {
        path: [[0, 5]],
      });
      assert.true(result.prevented[0], 'decided to drag');
      assert.false(
        result.prevented.slice(2).some(Boolean),
        'released once it went sideways',
      );
      assert.false(result.dragging, 'never dragged');
      assert.strictEqual(result.shift, 0);
    });

    test('only the finger that started on the tray counts', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'middle');

      const scroll = await gesture(el('[data-test-content]'), 'down', 10, {
        outside: true,
      });
      assert.false(scroll.dragging, 'scrolls');
      assert.false(scroll.prevented.some(Boolean));

      // The tray's finger lifted while the outside one stays down: the next
      // gesture is decided afresh.
      tray().scrollTop = 0;
      const drag = await gesture(el('[data-test-content]'), 'down', 30, {
        outside: true,
      });
      assert.true(drag.dragging, 'drags');
      assert.true(
        drag.prevented.every(Boolean),
        "decided by the tray's finger, which moved",
      );
    });

    test('a gesture whose touched element was removed does not decide the next one', async function (assert) {
      const state = new State();
      state.nested = true;
      state.snapPoints = [0, 200, 'content'];
      await renderDrawer(state);
      el('[data-test-nested]').scrollTop = 100;

      // A scroll gesture whose element disappears: its touchend never
      // reaches the document.
      const target = el('[data-test-nested-content]');
      const touch = (type: string, touches: Touch[]) =>
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            changedTouches: [
              new Touch({ identifier: 3, target, clientX: 100, clientY: 100 }),
            ],
          }),
        );
      const down = new Touch({
        identifier: 3,
        target,
        clientX: 100,
        clientY: 100,
      });
      touch('touchstart', [down]);
      touch('touchmove', [
        new Touch({ identifier: 3, target, clientX: 100, clientY: 120 }),
      ]);
      state.nested = false;
      await settled();
      target.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, touches: [] }),
      );

      const result = await gesture(el('[data-test-content]'), 'down', 30);
      assert.true(result.dragging, 'a new gesture: drags');
      assert.true(result.prevented.every(Boolean));
    });

    test('with @handleOnly the handle always drags and the tray is left alone', async function (assert) {
      const state = new State();
      state.handleOnly = true;
      await renderDrawer(state);
      assert.strictEqual(tray().style.touchAction, '');
      assert.strictEqual(el('[data-test-handle]').style.touchAction, 'pan-x');
      scrollTo(tray(), 'bottom', 'middle');

      const content = await gesture(el('[data-test-content]'), 'down', 30);
      assert.false(content.dragging, 'the content does not drag');
      assert.false(content.prevented.some(Boolean), 'nor cancel touchmoves');

      tray().scrollTop = 0;
      const atStart = await gesture(el('[data-test-content]'), 'down', 30);
      assert.false(atStart.dragging, 'not even at the scroll start');

      const handle = await gesture(el('[data-test-handle]'), 'down', 30);
      assert.true(handle.dragging, 'the handle drags');
      assert.true(handle.shift < -80, `(${handle.shift})`);
    });

    test('pan() still drags from the scroll start', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      scrollTo(tray(), 'bottom', 'start');
      const before = tray().getBoundingClientRect();
      let moved = 0;
      const record = () =>
        (moved = Math.min(moved, trayShift('bottom', before)));
      document.addEventListener('pointermove', record);
      try {
        await pan('[data-test-handle]', 'down');
      } finally {
        document.removeEventListener('pointermove', record);
      }
      assert.true(moved < -5, `the drawer followed (${moved})`);

      clock.runUntilIdle();
      await settled();
      scrollTo(tray(), 'bottom', 'middle');
      moved = 0;
      const again = tray().getBoundingClientRect();
      const recordAgain = () =>
        (moved = Math.min(moved, trayShift('bottom', again)));
      document.addEventListener('pointermove', recordAgain);
      try {
        await pan('[data-test-handle]', 'down');
      } finally {
        document.removeEventListener('pointermove', recordAgain);
      }
      assert.strictEqual(moved, 0, 'scrolled content: no drag');
    });
  },
);
