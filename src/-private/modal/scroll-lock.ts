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
 *   focus or the keyboard closes. A tap on a field that the keyboard will
 *   not cover focuses it without that scroll, which can go up on a tall
 *   page (see `onTouchEnd`, #116).
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
 * Whether `element` is a field the user types in (it opens the on-screen
 * keyboard), in a locked drawer.
 */
function isTypingField(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const field =
    (element instanceof HTMLInputElement &&
      !NON_TEXT_INPUTS.has(element.type)) ||
    element instanceof HTMLTextAreaElement
      ? !(element as HTMLInputElement).readOnly &&
        !(element as HTMLInputElement).disabled
      : element.isContentEditable;
  return field && allowed.some((tray) => tray.contains(element));
}

/** Whether a field the user types in has focus in a locked drawer. */
function typingFieldFocused(): boolean {
  return isTypingField(document.activeElement);
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
 * Any scroll of the page while locked is undone at once. Not while the
 * keyboard is open: iOS (or `revealFocused`) then scrolls to show the
 * focused field, and the fixed drawer moves with it.
 */
const onScroll = (): void => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/** The part of the viewport (px) that the keyboard covered last time. */
let keyboardHeight: number | undefined;

/** The part of the viewport that the keyboard will cover: a guess. */
function predictedKeyboardHeight(): number {
  if (keyboardHeight !== undefined) return keyboardHeight;
  const { innerWidth, innerHeight } = window;
  // iPhone, keyboard and autocomplete bar: 46% of the height in portrait.
  return innerHeight * (innerHeight > innerWidth ? 0.55 : 0.8);
}

/** Space (px) between the focused field and the keyboard. */
const REVEAL_MARGIN = 16;

/**
 * The keyboard opened or closed. Open: remember its height, and if it
 * covers the focused field (the guess of `onTouchEnd` was wrong), scroll the
 * page down so that the field shows. Only down, as with the #71 lock: the
 * drawer moves up with the visual viewport. Closed: put the page back.
 */
const onViewportResize = (): void => {
  if (!pinned) return;
  const viewport = window.visualViewport;
  if (!viewport) return;
  const covered = window.innerHeight - viewport.height * viewport.scale;
  if (covered > 1) {
    keyboardHeight = covered;
    const active = document.activeElement;
    if (isTypingField(active)) {
      const { bottom } = active.getBoundingClientRect();
      const visible = viewport.offsetTop + viewport.height;
      const delta = bottom + REVEAL_MARGIN - visible;
      if (delta > 0) {
        window.scrollBy({ top: Math.min(delta, covered), behavior: 'instant' });
      }
    }
    return;
  }
  if (!keyboardOpen()) restorePinned();
};

/**
 * Focus left a field in a drawer, and not for another one: put the page back
 * at once, as iOS does with the #71 lock.
 */
const onFocusOut = (): void => {
  // `activeElement` is the new focus only after the focusout.
  setTimeout(() => {
    if (pinned && !typingFieldFocused()) restorePinned();
  }, 0);
};

/** Where the current touch started (overflow lock). */
let touchStart: { x: number; y: number } | undefined;

const onTouchStart = (event: TouchEvent): void => {
  const touch = event.touches[0];
  lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  touchStart = event.touches.length === 1 ? lastTouch : undefined;
};

/**
 * A tap on a text field in a drawer that the keyboard will not cover: focus
 * it without the scroll of iOS.
 *
 * iOS shows a focused field by scrolling the visual viewport (and `scrollY`)
 * so that the field is in the middle of the part that the keyboard doesn't
 * cover. The fixed drawer moves with it. With the #71 lock (a fixed
 * `<body>`) the page can only scroll from 0 down to the keyboard height, so
 * iOS can only scroll down: when the field is high in the drawer (at full
 * height), nothing moves. With this lock the page is tall, so iOS also
 * scrolls up (49px in the simulator): the page and the drawer jump, and
 * jump back when the keyboard closes (#116).
 *
 * Thus when the field will be above the keyboard (`predictedKeyboardHeight`),
 * the tap's default (focus and that scroll) is cancelled, and the field gets
 * `focus({ preventScroll: true })`: iOS then doesn't scroll at all. Else iOS
 * does its own scroll, down, as with the #71 lock. A wrong guess is fixed
 * when the keyboard opens (`onViewportResize`).
 *
 * Only `<input>` and `<textarea>`, not a field that has focus, and not after
 * the finger moved (a swipe). The caret goes where `focus()` puts it, not
 * under the finger.
 */
const onTouchEnd = (event: TouchEvent): void => {
  const start = touchStart;
  touchStart = undefined;
  const target = event.target;
  const touch = event.changedTouches[0];
  if (
    !pinned ||
    !start ||
    !touch ||
    !event.cancelable ||
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) ||
    !isTypingField(target) ||
    target === document.activeElement ||
    Math.abs(touch.clientX - start.x) > 10 ||
    Math.abs(touch.clientY - start.y) > 10
  ) {
    return;
  }
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const visible = top + window.innerHeight - predictedKeyboardHeight();
  const { bottom } = target.getBoundingClientRect();
  if (bottom + REVEAL_MARGIN > visible) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
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

function lock(): Saved {
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

  if (ios && drawerEnvironment.iosScrollLock === 'overflow') {
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
    document.addEventListener('touchend', onTouchEnd, { passive: false });
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
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('touchmove', onTouchMoveOverflow);
    lastTouch = undefined;
    touchStart = undefined;
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
  if (allowed.length === 0) saved = lock();
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
