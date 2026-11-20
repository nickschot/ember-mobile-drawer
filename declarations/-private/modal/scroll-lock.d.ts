/**
 * A reference-counted body scroll lock for modal drawers: the page scrolls
 * again only once the last lock is released.
 *
 * Adapted from ember-mobile-menu's `utils/body-scroll-lock.js` (MIT, Nick
 * Schot), which adapts https://github.com/willmcpo/body-scroll-lock (MIT
 * License, Copyright (c) 2018 Will Po).
 *
 * - Everywhere: `overflow: hidden` on `<html>`, whose value applies to the
 *   viewport (also when the app sets `overflow` on `<html>`), and the body is
 *   padded by the width of a classic scrollbar so the page doesn't shift.
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
export interface LockOptions {
    /** Where to look for a text field: one forces the fixed `<body>`. */
    fields?: HTMLElement[];
    /**
     * iOS gets the overflow lock. The first lock decides; a later lock with a
     * text field changes it to the fixed `<body>`.
     */
    transparentStatusBar?: boolean;
}
/** Called when the overflow lock changes to the fixed `<body>`. */
export declare function onLockChange(listener: () => void): () => void;
/**
 * Locks body scrolling until the returned (idempotent) function is called.
 * Touch scrolling on the nodes `allow` accepts keeps working on iOS.
 */
export declare function lockBodyScroll(allow: (target: Node) => boolean, options?: LockOptions): () => void;
/** Whether the iOS overflow lock (no fixed `<body>`) is on. */
export declare function transparentStatusBarLock(): boolean;
/** The number of active locks. @internal for tests */
export declare function bodyScrollLocks(): number;
//# sourceMappingURL=scroll-lock.d.ts.map