import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  click,
  find,
  render,
  settled,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  MobileDrawer,
  type MobileDrawerApi,
  type MobileDrawerDragEndEvent,
  type MobileDrawerDragStartEvent,
  type MobileDrawerToggleEvent,
  type SnapPoint,
} from '#src/index.ts';
import { closeDrawer, dragDrawer, openDrawer } from '#src/test-support.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { TouchPointer } from '#src/-private/gesture/touch-pointer.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import { resizeObserversDelivered } from '../../helpers/resize-observers.ts';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';

const SNAP_POINTS: SnapPoint[] = [0, 200, 400];

/** Every event, in order, as `name:snapPoint`, plus the payloads. */
class State {
  @tracked active: number | undefined = undefined;
  @tracked placement: Placement = 'bottom';
  @tracked handleOnly = false;
  @tracked showHandle = true;
  /** Whether the container is `display: none`. */
  @tracked hidden = false;
  log: string[] = [];
  dragStarts: MobileDrawerDragStartEvent[] = [];
  dragEnds: MobileDrawerDragEndEvent[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;

  onOpen = ({ snapPoint }: MobileDrawerToggleEvent) =>
    this.log.push(`open:${snapPoint}`);
  onClose = ({ snapPoint }: MobileDrawerToggleEvent) =>
    this.log.push(`close:${snapPoint}`);
  onDragStart = (event: MobileDrawerDragStartEvent) => {
    this.dragStarts.push(event);
    this.log.push(`dragStart:${event.snapPoint}`);
  };
  onDragEnd = (event: MobileDrawerDragEndEvent) => {
    this.dragEnds.push(event);
    this.log.push(`dragEnd:${event.snapPoint}`);
  };
  onChange = (index: number) => {
    this.log.push(`change:${index}`);
    if (this.accept && this.active !== undefined) this.active = index;
  };
  openAndClose = (drawer: MobileDrawerApi) => {
    drawer.open();
    drawer.close();
  };

  /** Only the `@onOpen` and `@onClose` calls of `log`. */
  get toggles(): string[] {
    return this.log.filter((entry) => /^(open|close):/.test(entry));
  }
}

const containerStyle = (hidden: boolean) =>
  htmlSafe(
    `position: relative; width: 400px; height: 600px${hidden ? '; display: none' : ''}`,
  );
const contentStyle = htmlSafe('height: 80px');

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle state.hidden}}>
        <MobileDrawer
          @placement={{state.placement}}
          @snapPoints={{SNAP_POINTS}}
          @activeSnapPoint={{state.active}}
          @onSnapPointChange={{state.onChange}}
          @handleOnly={{state.handleOnly}}
          @onOpen={{state.onOpen}}
          @onClose={{state.onClose}}
          @onDragStart={{state.onDragStart}}
          @onDragEnd={{state.onDragEnd}}
          style="position: absolute"
          aria-label="Events"
          as |drawer|
        >
          <div style={{contentStyle}}>
            {{#if state.showHandle}}
              <div
                style="width: 40px; height: 40px"
                data-test-handle
                {{drawer.handle}}
              ></div>
            {{/if}}
            <button type="button" data-test-open {{on "click" drawer.open}}>
              Open
            </button>
            <button type="button" data-test-close {{on "click" drawer.close}}>
              Close
            </button>
            <button
              type="button"
              data-test-middle
              {{on "click" (fn drawer.snapTo 1)}}
            >
              Middle
            </button>
            <button
              type="button"
              data-test-open-and-close
              {{on "click" (fn state.openAndClose drawer)}}
            >
              Open and close
            </button>
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

/** How far open the bottom drawer's tray is, in px, from its transform. */
function openOffset(): number {
  const { m42 } = new DOMMatrix(
    getComputedStyle(el('.mobile-drawer__tray')).transform,
  );
  return 400 - m42;
}

module('Integration | Component | mobile-drawer | events', function (hooks) {
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

  /** Renders pending changes and runs the animation they start. */
  async function settle() {
    await settled();
    clock.runUntilIdle();
    await settled();
  }

  test('@onOpen and @onClose are called once per change, when it starts', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    await click('[data-test-open]');
    assert.deepEqual(state.toggles, ['open:2'], 'called before the animation');
    assert.true(clock.pendingFrames > 0, 'the drawer is still opening');
    await settle();
    assert.deepEqual(state.toggles, ['open:2'], 'not again when it arrives');

    await click('[data-test-middle]');
    await settle();
    assert.deepEqual(
      state.toggles,
      ['open:2'],
      'a move between open snap points',
    );

    await click('[data-test-close]');
    assert.deepEqual(state.toggles, ['open:2', 'close:0']);
    await settle();
    await click('[data-test-close]');
    await settle();
    assert.deepEqual(
      state.toggles,
      ['open:2', 'close:0'],
      'closing when closed',
    );
  });

  test('a drawer inserted open calls nothing', async function (assert) {
    const state = new State();
    state.active = 2;
    await renderDrawer(state);
    await settle();
    assert.deepEqual(state.toggles, []);
  });

  test('a drawer inserted open while hidden calls nothing when it is shown', async function (assert) {
    const state = new State();
    state.active = 2;
    state.hidden = true;
    await renderDrawer(state);
    await settle();

    state.hidden = false;
    await settled();
    // The resize observer measures the drawer once it has a size.
    await resizeObserversDelivered();
    await settle();
    assert
      .dom('.mobile-drawer')
      .doesNotHaveAttribute('data-closed', 'measured and shown open');
    assert.deepEqual(state.toggles, []);

    state.active = 0;
    await settle();
    assert.deepEqual(state.toggles, ['close:0'], 'later changes are reported');
  });

  test('@onOpen and @onClose follow @activeSnapPoint changes from outside', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    state.active = 1;
    await settle();
    state.active = 2;
    await settle();
    state.active = 0;
    await settle();
    assert.deepEqual(state.toggles, ['open:1', 'close:0']);
  });

  test('opening and closing within the same task calls neither', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await click('[data-test-open-and-close]');
    await settle();
    assert.deepEqual(state.toggles, []);
  });

  test('Escape closes the drawer and calls @onClose', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await openDrawer();
    await settle();
    await triggerKeyEvent('[data-test-close]', 'keydown', 'Escape');
    await settle();
    assert.deepEqual(state.toggles, ['open:2', 'close:0']);
  });

  test('openDrawer and closeDrawer call @onOpen and @onClose', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await openDrawer();
    await settle();
    await closeDrawer('.mobile-drawer');
    await settle();
    assert.deepEqual(state.toggles, ['open:2', 'close:0']);
  });

  test('a drag calls @onDragStart and @onDragEnd once, before the other callbacks', async function (assert) {
    const state = new State();
    await renderDrawer(state);

    await dragDrawer('.mobile-drawer', { to: 2 });
    assert.deepEqual(state.log, [
      'dragStart:0',
      'dragEnd:2',
      'change:2',
      'open:2',
    ]);
    assert.deepEqual(state.dragStarts, [{ snapPoint: 0, offset: 0 }]);
    const [end] = state.dragEnds;
    assert.strictEqual(end?.snapPoint, 2);
    assert.true(Math.abs(end!.offset - 400) < 0.01, `offset ${end?.offset}`);
    assert.strictEqual(end?.velocity, 0, 'the finger stopped');
    await settle();

    state.log = [];
    await dragDrawer('.mobile-drawer', { distance: -150 });
    assert.deepEqual(state.log, ['dragStart:2', 'dragEnd:1', 'change:1']);
    assert.true(
      Math.abs(state.dragStarts[1]!.offset - 400) < 0.01,
      'drag starts at the open offset',
    );
    assert.true(
      Math.abs(state.dragEnds[1]!.offset - 250) < 0.01,
      `released 150px further down: ${state.dragEnds[1]?.offset}`,
    );
  });

  test('@onDragEnd reports the release velocity and the snap point it picked', async function (assert) {
    const state = new State();
    state.active = 0;
    await renderDrawer(state);

    // A short, fast flick from closed moves at least one snap point.
    await dragDrawer('.mobile-drawer', { distance: 40, velocity: 1000 });
    const [end] = state.dragEnds;
    assert.true(
      Math.abs(end!.velocity - 1000) < 1,
      `velocity ${end?.velocity}`,
    );
    assert.strictEqual(end?.snapPoint, 1, 'a flick moves a snap point');
    // The parent accepted it; `@onOpen` follows.
    assert.deepEqual(state.log, [
      'dragStart:0',
      'dragEnd:1',
      'change:1',
      'open:1',
    ]);
  });

  test('dragDrawer counts the distance before the drag starts', async function (assert) {
    const state = new State();
    state.active = 1;
    await renderDrawer(state);

    // Shorter than the 11px it takes to start a drag, with a velocity: it
    // starts the other way, then flicks the way of the velocity.
    await dragDrawer('.mobile-drawer', { distance: 5, velocity: 1000 });
    let end = state.dragEnds[0]!;
    assert.true(Math.abs(end.offset - 205) < 0.01, `offset ${end.offset}`);
    assert.true(Math.abs(end.velocity - 1000) < 1, `velocity ${end.velocity}`);
    await settle();

    await dragDrawer('.mobile-drawer', { distance: -5, velocity: -1000 });
    end = state.dragEnds[1]!;
    assert.true(Math.abs(end.offset - 395) < 0.01, `offset ${end.offset}`);
    assert.true(Math.abs(end.velocity + 1000) < 1, `velocity ${end.velocity}`);
    await settle();

    await dragDrawer('.mobile-drawer', { distance: -30 });
    end = state.dragEnds[2]!;
    assert.true(Math.abs(end.offset - 170) < 0.01, `offset ${end.offset}`);
    assert.strictEqual(end.velocity, 0);
  });

  test('controlled: @onDragEnd gives the picked snap point also when the parent declines it', async function (assert) {
    const state = new State();
    state.active = 0;
    state.accept = false;
    await renderDrawer(state);

    await dragDrawer('.mobile-drawer', { to: 2 });
    await settle();
    assert.deepEqual(state.log, ['dragStart:0', 'dragEnd:2', 'change:2']);
    assert.strictEqual(openOffset(), 0, 'the drawer went back');
  });

  test('a drag whose handle is removed ends with @onDragEnd', async function (assert) {
    const state = new State();
    state.handleOnly = true;
    state.active = 2;
    await renderDrawer(state);

    const handle = el('[data-test-handle]');
    const rect = handle.getBoundingClientRect();
    const finger = new TouchPointer(handle, rect.left + 5, rect.top + 5);
    finger.down();
    for (let i = 0; i < 6; i++) finger.move(0, 4);
    assert.deepEqual(state.log, ['dragStart:2']);

    state.showHandle = false;
    await settled();
    assert.deepEqual(state.log, ['dragStart:2', 'dragEnd:2']);
    assert.strictEqual(state.dragEnds[0]?.velocity, 0);
    finger.up();
    await settle();
    assert.strictEqual(state.dragEnds.length, 1, 'only once');
  });

  test('a drag that a placement change ends calls @onDragEnd', async function (assert) {
    const state = new State();
    state.active = 2;
    await renderDrawer(state);

    const tray = el('.mobile-drawer__tray');
    const rect = tray.getBoundingClientRect();
    const finger = new TouchPointer(tray, rect.left + 20, rect.top + 20);
    finger.down();
    for (let i = 0; i < 6; i++) finger.move(0, 4);
    assert.deepEqual(state.log, ['dragStart:2']);

    state.placement = 'top';
    await settled();
    assert.deepEqual(state.log, ['dragStart:2', 'dragEnd:2']);
    finger.up();
    await settle();
    assert.strictEqual(state.dragEnds.length, 1, 'only once');
  });

  test('a touch that only holds a moving drawer is not a drag', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await click('[data-test-open]');
    clock.frame();

    const tray = el('.mobile-drawer__tray');
    const finger = new TouchPointer(tray, 10, 10);
    finger.down();
    finger.up();
    await settle();
    assert.deepEqual(state.log, ['change:2', 'open:2'], 'no drag events');
  });
});
