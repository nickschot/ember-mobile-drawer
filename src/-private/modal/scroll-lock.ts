/**
 * A reference-counted body scroll lock for modal drawers.
 *
 * Adapted from ember-mobile-menu's `utils/body-scroll-lock.js` (MIT, Nick
 * Schot), which in turn adapts https://github.com/willmcpo/body-scroll-lock
 * (MIT License, Copyright (c) 2018 Will Po). Unlike those, every lock is
 * counted: the page only scrolls again once the last lock is released, so
 * drawers can open and close in any order.
 *
 * - Everywhere: `overflow: hidden` on the root element (`<html>`), whose
 *   value applies to the viewport, so the page stops scrolling also when the
 *   app sets `overflow` on `<html>` itself. While a classic scrollbar
 *   disappears, the body is padded by its width so the page doesn't shift.
 * - iOS Safari ignores `overflow: hidden` for touch scrolling, so there the
 *   body is also fixed in place at its current scroll position (restored on
 *   unlock), and `touchmove`s outside the allowed elements (the trays of the
 *   locked drawers and the portals of the drawers nested in them) are
 *   cancelled, so the viewport doesn't rubber-band behind the drawer.
 * - SPIKE (#113): with `drawerEnvironment.iosScrollLock = 'overflow'`, iOS
 *   gets a lock that doesn't fix `<body>` (a fixed `<body>` makes Safari 26+
 *   paint the status bar in one solid colour). `overflow: hidden` and
 *   `overscroll-behavior: none` go on `<html>` and `<body>`, and touchmoves
 *   are cancelled outside the allowed elements and also inside them when no
 *   element between the touch and the allowed element can scroll further in
 *   the direction of the swipe, so the swipe can't chain to (or rubber-band)
 *   the page. The page keeps its scroll position: a scroll of the page
 *   while locked is undone at once, and again on unlock. Not while a text
 *   field in a drawer has focus (the on-screen keyboard): iOS scrolls the
 *   visual viewport to show the field, which moves the fixed drawer with
 *   it, as with the fixed `<body>`. The page goes back when the field loses
 *   focus or the keyboard closes. But a drawer that contains a text field
 *   gets the fixed `<body>` (see `hasTypingField`, #116).
 *
 * @module
 * @internal
 */

import { drawerEnvironment } from '../environment.ts';

interface Saved {
  htmlOverflow: string;
  bodyPaddingRight: string;
  /** Only with the iOS overflow lock (spike, #113). */
  overflow?: {
    bodyOverflow: string;
    htmlOverscroll: string;
    bodyOverscroll: string;
    x: number;
    y: number;
  };
  /** Only on iOS. */
  position?: {
    position: string;
    top: string;
    left: string;
    right: string;
    x: number;
    y: number;
  };
}

/**
 * Checks for the elements inside which touchmoves aren't cancelled (iOS
 * only), one per lock.
 */
const allowed: ((target: Node) => boolean)[] = [];
let saved: Saved | undefined;

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const { platform, maxTouchPoints } = navigator;
  // iPadOS reports itself as a Mac, but has touch points.
  return (
    /iP(ad|hone|od)/.test(platform) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  );
}

const onTouchMove = (event: TouchEvent): void => {
  // Leave multi-touch gestures (pinch-zoom) alone.
  if (event.touches.length > 1) return;
  const target = event.target;
  if (target instanceof Node && allowed.some((allows) => allows(target))) {
    return;
  }
  if (event.cancelable) event.preventDefault();
};

/** The last touch position, for the direction of a swipe (overflow lock). */
let lastTouch: { x: number; y: number } | undefined;
/** The page's scroll position while the overflow lock is on. */
let pinned: { x: number; y: number } | undefined;

/**
 * Whether the on-screen keyboard is (or is about to be) open: the visual
 * viewport is shorter than the layout viewport (pinch zoom aside), or a
 * field the user types in has focus in one of the locked drawers.
 */
function keyboardOpen(): boolean {
  const viewport = window.visualViewport;
  if (viewport && viewport.height * viewport.scale < window.innerHeight - 1) {
    return true;
  }
  return typingFieldFocused();
}

