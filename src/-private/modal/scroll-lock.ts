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
 *
 * @module
 * @internal
 */

import { drawerEnvironment } from '../environment.ts';

interface Saved {
  htmlOverflow: string;
  bodyPaddingRight: string;
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

  if (ios) {
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
  const { position } = state;
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
