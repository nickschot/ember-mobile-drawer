import Component from '@glimmer/component';
import { type SnapPoint } from '../-private/snap-points/index.ts';
import { type LifecycleHooks } from '../-private/lifecycle-modifier.ts';
import { type GrabberOwner } from '../-private/grabber';
import type { MobileDrawerSpring } from '../springs.ts';
import type { MobileDrawerApi, MobileDrawerDragEndEvent, MobileDrawerDragStartEvent, MobileDrawerToggleEvent, Placement } from '../types.ts';
export interface MobileDrawerSignature {
    Element: HTMLDivElement;
    Args: {
        /**
         * The edge the drawer is attached to. Default `'bottom'`.
         */
        placement?: Placement;
        /**
         * Positions the drawer can rest at, as the distance it is opened along
         * its axis: px (`240`), a percentage of the space the tray can open into
         * (`'50%'`), or `'content'` for the tray's natural size. Order doesn't
         * matter; snap points are identified by their index in this array.
         * Include `0` to let the drawer close fully. Default `[0, 'content']`.
         */
        snapPoints?: readonly SnapPoint[];
        /**
         * Index into `@snapPoints` of the snap point the drawer should be at.
         * When set, the drawer is controlled: changes made from outside animate
         * to the new snap point, and the drawer's own actions (`snapTo`, `open`,
         * `close`, releasing a drag) only call `@onSnapPointChange`. After a drag
         * the drawer heads back to `@activeSnapPoint` until the new index is
         * passed in. When omitted, the drawer starts at index `0` and manages its
         * snap point itself.
         */
        activeSnapPoint?: number;
        /**
         * Called with the new index when the drawer wants to move to another snap
         * point (through `snapTo`, `open`, `close` or releasing a drag). Not
         * called when `@activeSnapPoint` is changed from outside.
         */
        onSnapPointChange?: (index: number) => void;
        /**
         * Only start a drag on elements with the yielded `handle` modifier,
         * instead of anywhere on the tray. Use it when the content has its own
         * gestures. Without it, the tray drags too, and a handle is an area that
         * always drags (also when the content is scrolled). Either way the
         * content only scrolls along the axis at the highest snap point;
         * without it, scrollable content (the tray and elements marked
         * `data-mobile-drawer-scroll`) scrolls there and drags elsewhere, see
         * the class docs. Default `false`.
         */
        handleOnly?: boolean;
        /**
         * Whether to render the backdrop behind the tray. Without it nothing
         * covers the page, so the page stays interactive while the drawer is
         * open. Default: the value of `@modal`, so `true` unless the drawer is
         * non-modal.
         */
        backdrop?: boolean;
        /**
         * Whether a tap (or click) on the backdrop closes the drawer, like
         * `close`: to the smallest snap point, through `@onSnapPointChange` when
         * controlled. A pointer that moves more than a few px before it lifts
         * isn't a tap. Default `true`.
         */
        closeOnBackdropClick?: boolean;
        /**
         * Whether the drawer is a modal dialog while it is open (above its
         * smallest snap point): focus moves into it and stays there, the rest of
         * the page is `inert`, the page doesn't scroll, Escape closes it and
         * focus returns to where it was when it closes. The root gets
         * `role="dialog"` (label it with `aria-label` or `aria-labelledby`) and,
         * while open, `aria-modal="true"`. With `@modal={{false}}` the page stays
         * usable while the drawer is open, and Escape only closes the drawer
         * while focus is inside it. Default `true`.
         */
        modal?: boolean;
        /**
         * iOS Safari 26+ only: while this modal drawer is open, the status bar
         * shows the dimmed page (with Safari's blur) instead of one solid colour
         * (#113). The drawer then uses a scroll lock that doesn't fix `<body>`,
         * its root starts 5px below the top, and the dim is a separate layer as
         * large as the document, inserted before the root. A drawer that
         * contains a text field keeps the fixed `<body>` (the on-screen keyboard
         * needs it, #116), and with it the solid status bar; so does every
         * drawer while such a drawer is open in front of it. Top drawers and
         * other browsers don't change. Default `false`.
         */
        transparentStatusBar?: boolean;
        /**
         * Called when the drawer opens: its active snap point moves from the
         * smallest snap point to a larger one (by any means: an action, a drag,
         * `@activeSnapPoint`). Called once per change, in a microtask after it,
         * together with the modal behaviour (see `@modal`), so when the drawer
         * starts to move rather than when it arrives. Not called when the drawer
         * is inserted open (also when it is inserted hidden, e.g. in a
         * `display: none` container, and then shown), nor for a move between
         * two open snap points. A
         * drawer that opens and closes again within the same task calls
         * neither `@onOpen` nor `@onClose`.
         */
        onOpen?: (event: MobileDrawerToggleEvent) => void;
        /**
         * Called when the drawer closes: its active snap point moves back to the
         * smallest snap point, which is always the `snapPoint` it gets. Like
         * `@onOpen`, once per change, when the drawer starts to move. Not called
         * when the drawer is removed while open.
         */
        onClose?: (event: MobileDrawerToggleEvent) => void;
        /**
         * Called when a drag starts: once a pan along the drawer's axis is
         * recognised. Called synchronously, before the yielded `isDragging`
         * turns `true` (in a microtask right after).
         */
        onDragStart?: (event: MobileDrawerDragStartEvent) => void;
        /**
         * Called once for every `@onDragStart`, when the drag ends, before
         * `@onSnapPointChange`. Not called when the drawer is removed during
         * the drag. `@onSnapPointChange` then gets an index into `@snapPoints`
         * as they were at the release, also if `@onDragEnd` changes them.
         */
        onDragEnd?: (event: MobileDrawerDragEndEvent) => void;
        /**
         * The spring that moves the drawer to a snap point: `stiffness`,
         * `damping` and `mass`, for example `springPresets.ios`. Keys that are
         * left out keep the default (`springPresets.default`). Read when an
         * animation starts, so a change applies from the next one. Values must
         * be finite numbers greater than `0`: development builds assert that,
         * production builds ignore other values. With reduced motion the drawer
         * jumps to its snap point whatever the spring.
         */
        spring?: Partial<MobileDrawerSpring>;
    };
    Blocks: {
        default: [drawer: MobileDrawerApi];
        /**
         * Optional. Content that stays at the tray's leading edge, outside the
         * scroll container, such as a grabber or a title bar: the header
         * mode. The content then scrolls (and bounces at its start, as in a
         * native iOS sheet) under it. See "Header" in the README.
         */
        header: [drawer: MobileDrawerApi];
    };
}
/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring. The README describes the behaviour; the notes here are about how.
 *
 * Scroll vs drag: each touch gesture is decided once (see `dragSource`) and
 * keeps that decision until the finger lifts. Below the highest snap point
 * the content is locked along the axis (see `#syncScrollLock`) and every
 * gesture drags; at it, a gesture scrolls when a scroll container under the
 * finger can scroll that way. Two exceptions: a scroll that reaches its
 * scroll start while pulling towards close is taken over by a drag (see
 * `onTrayScroll`), and a drag that reaches the highest snap point scrolls the
 * content from script (see `#splitDrag`), because in iOS Safari a native
 * scroll can't start after its touchmoves were cancelled.
 *
 * A drag cancels its touchmoves at every snap point: iOS Safari doesn't
 * reliably honour `touch-action` on a scroll container, so nothing relies on
 * it alone. Touchmoves are only cancelled once a gesture is decided, so
 * swipes across the axis keep working.
 *
 * Handles are drag sources of their own and always drag; whichever drag
 * source recognises the pan first owns the drag (see `#onHandle`). A gesture
 * that starts in a nested drawer belongs to that drawer only (see
 * `#inNested` and `#onNestedTouchMove`).
 *
 * ```gts
 * <MobileDrawer @snapPoints={{array 0 "50%" "100%"}} as |drawer|>
 *   <button type="button" {{on "click" drawer.close}}>Close</button>
 * </MobileDrawer>
 * ```
 */