/** Whether a field the user types in has focus in a locked drawer. */
function typingFieldFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      active.isContentEditable) &&
    allowed.some((element) => element.contains(active))
  );
}

/** Scrolls the page back to where it was when it was locked. */
function restorePinned(): void {
  if (!pinned) return;
  const { x, y } = pinned;
  if (window.scrollX !== x || window.scrollY !== y) {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
}

/**
 * iOS still scrolls the page with `overflow: hidden`: to show a focused text
 * field above the on-screen keyboard, it moves the visual viewport (and with
 * it `scrollY`) so that the field is in the middle of the part that the
 * keyboard doesn't cover. The fixed drawer moves with the visual viewport, so
 * that is what shows the field (the #71 lock gets the same scroll, see
 * #116). Thus while the keyboard is open, the scroll stays: scrolling it back
 * hid the field and made the sheet jump. Any other scroll of the page is
 * undone at once. When the keyboard closes, the page goes back to its
 * position (see `onViewportResize`).
 */
const onScroll = (): void => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/** The keyboard closed: put the page back where it was. */
const onViewportResize = (): void => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/**
 * Focus left a field in a drawer, and not for another one: put the page back
 * at once, as iOS does with the #71 lock, and not only once the keyboard
 * has closed.
 */
const onFocusOut = (): void => {
  // `activeElement` is the new focus only after the focusout.
  setTimeout(() => {
    if (pinned && !typingFieldFocused()) restorePinned();
  }, 0);
};

const onTouchStart = (event: TouchEvent): void => {
  const touch = event.touches[0];
  lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
};

function canScroll(element: Element, dx: number, dy: number): boolean {
  const style = getComputedStyle(element);
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (!/auto|scroll/.test(style.overflowY)) return false;
    const max = element.scrollHeight - element.clientHeight;
    // Finger down (dy > 0) scrolls towards the top.
    return dy > 0 ? element.scrollTop > 0 : element.scrollTop < max - 1;
  }
  if (!/auto|scroll/.test(style.overflowX)) return false;
  const max = element.scrollWidth - element.clientWidth;
  const left = Math.abs(element.scrollLeft); // negative in RTL
  return dx > 0 ? left > 0 : left < max - 1;
}

/**
 * The overflow lock's touchmove filter: allowed only when an element from the
 * target up to (and including) the allowed element that contains it can
 * still scroll in the swipe's direction.
 */
const onTouchMoveOverflow = (event: TouchEvent): void => {
  if (event.touches.length > 1) return;
  const touch = event.touches[0];
  const target = event.target;
  const container =
    target instanceof Node
      ? allowed.find((element) => element.contains(target))
      : undefined;
  let allow = false;
  if (container && touch && lastTouch) {
    const dx = touch.clientX - lastTouch.x;
    const dy = touch.clientY - lastTouch.y;
    if (dx === 0 && dy === 0) return;
    let element: Element | null =
      target instanceof Element ? target : (target as Node).parentElement;
    while (element) {
      if (canScroll(element, dx, dy)) {
        allow = true;
        break;
      }
      if (element === container) break;
      element = element.parentElement;
    }
  }
  if (touch) lastTouch = { x: touch.clientX, y: touch.clientY };
  if (!allow && event.cancelable) event.preventDefault();
};

/** `<input>` types that open no on-screen keyboard. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether `element` contains a field the user types in (it opens the
 * on-screen keyboard).
 *
 * SPIKE (#116): the overflow lock can't give the keyboard behaviour of the
 * fixed `<body>`. iOS shows a focused field by scrolling the visual viewport
 * so that the field is in the middle of the part that the keyboard doesn't
 * cover. With a fixed `<body>` the page can only scroll from 0 down to the
 * keyboard height, so iOS scrolls down (animated with the keyboard) or not
 * at all. With the tall page of the overflow lock, iOS also scrolls up, and
 * on a real iPhone the page and the drawer move apart. Fixing `<body>` only
 * when a field gets focus doesn't work: during the touch (`touchstart`,
 * `touchend`) the change of `scrollY` makes iOS drop the tap (no focus, no
 * caret under the finger); in `focusin` iOS shows the page background for
 * about 6 frames. Cancelling the tap and focusing with `preventScroll`
 * leaves a dark overlay on the field and breaks the caret placement. Thus a
 * drawer with such a field gets the fixed `<body>` from the start; the
 * status bar is then one solid colour (#113).
 */
