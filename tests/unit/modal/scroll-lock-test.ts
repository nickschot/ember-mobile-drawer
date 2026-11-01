import { module, test } from 'qunit';
import { drawerEnvironment } from '#src/-private/environment.ts';
import {
  bodyScrollLocks,
  lockBodyScroll,
} from '#src/-private/modal/scroll-lock.ts';

/** A swipe by `dy` (and `dx`) px on `target`; whether its touchmove was cancelled. */
function swipe(target: Element, dy: number, dx = 0): boolean {
  const touch = (x: number, y: number) =>
    new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const start = touch(100, 100);
  const end = touch(100 + dx, 100 + dy);
  target.dispatchEvent(
    new TouchEvent('touchstart', {
      bubbles: true,
      touches: [start],
      changedTouches: [start],
    }),
  );
  const move = new TouchEvent('touchmove', {
    bubbles: true,
    cancelable: true,
    touches: [end],
    changedTouches: [end],
  });
  target.dispatchEvent(move);
  target.dispatchEvent(
    new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }),
  );
  return move.defaultPrevented;
}

// SPIKE (#113): the iOS lock that doesn't fix <body>.
module(
  'Unit | modal | scroll-lock (iOS overflow lock, spike #113)',
  function (hooks) {
    let fixture: HTMLElement;
    let tray: HTMLElement;
    let scroller: HTMLElement;
    let content: HTMLElement;

    hooks.beforeEach(function () {
      drawerEnvironment.isIOS = () => true;
      drawerEnvironment.iosScrollLock = 'overflow';
      fixture = document.createElement('div');
      tray = document.createElement('div');
      scroller = document.createElement('div');
      scroller.style.cssText = 'overflow: auto; height: 50px;';
      content = document.createElement('div');
      content.style.height = '200px';
      scroller.append(content);
      const plain = document.createElement('p');
      plain.className = 'plain';
      plain.textContent = 'Not scrollable';
      tray.append(plain, scroller);
      fixture.append(tray);
      document.body.append(fixture);
    });

    hooks.afterEach(function (assert) {
      fixture.remove();
      delete drawerEnvironment.isIOS;
      delete drawerEnvironment.iosScrollLock;
      assert.strictEqual(bodyScrollLocks(), 0, 'no lock left behind');
    });

    test('locks without fixing <body> and restores everything', function (assert) {
      const { body } = document;
      const html = document.documentElement;
      const release = lockBodyScroll(tray);
      assert.strictEqual(body.style.position, '', 'body not fixed');
      assert.strictEqual(body.style.top, '');
      assert.strictEqual(html.style.overflow, 'hidden');
      assert.strictEqual(body.style.overflow, 'hidden');
      assert.strictEqual(html.style.overscrollBehavior, 'none');
      assert.strictEqual(body.style.overscrollBehavior, 'none');
      release();
      assert.strictEqual(html.style.overflow, '');
      assert.strictEqual(body.style.overflow, '');
      assert.strictEqual(html.style.overscrollBehavior, '');
      assert.strictEqual(body.style.overscrollBehavior, '');
      assert.false(swipe(fixture, -20), 'listener removed');
    });

    test('cancels touchmoves that would scroll the page', function (assert) {
      const release = lockBodyScroll(tray);
      scroller.scrollTop = 50;
      assert.true(swipe(fixture, -20), 'outside the allowed element');
      assert.true(swipe(tray.querySelector('.plain')!, -20), 'nothing scrolls');
      assert.false(swipe(content, -20), 'scroller in the middle, up');
      assert.false(swipe(content, 20), 'scroller in the middle, down');
      assert.true(swipe(content, 0, 20), 'sideways, nothing scrolls sideways');
      scroller.scrollTop = 0;
      assert.true(swipe(content, 20), 'scroller at its top, down');
      assert.false(swipe(content, -20), 'scroller at its top, up');
      scroller.scrollTop = 1000;
      assert.true(swipe(content, -20), 'scroller at its end, up');
      assert.false(swipe(content, 20), 'scroller at its end, down');
      release();
    });

    test('keeps the scroll of a focused field (keyboard), else scrolls back', async function (assert) {
      const spacer = document.createElement('div');
      spacer.style.height = `${window.innerHeight + 2000}px`;
      fixture.append(spacer);
      const input = document.createElement('input');
      tray.append(input);
      const scrolled = () =>
        new Promise<void>((resolve) => {
          window.addEventListener('scroll', () => setTimeout(resolve, 0), {
            once: true,
          });
        });
      const start = window.scrollY;
      window.scrollTo({ top: start + 100, behavior: 'instant' });
      const y = window.scrollY;
      const release = lockBodyScroll(tray);
      // The test page has `overflow: hidden` now; scripts can still scroll.
      let event = scrolled();
      window.scrollTo({ top: y + 300, behavior: 'instant' });
      await event;
      assert.strictEqual(window.scrollY, y, 'other scrolls are undone');

      input.focus();
      event = scrolled();
      window.scrollTo({ top: y + 300, behavior: 'instant' });
      await event;
      assert.strictEqual(
        window.scrollY,
        y + 300,
        'the scroll that shows a focused field stays',
      );

      event = scrolled();
      input.blur();
      await event;
      assert.strictEqual(window.scrollY, y, 'restored when the field blurs');
      release();
      window.scrollTo({ top: start, behavior: 'instant' });
    });

    test('the default iOS lock still fixes <body>', function (assert) {
      delete drawerEnvironment.iosScrollLock;
      const release = lockBodyScroll(tray);
      assert.strictEqual(document.body.style.position, 'fixed');
      release();
      assert.strictEqual(document.body.style.position, '');
    });
  },
);
