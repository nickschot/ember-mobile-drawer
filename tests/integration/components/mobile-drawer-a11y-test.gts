import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import {
  clearRender,
  find,
  focus,
  render,
  settled,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { a11yAudit } from 'ember-a11y-testing/test-support';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { bodyScrollLocks } from '#src/-private/modal/scroll-lock.ts';
import { FakeClock } from '../../helpers/fake-clock.ts';
import '#src/styles.css';

// The drawers are embedded in a 400 x 600 px container, next to a page with
// a trigger button and a button that fills the container behind them.
const SNAP_POINTS: SnapPoint[] = [0, 200, 400];
const PEEK_SNAP_POINTS: SnapPoint[] = [120, 400];

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

/** The element a tap at `x`/`y` (px) in the container would hit. */
function hit(x = 200, y = 50): Element | null {
  const container = el('[data-test-container]');
  const rect = container.getBoundingClientRect();
  const scale = rect.width / container.offsetWidth;
  return document.elementFromPoint(rect.left + x * scale, rect.top + y * scale);
}

const active = () => document.activeElement;

/** The QUnit UI, a sibling of the test container's ancestors. */
const qunitUi = () => document.getElementById('qunit')!;

const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const pageStyle = htmlSafe('position: absolute; inset: 0');
const contentStyle = htmlSafe('height: 80px');

class State {
  @tracked active: number | undefined = 0;
  @tracked modal: boolean | undefined;
  @tracked backdrop: boolean | undefined;
  @tracked snapPoints: SnapPoint[] = SNAP_POINTS;
  @tracked shown = true;
  @tracked focusable = true;
  @tracked autofocus = false;
  @tracked secondActive: number | undefined;
  changes: number[] = [];
  /** Whether the parent accepts changes requested by the drawer. */
  accept = true;
  pageClicks = 0;

  onChange = (index: number) => {
    this.changes.push(index);
    if (this.accept) this.active = index;
  };

  onSecondChange = (index: number) => (this.secondActive = index);

  onPageClick = () => this.pageClicks++;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div data-test-outside>
        <button type="button" data-test-outside-button>Outside</button>
      </div>
      <div style={{containerStyle}} data-test-container>
        <button
          type="button"
          style={{pageStyle}}
          data-test-page
          {{on "click" state.onPageClick}}
        >Page</button>
        <button type="button" data-test-trigger>Trigger</button>
        {{#if state.shown}}
          <MobileDrawer
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.onChange}}
            @modal={{state.modal}}
            @backdrop={{state.backdrop}}
            style="position: absolute"
            aria-labelledby="drawer-title"
            data-test-drawer
            as |drawer|
          >
            <div style={{contentStyle}}>
              <h2 id="drawer-title">Title</h2>
              {{#if state.focusable}}
                <button type="button" data-test-first>First</button>
                {{! template-lint-disable no-autofocus-attribute }}
                <input
                  aria-label="Field"
                  autofocus={{state.autofocus}}
                  data-test-field
                />
                <button type="button" disabled>Disabled</button>
                <button
                  type="button"
                  data-test-last
                  {{on "click" drawer.close}}
                >Close</button>
              {{/if}}
              <output data-test-active>{{drawer.activeSnapPoint}}</output>
            </div>
          </MobileDrawer>
        {{/if}}
        {{#if state.secondActive}}
          <MobileDrawer
            @snapPoints={{SNAP_POINTS}}
            @activeSnapPoint={{state.secondActive}}
            @onSnapPointChange={{state.onSecondChange}}
            style="position: absolute"
            aria-label="Second"
            data-test-second
          >
            <div style={{contentStyle}}>
              <button type="button" data-test-second-button>Second</button>
            </div>
          </MobileDrawer>
        {{/if}}
      </div>
    </template>,
  );
}

const html = () => document.documentElement;

module('Integration | Component | mobile-drawer | a11y', function (hooks) {
  setupRenderingTest(hooks);

  let clock: FakeClock;

  hooks.beforeEach(function () {
    clock = new FakeClock();
    drawerEnvironment.clock = clock;
    drawerEnvironment.prefersReducedMotion = () => false;
  });

  hooks.afterEach(function (assert) {
    delete drawerEnvironment.clock;
    delete drawerEnvironment.prefersReducedMotion;
    delete drawerEnvironment.isIOS;
    // Nothing outlives the drawers of a test.
    assert.strictEqual(bodyScrollLocks(), 0, 'no scroll lock left behind');
    assert.strictEqual(
      document.querySelectorAll('[inert]').length,
      0,
      'nothing left inert',
    );
    assert.strictEqual(html().style.overflow, '', 'page scrolls again');
  });

  /** Renders pending changes and runs the animation they start. */
  async function settle() {
    await settled();
    clock.runUntilIdle();
    await settled();
  }

  /** Focuses the trigger, then opens the drawer to `index`. */
  async function openFromTrigger(state: State, index = 2) {
    await focus('[data-test-trigger]');
    state.active = index;
    await settle();
  }

  module('modal (default)', function () {
    test('ARIA attributes follow the open state', async function (assert) {
      const state = new State();
      await renderDrawer(state);

      assert
        .dom('[data-test-drawer]')
        .hasAttribute('role', 'dialog')
        .hasAttribute('aria-labelledby', 'drawer-title')
        .doesNotHaveAttribute('aria-modal', 'not modal while closed')
        .hasAttribute('data-closed');
      assert.strictEqual(
        getComputedStyle(el('[data-test-drawer]')).visibility,
        'hidden',
        'closed: hidden, also from assistive technology',
      );
      assert.false(
        el('[data-test-first]').checkVisibility({ visibilityProperty: true }),
        'closed: content is not rendered visible',
      );
      assert
        .dom('[data-test-drawer] > .mobile-drawer__tray')
        .hasAttribute('tabindex', '-1');

      await openFromTrigger(state);
      assert.dom('[data-test-drawer]').hasAttribute('aria-modal', 'true');

      state.active = 0;
      await settle();
      assert
        .dom('[data-test-drawer]')
        .doesNotHaveAttribute('aria-modal')
        .hasAttribute('data-closed');
    });

    test('focus moves into the drawer on open and back to the trigger on close', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await focus('[data-test-trigger]');

      state.active = 2;
      await settled();
      assert.strictEqual(
        active(),
        el('[data-test-first]'),
        'the first focusable element, as soon as the drawer starts opening',
      );
      assert.true(clock.pendingFrames > 0, 'while it animates');
      clock.runUntilIdle();
      await settled();
      assert.strictEqual(active(), el('[data-test-first]'));

      // A tap on Close inside the drawer.
      await focus('[data-test-last]');
      el('[data-test-last]').click();
      await settled();
      assert.strictEqual(
        active(),
        el('[data-test-trigger]'),
        'focus returns before the drawer is hidden',
      );
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
      clock.runUntilIdle();
      await settled();
      assert.dom('[data-test-drawer]').hasAttribute('data-closed');
      assert.strictEqual(active(), el('[data-test-trigger]'));
    });

    test('initial focus prefers [autofocus] and falls back to the tray', async function (assert) {
      const state = new State();
      state.autofocus = true;
      await renderDrawer(state);
      await openFromTrigger(state);
      assert.strictEqual(active(), el('[data-test-field]'), '[autofocus]');

      state.active = 0;
      await settle();
      state.autofocus = false;
      state.focusable = false;
      await openFromTrigger(state);
      assert.strictEqual(
        active(),
        el('[data-test-drawer] > .mobile-drawer__tray'),
        'the tray, without anything focusable',
      );

      await triggerKeyEvent(active()!, 'keydown', 'Tab');
      assert.strictEqual(
        active(),
        el('[data-test-drawer] > .mobile-drawer__tray'),
        'Tab keeps it there',
      );
      state.active = 0;
      await settle();
      assert.strictEqual(active(), el('[data-test-trigger]'));
    });

    test('Tab and Shift+Tab wrap around inside the drawer', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);

      await focus('[data-test-last]');
      await triggerKeyEvent('[data-test-last]', 'keydown', 'Tab');
      assert.strictEqual(active(), el('[data-test-first]'), 'last → first');

      await triggerKeyEvent('[data-test-first]', 'keydown', 'Tab', {
        shiftKey: true,
      });
      assert.strictEqual(
        active(),
        el('[data-test-last]'),
        'first → last, skipping the disabled button',
      );

      // In between, Tab is left to the browser.
      await focus('[data-test-first]');
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      el('[data-test-first]').dispatchEvent(event);
      assert.false(event.defaultPrevented, 'not the last element: native');

      // Focus dropped onto the body (e.g. a click on the backdrop).
      (document.activeElement as HTMLElement).blur();
      await triggerKeyEvent(document.body, 'keydown', 'Tab');
      assert.strictEqual(active(), el('[data-test-first]'), 'body → first');
      (document.activeElement as HTMLElement).blur();
      await triggerKeyEvent(document.body, 'keydown', 'Tab', {
        shiftKey: true,
      });
      assert.strictEqual(active(), el('[data-test-last]'), 'body → last');

      state.active = 0;
      await settle();
    });

    test('the rest of the page is inert while open', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      const preexisting = el('[data-test-outside]');
      preexisting.setAttribute('inert', '');

      await openFromTrigger(state);
      assert.dom('[data-test-page]').hasAttribute('inert');
      assert.dom('[data-test-trigger]').hasAttribute('inert');
      assert.dom(qunitUi()).hasAttribute('inert', '', 'up to <body>');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('inert');
      assert.dom('[data-test-container]').doesNotHaveAttribute('inert');
      assert.notOk(el('[data-test-first]').closest('[inert]'));

      state.active = 0;
      await settle();
      assert.dom('[data-test-page]').doesNotHaveAttribute('inert');
      assert.dom('[data-test-trigger]').doesNotHaveAttribute('inert');
      assert.dom(qunitUi()).doesNotHaveAttribute('inert');
      assert
        .dom('[data-test-outside]')
        .hasAttribute('inert', '', 'inert set by the app is left alone');
      preexisting.removeAttribute('inert');
    });

    test('Escape closes an uncontrolled drawer, from inside or from <body>', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);
      // Let go of @activeSnapPoint: the drawer stays open, uncontrolled.
      state.active = undefined;
      await settled();
      assert.dom('[data-test-active]').hasText('2');

      await triggerKeyEvent('[data-test-first]', 'keydown', 'Escape');
      assert.dom('[data-test-active]').hasText('0');
      assert.strictEqual(active(), el('[data-test-trigger]'));
      await settle();
      assert.dom('[data-test-drawer]').hasAttribute('data-closed');

      // Reopen through the uncontrolled drawer's own snapTo isn't possible
      // from outside, so take control again, then let go.
      state.active = 1;
      await settle();
      state.active = undefined;
      await settled();
      (document.activeElement as HTMLElement).blur();
      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      assert.dom('[data-test-active]').hasText('0', 'Escape on <body>');
      await settle();
    });

    test('Escape asks a controlled drawer to close', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);

      state.accept = false;
      await triggerKeyEvent('[data-test-first]', 'keydown', 'Escape');
      assert.deepEqual(state.changes, [0], '@onSnapPointChange(0)');
      await settle();
      assert.dom('[data-test-active]').hasText('2', 'the parent said no');
      assert.dom('[data-test-drawer]').hasAttribute('aria-modal', 'true');
      assert.strictEqual(active(), el('[data-test-first]'), 'still trapped');

      state.accept = true;
      await triggerKeyEvent('[data-test-first]', 'keydown', 'Escape');
      await settle();
      assert.dom('[data-test-active]').hasText('0');
      assert.strictEqual(active(), el('[data-test-trigger]'));

      // Escape handled elsewhere first, or on a closed drawer: nothing.
      state.changes = [];
      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      assert.deepEqual(state.changes, [], 'closed: Escape does nothing');
    });

    test('Escape that another handler took care of is ignored', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);
      const field = el('[data-test-field]');
      const handled = (event: KeyboardEvent) => event.preventDefault();
      field.addEventListener('keydown', handled);
      await triggerKeyEvent(field, 'keydown', 'Escape');
      assert.deepEqual(state.changes, [], 'not closed');
      field.removeEventListener('keydown', handled);
      state.active = 0;
      await settle();
    });

    test('body scrolling is locked while open', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      assert.strictEqual(html().style.overflow, '');

      await openFromTrigger(state);
      assert.strictEqual(html().style.overflow, 'hidden');
      assert.strictEqual(bodyScrollLocks(), 1);

      state.active = 0;
      await settle();
      assert.strictEqual(html().style.overflow, '');
      assert.strictEqual(bodyScrollLocks(), 0);
    });

    test('on iOS the body is fixed in place and stray touchmoves are cancelled', async function (assert) {
      drawerEnvironment.isIOS = () => true;
      const state = new State();
      await renderDrawer(state);
      const { body } = document;
      const before = body.style.position;

      await openFromTrigger(state);
      assert.strictEqual(body.style.position, 'fixed');
      assert.strictEqual(body.style.top, `${-window.scrollY}px`);

      const touchmove = (target: Element) => {
        const event = new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      assert.true(touchmove(qunitUi()), 'outside the drawer: cancelled');
      assert.true(
        touchmove(el('[data-test-drawer] > .mobile-drawer__backdrop')),
        'on the backdrop: cancelled',
      );
      assert.false(touchmove(el('[data-test-first]')), 'in the tray: allowed');

      state.active = 0;
      await settle();
      assert.strictEqual(body.style.position, before, 'restored');
      assert.strictEqual(body.style.top, '');
      assert.false(touchmove(qunitUi()), 'listener removed');
    });

    test('tearing down an open drawer undoes everything and returns focus', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);
      assert.strictEqual(bodyScrollLocks(), 1);
      assert.dom('[data-test-page]').hasAttribute('inert');

      state.shown = false;
      await settled();
      assert.strictEqual(bodyScrollLocks(), 0);
      assert.dom('[data-test-page]').doesNotHaveAttribute('inert');
      assert.strictEqual(active(), el('[data-test-trigger]'), 'focus returns');

      state.changes = [];
      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      await triggerKeyEvent(document.body, 'keydown', 'Tab');
      assert.deepEqual(state.changes, [], 'no listeners left');
      assert.strictEqual(active(), el('[data-test-trigger]'));
    });

    test('clearing the render while open leaves nothing behind', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);
      await clearRender();
      // The afterEach hook checks the locks and inert attributes.
      assert.ok(true);
    });

    test('several modal drawers: counted locks, only the top one handles keys', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await openFromTrigger(state);

      state.secondActive = 2;
      await settle();
      assert.strictEqual(bodyScrollLocks(), 2);
      assert.strictEqual(active(), el('[data-test-second-button]'));
      assert
        .dom('[data-test-drawer]')
        .hasAttribute('inert', '', 'the first drawer is behind the second');

      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      assert.strictEqual(state.secondActive, 0, 'the top drawer closes');
      assert.deepEqual(state.changes, [], 'the one behind it does not');
      await settle();
      assert.strictEqual(bodyScrollLocks(), 1, 'still locked by the first');
      assert.strictEqual(html().style.overflow, 'hidden');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('inert');
      assert.dom('[data-test-page]').hasAttribute('inert', '', 'still inert');
      assert.strictEqual(
        active(),
        el('[data-test-first]'),
        'focus returns to the first drawer',
      );

      state.active = 0;
      await settle();
      state.secondActive = undefined;
      await settled();
    });

    test('closes and returns focus right away with reduced motion', async function (assert) {
      drawerEnvironment.prefersReducedMotion = () => true;
      const state = new State();
      await renderDrawer(state);
      await focus('[data-test-trigger]');

      state.active = 2;
      await settled();
      assert.strictEqual(clock.pendingFrames, 0, 'no animation');
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
      assert.strictEqual(active(), el('[data-test-first]'));

      await triggerKeyEvent('[data-test-first]', 'keydown', 'Escape');
      assert.strictEqual(clock.pendingFrames, 0, 'no animation');
      assert.dom('[data-test-drawer]').hasAttribute('data-closed');
      assert.strictEqual(active(), el('[data-test-trigger]'));
    });

    test('passes an axe audit open and closed', async function (assert) {
      const state = new State();
      await renderDrawer(state);
      await a11yAudit(el('[data-test-container]'));
      await openFromTrigger(state);
      await a11yAudit(el('[data-test-container]'));
      assert.ok(true, 'no violations');
      state.active = 0;
      await settle();
    });
  });

  module('non-modal', function () {
    test('no role, no trap, no inert, no scroll lock', async function (assert) {
      const state = new State();
      state.modal = false;
      await renderDrawer(state);
      assert
        .dom('[data-test-drawer]')
        .doesNotHaveAttribute('role')
        .doesNotHaveAttribute('aria-modal');
      assert
        .dom('[data-test-drawer] > .mobile-drawer__tray')
        .doesNotHaveAttribute('tabindex');
      assert.dom('.mobile-drawer__backdrop').doesNotExist('no backdrop');

      await openFromTrigger(state);
      assert.strictEqual(active(), el('[data-test-trigger]'), 'focus stays');
      assert.dom('[inert]').doesNotExist();
      assert.strictEqual(html().style.overflow, '');
      assert.strictEqual(hit(), el('[data-test-page]'), 'the page is usable');

      await triggerKeyEvent('[data-test-trigger]', 'keydown', 'Escape');
      assert.deepEqual(state.changes, [], 'Escape outside: nothing');
      await triggerKeyEvent('[data-test-trigger]', 'keydown', 'Tab');
      assert.strictEqual(active(), el('[data-test-trigger]'), 'no trap');

      // Escape with focus inside closes it and returns focus.
      await focus('[data-test-last]');
      await triggerKeyEvent('[data-test-last]', 'keydown', 'Escape');
      assert.deepEqual(state.changes, [0]);
      assert.strictEqual(active(), el('[data-test-trigger]'));
      await settle();
      await a11yAudit(el('[data-test-container]'));
    });

    test('focus that left the drawer is not moved on close', async function (assert) {
      const state = new State();
      state.modal = false;
      await renderDrawer(state);
      await openFromTrigger(state);
      await focus('[data-test-outside-button]');
      state.active = 0;
      await settle();
      assert.strictEqual(active(), el('[data-test-outside-button]'));
    });

    test('a peek drawer’s backdrop does not block the page at its peek', async function (assert) {
      const state = new State();
      state.modal = false;
      state.backdrop = true;
      state.snapPoints = PEEK_SNAP_POINTS;
      await renderDrawer(state);
      await settle();

      assert.dom('[data-test-drawer]').doesNotHaveAttribute('data-closed');
      assert.strictEqual(hit(), el('[data-test-page]'), 'at the peek');
      assert.strictEqual(
        hit(200, 550)?.closest('.mobile-drawer__tray'),
        el('[data-test-drawer] .mobile-drawer__tray'),
        'the tray shows at the peek',
      );
      el('[data-test-page]').click();
      assert.strictEqual(state.pageClicks, 1);

      state.active = 1;
      await settle();
      const backdrop = el('[data-test-drawer] > .mobile-drawer__backdrop');
      assert.strictEqual(hit(), backdrop, 'expanded: the backdrop blocks');
      backdrop.click();
      await settle();
      assert
        .dom('[data-test-active]')
        .hasText('0', 'a tap goes back to the peek');
      assert.strictEqual(hit(), el('[data-test-page]'), 'and lets go again');
    });

    test('a modal peek drawer is only modal above its peek', async function (assert) {
      const state = new State();
      state.snapPoints = PEEK_SNAP_POINTS;
      await renderDrawer(state);
      await settle();
      assert.dom('[data-test-drawer]').doesNotHaveAttribute('aria-modal');
      assert.dom('[inert]').doesNotExist();
      assert.strictEqual(hit(), el('[data-test-page]'));

      await openFromTrigger(state, 1);
      assert.dom('[data-test-drawer]').hasAttribute('aria-modal', 'true');
      assert.strictEqual(active(), el('[data-test-first]'));
      await triggerKeyEvent('[data-test-first]', 'keydown', 'Escape');
      await settle();
      assert.dom('[data-test-active]').hasText('0');
      assert.dom('[inert]').doesNotExist();
      assert.strictEqual(active(), el('[data-test-trigger]'));
    });
  });

  test('@backdrop follows @modal unless set', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    assert.dom('.mobile-drawer__backdrop').exists('modal: backdrop');
    state.modal = false;
    await settled();
    assert.dom('.mobile-drawer__backdrop').doesNotExist('non-modal: none');
    state.backdrop = true;
    await settled();
    assert.dom('.mobile-drawer__backdrop').exists('unless asked for');
    state.modal = true;
    state.backdrop = false;
    await settled();
    assert.dom('.mobile-drawer__backdrop').doesNotExist('or turned off');
  });

  test('turning @modal off while open undoes it, and on again redoes it', async function (assert) {
    const state = new State();
    await renderDrawer(state);
    await openFromTrigger(state);
    assert.strictEqual(bodyScrollLocks(), 1);

    state.modal = false;
    await settled();
    assert.strictEqual(bodyScrollLocks(), 0);
    assert.dom('[inert]').doesNotExist();
    assert.dom('[data-test-drawer]').doesNotHaveAttribute('role');

    state.modal = true;
    await settled();
    assert.strictEqual(bodyScrollLocks(), 1);
    assert.dom('[data-test-drawer]').hasAttribute('aria-modal', 'true');

    state.active = 0;
    await settle();
    assert.strictEqual(active(), el('[data-test-trigger]'));
  });
});
