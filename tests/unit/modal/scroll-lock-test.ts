import { module, test } from 'qunit';
import { drawerEnvironment } from '#src/-private/environment.ts';
import {
  bodyScrollLocks,
  lockBodyScroll,
  onLockChange,
  transparentStatusBarLock,
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

// The iOS lock that doesn't fix <body>, for a transparent status bar (#113).
module('Unit | modal | scroll-lock (iOS overflow lock)', function (hooks) {
  let fixture: HTMLElement;
  let tray: HTMLElement;
  let scroller: HTMLElement;
  let content: HTMLElement;

  hooks.beforeEach(function () {
    drawerEnvironment.isIOS = () => true;
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

  /** A lock for `@transparentStatusBar`, with `tray` allowed. */
  const lockOverflow = () =>
    lockBodyScroll((node) => tray.contains(node), {
      fields: [tray],
      transparentStatusBar: true,
    });

  hooks.afterEach(function (assert) {
    fixture.remove();
    delete drawerEnvironment.isIOS;
    assert.strictEqual(bodyScrollLocks(), 0, 'no lock left behind');
  });

  test('locks without fixing <body> and restores everything', function (assert) {
    const { body } = document;
    const html = document.documentElement;
    const release = lockOverflow();
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
    const release = lockOverflow();
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

  /** A horizontal scroller in `tray`, 50px wide with 200px of content. */
  function horizontalScroller(direction: 'ltr' | 'rtl'): {
    row: HTMLElement;
    item: HTMLElement;
  } {
    const row = document.createElement('div');
    row.dir = direction;
    row.style.cssText = 'overflow-x: auto; overflow-y: hidden; width: 50px;';
    const item = document.createElement('div');
    item.style.cssText = 'width: 200px; height: 20px;';
    row.append(item);
    tray.append(row);
    return { row, item };
  }

  test('horizontal swipes, left-to-right', function (assert) {
    const { row, item } = horizontalScroller('ltr');
    const release = lockOverflow();
    row.scrollLeft = 0;
    assert.true(swipe(item, 0, 20), 'at the start, finger right');
    assert.false(swipe(item, 0, -20), 'at the start, finger left');
    row.scrollLeft = 75;
    assert.false(swipe(item, 0, 20), 'in the middle, finger right');
    assert.false(swipe(item, 0, -20), 'in the middle, finger left');
    row.scrollLeft = 1000;
    assert.strictEqual(row.scrollLeft, 150, 'at the end');
    assert.false(swipe(item, 0, 20), 'at the end, finger right');
    assert.true(swipe(item, 0, -20), 'at the end, finger left');
    release();
  });

  // #161: right-to-left scrollLeft runs from 0 (start, right edge) to -150.
  test('horizontal swipes, right-to-left', function (assert) {
    const { row, item } = horizontalScroller('rtl');
    const release = lockOverflow();
    row.scrollLeft = 0;
    assert.false(swipe(item, 0, 20), 'at the start, finger right');
    assert.true(swipe(item, 0, -20), 'at the start, finger left');
    row.scrollLeft = -75;
    assert.false(swipe(item, 0, 20), 'in the middle, finger right');
    assert.false(swipe(item, 0, -20), 'in the middle, finger left');
    row.scrollLeft = -1000;
    assert.strictEqual(row.scrollLeft, -150, 'at the end');
    assert.true(swipe(item, 0, 20), 'at the end, finger right');
    assert.false(swipe(item, 0, -20), 'at the end, finger left');
    release();
  });

  /**
   * Focuses `field` in the tray of an overflow lock, scrolls the page, and
   * returns whether that scroll stays (the keyboard counts as open).
   */
  async function scrollStaysWithFocusOn(field: HTMLElement): Promise<boolean> {
    const spacer = document.createElement('div');
    spacer.style.height = `${window.innerHeight + 2000}px`;
    fixture.append(spacer);
    const scrolled = () =>
      new Promise<void>((resolve) => {
        window.addEventListener('scroll', () => setTimeout(resolve, 0), {
          once: true,
        });
      });
    const start = window.scrollY;
    window.scrollTo({ top: start + 100, behavior: 'instant' });
    const y = window.scrollY;
    const release = lockOverflow();
    // Added after the lock: else a text field gives the fixed <body>.
    tray.append(field);
    field.focus();
    const event = scrolled();
    window.scrollTo({ top: y + 300, behavior: 'instant' });
    await event;
    const stays = window.scrollY !== y;
    field.blur();
    release();
    window.scrollTo({ top: start, behavior: 'instant' });
    return stays;
  }

  function input(type: string, attributes: string[] = []): HTMLInputElement {
    const element = document.createElement('input');
    element.type = type;
    for (const attribute of attributes) element.setAttribute(attribute, '');
    return element;
  }

  // #161: only a field that opens a keyboard keeps the page scroll.
  test('focus on a field without a keyboard does not keep the page scroll', async function (assert) {
    const fields: [string, HTMLElement][] = [
      ['checkbox', input('checkbox')],
      ['radio', input('radio')],
      ['range', input('range')],
      ['button', input('button')],
      ['readonly text', input('text', ['readonly'])],
      ['readonly textarea', document.createElement('textarea')],
    ];
    (fields[5]![1] as HTMLTextAreaElement).readOnly = true;
    for (const [name, field] of fields) {
      assert.false(await scrollStaysWithFocusOn(field), name);
      field.remove();
    }
  });

  test('focus on a text field keeps the page scroll', async function (assert) {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.textContent = 'Text';
    const fields: [string, HTMLElement][] = [
      ['text', input('text')],
      ['search', input('search')],
      ['email', input('email')],
      ['textarea', document.createElement('textarea')],
      ['contenteditable', editable],
    ];
    for (const [name, field] of fields) {
      assert.true(await scrollStaysWithFocusOn(field), name);
      field.remove();
    }
  });

  test('keeps the scroll of a focused field (keyboard), else scrolls back', async function (assert) {
    const spacer = document.createElement('div');
    spacer.style.height = `${window.innerHeight + 2000}px`;
    fixture.append(spacer);
    const input = document.createElement('input');
    const scrolled = () =>
      new Promise<void>((resolve) => {
        window.addEventListener('scroll', () => setTimeout(resolve, 0), {
          once: true,
        });
      });
    const start = window.scrollY;
    window.scrollTo({ top: start + 100, behavior: 'instant' });
    const y = window.scrollY;
    const release = lockOverflow();
    // Added after the lock: else the drawer gets the fixed <body>.
    tray.append(input);
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

  test('a drawer with a text field gets the fixed <body>', function (assert) {
    const field = document.createElement('textarea');
    tray.append(field);
    let release = lockOverflow();
    assert.strictEqual(document.body.style.position, 'fixed');
    release();
    assert.strictEqual(document.body.style.position, '');

    field.readOnly = true;
    release = lockOverflow();
    assert.strictEqual(
      document.body.style.position,
      '',
      'a readonly field opens no keyboard: overflow lock',
    );
    release();
  });

  test('a later lock with a text field switches to the fixed <body>', function (assert) {
    const { body } = document;
    const html = document.documentElement;
    let changes = 0;
    const unsubscribe = onLockChange(() => changes++);
    const release = lockOverflow();
    assert.true(transparentStatusBarLock());

    // A nested drawer that has a text field opens.
    const nested = document.createElement('div');
    nested.append(document.createElement('input'));
    fixture.append(nested);
    const releaseNested = lockBodyScroll((node) => nested.contains(node), {
      fields: [nested],
      transparentStatusBar: true,
    });
    assert.strictEqual(body.style.position, 'fixed', 'fixed <body> now');
    assert.strictEqual(body.style.overflow, '', 'overflow lock undone');
    assert.strictEqual(html.style.overscrollBehavior, '');
    assert.false(transparentStatusBarLock());
    assert.strictEqual(changes, 1, 'the drawers are told');
    assert.true(
      swipe(fixture, -20),
      'touchmoves outside the drawers are still cancelled',
    );

    releaseNested();
    assert.strictEqual(body.style.position, 'fixed', 'stays fixed');
    release();
    assert.strictEqual(body.style.position, '');
    assert.strictEqual(html.style.overflow, '');
    unsubscribe();
  });

  test('a later lock without a text field shares the overflow lock', function (assert) {
    const release = lockOverflow();
    const releaseNested = lockOverflow();
    assert.true(transparentStatusBarLock());
    assert.strictEqual(document.body.style.position, '');
    releaseNested();
    assert.true(transparentStatusBarLock());
    release();
    assert.false(transparentStatusBarLock());
  });

  test('the default iOS lock still fixes <body>', function (assert) {
    const release = lockBodyScroll((node) => tray.contains(node), {
      fields: [tray],
    });
    assert.strictEqual(document.body.style.position, 'fixed');
    release();
    assert.strictEqual(document.body.style.position, '');
  });
});

// A classic scrollbar goes away with `overflow: hidden` on <html> (#166).
module('Unit | modal | scroll-lock (classic scrollbar)', function (hooks) {
  let style: HTMLStyleElement;
  let content: HTMLElement;
  let fixed: HTMLElement;
  const html = document.documentElement;
  const { body } = document;

  hooks.beforeEach(async function () {
    // A custom scrollbar takes layout space also where the browser uses
    // overlay scrollbars (macOS).
    style = document.createElement('style');
    style.textContent = `
      html.lock-scrollbar::-webkit-scrollbar { width: 15px; }
      html.lock-scrollbar::-webkit-scrollbar-thumb { background: gray; }
      html.lock-gutter { scrollbar-gutter: stable; }
    `;
    document.head.append(style);
    html.classList.add('lock-scrollbar');
    content = document.createElement('div');
    content.style.height = `${window.innerHeight + 2000}px`;
    fixed = document.createElement('div');
    fixed.style.cssText = 'position: fixed; top: 0; left: 0; right: 0;';
    body.append(content, fixed);
    // Chrome adds the custom scrollbar in the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

  hooks.afterEach(function (assert) {
    content.remove();
    fixed.remove();
    html.classList.remove('lock-scrollbar', 'lock-gutter');
    style.remove();
    delete drawerEnvironment.isIOS;
    assert.strictEqual(bodyScrollLocks(), 0, 'no lock left behind');
  });

  /**
   * Whether the browser keeps the scrollbar's space for `scrollbar-gutter:
   * stable` on <html> with `overflow: hidden`. Not with overlay scrollbars
   * (macOS): there the custom scrollbar goes away.
   */
  function gutterHolds(): boolean {
    const { overflow, scrollbarGutter } = html.style;
    const width = html.getBoundingClientRect().width;
    html.style.scrollbarGutter = 'stable';
    html.style.overflow = 'hidden';
    const holds = html.getBoundingClientRect().width === width;
    html.style.overflow = overflow;
    html.style.scrollbarGutter = scrollbarGutter;
    return holds;
  }

  const right = (element: HTMLElement) => element.getBoundingClientRect().right;

  const variants: [string, boolean, boolean][] = [
    // name, iOS, transparentStatusBar
    ['desktop', false, false],
    ['iOS, fixed <body>', true, false],
    ['iOS, overflow lock', true, true],
  ];

  for (const [name, ios, transparentStatusBar] of variants) {
    const lock = () => {
      drawerEnvironment.isIOS = () => ios;
      return lockBodyScroll(() => false, { transparentStatusBar });
    };

    test(`${name}: the body is padded for the scrollbar`, function (assert) {
      const scrollbar = window.innerWidth - html.clientWidth;
      assert.true(scrollbar > 0, 'a scrollbar');
      const before = right(content);
      const release = lock();
      assert.strictEqual(right(content), before, 'content in place');
      assert.strictEqual(body.style.paddingRight, `${scrollbar}px`, 'padding');
      assert.strictEqual(html.style.scrollbarGutter, '', 'no gutter set');
      release();
      assert.strictEqual(html.style.overflow, '');
      assert.strictEqual(body.style.paddingRight, '');
      assert.strictEqual(right(content), before);
    });

    test(`${name}: with scrollbar-gutter: stable on <html>`, function (assert) {
      html.classList.add('lock-gutter');
      assert.true(window.innerWidth - html.clientWidth > 0, 'a scrollbar');
      const holds = gutterHolds();
      const before = { content: right(content), fixed: right(fixed) };
      const release = lock();
      assert.strictEqual(html.style.scrollbarGutter, '', 'left to the app');
      assert.strictEqual(right(content), before.content, 'content in place');
      if (holds) {
        assert.strictEqual(body.style.paddingRight, '', 'no extra padding');
        assert.strictEqual(right(fixed), before.fixed, 'fixed in place');
      } else {
        assert.notStrictEqual(body.style.paddingRight, '', 'padding');
      }
      release();
      assert.strictEqual(html.style.overflow, '');
      assert.strictEqual(body.style.paddingRight, '');
      assert.strictEqual(right(content), before.content);
    });
  }
});
