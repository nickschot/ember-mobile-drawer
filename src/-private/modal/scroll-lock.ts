/**
 * A reference-counted body scroll lock for modal drawers: the page scrolls
 * again only once the last lock is released.
 *
 * Adapted from ember-mobile-menu's `utils/body-scroll-lock.js` (MIT, Nick
 * Schot), which adapts https://github.com/willmcpo/body-scroll-lock (MIT
 * License, Copyright (c) 2018 Will Po).
 *
 * - Everywhere: `overflow: hidden` on `<html>`, and the body is padded by the
 *   width of a classic scrollbar so the page doesn't shift.
 * - iOS ignores `overflow: hidden` for touch scrolling: `<body>` is fixed at
 *   its scroll position, and touchmoves outside the allowed elements are
 *   cancelled so the viewport doesn't rubber-band.
 * - Transparent status bar: a fixed `<body>` makes Safari 26+ paint the
 *   status bar in one solid colour, so iOS gets the "overflow lock" instead.
 *   Touchmoves are also cancelled inside the allowed elements when nothing
 *   there can scroll further in the swipe's direction, and a page scroll is
 *   undone at once, except while the on-screen keyboard is open. A drawer
 *   with a text field still gets the fixed `<body>` (see `lock`).
 *
 * @module
 * @internal
 */

import { drawerEnvironment } from '../environment.ts';
import { containsTypingField } from '../fields.ts';

interface Saved {
  htmlOverflow: string;
  bodyPaddingRight: string;
  /** Only with the iOS overflow lock. */
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

/** One per lock: where touchmoves are not cancelled (iOS). */
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

let lastTouch: { x: number; y: number } | undefined;
let pinned: { x: number; y: number } | undefined;

/** The keyboard is open, or about to open (a field in a drawer has focus). */
function keyboardOpen(): boolean {
  const viewport = window.visualViewport;
  if (viewport && viewport.height * viewport.scale < window.innerHeight - 1) {
    return true;
  }
  return typingFieldFocused();
}

function typingFieldFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      active.isContentEditable) &&
    allowed.some((allows) => allows(active))
  );
}

function restorePinned(): void {
  if (!pinned) return;
  const { x, y } = pinned;
  if (window.scrollX !== x || window.scrollY !== y) {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
}

/**
 * Undoes any page scroll, except while the keyboard is open: iOS scrolls the
 * page to show a focused field, and the fixed drawer moves with it. Scrolling
 * back would hide the field. The viewport `resize` restores it on close.
 */
const onViewportChange = (): void => {
  if (!pinned || keyboardOpen()) return;
  restorePinned();
};

/** Puts the page back as soon as focus leaves the fields, as iOS does. */
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
 * Allows a touchmove only when an element from the target up through the
 * allowed element can still scroll in the swipe's direction.
 */
const onTouchMoveOverflow = (event: TouchEvent): void => {
  if (event.touches.length > 1) return;
  const touch = event.touches[0];
  const target = event.target;
  const allows =
    target instanceof Node ? allowed.find((check) => check(target)) : undefined;
  let allow = false;
  if (allows && touch && lastTouch) {
    const dx = touch.clientX - lastTouch.x;
    const dy = touch.clientY - lastTouch.y;
    if (dx === 0 && dy === 0) return;
    let element: Element | null =
      target instanceof Element ? target : (target as Node).parentElement;
    while (element && allows(element)) {
      if (canScroll(element, dx, dy)) {
        allow = true;
        break;
      }
      element = element.parentElement;
    }
  }
  if (touch) lastTouch = { x: touch.clientX, y: touch.clientY };
  if (!allow && event.cancelable) event.preventDefault();
};

/**
 * A drawer with a text field gets the fixed `<body>` from the start: with the
 * tall page of the overflow lock, iOS also scrolls up to show a focused field,
 * and the page and the drawer move apart. Fixing `<body>` only on focus does
 * not work: during the touch iOS drops the tap, and in `focusin` it flashes
 * the page background.
 */
function lock(options: LockOptions): Saved {
  const html = document.documentElement;
  const body = document.body;
  const ios = (drawerEnvironment.isIOS ?? detectIOS)();
  const result: Saved = {
    htmlOverflow: html.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
  };

  // Before hiding the overflow, which removes a classic scrollbar.
  const scrollbar = window.innerWidth - html.clientWidth;
  if (scrollbar > 0) {
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${padding + scrollbar}px`;
  }

  if (
    ios &&
    options.transparentStatusBar &&
    !options.fields?.some(containsTypingField)
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
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.visualViewport?.addEventListener('resize', onViewportChange);
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
    window.removeEventListener('scroll', onViewportChange);
    window.visualViewport?.removeEventListener('resize', onViewportChange);
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

export interface LockOptions {
  /** Where to look for a text field: one forces the fixed `<body>`. */
  fields?: HTMLElement[];
  /**
   * iOS gets the overflow lock. The first lock decides; a later lock with a
   * text field changes it to the fixed `<body>`.
   */
  transparentStatusBar?: boolean;
}

const lockChangeListeners = new Set<() => void>();

/** Called when the overflow lock changes to the fixed `<body>`. */
export function onLockChange(listener: () => void): () => void {
  lockChangeListeners.add(listener);
  return () => lockChangeListeners.delete(listener);
}

/**
 * Locks body scrolling until the returned (idempotent) function is called.
 * Touch scrolling on the nodes `allow` accepts keeps working on iOS.
 */
export function lockBodyScroll(
  allow: (target: Node) => boolean,
  options: LockOptions = {},
): () => void {
  if (allowed.length === 0) {
    saved = lock(options);
  } else if (saved?.overflow && options.fields?.some(containsTypingField)) {
    // The keyboard needs the fixed `<body>`.
    unlock(saved);
    saved = lock({});
    for (const listener of [...lockChangeListeners]) listener();
  }
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

/** Whether the iOS overflow lock (no fixed `<body>`) is on. */
export function transparentStatusBarLock(): boolean {
  return saved?.overflow !== undefined;
}

/** The number of active locks. @internal for tests */
export function bodyScrollLocks(): number {
  return allowed.length;
}
