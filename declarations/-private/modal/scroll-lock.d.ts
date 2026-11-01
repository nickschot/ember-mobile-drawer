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
 * - For a transparent status bar (`transparentStatusBar`, #113), iOS gets
 *   a lock that doesn't fix `<body>` (a fixed `<body>` makes Safari 26+
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
 *   gets the fixed `<body>` (see `hasTypingField`, #116), also when it
 *   opens while the overflow lock is on: the lock then changes to the fixed
 *   `<body>` until the last lock is released (see `onLockChange`).
 *
 * @module
 * @internal
 */
export interface LockOptions {
    /**
     * The elements to look for a text field in (iOS overflow lock only): with
     * one, iOS gets the fixed `<body>` (see `hasTypingField`).
     */
    fields?: HTMLElement[];
    /**
     * iOS gets the overflow lock (no fixed `<body>`), so the status bar can
     * show the page (#113), unless a text field is in `fields`. The first
     * lock decides; later locks share it, except that a later lock with a
     * text field changes it to the fixed `<body>` (see `onLockChange`).
     */
    transparentStatusBar?: boolean;
}
/**
 * Calls `listener` when the lock that is on changes from the overflow lock
 * to the fixed `<body>` (a drawer with a text field opened while the
 * overflow lock was on). Returns a function that removes the listener.
 */
export declare function onLockChange(listener: () => void): () => void;
/**
 * Locks body scrolling until the returned function is called. Touch scrolling
 * on the nodes `allow` returns `true` for keeps working on iOS (a drawer
 * allows its tray and the portals of the drawers nested in it). Calling the
 * returned function more than once does nothing.
 */
export declare function lockBodyScroll(allow: (target: Node) => boolean, options?: LockOptions): () => void;
/**
 * Whether the lock that is on is the iOS overflow lock for a transparent
 * status bar (#113): `<body>` isn't fixed, and the drawers move
 * their fixed elements away from the top edge (`data-status-bar`).
 */
export declare function transparentStatusBarLock(): boolean;
/** The number of active locks. @internal for tests */
export declare function bodyScrollLocks(): number;
//# sourceMappingURL=scroll-lock.d.ts.map