function hasTypingField(element: HTMLElement): boolean {
  for (const field of element.querySelectorAll<HTMLElement>(
    'input, textarea, [contenteditable]',
  )) {
    if (field instanceof HTMLInputElement) {
      if (
        !NON_TEXT_INPUTS.has(field.type) &&
        !field.disabled &&
        !field.readOnly
      ) {
        return true;
      }
    } else if (field instanceof HTMLTextAreaElement) {
      if (!field.disabled && !field.readOnly) return true;
    } else if (field.isContentEditable) {
      return true;
    }
  }
  return false;
}

function lock(allow: HTMLElement): Saved {
  const html = document.documentElement;
  const body = document.body;
  const ios = (drawerEnvironment.isIOS ?? detectIOS)();
  const result: Saved = {
    htmlOverflow: html.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
  };

  // Measured before hiding the overflow, which removes a classic scrollbar.
  const scrollbar = window.innerWidth - html.clientWidth;
  if (scrollbar > 0) {
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbar}px`;
  }

  if (
    ios &&
    drawerEnvironment.iosScrollLock === 'overflow' &&
    !hasTypingField(allow)
  ) {
    const { scrollX: x, scrollY: y } = window;
    result.overflow = {
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
      x,
      y,
    };
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    pinned = { x, y };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.visualViewport?.addEventListener('resize', onViewportResize);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMoveOverflow, {
      passive: false,
    });
  } else if (ios) {
    const { scrollX: x, scrollY: y } = window;
    const { position, top, left, right } = body.style;
    result.position = { position, top, left, right, x, y };
    body.style.position = 'fixed';
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.right = `${x}px`;
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  html.style.overflow = 'hidden';
  return result;
}

function unlock(state: Saved): void {
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = state.htmlOverflow;
  body.style.paddingRight = state.bodyPaddingRight;
  const { position, overflow } = state;
  if (overflow) {
    window.removeEventListener('scroll', onScroll);
    window.visualViewport?.removeEventListener('resize', onViewportResize);
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMoveOverflow);
    lastTouch = undefined;
    pinned = undefined;
    body.style.overflow = overflow.bodyOverflow;
    html.style.overscrollBehavior = overflow.htmlOverscroll;
    body.style.overscrollBehavior = overflow.bodyOverscroll;
    if (window.scrollX !== overflow.x || window.scrollY !== overflow.y) {
      window.scrollTo({
        left: overflow.x,
        top: overflow.y,
        behavior: 'instant',
      });
    }
  }
  if (position) {
    document.removeEventListener('touchmove', onTouchMove);
    body.style.position = position.position;
    body.style.top = position.top;
    body.style.left = position.left;
    body.style.right = position.right;
    // `instant`, so a `scroll-behavior: smooth` page doesn't visibly scroll
    // back to where it was.
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
  }
}

/**
 * Locks body scrolling until the returned function is called. Touch scrolling
 * on the nodes `allow` returns `true` for keeps working on iOS (a drawer
 * allows its tray and the portals of the drawers nested in it). Calling the
 * returned function more than once does nothing.
 */
export function lockBodyScroll(allow: (target: Node) => boolean): () => void {
  if (allowed.length === 0) saved = lock(allow);
  allowed.push(allow);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    allowed.splice(allowed.indexOf(allow), 1);
    if (allowed.length === 0 && saved) {
      const state = saved;
      saved = undefined;
      unlock(state);
    }
  };
}

/** The number of active locks. @internal for tests */
export function bodyScrollLocks(): number {
  return allowed.length;
}
