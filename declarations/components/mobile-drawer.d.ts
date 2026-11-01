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
    };
}
/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring.
 *
 * The tray can be dragged with touch or pen input along the drawer's axis
 * (through `didPan` from ember-gesture-modifiers). It follows the finger 1:1,
 * with rubber-band resistance past the first and last snap point. Past the
 * last one the tray stays at its edge; a drag from the content scrolls the
 * content there when it can (see `#splitDrag`), else the content bounces,
 * like an iOS sheet (see `OPEN_RUBBER_BAND_RATIO` and `#renderBounce`).
 * On release the drawer's velocity is handed to the spring and the snap point nearest to where the
 * release would carry the drawer is picked; a release faster than
 * `FLING_VELOCITY` always moves at least one snap point its way. A touch
 * holds a running animation where it is, and a drag continues from there.
 * Elements with the yielded `handle` modifier always drag, see below. With
 * `@handleOnly`, only they start a drag. One finger drags at a time.
 *
 * Scroll vs drag: the tray is a scroll container, as is every element in it
 * marked with `data-mobile-drawer-scroll`. Each touch gesture is decided
 * once the finger has moved a few px along the axis, and further along it
 * than across it (see `dragSource`), and keeps that decision until the
 * finger lifts:
 * - below the highest snap point every gesture along the axis drags, and
 *   the content can't scroll along the axis at all (see `#syncScrollLock`);
 * - at the highest snap point a gesture scrolls if a scroll container
 *   between the touched element and the tray (inclusive) can scroll the way
 *   the finger pushes the content, and drags otherwise. So at the start of
 *   the content, pulling a bottom drawer down closes it.
 * One exception to "keeps that decision": a gesture that scrolls the
 * content and reaches its scroll start while the finger still pulls
 * towards close is taken over by a drag (the scroll handoff of an iOS
 * sheet, see `onTrayScroll`). The drag starts where the tray is, locks the
 * content and stays a drag until the finger lifts. Momentum after the
 * finger lifted never moves the drawer.
 * The other way, a drag from the content (not a handle) that reaches the
 * highest snap point while the finger moves on towards open scrolls the
 * content from script, 1:1 with the finger, and its release goes on with a
 * momentum (see `#splitDrag` and `#startMomentum`). The gesture stays a
 * drag: in iOS Safari a native scroll can't start after its touchmoves
 * were cancelled.
 * A gesture that drags cancels its `touchmove` events at every snap point
 * (see `dragSource`), so the browser can't scroll the content or the page
 * under it. The tray also gets `touch-action: pan-x` (vertical drawers) or
 * `pan-y` (horizontal ones) below the highest snap point and `pan-x pan-y`
 * at it, but iOS Safari doesn't reliably honour `touch-action` on a scroll
 * container, so nothing relies on it alone. Touchmoves are only cancelled
 * once a gesture is decided, so swipes across the axis (a carousel, a list
 * in a side drawer) keep working.
 *
 * Handles: an element with the `handle` modifier is a drag source of its
 * own, with `didPan`'s `touch-action` (`pan-x` for a vertical axis, `pan-y`
 * for a horizontal one), so the browser doesn't pan along the axis on it. A
 * gesture that starts on a handle always drags, at every snap point, also
 * when the content is scrolled (see `#onHandle`): a sticky header with the
 * modifier stays a way to drag a scrolled sheet. The handle's drag source
 * decides such a gesture as a drag like the tray's does (`shouldHandleDrag`),
 * so it cancels the touchmoves, also with `@handleOnly`. Without
 * `@handleOnly` the tray's drag source decides it as a drag too
 * (`shouldDrag`); whichever of the two recognises the pan first owns the
 * drag, and the other is ignored. A handle wins over everything in it, also
 * a `data-mobile-drawer-scroll` element, except a text field (see
 * `#onHandle`). A handle belongs to the drawer that yielded it, not to a
 * drawer around that one. A tap on an element in a handle (a button) still
 * clicks.
 *
 * Nested drawers: a drawer in this drawer's tray is a part of its tray, so
 * its touches also reach this drawer's drag sources. A gesture that starts
 * in a nested drawer (its tray, a handle or its backdrop) belongs to that
 * drawer only (see `#inNested`): it never drags this drawer, also when the
 * nested drawer is at its closed position and the finger moves on, and it
 * doesn't hold this drawer's running animation. A nested drawer in the
 * yielded `Nested` renders outside the tray (see `nesting.ts`), so the tray
 * doesn't clip it; its touches never reach this drawer. For the modal
 * stack, `data-nested`, `inert`, focus, the scroll lock and the hiding of
 * a closed drawer it still counts as inside this drawer. When this drawer
 * starts to close, it closes such a drawer (see `#closePortaled`).
 *
 * With `@handleOnly` the content is locked below the highest snap point
 * too, so it only scrolls when the drawer is fully open, and swipes along
 * the axis on it are cancelled there without dragging (see
 * `#onTrayTouchMove`), so the page behind doesn't scroll instead.
 * When a bottom or top drawer leaves its highest snap point, its tray
 * scrolls back to its scroll start, the content start at the leading edge;
 * at the highest snap point it opens at `scrollTop` 0 (see
 * `#planScrollReset`).
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` (unless
 * `@backdrop={{false}}`) and a `.mobile-drawer__sheet` with the
 * `.mobile-drawer__tray` in it, with the block inside
 * `.mobile-drawer__content`, and an empty `.mobile-drawer__bar-tint` after
 * the sheet and (with the backdrop) an empty `.mobile-drawer__backdrop-tint`
 * after the backdrop (for the iOS Safari 26 bars, see styles.css), and a
 * `.mobile-drawer__shadow` before the sheet, for a theme's outer shadow of
 * a floating bottom sheet (see `#paintShadow`), and an empty
 * `.mobile-drawer__glass` in the sheet before the tray, for a theme's
 * `backdrop-filter` on a floating bottom sheet (see `#paintShadow`).
 * Attributes are applied to the root element.
 *
 * Sheet: the sheet clips the tray. Every frame the component writes the
 * expand progress on it (see `#paintExpand`), from the second-highest to
 * the highest snap point, for themes such as a floating sheet that goes
 * edge-to-edge (`--mobile-drawer-inset`). The root gets `data-at-highest`
 * while the tray is at its highest snap point, and `data-nested` while a
 * modal drawer in front of it is open (see `#syncNested`).
 *
 * Backdrop: its opacity follows the drawer frame by frame through
 * `--mobile-drawer-progress`, written in `#render` like the transform. A tap
 * on it calls `close` (unless `@closeOnBackdropClick={{false}}`); a pointer
 * that moved more than `TAP_SLOP` isn't a tap. The backdrop
 * is not a drag source: touching it doesn't hold a running animation, and
 * a drag on it doesn't move the drawer.
 *
 * Modal (`@modal`, default): "open" means the active snap point is above
 * the smallest one. While open, the rest of the page is inert (the siblings
 * of the root and of each of its ancestors up to `<body>`), body scrolling is
 * locked, Tab wraps around inside the tray and Escape calls `close`. Focus
 * moves in when it opens and back to the previously focused element when it
 * closes, before `data-closed` hides the drawer. All of that is applied in a
 * microtask after rendering (`#syncOpen`), and undone right away on teardown.
 *
 * Keyboard focus on an element in the tray that is off screen moves the
 * drawer (modal or not, also from a peek, then without the modal
 * behaviour) to its highest snap point, see `#onTrayFocusIn`. The root never scrolls, see `#resetRootScroll`.
 *
 * Snap points are re-measured when the root or `.mobile-drawer__content`
 * changes size, and when an argument changes. The tray itself is not
 * observed (the component sizes it), so a change to only the tray's own
 * padding or border is picked up at the next of those.
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
     * Starts at `0`: the real value needs the measured layout, which only
     * exists after the first render. A drawer inserted at a snap point other
     * than closed therefore renders its block once more after insertion.
     */
    progress: number;
    /**
     * Bumped when the drawer changes its own (uncontrolled) snap point, so
     * everything that reads `activeSnapPoint` updates.
     */
    uncontrolledVersion: number;
    /** Whether the modal behaviour is on, for `aria-modal`. */
    modalActive: boolean;
    /**
     * For the yielded `Grabber`: the indices of the open snap points (offset
     * above `0`), one entry per resolved snap point, ascending by offset.
     * Updated after each measurement (see `#measure`), so empty before the
     * first one.
     */
    openSnapPoints: readonly (readonly number[])[];
    /**
     * The parent element of the root, once the drawer is in the DOM: where
     * the yielded `Nested` renders without `@destination`.
     */
    nestedParent?: Element;
    /** What the yielded `Nested` registers its portal element with. */
    private nestedOwner;
    get placement(): Placement;
    get snapPoints(): readonly SnapPoint[];
    get axis(): 'vertical' | 'horizontal';
    get handleOnly(): boolean;
    get isModal(): boolean;
    /** Unset, the backdrop follows `@modal`. */
    get showBackdrop(): boolean;
    get closeOnBackdropClick(): boolean;
    get isControlled(): boolean;
    /**
     * The active index into `@snapPoints`. An `@activeSnapPoint` that isn't a
     * valid index (e.g. `@snapPoints` shrank before the parent updated
     * `@activeSnapPoint`) is clamped to the nearest valid index, with a warning
     * in development, rather than throwing during rendering.
     */
    get activeSnapPoint(): number;
    snapTo: (index: number) => void;
    /** What the yielded `Grabber` gets, see `grabber.gts`. */
    grabberOwner: GrabberOwner;
    open: () => void;
    close: () => void;
    hooks: LifecycleHooks;
    /**
     * The backdrop is optional (`@backdrop`), so it registers itself. It is a
     * pointer convenience and deliberately not focusable or a button: a
     * keyboard closes the drawer with Escape or the app's own controls, so its
     * listeners are added here rather than with `{{on}}`.
     */
    backdropHooks: LifecycleHooks;
    /**
     * Starts tracking a pointer on the backdrop, to tell a tap from a drag
     * (or a scroll the browser took over) when its click arrives. Pointer
     * events of a touch stay on the backdrop (implicit capture), those of a
     * mouse don't, so movement is followed on the document.
     */
    private onBackdropPointerDown;
    /**
     * Closes the drawer on a tap on the backdrop. A click whose pointer moved
     * past `TAP_SLOP` (a drag that happened to start on the backdrop) isn't a
     * tap. The click a pointer causes lands where it lifted; any other click,
     * e.g. one without a pointer (`element.click()`, assistive technology),
     * is a tap, also when an earlier pointer's click never reached the
     * backdrop.
     */
    private onBackdropClick;
    /**
     * The tray's `touch-action`. Below the highest snap point every gesture
     * along the axis drags, so the browser may only pan across it. At the
     * highest snap point the content may scroll along the axis too; gestures
     * that drag cancel their `touchmove` events instead. Read when a touch
     * starts, so it is kept up to date in `#render`.
     */
    private trayTouchAction;
    /**
     * Decides whether a gesture on the tray drags the drawer or scrolls (see
     * the class docs). A gesture that starts on a handle always drags, one
     * that starts in a nested drawer never does. Called once per gesture,
     * after a touch on a moving drawer has held it.
     */
    private shouldDrag;
    /**
     * The tray's `onScroll`, for every `touchmove` of a gesture that scrolls
     * the content (see `dragSource`): whether a drag takes it over, the scroll
     * handoff of a native sheet. That is when the finger moves `step` px
     * towards close and no scroll container of the gesture (see
     * `#scrollChain`) can scroll that way any more: the content is at its
     * scroll start (for a bottom drawer). The drag then follows the finger
     * from where it is. Only while the finger is down: momentum that carries
     * the content to its start after the finger lifted doesn't move the
     * drawer. Not for a gesture in a nested drawer.
     *
     * Before that, so the content doesn't bounce at its start (iOS) and then
     * jump back when the drag locks it, the scroll containers of the gesture
     * that are nearer the end a pull towards close scrolls to than the other
     * end get `overscroll-behavior: none` along the axis, see `#setOverscroll`.
     */
    private onTrayScroll;
    /** The tray's `onScrollEnd`: puts back the overscroll behaviour. */
    private onTrayScrollEnd;
    /**
     * The handles' `shouldDrag`: a gesture on a handle drags (see
     * `#onHandle`). With it the handle's drag source also cancels the
     * touchmoves of a drag, so the browser can't scroll the tray under it,
     * also with `@handleOnly`, where the tray isn't a drag source.
     */
    private shouldHandleDrag;
    private onHandleInstall;
    private onHandleTeardown;
    /**
     * A touch on a drag source holds a running animation right away, like
     * native sheets, instead of only once a pan is recognised (past didPan's
     * threshold). If no drag starts, lifting the finger resumes the animation,
     * so taps on content keep working. Not a touch in a nested drawer (see
     * `#inNested`).
     */
    private onPointerDown;
    private onPanStart;
    private onPan;
    private onPanEnd;
    /**
     * The pan modifier of `source` was torn down (its element removed, or,
     * for the tray, `@handleOnly` changed). If it owned the drag, its pointer
     * events won't arrive any more: settle from where the drawer is, as on
     * `pointercancel`.
     * Teardown happens during rendering, so the release waits for a microtask.
     */
    private onDragSourceTeardown;
}
//# sourceMappingURL=mobile-drawer.d.ts.map