export default class MobileDrawer extends Component<MobileDrawerSignature> {
    #private;
    isAnimating: boolean;
    isDragging: boolean;
    /**
     * The real value needs the measured layout, so a drawer inserted open
     * renders its block once more after insertion.
     */
    progress: number;
    /** Bumped when the drawer changes its own (uncontrolled) snap point. */
    uncontrolledVersion: number;
    modalActive: boolean;
    /** For the `Grabber`: the open snap point indices, ascending by offset. */
    openSnapPoints: readonly (readonly number[])[];
    /** Where the yielded `Nested` renders without `@destination`. */
    nestedParent?: Element;
    private nestedOwner;
    /** The DOM order (tab and reading order) is the order on screen. */
    get headerFirst(): boolean;
    get placement(): Placement;
    get snapPoints(): readonly SnapPoint[];
    get axis(): 'vertical' | 'horizontal';
    get handleOnly(): boolean;
    get isModal(): boolean;
    get showBackdrop(): boolean;
    get closeOnBackdropClick(): boolean;
    get isControlled(): boolean;
    /**
     * An invalid `@activeSnapPoint` (e.g. `@snapPoints` shrank first) is
     * clamped with a warning, rather than throwing during rendering.
     */
    get activeSnapPoint(): number;
    snapTo: (index: number) => void;
    grabberOwner: GrabberOwner;
    open: () => void;
    close: () => void;
    hooks: LifecycleHooks;
    /**
     * The backdrop is a pointer convenience, deliberately not focusable or a
     * button: a keyboard closes with Escape or the app's own controls.
     */
    backdropHooks: LifecycleHooks;
    /**
     * Tells a tap from a drag when the click arrives. A mouse has no implicit
     * capture, so movement is followed on the document.
     */
    private onBackdropPointerDown;
    /**
     * A click whose pointer moved isn't a tap. A pointer's click lands where
     * it lifted; any other click (`element.click()`, assistive technology) is.
     */
    private onBackdropClick;
    /** Read when a touch starts, so `#render` keeps it up to date. */
    private trayTouchAction;
    /** Once per gesture, after a touch on a moving drawer has held it. */
    private shouldDrag;
    /**
     * The scroll handoff of a native sheet: a drag takes over a scroll that
     * reaches its scroll start while the finger pulls towards close. Only
     * while the finger is down: momentum never moves the drawer. Before that,
     * `overscroll-behavior: none` near that end, so the content doesn't bounce
     * (iOS) and then jump back when the drag locks it.
     */
    private onTrayScroll;
    private onTrayScrollEnd;
    /**
     * So the handle's drag source cancels the touchmoves too, also with
     * `@handleOnly`, where the tray isn't a drag source.
     */
    private shouldHandleDrag;
    private onHandleInstall;
    private onHandleTeardown;
    /**
     * A touch holds a running animation at once, like native sheets, not only
     * once a pan is recognised. Lifting without a drag resumes it, so taps on
     * content keep working.
     */
    private onPointerDown;
    private onPanStart;
    private onPan;
    private onPanEnd;
    /**
     * Its pointer events won't arrive any more: settle as on `pointercancel`.
     * Teardown happens during rendering, so the release waits for a microtask.
     */
    private onDragSourceTeardown;
}
//# sourceMappingURL=mobile-drawer.d.ts.map