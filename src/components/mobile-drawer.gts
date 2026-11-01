import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { assert, warn } from '@ember/debug';
import { buildWaiter } from '@ember/test-waiters';
import {
  DEFAULT_SPRING_CONFIG,
  Spring,
  browserClock,
  type FrameClock,
  type SpringResult,
} from '../-private/spring/spring.ts';
import {
  dragOffset,
  findSnapPoint,
  resolveSnapPoints,
  selectSnapPoint,
  type ResolvedSnapPoint,
  type SnapPoint,
} from '../-private/snap-points/index.ts';
import {
  DECISION_SLOP,
  dragSource,
  type PanData,
} from '../-private/gesture/drag-source.ts';
import { drawerEnvironment } from '../-private/environment.ts';
import {
  lifecycle,
  type LifecycleHooks,
} from '../-private/lifecycle-modifier.ts';
import { noop } from '../-private/noop-modifier.ts';
import { VelocityTracker } from '../-private/gesture/velocity.ts';
import { TURN_SLOP, catchUpLag } from '../-private/gesture/catch-up.ts';
import { inertOutside } from '../-private/modal/inert.ts';
import {
  lockBodyScroll,
  onLockChange,
  transparentStatusBarLock,
} from '../-private/modal/scroll-lock.ts';
import { PageDim } from '../-private/status-bar.ts';
import {
  focusWithoutScrolling,
  initialFocus,
  tabbables,
} from '../-private/modal/focus.ts';
import { registerDrawer, unregisterDrawer } from '../-private/registry.ts';
import {
  addPortal,
  logicalParent,
  logicallyContains,
  portalsOf,
  removePortal,
} from '../-private/nesting.ts';
import NestedPortal, { type NestedOwner } from '../-private/nested-portal.gts';
import { setPageProgress } from '../-private/page-progress.ts';
import { KeyboardFill } from '../-private/keyboard-fill.ts';
import type { MobileDrawerSpring } from '../springs.ts';

import type {
  MobileDrawerApi,
  MobileDrawerDragEndEvent,
  MobileDrawerDragStartEvent,
  MobileDrawerToggleEvent,
  Placement,
} from '../types.ts';

/**
 * Keeps `settled()` from `@ember/test-helpers` waiting while the drawer
 * animates, see `#startSpring`. A no-op in production builds.
 */
const animationWaiter = buildWaiter('ember-mobile-drawer:animation');

const PLACEMENTS: readonly Placement[] = ['bottom', 'top', 'left', 'right'];

const DEFAULT_SNAP_POINTS: readonly SnapPoint[] = Object.freeze([0, 'content']);

/**
 * Pointer types that can drag the drawer. Mouse is left out: a mouse drag
 * would also select text and end in a click on whatever is under the pointer.
 */
const POINTER_TYPES = Object.freeze(['touch', 'pen'] as const);

/**
 * A release at least this fast (px/s) always moves to at least the next snap
 * point in the direction of the finger, see `selectSnapPoint`.
 */
const FLING_VELOCITY = 400;

/**
 * Which way along the pointer's axis opens the drawer: `1` when opening moves
 * towards larger client coordinates (right, down), `-1` otherwise.
 */
const OPENING_DIRECTION: Record<Placement, 1 | -1> = {
  bottom: -1,
  top: 1,
  left: 1,
  right: -1,
};

/**
 * The rubber band past the largest snap point, like the content of an iOS
 * sheet: the classic UIScrollView curve `(1 - 1 / (x * c / d + 1)) * d` with
 * `c = DEFAULT_RUBBER_BAND_FACTOR` (0.55) and a dimension `d` of this ratio
 * times the tray's length (the scroll container's size along the axis).
 * Measured in the iOS 27 simulator (iPhone 17e): a sheet at its largest
 * detent doesn't move, its content bounces with c ≈ 0.55 and d ≈ 440pt for
 * a scroll view of about 800pt, so d ≈ 0.55 × the scroll view's size. Past
 * the tray's length only the content moves (see `#renderBounce`); the tray
 * stays at its edge. Past the smallest snap point the container size is
 * used.
 */
const OPEN_RUBBER_BAND_RATIO = 0.55;

/**
 * Marks an element in `.mobile-drawer__content` that stays at the tray's
 * edge while the content bounces past fully open, such as a sticky grabber
 * or header: the component writes the opposite `translate` on it.
 */
const PINNED_ATTRIBUTE = 'data-mobile-drawer-pinned';

/**
 * Marks an element inside the tray as a scroll container for scroll vs drag
 * handling. The tray itself always is one.
 */
const SCROLL_ATTRIBUTE = 'data-mobile-drawer-scroll';

/**
 * Events on the tray that (re)lock the scroll containers they reach. `wheel`
 * isn't passive, so the browser applies the lock before the wheel scrolls.
 */
const TRAY_INPUT_EVENTS = ['pointerdown', 'wheel', 'focusin'] as const;
const CAPTURE_PASSIVE = { capture: true, passive: true } as const;
const CAPTURE_ACTIVE = { capture: true, passive: false } as const;

/**
 * Tolerance (px) for "at the highest snap point" and "at a scroll end":
 * offsets and scroll positions can be fractional.
 */
const EPSILON = 0.5;

/**
 * How far (screen px) a pointer may move between going down on the backdrop
 * and its click for the click to still count as a tap. The same distance at
 * which `didPan` recognises a pan.
 */
const TAP_SLOP = 10;

/**
 * How far (px) a click may be from where the backdrop pointer lifted to
 * still be that pointer's click. Pointer and click coordinates can differ
 * by rounding.
 */
const CLICK_MATCH = 2;

/**
 * The open modal drawers, in the order they became modal, except that a
 * drawer always comes before the modal drawers inside it (see
 * `#activateModal`). Only the last one handles Escape and Tab on the
 * document.
 */
const modalStack: object[] = [];

/** Every drawer in the DOM, to find nested drawers, see `#applyNested`. */
const mountedDrawers = new Set<object>();

/**
 * The root elements of the drawers in `mountedDrawers`, to tell a drawer's
 * root from another element with the `mobile-drawer` class, see `#inNested`.
 */
const mountedRoots = new WeakSet<Element>();

/** The kind of input the user gave last, see `trackInput`. */
type InputType = 'keyboard' | 'pointer';

/** The drawers that show (open or at a peek), see `trackInput`. */
const shownDrawers = new Set<object>();

/**
 * The input the user gave last while a drawer showed, and when (ms, see
 * `inputTime`), or `undefined` when there was none since then. See
 * `trackInput`.
 */
let lastInput: { type: InputType; time: number } | undefined;

/**
 * How long (ms) after a key press or a pointer that goes down a focus still
 * counts as caused by it, see `focusInputOf`. A focus from Tab, a tap or a
 * click, or from the app's own handler for the event, comes at once. A long
 * press can take more time; then the browser decides, as for focus without
 * input.
 */
const INPUT_WINDOW = 1000;

/** The time for `lastInput`: the drawer's clock, as for its animations. */
const inputTime = (): number => (drawerEnvironment.clock ?? performance).now();

const onInputKeyDown = (): void => {
  lastInput = { type: 'keyboard', time: inputTime() };
};

const onInputPointerDown = (): void => {
  lastInput = { type: 'pointer', time: inputTime() };
};

const INPUT_LISTENER = { capture: true, passive: true } as const;

/**
 * Adds `drawer` to the drawers that show (`shown`) or removes it. While one
 * or more drawers show, listeners on the window record the input the user
 * gave last: a key press (`keydown`) or a pointer that goes down (mouse,
 * touch or pen, `pointerdown`). They are in the capture phase, so the record
 * is there before the focus that the input causes, also when the app moves
 * focus in its own handler for the event, and an app's listener that stops
 * the event doesn't hide it. When no drawer shows, the listeners go and the
 * record is forgotten. See `focusInputOf`.
 */
function trackInput(drawer: object, shown: boolean): void {
  if (shown) {
    if (shownDrawers.has(drawer)) return;
    if (shownDrawers.size === 0) {
      window.addEventListener('keydown', onInputKeyDown, INPUT_LISTENER);
      window.addEventListener(
        'pointerdown',
        onInputPointerDown,
        INPUT_LISTENER,
      );
    }
    shownDrawers.add(drawer);
  } else if (shownDrawers.delete(drawer) && shownDrawers.size === 0) {
    window.removeEventListener('keydown', onInputKeyDown, INPUT_LISTENER);
    window.removeEventListener(
      'pointerdown',
      onInputPointerDown,
      INPUT_LISTENER,
    );
    lastInput = undefined;
  }
}

/**
 * The input that gives `element` focus now: keyboard focus when the last
 * input was a key press (see `trackInput`) less than `INPUT_WINDOW` ago.
 * Also programmatic focus by the app right after a key press, like
 * `:focus-visible` in Chrome. The same in every browser, and for every
 * element: a mouse click on a `readonly` text field is pointer focus, though
 * Chrome gives it `:focus-visible`.
 *
 * Without a recent input the browser decides: `:focus-visible`, but never
 * for a `readonly` or `disabled` text field (Chrome gives it
 * `:focus-visible` after a mouse click too). That is focus from a screen
 * reader or switch access, which sends no key or pointer event to the page
 * (an old tap must not make it pointer focus), and focus that the app moves
 * right after the click or key press that opened the drawer, before the
 * listeners were there. A browser without `:focus-visible` (Safari before
 * 15.4) throws; nothing then counts as keyboard focus.
 */
function focusInputOf(element: Element): InputType {
  if (lastInput && inputTime() - lastInput.time < INPUT_WINDOW) {
    return lastInput.type;
  }
  if (isInactiveTextField(element)) return 'pointer';
  try {
    return element.matches(':focus-visible') ? 'keyboard' : 'pointer';
  } catch {
    return 'pointer';
  }
}

/**
 * Whether `element` can scroll along the axis in the direction a finger that
 * moved `movement` px (positive: down or right) pushes its content.
 */
function canScroll(
  element: Element,
  vertical: boolean,
  movement: number,
): boolean {
  const style = getComputedStyle(element);
  const overflow = vertical ? style.overflowY : style.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  const range = vertical
    ? element.scrollHeight - element.clientHeight
    : element.scrollWidth - element.clientWidth;
  if (!(range > EPSILON)) return false;
  // Horizontal right-to-left scroll positions run from -range to 0.
  const rtl = !vertical && style.direction === 'rtl';
  const min = rtl ? -range : 0;
  const max = rtl ? 0 : range;
  // iOS reports positions past the ends while bouncing; those count as ends.
  const position = vertical ? element.scrollTop : element.scrollLeft;
  // A finger moving down (right) reveals what is above (left of) the view,
  // so the position has to be able to decrease; moving up (left), increase.
  return movement > 0 ? position > min + EPSILON : position < max - EPSILON;
}

interface Drag {
  /** The element whose pan modifier started the drag. */
  source: HTMLElement;
  /** Offset (px open) shown when the drag started. */
  startOffset: number;
  /** Pointer coordinate along the drawer axis where the finger went down. */
  startPosition: number;
  /** Screen px per px of drawer offset, see `#screenScale`. */
  scale: number;
  /**
   * How far (drawer px, positive opens) the tray was behind the finger when
   * the catch-up (re)started: at first the distance the finger had moved
   * when the pan was recognised. The lag eases from this to `0`, see
   * `catchUpLag` and `#follow`.
   */
  lagFrom: number;
  /** Time (ms, see `#now`) the catch-up (re)started. */
  lagStart: number;
  /**
   * Whether the tray holds still while the finger comes back towards it
   * during the catch-up, see `onPan`.
   */
  holding: boolean;
  /** Whether the finger moved since the last catch-up frame. */
  moved: boolean;
  /**
   * The furthest `delta` the finger reached the way the tray catches up
   * (the sign of `lagFrom`) since the catch-up (re)started, see `onPan`.
   */
  peak: number;
  /** How far (drawer px) the finger has moved from where it went down. */
  delta: number;
  /** The tray's `delta`: `delta` minus the lag, as last drawn. */
  drawn: number;
  /** Where the finger puts the drawer: `#dragOffset` of `delta`. */
  target: number;
  /** Rendered offset, after rubber-banding, behind `target` while catching up. */
  offset: number;
  /** The scheduled catch-up frame, see `#catchUpFrame`. */
  frame?: number;
}

/** A scroll reset of the tray, see `#planScrollReset`. */
interface ScrollReset {
  /** `scrollTop` of the scroll start. */
  start: number;
  /** Which way `scrollTop` moves away from the start. */
  sign: 1 | -1;
  /** How far (px) the tray was from its scroll start when planned. */
  distance: number;
  /** Offset (px open) the tray was at when planned. */
  from: number;
  /** Offset of the run's target. */
  target: number;
  /** The part of `distance` left, as last written. */
  fraction: number;
}

interface PendingState {
  isAnimating?: boolean;
  isDragging?: boolean;
  progress?: number;
}

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

interface Layout {
  resolved: ResolvedSnapPoint[];
  /** The space the tray can open into, in px. */
  container: number;
  /** Untransformed tray size along the drawer axis, in px. */
  trayLength: number;
  /** Offset of the largest snap point, in px. */
  maxOffset: number;
}

/**
 * The border-box length of `element` along the drawer axis, in fractional px
 * and in the element's own coordinate space, or `undefined` when it can't be
 * measured: outside of the render tree (e.g. under a `display: none`
 * ancestor) computed styles return specified values such as `'auto'` or
 * `'100%'` instead of px. Computed styles are used instead
 * of `getBoundingClientRect()`, which also includes transforms (of the tray
 * and of any ancestor, e.g. a scaled preview), and instead of
 * `offsetHeight`/`offsetWidth`, which are rounded.
 *
 * `extra` is what the `height`/`width` property doesn't include (padding and
 * border under `box-sizing: content-box`), needed to write an explicit size.
 */
function measureLength(
  element: HTMLElement,
  vertical: boolean,
): { length: number; extra: number } | undefined {
  const style = getComputedStyle(element);
  const px = (value: string) =>
    value.endsWith('px') ? parseFloat(value) : NaN;
  const extra =
    style.boxSizing === 'content-box'
      ? vertical
        ? px(style.paddingTop) +
          px(style.paddingBottom) +
          px(style.borderTopWidth) +
          px(style.borderBottomWidth)
        : px(style.paddingLeft) +
          px(style.paddingRight) +
          px(style.borderLeftWidth) +
          px(style.borderRightWidth)
      : 0;
  const length = px(vertical ? style.height : style.width) + extra;
  return Number.isFinite(length) ? { length, extra } : undefined;
}

/** `<input>` types that take no typed text, so open no on-screen keyboard. */
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
 * Whether `element` is a field the user edits: a text input, a textarea, a
 * select, or contenteditable content. Focus on one of them can open an
 * on-screen keyboard or picker, and the browser then scrolls the field into
 * view. An iframe counts too: the element focused inside it is unknown. A
 * `readonly` or `disabled` text field opens no keyboard, so it doesn't count.
 */
function isEditable(element: Element): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.readOnly || element.disabled) return false;
    return (
      element instanceof HTMLTextAreaElement ||
      !NON_TEXT_INPUTS.has(element.type)
    );
  }
  return (
    element instanceof HTMLSelectElement ||
    element instanceof HTMLIFrameElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/**
 * Whether `element` is a text `<input>` or a `<textarea>` that is `readonly`
 * or `disabled`: it opens no keyboard, see `isEditable`.
 */
function isInactiveTextField(element: Element): boolean {
  return (
    ((element instanceof HTMLInputElement &&
      !NON_TEXT_INPUTS.has(element.type)) ||
      element instanceof HTMLTextAreaElement) &&
    (element.readOnly || element.disabled)
  );
}

/**
 * Whether `element` is a field the user types in: a text `<input>` or a
 * `<textarea>` that isn't `readonly` or `disabled`, or contenteditable
 * content. Focus on one of them opens an on-screen keyboard, also after a
 * tap. Unlike `isEditable`, not a select or an iframe.
 */
function isTypingField(element: Element): boolean {
  return (
    isEditable(element) &&
    !(element instanceof HTMLSelectElement) &&
    !(element instanceof HTMLIFrameElement)
  );
}

/**
 * Whether `element` is a field that takes text: a text `<input>` (not
 * `disabled`), a `<textarea>` or contenteditable content. Unlike
 * `isEditable`, `readonly` fields count: their text can still be selected.
 */
function isTextField(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !NON_TEXT_INPUTS.has(element.type);
  }
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  return element instanceof HTMLElement && element.isContentEditable;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** The valid index into an array of `count` items nearest to `index`. */
const clampIndex = (index: number, count: number) =>
  Number.isFinite(index) ? clamp(Math.round(index), 0, count - 1) : 0;

/**
 * A drawer attached to one edge of its container (by default the viewport)
 * that rests at one of a set of snap points and animates between them with a
 * spring.
 *
 * The tray can be dragged with touch or pen input along the drawer's axis
 * (through `didPan` from ember-gesture-modifiers). It follows the finger 1:1,
 * with rubber-band resistance past the first and last snap point. Past the
 * last one the tray stays at its edge and its content bounces, like an iOS
 * sheet (see `OPEN_RUBBER_BAND_RATIO` and `#renderBounce`). On release the drawer's
 * velocity is handed to the spring and the snap point nearest to where the
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
 * `#planScrollReset`). Until it is back there, the root has
 * `data-scroll-reset` (see `#markScrollReset`).
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` (unless
 * `@backdrop={{false}}`) and a `.mobile-drawer__sheet` with the
 * `.mobile-drawer__tray` in it, with the block inside
 * `.mobile-drawer__content`, and an empty `.mobile-drawer__bar-tint` after
 * the sheet and (with the backdrop) an empty `.mobile-drawer__backdrop-tint`
 * after the backdrop (for the iOS Safari 26 bars, see styles.css).
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
  @tracked isAnimating = false;
  @tracked isDragging = false;
  /**
   * Starts at `0`: the real value needs the measured layout, which only
   * exists after the first render. A drawer inserted at a snap point other
   * than closed therefore renders its block once more after insertion.
   */
  @tracked progress = 0;
  /**
   * Bumped when the drawer changes its own (uncontrolled) snap point, so
   * everything that reads `activeSnapPoint` updates.
   */
  @tracked uncontrolledVersion = 0;
  /** Whether the modal behaviour is on, for `aria-modal`. */
  @tracked modalActive = false;
  /**
   * The parent element of the root, once the drawer is in the DOM: where
   * the yielded `Nested` renders without `@destination`.
   */
  @tracked nestedParent?: Element;

  /**
   * The portal elements of the yielded `Nested` (see `nesting.ts`). They
   * are a part of the tray for the nesting relation, and hidden with the
   * drawer (`data-closed`, see `#setClosed`).
   */
  #portals = new Set<HTMLElement>();

  /** What the yielded `Nested` registers its portal element with. */
  private nestedOwner: NestedOwner = {
    add: (portal) => {
      this.#portals.add(portal);
      addPortal(portal, () => this.#tray);
      // Like the root until the drawer has rendered: closed.
      portal.toggleAttribute(
        'data-closed',
        this.#root?.hasAttribute('data-closed') ?? true,
      );
      MobileDrawer.#portalsChanged();
    },
    remove: (portal) => {
      this.#portals.delete(portal);
      removePortal(portal);
      MobileDrawer.#portalsChanged();
    },
  };

  /**
   * The snap point when uncontrolled. Not tracked (see `uncontrolledVersion`)
   * because it is also written during rendering, to remember the last
   * controlled index: dropping `@activeSnapPoint` keeps the drawer where it
   * is.
   */
  #uncontrolledSnapPoint = 0;
  #lastWarning?: string;

  #root?: HTMLElement;
  /** The `.mobile-drawer__sheet` around the tray, see `#paintExpand`. */
  #sheet?: HTMLElement;
  #tray?: HTMLElement;
  #content?: HTMLElement;
  /** The root's `.mobile-drawer__bar-tint` child, if any. */
  #barTint?: HTMLElement;
  /**
   * The sheet's colour below the root while an on-screen keyboard is open
   * in iOS Safari, see `KeyboardFill`.
   */
  #keyboardFill?: KeyboardFill;
  /** Whether the content is moved past fully open, see `#renderBounce`. */
  #bouncing = false;
  /**
   * The pinned elements while bouncing (see `PINNED_ATTRIBUTE`), with their
   * inline `translate` from before the bounce, put back after.
   */
  #pinned = new Map<HTMLElement, { value: string; priority: string }>();
  /** The content's inline `will-change` before a bounce, put back after. */
  #contentWillChange?: { value: string; priority: string };
  #backdrop?: HTMLElement;
  /** The backdrop's `.mobile-drawer__backdrop-tint` sibling, if any. */
  #backdropTint?: HTMLElement;
  /**
   * Whether the root has `data-status-bar="transparent"` (#113),
   * see `#syncStatusBar`.
   */
  #statusBar = false;
  /** The dim layer (#113), while `#statusBar` with a backdrop. */
  #pageDim?: PageDim;
  /** Removes the listener for a change of the scroll lock. */
  #offLockChange?: () => void;
  #spring?: Spring;
  #resizeObserver?: ResizeObserver;
  #layout?: Layout;
  #placement?: Placement;
  #destroyed = false;
  #pendingState?: PendingState;
  /** The injected clock, if any (tests); see `#timeOf`. */
  #clock?: FrameClock;
  #drag?: Drag;
  /**
   * Set while a pointer that went down on a drag source holds a running
   * animation that it stopped, until a drag starts or the pointer lifts.
   */
  #hold?: { pointerId: number; end: (event: PointerEvent) => void };
  #velocity = new VelocityTracker();
  /** Offset written by the last `#render`, after clamping. */
  #renderedOffset = 0;
  /**
   * How far (px) the tray may be rendered past fully open while not dragged.
   * Set on release to where the finger left it and only shrinks from there,
   * so the tray returns from a rubber-band without jumping but the spring
   * never pulls it further off its edge.
   */
  #overshoot = 0;
  /**
   * Set when a run of the spring towards the highest snap point has
   * reached it; the render then holds the tray there for the rest of that
   * run (see `#render`). Cleared when the run ends, a drag starts or the
   * target changes.
   */
  #arrivedAtHighest = false;
  /**
   * Whether the tray was at (or past) the highest snap point at the last
   * render, i.e. whether its content may scroll. See `#trayTouchAction`.
   */
  #atTop = false;
  /**
   * A scroll reset that follows the tray in `#render`, see
   * `#planScrollReset`.
   */
  #scrollReset?: ScrollReset;
  /** The spring of a scroll reset that runs on its own, if any. */
  #scrollSpring?: Spring;
  /**
   * The elements whose scrolling along the axis is locked, with the inline
   * value of the overflow property they had before. See `#syncScrollLock`.
   */
  #scrollLock = new Map<
    HTMLElement,
    { property: string; value: string; priority: string }
  >();
  /** The overflow property the lock sets, while locked. */
  #scrollLockProperty?: string;
  /**
   * With `@handleOnly`, the touch on the tray that started while scrolling
   * was locked, see `#onTrayTouchMove`. `cancels` is `undefined` until the
   * gesture is decided; `far` once it moved `TAP_SLOP` along the axis.
   */
  #lockedTouch?: {
    id: number;
    x: number;
    y: number;
    cancels?: boolean;
    far: boolean;
  };
  /**
   * The elements with the yielded `handle` modifier, see `#onHandle`.
   */
  #handles = new Set<HTMLElement>();
  /**
   * The element whose keyboard focus moves the drawer to its highest snap
   * point, to show in the tray when it arrives, see `#onTrayFocusIn`.
   */
  #reveal?: Element;
  /** Backdrop progress written by the last `#render`, see `#paintBackdrop`. */
  #backdropProgress = 0;
  /** Expand progress written by the last `#render`, see `#paintExpand`. */
  #expandProgress = NaN;
  /**
   * Whether the last `#render` was above the smallest snap point, where the
   * backdrop catches pointers, see `#paintBackdrop`.
   */
  #backdropBlocks = false;
  /**
   * Whether the active snap point is above the smallest one, i.e. the drawer
   * is open or opening. Updated during rendering by `#syncOpen`; the modal
   * behaviour and focus follow in a microtask, see `#applyOpen`.
   */
  #open = false;
  /**
   * Whether the active snap point is at 0, i.e. the drawer is closed or
   * closing and `data-closed` hides it (or soon will). Unlike `!#open`, not
   * set while the drawer rests at a peek: a smallest snap point above 0 keeps
   * the drawer, and the drawers inside it, visible. Also set until the
   * drawer is first measured. Updated with `#open` by `#syncOpen`, see
   * `#insideClosedDrawer`.
   */
  #hidden = true;
  /**
   * `#open` as last reported through `@onOpen`/`@onClose`. The first value
   * `#syncOpen` computes (on insertion, or at the first successful measure
   * of a drawer inserted while hidden) counts as reported. See `#applyOpen`.
   */
  #reportedOpen = false;
  /** Whether `#reportedOpen` has its first value, see `#syncOpen`. */
  #hasReportBaseline = false;
  /** The element to focus again when the drawer closes. */
  #returnFocus?: HTMLElement | SVGElement;
  /** Its ancestors when the drawer opened, see `#returnFocusAfterClose`. */
  #returnFocusPath: Element[] = [];
  /**
   * Set while the drawer is open because keyboard focus moved it up from
   * its peek (see `#onTrayFocusIn`): it is then not modal, and goes back
   * to its peek when focus leaves it (see `#onRootFocusOut`). Set when the
   * drawer opens while `#focusOpenPending`, cleared when it closes (to its
   * peek or to `0`). A drag or an action that moves it between open snap
   * points meanwhile keeps it; one that opens it from the peek doesn't set
   * it, so the drawer is modal as before.
   */
  #openedByFocus = false;
  /**
   * Set from a focus move from the peek until the drawer opens, or until
   * the next task when a controlled parent doesn't take the new index.
   */
  #focusOpenPending = false;
  /**
   * The last element outside the drawer that focus came from into the
   * tray, to return focus to when a drawer opened by focus closes.
   */
  #enteredFrom?: HTMLElement | SVGElement;
  /** Set while a modal drawer moves focus in, see `#activateModal`. */
  #initialFocusing = false;
  /**
   * The element a modal drawer focused when it opened (see
   * `#activateModal`), until focus moves to another element. Its keyboard
   * focus doesn't hold the scroll reset, see `#focusHoldsReset`.
   */
  #initialFocused?: Element;
  /**
   * The element in the tray that got focus last, also inside an open shadow
   * root, and the input that focused it (see `focusInputOf`), read when it
   * got focus: a later key press (e.g. typing, or Space on a tapped button)
   * doesn't make it keyboard focus. See `#onTrayFocusIn`.
   */
  #focused?: { element: Element; input: InputType };
  /**
   * Set when the drawer closed and `#applyOpen` has yet to return focus:
   * whether focus was inside the drawer when it closed.
   */
  #closedWithFocusInside?: boolean;
  #applyQueued = false;
  /** Undoes the modal behaviour while it is on. */
  #releaseModal?: () => void;
  /**
   * Undoes the `inert` part of the modal behaviour while it is on, see
   * `#makeOutsideInert`.
   */
  #releaseInert?: () => void;
  #warnedLabel = false;
  /**
   * The pointer that went down on the backdrop, from its `pointerdown` until
   * its click, its `pointercancel` or the next pointer down. `moved` once it
   * went further than `TAP_SLOP`: its click then isn't a tap. `up` is where
   * it lifted; only a click there belongs to it (see `onBackdropClick`).
   */
  #backdropPointer?: {
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    up?: { x: number; y: number };
  };

  get placement(): Placement {
    const { placement } = this.args;
    return placement && PLACEMENTS.includes(placement) ? placement : 'bottom';
  }

  get snapPoints(): readonly SnapPoint[] {
    return this.args.snapPoints ?? DEFAULT_SNAP_POINTS;
  }

  get axis(): 'vertical' | 'horizontal' {
    return this.placement === 'bottom' || this.placement === 'top'
      ? 'vertical'
      : 'horizontal';
  }

  get handleOnly(): boolean {
    return this.args.handleOnly === true;
  }

  get isModal(): boolean {
    return this.args.modal !== false;
  }

  /** Unset, the backdrop follows `@modal`. */
  get showBackdrop(): boolean {
    return this.args.backdrop ?? this.isModal;
  }

  get closeOnBackdropClick(): boolean {
    return this.args.closeOnBackdropClick !== false;
  }

  get isControlled(): boolean {
    return this.args.activeSnapPoint !== undefined;
  }

  /**
   * The active index into `@snapPoints`. An `@activeSnapPoint` that isn't a
   * valid index (e.g. `@snapPoints` shrank before the parent updated
   * `@activeSnapPoint`) is clamped to the nearest valid index, with a warning
   * in development, rather than throwing during rendering.
   */
  get activeSnapPoint(): number {
    const count = this.snapPoints.length;
    const { activeSnapPoint } = this.args;
    if (activeSnapPoint === undefined) {
      void this.uncontrolledVersion;
      return clampIndex(this.#uncontrolledSnapPoint, count);
    }
    const index = clampIndex(activeSnapPoint, count);
    if (index !== activeSnapPoint) {
      this.#warnOnce(
        `<MobileDrawer>: @activeSnapPoint must be an index into @snapPoints (0-${count - 1}), got ${activeSnapPoint}. Using ${index} instead.`,
      );
    }
    return index;
  }

  /** Warns in development, once per distinct message in a row. */
  #warnOnce(message: string): void {
    if (message === this.#lastWarning) return;
    this.#lastWarning = message;
    // `warn` from @ember/debug is a no-op in production builds of Ember.
    warn(message, false, { id: 'ember-mobile-drawer.invalid-snap-point' });
  }

  snapTo = (index: number): void => {
    assert(
      `<MobileDrawer>: snapTo needs an index into @snapPoints (0-${this.snapPoints.length - 1}), got ${index}.`,
      Number.isInteger(index) && index >= 0 && index < this.snapPoints.length,
    );
    if (index === this.activeSnapPoint) {
      // Already the active snap point: make sure the drawer is (moving)
      // there, e.g. after a resize stopped an animation.
      this.#moveToActive(true);
      return;
    }
    if (!this.isControlled) {
      // Re-renders the lifecycle modifier, which animates to it.
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.args.onSnapPointChange?.(index);
  };

  open = (): void => {
    const resolved = this.#layout?.resolved;
    const last = resolved?.[resolved.length - 1];
    if (last) this.snapTo(this.#indexOf(last));
  };

  close = (): void => {
    const first = this.#layout?.resolved[0];
    if (first) this.snapTo(this.#indexOf(first));
  };

  /** Prefers the active index when several snap points share an offset. */
  #indexOf(snapPoint: ResolvedSnapPoint): number {
    const active = this.activeSnapPoint;
    return snapPoint.indices.includes(active)
      ? active
      : (snapPoint.indices[0] as number);
  }

  hooks: LifecycleHooks = {
    install: (root) => {
      this.#root = root;
      this.#sheet = root.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__sheet',
      )!;
      this.#tray = this.#sheet.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__tray',
      )!;
      this.#barTint =
        root.querySelector<HTMLElement>(':scope > .mobile-drawer__bar-tint') ??
        undefined;
      this.#content = this.#tray.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__content',
      )!;
      const { clock } = drawerEnvironment;
      this.#clock = clock;
      this.#spring = new Spring({
        ...this.#springConfig(),
        clock,
        prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
        onUpdate: ({ value }) => this.#render(value),
      });
      this.#placement = this.placement;
      root.addEventListener('keydown', this.#onKeyDown);
      root.addEventListener('scroll', this.#onRootScroll, { passive: true });
      root.addEventListener('focusout', this.#onRootFocusOut);
      this.#sheet.addEventListener('scroll', this.#onRootScroll, {
        passive: true,
      });
      mountedDrawers.add(this);
      mountedRoots.add(root);
      MobileDrawer.#syncNested();
      // Where the yielded `Nested` renders by default. Tracked state, so not
      // during rendering (and the drawers around this one are in the DOM
      // by then).
      queueMicrotask(() => {
        if (!this.#destroyed) this.nestedParent = this.#nestedDestination();
      });
      this.#measure();
      // Appear at the initial snap point without animating in.
      this.#moveToActive(false);
      this.#syncScrollLock();
      // A drawer with a text field opened in front: the lock is now the
      // fixed `<body>`, so the status bar is solid again.
      this.#offLockChange = onLockChange(() => this.#endStatusBar());
      registerDrawer({
        root,
        tray: this.#tray,
        placement: () => this.placement,
        isDragging: () => this.#drag !== undefined,
        offset: () => this.#renderedOffset,
        offsetOf: (index) =>
          this.#layout
            ? findSnapPoint(this.#layout.resolved, index)?.offset
            : undefined,
        screenScale: () => (this.#layout ? this.#screenScale() : 1),
        open: this.open,
        close: this.close,
      });
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray.addEventListener(
          type,
          this.#onTrayInput,
          type === 'wheel' ? CAPTURE_ACTIVE : CAPTURE_PASSIVE,
        );
      }
      tray.addEventListener('focusin', this.#onTrayFocusIn);
      tray.addEventListener('touchstart', this.#onTrayTouchStart, {
        passive: true,
      });
      // Not passive: see `#onTrayTouchMove`.
      tray.addEventListener('touchmove', this.#onTrayTouchMove, {
        passive: false,
      });
      tray.addEventListener('touchend', this.#onTrayTouchEnd);
      tray.addEventListener('touchcancel', this.#onTrayTouchEnd);
      this.#keyboardFill = new KeyboardFill({
        root,
        tray,
        viewport: drawerEnvironment.visualViewport
          ? drawerEnvironment.visualViewport()
          : (window.visualViewport ?? null),
        // Only a bottom drawer (a sheet) ends at the bottom of the screen
        // and has its background there; only while it shows.
        active: () =>
          !this.#destroyed &&
          this.placement === 'bottom' &&
          !root.hasAttribute('data-closed'),
        keepsKeyboard: isEditable,
        contains: logicallyContains,
      });
      this.#keyboardFill.sync();

      if (typeof ResizeObserver !== 'undefined') {
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(this.#content);
      }
    },

    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      this.#measure();
      // The axis may have changed.
      this.#syncScrollLock();
      if (this.#drag) {
        // The finger wins until it lets go; the release then picks a snap
        // point (and asks the parent, when controlled). A new placement is a
        // new axis, so that drag is over.
        if (!placementChanged) {
          this.#syncOpen();
          return;
        }
        const drag = this.#endDrag()!;
        // Not during rendering. The drawer jumps to the active snap point.
        queueMicrotask(() => {
          if (this.#destroyed) return;
          this.args.onDragEnd?.({
            snapPoint: this.activeSnapPoint,
            offset: drag.target,
            velocity: 0,
          });
        });
      }
      // A new placement is a different layout: jump instead of animating
      // along the new axis from the old position.
      this.#moveToActive(!placementChanged);
      if (placementChanged) this.#keyboardFill?.sync();
    },

    destroy: () => {
      this.#destroyed = true;
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray?.removeEventListener(type, this.#onTrayInput, true);
      }
      tray?.removeEventListener('focusin', this.#onTrayFocusIn);
      tray?.removeEventListener('touchstart', this.#onTrayTouchStart);
      tray?.removeEventListener('touchmove', this.#onTrayTouchMove);
      tray?.removeEventListener('touchend', this.#onTrayTouchEnd);
      tray?.removeEventListener('touchcancel', this.#onTrayTouchEnd);
      this.#lockedTouch = undefined;
      this.#reveal = undefined;
      this.#keyboardFill?.destroy();
      this.#endHold();
      this.#cancelCatchUp(this.#drag);
      this.#endBackdropPointer();
      this.#resizeObserver?.disconnect();
      this.#spring?.stop();
      this.#stopScrollReset();
      this.#syncScrollLock();
      this.#root?.removeEventListener('keydown', this.#onKeyDown);
      this.#root?.removeEventListener('scroll', this.#onRootScroll);
      this.#root?.removeEventListener('focusout', this.#onRootFocusOut);
      this.#sheet?.removeEventListener('scroll', this.#onRootScroll);
      mountedDrawers.delete(this);
      if (this.#root) mountedRoots.delete(this.#root);
      MobileDrawer.#syncNested();
      trackInput(this, false);
      this.#focused = undefined;
      if (this.#root) {
        setPageProgress(this.#root, 0);
        unregisterDrawer(this.#root);
      }
      // Undone right away, so nothing outlives the drawer. Focus can only
      // move back once the drawer is gone from the DOM.
      const wasModal = this.#releaseModal !== undefined;
      this.#deactivateModal();
      this.#endStatusBar();
      this.#offLockChange?.();
      if (this.#open) {
        this.#open = false;
        const focusInside = this.#hasFocus();
        queueMicrotask(() =>
          this.#returnFocusAfterClose(focusInside, wasModal),
        );
      }
    },
  };

  /**
   * Measures the container and the tray, resolves the snap points and sizes
   * the tray so the largest snap point fits. Forces layout, so it only runs
   * on setup, argument changes and resizes, never per frame.
   *
   * Returns `false`, leaving the previous layout and inline sizes in place,
   * when the tray can't be measured (e.g. while hidden). The resize observer
   * measures again once the drawer gets a size.
   */
  #measure(): boolean {
    const tray = this.#tray!;
    const vertical = this.placement === 'bottom' || this.placement === 'top';
    const size = vertical ? 'height' : 'width';
    const { style } = tray;
    const { height, width } = style;

    // The tray's natural size.
    style.height = '';
    style.width = '';
    const content = measureLength(tray, vertical);

    // The space the tray can open into: the root minus the opposite safe-area
    // inset, or the tray's own max size.
    style[size] = '100%';
    const available = measureLength(tray, vertical);

    if (!content || !available) {
      style.height = height;
      style.width = width;
      return false;
    }
    const { length: natural, extra } = content;
    const container = available.length;

    const resolved = resolveSnapPoints(this.snapPoints, {
      container,
      content: natural,
    });
    const maxOffset = resolved[resolved.length - 1]!.offset;

    let trayLength = natural;
    if (maxOffset > natural) {
      // A snap point needs more than the content: grow the tray to it.
      style[size] = `${maxOffset - extra}px`;
      trayLength = maxOffset;
    } else {
      style[size] = '';
    }

    this.#layout = { resolved, container, trayLength, maxOffset };
    return true;
  }

  #offsetOf(index: number): number {
    const { resolved } = this.#layout!;
    return (findSnapPoint(resolved, index) ?? resolved[0]!).offset;
  }

  #progressOf(offset: number): number {
    const { maxOffset } = this.#layout!;
    return maxOffset > 0 ? clamp(offset / maxOffset, 0, 1) : 0;
  }

  /**
   * Moves (or jumps) to the active snap point. Does nothing while dragging:
   * the release moves to the active snap point.
   */
  #moveToActive(animate: boolean): void {
    const spring = this.#spring;
    const index = this.activeSnapPoint;
    // Remember a controlled index, so dropping @activeSnapPoint keeps it.
    this.#uncontrolledSnapPoint = index;
    if (!spring || !this.#layout || this.#destroyed) return;
    this.#syncOpen();
    if (this.#drag) return;

    const target = this.#offsetOf(index);
    this.#queueState({ progress: this.#progressOf(target) });
    spring.retarget(target);
    this.#markExpanded(target);

    if (!animate) {
      // A jump (setup, a new placement): the content starts where it starts
      // at the target, see `#scrollToStart`.
      spring.stop();
      spring.set(target, 0);
      this.#render(target);
      this.#scrollToStart(target);
      this.#queueState({ isAnimating: false });
      return;
    }
    this.#planScrollReset(target);

    if (spring.isAnimating) return; // Retargeted; the run continues.

    void this.#startSpring(spring).then(() => {
      if (spring.isAnimating) return;
      this.#queueState({ isAnimating: false });
      this.#revealFocus();
    });
    // With reduced motion the run ends synchronously.
    this.#queueState({ isAnimating: spring.isAnimating });
    // Show the drawer now rather than at the first frame, so focus can move
    // into an opening drawer right away.
    if (spring.isAnimating) this.#setClosed(false);
  }

  /**
   * Sets `data-expanded` on the root when the drawer rests at, or is
   * animating to, its highest snap point (and that snap point is open at
   * all), from `target`: where the drawer is headed. Only called when the
   * target changes outside a drag, so the attribute keeps its value during
   * a drag and while a touch holds the drawer: small movements at the top
   * never flicker it, and a drag down from the top only removes it when it
   * is released towards a lower snap point. Unlike the scroll lock (see
   * `#syncScrollLock`), which follows the rendered position.
   */
  #markExpanded(target: number): void {
    const { maxOffset } = this.#layout!;
    const root = this.#root!;
    const expanded = maxOffset > 0 && target >= maxOffset - EPSILON;
    if (root.hasAttribute('data-expanded') === expanded) return;
    root.toggleAttribute('data-expanded', expanded);
    // A theme may change the tray's colour with it, see `KeyboardFill`.
    this.#keyboardFill?.paint();
  }

  /**
   * Plans the scroll reset for a run to `target`: below the highest snap
   * point the tray of a vertical drawer goes back to its scroll start (the
   * content start at the leading edge: `scrollTop` 0 for a bottom drawer,
   * the end of the scroll range for a top drawer, whose leading edge is its
   * bottom), where the content can't be scrolled. At the highest snap point
   * the content starts at `scrollTop` 0 for every placement, so the tray
   * is put there when it opens from closed to the highest snap point; a
   * move up from a lower snap point keeps the position. Nothing changes
   * for left and right drawers, whose tray isn't sized by the snap point
   * along its scroll axis.
   *
   * The reset never jumps while the tray shows:
   * - towards closed (offset `0`), it waits until the tray is closed, when
   *   nothing of it shows, so a closing sheet keeps its content in place;
   * - when the tray is hidden (closed), at once;
   * - when the tray has at least as far to go as the content (`span >=
   *   distance`, up or down), in step with the tray in `#render`: the
   *   content reaches its start when the tray reaches the target and never
   *   moves faster than the tray, or back when the spring overshoots;
   * - otherwise (the tray is near its target, e.g. released just past it,
   *   or caught while closing and released below it), on a spring of its
   *   own with the drawer's spring settings, from rest: it eases in, so no
   *   frame moves the content far. A new plan while that spring runs (a
   *   resize, a new target) keeps its velocity instead of starting over.
   * With reduced motion both springs end at once, and so does the reset.
   *
   * Reads layout only here, so the render loop only writes. A drag or a
   * touch that holds the drawer stops the reset where it is; the release
   * plans a new one. A drag down from the top of a bottom drawer only
   * starts when the tray is at its scroll start anyway (see `shouldDrag`);
   * one with `@handleOnly` may start anywhere, and resets after its release.
   *
   * While the reset is to come (the content is away from its scroll start
   * below the highest snap point), the root has `data-scroll-reset`, see
   * `#markScrollReset`.
   */
  #planScrollReset(target: number): void {
    // A new plan while the reset's own spring runs (e.g. on each frame of
    // a resize) keeps its speed, so the reset doesn't start over from rest.
    const running = this.#scrollSpring?.isAnimating
      ? this.#scrollSpring
      : undefined;
    const velocity = running?.velocity ?? 0;
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    if (this.#isHighest(target)) {
      // Opening from closed: start at the content start. A move up from a
      // lower snap point keeps the position, so nothing jumps.
      if (this.#renderedOffset <= EPSILON) this.#scrollToStart(target);
      // Already there (e.g. a handle drag released at the top): the content
      // can scroll, `data-at-highest` covers it. On the way up the mark
      // stays until the tray gets there (see `#render`).
      else if (this.#atTop) this.#markScrollReset(false);
      return;
    }
    const tray = this.#tray!;
    const top = this.placement === 'top';
    const start = top ? Math.max(0, tray.scrollHeight - tray.clientHeight) : 0;
    let distance = Math.abs(tray.scrollTop - start);
    // The browser rounds scroll positions. Where the tray is still where
    // the running spring put it, go on from the spring's exact position:
    // otherwise a resize on every frame could keep the reset a pixel short.
    if (running && Math.abs(distance - running.value) < 1) {
      distance = running.value;
    }
    const open = this.#renderedOffset;
    const reset: ScrollReset = {
      start,
      sign: top ? -1 : 1,
      distance,
      from: open,
      target,
      fraction: 1,
    };
    if (distance <= EPSILON || open <= EPSILON) {
      // Nothing (much) to do, or nothing of the tray shows: at once.
      this.#writeScroll(reset, 0);
      return;
    }
    // The content is away from its start while the tray shows: until the
    // reset gets there (`#writeScroll` with 0).
    this.#markScrollReset(true);
    if (target <= EPSILON || Math.abs(open - target) >= distance) {
      this.#scrollReset = reset;
      return;
    }
    const scrollSpring = new Spring({
      ...this.#springConfig(),
      clock: this.#clock,
      prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
      onUpdate: ({ value }) =>
        this.#writeScroll(reset, clamp(value / distance, 0, 1)),
    });
    this.#scrollSpring = scrollSpring;
    scrollSpring.set(distance, velocity);
    scrollSpring.retarget(0);
    void this.#startSpring(scrollSpring).then(() => {
      if (this.#scrollSpring === scrollSpring && !scrollSpring.isAnimating) {
        this.#scrollSpring = undefined;
      }
    });
  }

  /**
   * Moves the tray's scroll position along with the run in `#render`, for
   * a reset that follows the tray (see `#planScrollReset`).
   */
  #applyScrollReset(open: number): void {
    const reset = this.#scrollReset;
    if (!reset) return;
    let fraction: number;
    if (reset.target <= EPSILON) {
      fraction = open <= EPSILON ? 0 : 1;
    } else {
      // At least `distance`, which is more than EPSILON, when planned.
      const span = Math.abs(reset.from - reset.target);
      fraction = clamp(Math.abs(open - reset.target) / span, 0, 1);
    }
    if (fraction >= reset.fraction) return;
    this.#writeScroll(reset, fraction);
    if (fraction === 0) this.#scrollReset = undefined;
  }

  /**
   * Scrolls the tray to `fraction` of the reset's distance from its scroll
   * start, without reading layout. `behavior: 'instant'`, so an app's
   * `scroll-behavior: smooth` doesn't turn each frame into a smooth scroll.
   */
  #writeScroll(reset: ScrollReset, fraction: number): void {
    reset.fraction = fraction;
    const top = reset.start + reset.sign * reset.distance * fraction;
    this.#tray!.scrollTo({ top, behavior: 'instant' });
    if (fraction === 0) this.#markScrollReset(false);
  }

  /**
   * Sets or removes `data-scroll-reset` on the root. It is on from the plan
   * of a reset that can't happen at once (see `#planScrollReset`: a run
   * down from a scrolled tray, also a close) until the content is back at
   * its scroll start, or until the tray gets to the highest snap point
   * (where `data-at-highest` takes over). A touch that stops the reset
   * keeps it: the content is still away from its start. A drag sets it
   * from where the content is when it starts (see `onPanStart`), as a
   * drag on a handle from a scrolled tray keeps the content in place until
   * its release. Themes use
   * it to cover the content under an element at the leading edge, such as
   * the iOS theme's grabber strip, which is transparent below the highest
   * snap point.
   */
  #markScrollReset(on: boolean): void {
    this.#root?.toggleAttribute('data-scroll-reset', on);
  }

  /**
   * Whether the tray of a vertical drawer is away from its scroll start
   * below the highest snap point (see `#planScrollReset`). Reads layout.
   */
  #awayFromScrollStart(): boolean {
    if (this.axis !== 'vertical') return false;
    const tray = this.#tray!;
    const start =
      this.placement === 'top'
        ? Math.max(0, tray.scrollHeight - tray.clientHeight)
        : 0;
    return Math.abs(tray.scrollTop - start) > EPSILON;
  }

  /**
   * Starts a run of `spring` and registers it with the test waiter, so
   * `await settled()` waits until it ends (it comes to rest or is stopped).
   * Not with an injected clock: the addon's own tests then run the frames
   * themselves, and `settled()` would wait for frames that never come.
   */
  #startSpring(spring: Spring): Promise<SpringResult> {
    if (!spring.isAnimating) spring.configure(this.#springConfig());
    const run = spring.start();
    if (spring.isAnimating && !this.#clock) {
      const token = animationWaiter.beginAsync();
      void run.then(() => animationWaiter.endAsync(token));
    }
    return run;
  }

  /**
   * The spring parameters from `@spring`, with the defaults for the keys it
   * leaves out. Development builds assert that every value is valid;
   * production builds use the default instead of an invalid value.
   */
  #springConfig(): MobileDrawerSpring {
    const { stiffness, damping, mass } = DEFAULT_SPRING_CONFIG;
    const config: MobileDrawerSpring = { stiffness, damping, mass };
    const spring = this.args.spring;
    if (!spring) return config;
    for (const key of ['stiffness', 'damping', 'mass'] as const) {
      const value: unknown = spring[key];
      if (value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        config[key] = value;
      } else {
        const shown = typeof value === 'number' ? String(value) : typeof value;
        assert(
          `<MobileDrawer>: @spring.${key} must be a finite number greater than 0, got ${shown}`,
        );
      }
    }
    return config;
  }

  /** Stops a running scroll reset where it is. */
  #stopScrollReset(): void {
    this.#scrollReset = undefined;
    this.#scrollSpring?.stop();
    this.#scrollSpring = undefined;
  }

  /** Whether `offset` is the highest snap point (when it is open at all). */
  #isHighest(offset: number): boolean {
    const { maxOffset } = this.#layout!;
    return maxOffset > 0 && offset >= maxOffset - EPSILON;
  }

  /**
   * Scrolls the tray of a vertical drawer at once to where its content
   * starts at `target`: `scrollTop` 0 at the highest snap point (for every
   * placement: the content starts at the top there and is read from the
   * top down), and the scroll start below it (see `#planScrollReset`).
   */
  #scrollToStart(target: number): void {
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    const tray = this.#tray!;
    const top =
      this.placement === 'top' && !this.#isHighest(target)
        ? Math.max(0, tray.scrollHeight - tray.clientHeight)
        : 0;
    tray.scrollTo({ top, behavior: 'instant' });
    this.#markScrollReset(false);
  }

  /**
   * Whether focus in the tray holds a resize's scroll reset: focus on an
   * editable element (see `isEditable`), or keyboard focus (focus after a
   * key press, see `focusInputOf`) on any element in it, which the browser
   * scrolled into view. Not the tray itself, which a modal drawer focuses
   * when it opens. Also inside an open shadow root in the tray.
   *
   * Keyboard focus that the drawer gave itself (the initial focus of a
   * modal drawer, see `#activateModal`) doesn't hold it: that focus doesn't
   * scroll, so the content end of a top drawer stays at its leading edge.
   * It holds it again when focus moves. An editable element always holds
   * it: an on-screen keyboard can open for it. A `readonly` text field
   * holds it like any other element: after a key press, not after a click
   * or a tap.
   */
  #focusHoldsReset(): boolean {
    const tray = this.#tray!;
    let active = document.activeElement;
    if (active !== this.#initialFocused) this.#initialFocused = undefined;
    if (!active || active === tray || !tray.contains(active)) return false;
    const initial = active === this.#initialFocused;
    while (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (isEditable(active)) return true;
    if (initial) return false;
    return this.#inputOf(active) === 'keyboard';
  }

  /**
   * The input that focused `element`, which has focus: as read when it got
   * focus (see `#focused`), or now when the drawer didn't see that focus.
   */
  #inputOf(element: Element): InputType {
    const focused = this.#focused;
    return focused?.element === element ? focused.input : focusInputOf(element);
  }

  #onResize(): void {
    const spring = this.#spring;
    if (!spring || this.#destroyed || !this.#measure()) return;
    // While dragging or while a touch holds the drawer, it stays at the
    // offset shown (re-rendered for the new tray length) until the finger
    // moves or lifts.
    if (this.#drag || this.#hold) {
      this.#render(this.#drag?.offset ?? this.#renderedOffset);
      return;
    }

    this.#syncOpen();
    const target = this.#offsetOf(this.activeSnapPoint);
    this.#queueState({ progress: this.#progressOf(target) });
    this.#markExpanded(target);
    // From where the tray and its content are now. Also keeps a top drawer's
    // content end at its leading edge below the top when the content changes.
    // Not while a field in the tray has focus, or an element has keyboard
    // focus: the browser may have scrolled it into view (e.g. above an
    // Android keyboard that resizes the page, or on Tab), and the reset
    // would move it out of view again. Other focused elements (e.g. a
    // tapped button) don't hold the reset.
    if (!this.#focusHoldsReset()) this.#planScrollReset(target);

    if (spring.isAnimating) {
      // Keep going from the current position to the new target.
      spring.retarget(target);
      this.#render(spring.value);
    } else {
      // Stay at the same snap point. This runs before the next paint, so the
      // drawer never shows at the old position with the new size.
      spring.retarget(target);
      spring.set(target, 0);
      this.#render(target);
    }
  }

  /**
   * Writes the tray transform and backdrop progress for `offset` (px open).
   * Runs every animation frame, so it only touches inline styles and never
   * tracked state.
   */
  #render(offset: number): void {
    const layout = this.#layout;
    const root = this.#root;
    if (!layout || !root || this.#destroyed) return;

    // Never push the tray further than fully closed. While dragging, the
    // rubber-band may pull it off its open edge. Otherwise a fast spring can
    // overshoot, but never pulls the tray further off its edge than where
    // the finger left it.
    const max = this.#drag ? Infinity : layout.trayLength + this.#overshoot;
    let open = clamp(offset, 0, max);
    // A spring that bounces comes back below its target after it overshoots
    // it. At the highest snap point that would lock the content's scrolling
    // again for a moment (and make a touch drag instead of scroll), so once a
    // run towards the highest snap point gets there, the tray stays there
    // for the rest of the run. The undershoot is a fraction of a percent of
    // the move, so this doesn't show.
    const spring = this.#spring!;
    if (
      this.#drag ||
      !spring.isAnimating ||
      layout.maxOffset <= 0 ||
      Math.abs(spring.target - layout.maxOffset) > EPSILON
    ) {
      this.#arrivedAtHighest = false;
    } else if (this.#arrivedAtHighest || open >= layout.maxOffset - EPSILON) {
      this.#arrivedAtHighest = true;
      open = Math.max(open, layout.maxOffset);
    }
    if (!this.#drag) {
      this.#overshoot = clamp(open - layout.trayLength, 0, this.#overshoot);
    }
    this.#renderedOffset = open;
    // Past the tray's length the tray stays at its edge; the content moves
    // on inside it (see `#renderBounce`).
    const distance = Math.max(0, layout.trayLength - open);
    const transform = {
      bottom: `translate3d(0, ${distance}px, 0)`,
      top: `translate3d(0, ${-distance}px, 0)`,
      left: `translate3d(${-distance}px, 0, 0)`,
      right: `translate3d(${distance}px, 0, 0)`,
    }[this.placement];

    this.#tray!.style.transform = transform;
    this.#renderBounce(Math.max(0, open - layout.trayLength));
    const atTop = open >= layout.maxOffset - EPSILON;
    this.#paintExpand(open, atTop);
    // A no-op while it keeps its value.
    root.toggleAttribute('data-at-highest', atTop && layout.maxOffset > 0);
    if (atTop !== this.#atTop) {
      this.#atTop = atTop;
      // The content can scroll here; `data-at-highest` takes over.
      if (atTop) this.#markScrollReset(false);
      // Only while the tray is a drag source (not with @handleOnly).
      if (this.#tray!.style.touchAction) {
        this.#tray!.style.touchAction = this.trayTouchAction();
      }
      this.#syncScrollLock();
    }
    if (!this.#drag) this.#applyScrollReset(open);
    this.#backdropProgress = this.#progressOf(open);
    const smallest = layout.resolved[0]!.offset;
    this.#backdropBlocks = open > smallest;
    this.#paintBackdrop();
    // For themes whose bar colour follows the dim, see `#paintExpand`.
    this.#barTint?.style.setProperty(
      '--mobile-drawer-progress',
      String(this.#backdropProgress),
    );
    // For the page behind (`data-mobile-drawer-page`, see
    // `setPageProgress`): from the smallest snap point (0) to the largest
    // (1), for modal bottom drawers only. A non-modal drawer leaves the page
    // as it is, usable; and like on iOS, only a sheet from the bottom moves
    // the page back, not a top or side drawer.
    setPageProgress(
      root,
      this.isModal && this.placement === 'bottom' && layout.maxOffset > smallest
        ? clamp((open - smallest) / (layout.maxOffset - smallest), 0, 1)
        : 0,
    );
    this.#setClosed(open <= 0 && !this.#spring!.isAnimating && !this.#drag);
    // At rest without the modal behaviour (closed, or at a peek): no
    // transparent status bar until the drawer locks the page again.
    if (!this.#releaseModal && !this.#spring!.isAnimating && !this.#drag) {
      this.#endStatusBar();
    }
  }

  /**
   * Sets or removes `data-closed` on the root and on the portals of the
   * yielded `Nested`, so a nested drawer rendered outside the tray hides
   * with this drawer, like one inside it.
   */
  #setClosed(closed: boolean): void {
    const root = this.#root!;
    const changed = root.hasAttribute('data-closed') !== closed;
    root.toggleAttribute('data-closed', closed);
    for (const portal of this.#portals) {
      portal.toggleAttribute('data-closed', closed);
    }
    // Shows or hides the sheet's colour below the root, see `KeyboardFill`.
    if (changed) this.#keyboardFill?.sync();
  }

  /**
   * Writes the expand progress for `open` (px open) as
   * `--mobile-drawer-expand-progress` on the sheet: `0` at or below the
   * second-highest snap point (or closed, for a drawer with one open snap
   * point), `1` at the highest snap point and past it, linear in between.
   * Themes move the sheet from its floating look to its full-height look
   * with it (see `--mobile-drawer-inset` in styles.css). Only the sheet gets
   * it, not the root: the property is registered as not inherited, and only
   * the tray takes it from the sheet, so the content isn't styled again on
   * every frame. The bar tint and, in `#paintBackdrop`, the backdrop and its
   * tint (all three empty elements) get it too, for a dim and bar colours
   * that follow it. Only written when it changes.
   */
  #paintExpand(open: number, atTop: boolean): void {
    const { resolved, maxOffset } = this.#layout!;
    const below =
      resolved.length > 1 ? resolved[resolved.length - 2]!.offset : 0;
    let progress = 0;
    if (atTop) {
      progress = maxOffset > 0 ? 1 : 0;
    } else if (maxOffset > below) {
      progress = clamp((open - below) / (maxOffset - below), 0, 1);
    }
    if (progress === this.#expandProgress) return;
    this.#expandProgress = progress;
    const value = String(progress);
    this.#sheet?.style.setProperty('--mobile-drawer-expand-progress', value);
    this.#barTint?.style.setProperty('--mobile-drawer-expand-progress', value);
    // A theme may change the tray's colour with it (e.g. the iOS theme's
    // glass that becomes opaque), see `KeyboardFill`.
    this.#keyboardFill?.paint();
  }

  /**
   * Moves the content `bounce` px past fully open, in the opening direction,
   * with an inline `translate` on `.mobile-drawer__content` (the individual
   * property, so it composes with an app `transform` there). The tray stays
   * at its edge and clips the content. Pinned elements (`PINNED_ATTRIBUTE`)
   * get the opposite `translate`, so they stay at the tray's edge; their own
   * inline `translate` is put back after the bounce. Runs every
   * frame; it only writes inline styles. While the content is moved it gets
   * `will-change: translate` (its own layer, so a frame doesn't paint it
   * again) and scrolling along the axis is locked (`#syncScrollLock`): the
   * moved content widens the scrollable overflow of a top or left tray for
   * the moment, and no scroll may start on top of the bounce.
   */
  #renderBounce(bounce: number): void {
    const content = this.#content;
    if (!content) return;
    const bouncing = bounce > 0;
    const value = (b: number) =>
      bouncing
        ? {
            bottom: `0px ${-b}px`,
            top: `0px ${b}px`,
            left: `${b}px 0px`,
            right: `${-b}px 0px`,
          }[this.placement]
        : '';
    if (bouncing !== this.#bouncing) {
      this.#bouncing = bouncing;
      const { style } = content;
      if (bouncing) {
        this.#contentWillChange = {
          value: style.getPropertyValue('will-change'),
          priority: style.getPropertyPriority('will-change'),
        };
        style.setProperty('will-change', 'translate');
        for (const element of content.querySelectorAll<HTMLElement>(
          `[${PINNED_ATTRIBUTE}]`,
        )) {
          if (element.closest('.mobile-drawer__content') !== content) continue;
          this.#pinned.set(element, {
            value: element.style.getPropertyValue('translate'),
            priority: element.style.getPropertyPriority('translate'),
          });
        }
      } else {
        const saved = this.#contentWillChange;
        style.setProperty('will-change', saved?.value ?? '', saved?.priority);
        this.#contentWillChange = undefined;
        for (const [element, saved] of this.#pinned) {
          element.style.setProperty('translate', saved.value, saved.priority);
        }
        this.#pinned.clear();
      }
      this.#syncScrollLock();
    }
    const translate = value(bounce);
    if (content.style.translate !== translate) {
      content.style.translate = translate;
    }
    if (bouncing) {
      const opposite = value(-bounce);
      for (const element of this.#pinned.keys()) {
        element.style.translate = opposite;
      }
    }
  }

  /**
   * Locks scrolling along the axis below the highest snap point, so the
   * content and the drag never fight there: the tray and the marked scroll
   * containers in it (`data-mobile-drawer-scroll`, not those of a nested
   * drawer) get an inline `overflow-y: hidden` (`overflow-x` for left and
   * right), which is removed again at the highest snap point. `hidden`
   * keeps them scroll containers, so their scroll position is kept. Also
   * with `@handleOnly`: the content only scrolls when the drawer is fully
   * open, so a handle never scrolls out of reach below the top.
   *
   * Inline styles rather than a CSS rule keyed on a state attribute: the
   * marked elements are the app's, and their `overflow` usually comes from
   * unlayered app CSS, which beats every rule in the drawer's cascade layer;
   * and it must follow the rendered position, also mid-drag. The previous
   * inline value is put back on unlock. Runs when `#atTop` flips, on
   * install, on argument changes and on teardown; a marked element added
   * while locked, or whose inline style the app rewrote, is locked when a
   * pointer goes down, a wheel turns or focus moves in it (`#onTrayInput`).
   * After a placement change during a drag, the lock follows the new
   * layout from the next frame.
   */
  #syncScrollLock(): void {
    const tray = this.#tray;
    if (!tray) return;
    const lock = !this.#destroyed && (!this.#atTop || this.#bouncing);
    const property = this.axis === 'vertical' ? 'overflow-y' : 'overflow-x';
    this.#scrollLockProperty = lock ? property : undefined;
    for (const [element, saved] of this.#scrollLock) {
      if (!element.isConnected) {
        // Removed from the page: nothing to put back.
        this.#scrollLock.delete(element);
      } else if (!lock || saved.property !== property) {
        this.#unlockScroll(element);
      }
    }
    if (!lock) return;
    this.#lockScroll(tray);
    for (const element of tray.querySelectorAll<HTMLElement>(
      `[${SCROLL_ATTRIBUTE}]`,
    )) {
      if (element.closest('.mobile-drawer__tray') === tray) {
        this.#lockScroll(element);
      }
    }
  }

  /**
   * Locks `element` with the current lock property, or locks it again if
   * the app has rewritten its inline style since: the app's value is then
   * the one to put back.
   */
  #lockScroll(element: HTMLElement): void {
    const property = this.#scrollLockProperty;
    if (!property) return;
    const { style } = element;
    const value = style.getPropertyValue(property);
    const priority = style.getPropertyPriority(property);
    if (value === 'hidden' && !priority && this.#scrollLock.has(element)) {
      return;
    }
    this.#scrollLock.set(element, { property, value, priority });
    style.setProperty(property, 'hidden');
  }

  /**
   * Puts back the inline value `element` had before it was locked, unless
   * the app has set a value of its own since, which is then kept.
   */
  #unlockScroll(element: HTMLElement): void {
    const saved = this.#scrollLock.get(element);
    if (!saved) return;
    this.#scrollLock.delete(element);
    const { style } = element;
    if (
      style.getPropertyValue(saved.property) === 'hidden' &&
      !style.getPropertyPriority(saved.property)
    ) {
      style.setProperty(saved.property, saved.value, saved.priority);
    }
  }

  /**
   * Writes the progress of the last render on the backdrop, if there is one:
   * `--mobile-drawer-progress` for its opacity (also on the backdrop tint,
   * for the iOS Safari 26 bar colour), and `pointer-events: none`
   * at or below the smallest snap point. So an invisible backdrop (e.g.
   * while the drawer closes, before `data-closed` hides it) never blocks the
   * page, and neither does the backdrop of a "peek" drawer (smallest snap
   * point above 0) resting at its peek.
   */
  #paintBackdrop(): void {
    const backdrop = this.#backdrop;
    if (!backdrop) return;
    const progress = String(this.#backdropProgress);
    const expand = String(
      Number.isNaN(this.#expandProgress) ? 0 : this.#expandProgress,
    );
    for (const element of [
      backdrop,
      this.#backdropTint,
      this.#pageDim?.element,
    ]) {
      element?.style.setProperty('--mobile-drawer-progress', progress);
      element?.style.setProperty('--mobile-drawer-expand-progress', expand);
    }
    const pointerEvents = this.#backdropBlocks ? '' : 'none';
    if (backdrop.style.pointerEvents !== pointerEvents) {
      backdrop.style.pointerEvents = pointerEvents;
    }
  }

  /**
   * The backdrop is optional (`@backdrop`), so it registers itself. It is a
   * pointer convenience and deliberately not focusable or a button: a
   * keyboard closes the drawer with Escape or the app's own controls, so its
   * listeners are added here rather than with `{{on}}`.
   */
  backdropHooks: LifecycleHooks = {
    install: (backdrop) => {
      this.#backdrop = backdrop;
      // Rendered in the same block, after the backdrop.
      const tint = backdrop.nextElementSibling;
      this.#backdropTint =
        tint instanceof HTMLElement &&
        tint.classList.contains('mobile-drawer__backdrop-tint')
          ? tint
          : undefined;
      backdrop.addEventListener('pointerdown', this.onBackdropPointerDown);
      backdrop.addEventListener('click', this.onBackdropClick);
      this.#paintBackdrop();
    },
    update: () => {},
    destroy: () => {
      const backdrop = this.#backdrop;
      backdrop?.removeEventListener('pointerdown', this.onBackdropPointerDown);
      backdrop?.removeEventListener('click', this.onBackdropClick);
      this.#backdrop = undefined;
      this.#backdropTint = undefined;
      this.#pageDim?.destroy();
      this.#pageDim = undefined;
      this.#endBackdropPointer();
    },
  };

  /**
   * Starts tracking a pointer on the backdrop, to tell a tap from a drag
   * (or a scroll the browser took over) when its click arrives. Pointer
   * events of a touch stay on the backdrop (implicit capture), those of a
   * mouse don't, so movement is followed on the document.
   */
  private onBackdropPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    this.#endBackdropPointer();
    this.#backdropPointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    document.addEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true,
    });
    document.addEventListener('pointercancel', this.#onBackdropPointerCancel, {
      capture: true,
    });
  };

  #onBackdropPointerMove = (event: PointerEvent): void => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#trackBackdropPointer(event.clientX, event.clientY);
    }
  };

  /** Marks the backdrop pointer as `moved` once it is at `x`/`y`. */
  #trackBackdropPointer(x: number, y: number): void {
    const pointer = this.#backdropPointer;
    if (!pointer) return;
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    // NaN (no coordinates) doesn't count as moved.
    if (distance > TAP_SLOP) pointer.moved = true;
  }

  /**
   * The pointer lifted: stop following it, but keep it (with where it
   * lifted) for the click that may follow, which reads `moved`. A click
   * elsewhere (e.g. a mouse dragged onto the tray) never reaches the
   * backdrop; the record is then ignored by the next click, see
   * `onBackdropClick`.
   */
  #onBackdropPointerUp = (event: PointerEvent): void => {
    const pointer = this.#backdropPointer;
    if (pointer?.pointerId !== event.pointerId) return;
    this.#trackBackdropPointer(event.clientX, event.clientY);
    pointer.up = { x: event.clientX, y: event.clientY };
    this.#removeBackdropListeners();
  };

  /** The browser took the pointer over (e.g. to scroll): no click follows. */
  #onBackdropPointerCancel = (event: PointerEvent): void => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#endBackdropPointer();
    }
  };

  #removeBackdropListeners(): void {
    document.removeEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true,
    });
    document.removeEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true,
    });
    document.removeEventListener(
      'pointercancel',
      this.#onBackdropPointerCancel,
      { capture: true },
    );
  }

  #endBackdropPointer(): void {
    this.#removeBackdropListeners();
    this.#backdropPointer = undefined;
  }

  /**
   * Closes the drawer on a tap on the backdrop. A click whose pointer moved
   * past `TAP_SLOP` (a drag that happened to start on the backdrop) isn't a
   * tap. The click a pointer causes lands where it lifted; any other click,
   * e.g. one without a pointer (`element.click()`, assistive technology),
   * is a tap, also when an earlier pointer's click never reached the
   * backdrop.
   */
  private onBackdropClick = (event: MouseEvent): void => {
    const pointer = this.#backdropPointer;
    const own =
      pointer?.up !== undefined &&
      Math.hypot(event.clientX - pointer.up.x, event.clientY - pointer.up.y) <=
        CLICK_MATCH;
    this.#endBackdropPointer();
    if (!this.closeOnBackdropClick || this.#destroyed) return;
    if (own && pointer?.moved) return;
    this.close();
  };

  /**
   * Notes whether the active snap point is above the smallest one, and
   * queues `#applyOpen` for the modal behaviour and focus, which must not run
   * during rendering. Called whenever the target may have changed (and on
   * every argument change, which covers `@modal`).
   */
  #syncOpen(): void {
    const layout = this.#layout;
    if (!layout || this.#destroyed) return;
    const target = this.#offsetOf(this.activeSnapPoint);
    const open = target > layout.resolved[0]!.offset;
    const hidden = target <= 0;
    if (hidden !== this.#hidden) {
      this.#hidden = hidden;
      MobileDrawer.#syncNested();
      if (hidden) this.#closePortaled();
    }
    trackInput(this, !this.#hidden);
    if (!this.#hasReportBaseline) {
      // The first open state the drawer knows (on insertion, or once a
      // drawer inserted while hidden is measured) is not a change.
      this.#hasReportBaseline = true;
      this.#reportedOpen = open;
    }
    if (open && !this.#open) {
      this.#open = true;
      // Reopened before the close was applied: keep where focus came from.
      const reopened = this.#closedWithFocusInside !== undefined;
      this.#closedWithFocusInside = undefined;
      const active = document.activeElement;
      if (
        (active instanceof HTMLElement || active instanceof SVGElement) &&
        active !== document.body &&
        !this.#contains(active)
      ) {
        this.#returnFocus = active;
        this.#returnFocusPath = this.#ancestorsOf(active);
      } else if (!reopened) {
        this.#returnFocus = undefined;
        this.#returnFocusPath = [];
      }
      this.#openedByFocus = this.#focusOpenPending;
      this.#focusOpenPending = false;
      // Focus is already inside: return it to where it came from into the
      // tray, e.g. on Escape.
      const from = this.#enteredFrom;
      if (this.#openedByFocus && from?.isConnected && !this.#contains(from)) {
        this.#returnFocus = from;
        this.#returnFocusPath = this.#ancestorsOf(from);
      }
    } else if (!open && this.#open) {
      this.#open = false;
      this.#openedByFocus = false;
      // Read now: a drawer that closes without animating is hidden (and
      // loses focus) before the microtask runs.
      this.#closedWithFocusInside = this.#hasFocus();
    }
    if (this.#applyQueued) return;
    this.#applyQueued = true;
    queueMicrotask(() => {
      this.#applyQueued = false;
      this.#applyOpen();
    });
  }

  /**
   * Turns the modal behaviour on or off to match `#open` and `@modal`, and
   * moves focus: into a modal drawer that opens, back to where it came from
   * when the drawer closes.
   */
  #applyOpen(): void {
    if (this.#destroyed) return;
    const insideClosed = this.#insideClosedDrawer();
    const modal =
      this.#open && this.isModal && !insideClosed && !this.#openedByFocus;
    const wasModal = this.#releaseModal !== undefined;
    if (modal && !wasModal) {
      this.#activateModal();
    } else if (!modal && wasModal) {
      this.#deactivateModal();
      if (insideClosed && this.#open) this.#moveFocusOutOfClosedDrawer();
    }
    // Before focus returns: an open modal drawer inside this one would keep
    // the element to return to inert.
    this.#applyNested();
    const focusInside = this.#closedWithFocusInside;
    if (focusInside !== undefined) {
      this.#closedWithFocusInside = undefined;
      this.#returnFocusAfterClose(focusInside, wasModal);
    }
    this.#reportOpen();
  }

  /**
   * Calls `@onOpen` or `@onClose` when `#open` differs from what was last
   * reported. Runs in `#applyOpen`, so a drawer that opens and closes again
   * before it runs reports neither.
   */
  #reportOpen(): void {
    const open = this.#open;
    if (open === this.#reportedOpen) return;
    this.#reportedOpen = open;
    const event = { snapPoint: this.activeSnapPoint };
    if (open) {
      this.args.onOpen?.(event);
    } else {
      this.args.onClose?.(event);
    }
  }

  #activateModal(): void {
    const root = this.#root!;
    const tray = this.#tray!;
    this.#makeOutsideInert();
    // The tray, with the portals of the drawers nested in it.
    const releaseScroll = lockBodyScroll(
      (target) => logicallyContains(tray, target),
      {
        fields: [tray, ...this.#portals],
        transparentStatusBar:
          this.args.transparentStatusBar === true && this.placement !== 'top',
      },
    );
    this.#syncStatusBar();
    // Below the modal drawers inside this one (e.g. a peeking drawer that
    // opens under its open nested drawer, also one rendered outside the
    // tray with `Nested`): the nested drawer stays in front, so it keeps
    // Escape and the Tab wrap.
    const nested = modalStack.findIndex((other) =>
      logicallyContains(root, (other as MobileDrawer).#root),
    );
    modalStack.splice(nested === -1 ? modalStack.length : nested, 0, this);
    MobileDrawer.#syncNested();
    document.addEventListener('keydown', this.#onDocumentKeyDown);
    this.#releaseModal = () => {
      document.removeEventListener('keydown', this.#onDocumentKeyDown);
      modalStack.splice(modalStack.indexOf(this), 1);
      MobileDrawer.#syncNested();
      releaseScroll();
      // Not moving (e.g. a jump without animation): `#render` won't run
      // again to end it.
      if (!this.#spring?.isAnimating && !this.#drag) this.#endStatusBar();
      this.#releaseInert?.();
      this.#releaseInert = undefined;
    };
    this.modalActive = true;

    if (
      !this.#warnedLabel &&
      !root.hasAttribute('aria-label') &&
      !root.hasAttribute('aria-labelledby')
    ) {
      this.#warnedLabel = true;
      warn(
        '<MobileDrawer>: a modal drawer is a dialog and needs an accessible name. Add `aria-label` or `aria-labelledby` to <MobileDrawer>.',
        false,
        { id: 'ember-mobile-drawer.modal-label' },
      );
    }

    if (!this.#hasFocus()) {
      // The drawer's own focus never moves it (see `#onTrayFocusIn`): the
      // app chose the snap point it opens at.
      this.#initialFocusing = true;
      try {
        const element = initialFocus(tray, tray);
        focusWithoutScrolling(element);
        if (document.activeElement === element) this.#initialFocused = element;
      } finally {
        this.#initialFocusing = false;
      }
    }
  }

  /**
   * `@transparentStatusBar` (#113): while the scroll lock is the one for a
   * transparent status bar (the first modal drawer decides, so a drawer
   * nested in it follows), the root gets `data-status-bar="transparent"`
   * (styles.css moves it 5px down and makes the backdrop transparent on
   * iOS), and a drawer with a backdrop gets the dim layer (`PageDim`). Both
   * stay until the drawer rests without the modal behaviour (closed, or at
   * a peek, see `#render`), so the dim also fades out while it closes. They
   * end at once when the lock changes to the fixed `<body>` (see
   * `onLockChange`). Not for top drawers, and not for an embedded drawer (a
   * root that isn't `position: fixed`).
   */
  #syncStatusBar(): void {
    const root = this.#root;
    if (
      this.#statusBar ||
      !root ||
      !transparentStatusBarLock() ||
      this.placement === 'top' ||
      getComputedStyle(root).position !== 'fixed'
    ) {
      return;
    }
    this.#statusBar = true;
    root.setAttribute('data-status-bar', 'transparent');
    if (this.#backdrop) {
      this.#pageDim = new PageDim(root);
      this.#paintBackdrop();
    }
  }

  /** Undoes `#syncStatusBar`. */
  #endStatusBar(): void {
    if (!this.#statusBar) return;
    this.#statusBar = false;
    this.#root?.removeAttribute('data-status-bar');
    this.#pageDim?.destroy();
    this.#pageDim = undefined;
  }

  /** Undoes `#activateModal`, if it is on. Leaves focus alone. */
  #deactivateModal(): void {
    const release = this.#releaseModal;
    if (!release) return;
    this.#releaseModal = undefined;
    this.#initialFocused = undefined;
    release();
    if (!this.#destroyed) this.modalActive = false;
  }

  /**
   * Where the yielded `Nested` renders by default: the parent element of
   * the root, or, when this drawer is inside the tray of another drawer
   * (also through a `Nested` of that drawer), the parent element of the
   * outermost such drawer. A transformed tray is the containing block of the
   * fixed drawers in it, so a nested drawer in the tray of any drawer
   * around this one would be clipped by that tray again.
   */
  #nestedDestination(): Element | undefined {
    let root = this.#root!;
    for (;;) {
      const inner = root;
      const outer = [...(mountedDrawers as Set<MobileDrawer>)].find(
        (other) =>
          other.#root !== inner &&
          !!other.#tray &&
          logicallyContains(other.#tray, inner),
      );
      const outerRoot = outer ? outer.#root : undefined;
      if (!outerRoot) break;
      root = outerRoot;
    }
    return root.parentElement ?? undefined;
  }

  /**
   * Called when this drawer starts to close (see `#hidden`): closes the
   * drawers in the portals of its `Nested` that show, like `close()`, so
   * they move away together with this drawer. A drawer inside the tray
   * moves with the tray; one in a portal would else stay on the screen
   * until this drawer has closed, and then disappear at once. In a
   * microtask: `close()` can call `@onSnapPointChange`, which must not run
   * during rendering. A controlled drawer whose parent doesn't take the new
   * index hides with this drawer (`data-closed` on the portal).
   */
  #closePortaled(): void {
    if (this.#portals.size === 0) return;
    queueMicrotask(() => {
      if (this.#destroyed || !this.#hidden) return;
      const root = this.#root!;
      for (const other of mountedDrawers as Set<MobileDrawer>) {
        const otherRoot = other.#root;
        if (
          other === this ||
          other.#hidden ||
          !otherRoot ||
          ![...this.#portals].some((portal) => portal.contains(otherRoot)) ||
          other.#closestDrawerRoot() !== root
        ) {
          continue;
        }
        other.close();
      }
    });
  }

  /**
   * The root of the nearest drawer around this one, also through portals
   * (see `nesting.ts`).
   */
  #closestDrawerRoot(): Element | undefined {
    for (
      let node = this.#root ? logicalParent(this.#root) : null;
      node;
      node = logicalParent(node)
    ) {
      if (mountedRoots.has(node)) return node;
    }
    return undefined;
  }

  /**
   * Makes the page outside the drawer inert (see `inertOutside`), or
   * updates that: everything except the root and the portals of the drawers
   * nested in this one (see `nesting.ts`), which are a part of this drawer.
   * The new `inert` attributes are set before the old ones are released, so
   * an element that stays inert never loses it in between.
   */
  #makeOutsideInert(): void {
    const root = this.#root!;
    const release = this.#releaseInert;
    this.#releaseInert = inertOutside(root, ...portalsOf(root));
    release?.();
  }

  /**
   * Called when a portal of the yielded `Nested` is added or removed:
   * updates what the open modal drawers make inert (a portal can be added
   * in an element that is inert already), `data-nested`, and the open state
   * of the drawers nested in the drawers. In a microtask: portals are added
   * and removed during rendering, where the open state must not change.
   */
  static #portalsChanged(): void {
    if (MobileDrawer.#portalsQueued) return;
    MobileDrawer.#portalsQueued = true;
    queueMicrotask(() => {
      MobileDrawer.#portalsQueued = false;
      MobileDrawer.#applyPortals();
    });
  }

  static #portalsQueued = false;

  static #applyPortals(): void {
    for (const drawer of modalStack as MobileDrawer[]) {
      if (drawer.#releaseInert) drawer.#makeOutsideInert();
    }
    MobileDrawer.#syncNested();
    for (const drawer of mountedDrawers as Set<MobileDrawer>) {
      if (drawer.#portals.size > 0) drawer.#applyNested();
    }
  }

  /**
   * Whether `node` is inside the drawer: in its DOM, or in a portal of a
   * drawer nested in it (see `nesting.ts`).
   */
  #contains(node: Node | null | undefined): boolean {
    const root = this.#root;
    return !!root && logicallyContains(root, node);
  }

  /** Whether focus is inside the drawer. */
  #hasFocus(): boolean {
    return this.#contains(document.activeElement);
  }

  /**
   * Focuses the element that had focus when the drawer opened again, if
   * focus was inside the drawer when it closed (or, for a modal drawer, was
   * dropped onto `<body>`). Runs after the modal behaviour was undone, so the
   * element is no longer inert.
   *
   * If that element has left the page (e.g. the drawer deleted the list item
   * it was opened from), focus goes to the first tabbable element in the
   * nearest of its former ancestors that is still on the page, outside the
   * drawer, but never all the way up to `<body>`: focus then stays where the
   * browser put it.
   */
  #returnFocusAfterClose(focusInside: boolean, wasModal: boolean): void {
    const target = this.#returnFocus;
    const path = this.#returnFocusPath;
    this.#returnFocus = undefined;
    this.#returnFocusPath = [];
    if (!target) return;
    const active = document.activeElement;
    const dropped = !active || active === document.body;
    if (!(focusInside || this.#hasFocus() || (wasModal && dropped))) return;
    if (target.isConnected) {
      target.focus();
      return;
    }
    const root = this.#root;
    const ancestor = path.find((element) => element.isConnected);
    if (!ancestor) return;
    tabbables(ancestor)
      .find((element) => !(root && logicallyContains(root, element)))
      ?.focus();
  }

  /**
   * The ancestors of `element` from its parent up to (not including)
   * `<body>`, for the fallback in `#returnFocusAfterClose`.
   */
  #ancestorsOf(element: Element): Element[] {
    const path: Element[] = [];
    for (
      let node = element.parentElement;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      path.push(node);
    }
    return path;
  }

  /**
   * Whether the drawer is inside another drawer that is closed or closing,
   * whose `data-closed` hides it (or soon will): its modal behaviour is then
   * off, so it never keeps the page inert and locked from inside a hidden
   * drawer. It comes back when that drawer opens again. A drawer that rests
   * at a peek (a smallest snap point above 0) is visible, so it does not
   * count, see `#hidden`.
   */
  #insideClosedDrawer(): boolean {
    const root = this.#root;
    return !!root && this.#hiddenByDrawer(root);
  }

  /**
   * Whether `element` is inside a drawer (other than this one) that is
   * closed or closing, see `#hidden`.
   */
  #hiddenByDrawer(element: Element): boolean {
    for (const other of mountedDrawers as Set<MobileDrawer>) {
      if (other !== this && other.#hidden && other.#contains(element)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Called when the modal behaviour turns off because a drawer around this
   * one closes, while this drawer stays open. If focus is inside this
   * drawer, which is now hidden (or soon will be), it moves to the element
   * this drawer was opened from, if that is still on the page and not
   * hidden too. Else focus leaves the drawer for `<body>`: the drawer
   * around this one returns it from there if it was open (see
   * `#returnFocusAfterClose`). `#returnFocus` is kept, for when this drawer
   * closes after the drawer around it opens again.
   */
  #moveFocusOutOfClosedDrawer(): void {
    if (!this.#hasFocus()) return;
    const target = this.#returnFocus;
    if (target?.isConnected && !this.#hiddenByDrawer(target)) {
      target.focus();
      if (!this.#hasFocus()) return;
    }
    (document.activeElement as HTMLElement | SVGElement | null)?.blur();
  }

  /**
   * Sets `data-nested` on the root of every drawer that the front modal
   * drawer (the last one in `modalStack`) covers, and removes it from the
   * others: every drawer that shows (not closed or closing, see `#hidden`)
   * except the front one and the drawers inside it, which are in front of
   * it. Themes dim a covered sheet with it. Runs when the modal stack
   * changes, when a drawer starts to show or hide, and when a drawer is
   * inserted or removed.
   */
  static #syncNested(): void {
    const front = modalStack[modalStack.length - 1] as MobileDrawer | undefined;
    const frontRoot = front ? front.#root : undefined;
    for (const drawer of mountedDrawers as Set<MobileDrawer>) {
      const root = drawer.#root;
      if (!root) continue;
      root.toggleAttribute(
        'data-nested',
        !!frontRoot &&
          drawer !== front &&
          !drawer.#hidden &&
          !logicallyContains(frontRoot, root),
      );
    }
  }

  /** Re-applies the open state of the drawers inside this one. */
  #applyNested(): void {
    const root = this.#root;
    if (!root) return;
    for (const other of mountedDrawers as Set<MobileDrawer>) {
      if (
        other !== this &&
        other.#root &&
        logicallyContains(root, other.#root)
      ) {
        other.#applyOpen();
      }
    }
  }

  /**
   * Escape closes an open drawer while focus is inside it, modal or not.
   * Events another handler already took care of (`preventDefault`) are left
   * alone, so of nested drawers only the innermost one closes. Ignored while
   * the drawer is dragged: the release decides where it goes, so the parent
   * never sees a close and a reopen.
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      event.isComposing ||
      !this.#open ||
      this.#drag ||
      this.#destroyed
    ) {
      return;
    }
    event.preventDefault();
    this.close();
  };

  /**
   * While modal, for the topmost modal drawer only: Escape closes the drawer
   * also when focus is outside it (e.g. on `<body>` after a click on the
   * backdrop), and Tab and Shift+Tab wrap around inside the tray.
   */
  #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      modalStack[modalStack.length - 1] !== this ||
      this.#destroyed
    ) {
      return;
    }
    if (event.key === 'Escape') {
      // Not during a drag: the release decides where the drawer goes.
      if (event.isComposing || !this.#open || this.#drag) return;
      event.preventDefault();
      this.close();
    } else if (
      event.key === 'Tab' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      this.#trapTab(event);
    }
  };

  /**
   * Keeps Tab inside the tray: from the last tabbable element (or from
   * outside the tray) it moves to the first, Shift+Tab the other way round.
   * In between the browser moves focus as usual; the rest of the page is
   * inert, so focus can't leave the drawer.
   */
  #trapTab(event: KeyboardEvent): void {
    const tray = this.#tray!;
    const items = tabbables(tray);
    const active = document.activeElement;
    const inside = !!active && tray.contains(active);
    const first = items[0];
    const last = items[items.length - 1];
    // Whether a tabbable element comes after (or before) the focused one,
    // also when that isn't tabbable itself (e.g. a focused `tabindex="-1"`
    // status message after the last button).
    const any = (position: number) =>
      !!active &&
      items.some((item) => active.compareDocumentPosition(item) & position);
    let next: HTMLElement | undefined;
    if (!first || !last) {
      next = tray;
    } else if (event.shiftKey) {
      if (
        !inside ||
        active === tray ||
        !any(Node.DOCUMENT_POSITION_PRECEDING)
      ) {
        next = last;
      }
    } else if (!inside || !any(Node.DOCUMENT_POSITION_FOLLOWING)) {
      next = first;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  /**
   * Screen px per px of drawer offset along the axis: `1`, unless an
   * ancestor is scaled (e.g. a scaled preview). Pointer coordinates are in
   * screen px, offsets in the drawer's own px, so this keeps the drawer under
   * the finger. Measured once per drag; it forces layout.
   */
  #screenScale(): number {
    const layout = this.#layout!;
    const rect = this.#tray!.getBoundingClientRect();
    const scale =
      (this.axis === 'vertical' ? rect.height : rect.width) / layout.trayLength;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  /** The pointer coordinate along the drawer axis. */
  #positionOf(data: PanData): number | undefined {
    const position = this.axis === 'vertical' ? data.current.y : data.current.x;
    return Number.isFinite(position) ? position : undefined;
  }

  /**
   * The time of `event` in ms, for the release velocity: the event's own
   * time stamp, which is when the input happened even if the main thread was
   * busy. With an injected clock (tests) the clock's time instead, since
   * event time stamps can't be set.
   */
  #timeOf(event: Event | undefined): number {
    const { dragTime } = drawerEnvironment;
    if (dragTime) return dragTime();
    if (this.#clock) return this.#clock.now();
    return event?.timeStamp ?? performance.now();
  }

  /**
   * Where the drag puts the drawer after the finger moved `delta` px (in
   * drawer px, positive opens) since the drag started: 1:1 inside the snap
   * range and back towards it, rubber-banded outside it (stiff past fully
   * open like an iOS sheet's content, see `OPEN_RUBBER_BAND_RATIO`). See
   * `dragOffset`.
   */
  #dragOffset(drag: Drag, delta: number): number {
    const { resolved, container, trayLength } = this.#layout!;
    return dragOffset(
      drag.startOffset,
      delta,
      resolved[0]!.offset,
      resolved[resolved.length - 1]!.offset,
      {
        below: { dimension: container },
        above: { dimension: trayLength * OPEN_RUBBER_BAND_RATIO },
      },
    );
  }

  /**
   * The tray's `touch-action`. Below the highest snap point every gesture
   * along the axis drags, so the browser may only pan across it. At the
   * highest snap point the content may scroll along the axis too; gestures
   * that drag cancel their `touchmove` events instead. Read when a touch
   * starts, so it is kept up to date in `#render`.
   */
  private trayTouchAction = (): string => {
    if (this.#atTop) return 'pan-x pan-y';
    return this.axis === 'vertical' ? 'pan-x' : 'pan-y';
  };

  /**
   * Decides whether a gesture on the tray drags the drawer or scrolls (see
   * the class docs). A gesture that starts on a handle always drags, one
   * that starts in a nested drawer never does. Called once per gesture,
   * after a touch on a moving drawer has held it.
   */
  private shouldDrag = (movement: number, target: Element | null): boolean => {
    const layout = this.#layout;
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    if (!layout || !tray) return true;
    if (this.#renderedOffset < layout.maxOffset - EPSILON) return true;
    if (this.#onHandle(target)) return true;
    const vertical = this.axis === 'vertical';
    for (
      let element = target instanceof Element ? target : tray;
      element && tray.contains(element);
      element = element.parentElement!
    ) {
      if (
        (element === tray || element.hasAttribute(SCROLL_ATTRIBUTE)) &&
        canScroll(element, vertical, movement)
      ) {
        return false;
      }
      if (element === tray) break;
    }
    return true;
  };

  /**
   * Whether `target` is in one of this drawer's handles (not a nested
   * drawer's). A gesture that starts there always drags. A text field in a
   * handle (see `isTextField`) is not part of it, so text selection in it
   * keeps working: without `@handleOnly` a gesture there follows the rules
   * of the rest of the tray, with it a gesture there doesn't drag.
   */
  #onHandle(target: Element | null): boolean {
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    for (
      let element = target;
      element && element !== tray && tray?.contains(element);
      element = element.parentElement
    ) {
      if (isTextField(element)) return false;
      if (this.#handles.has(element as HTMLElement)) return true;
    }
    return false;
  }

  /**
   * The handles' `shouldDrag`: a gesture on a handle drags (see
   * `#onHandle`). With it the handle's drag source also cancels the
   * touchmoves of a drag, so the browser can't scroll the tray under it,
   * also with `@handleOnly`, where the tray isn't a drag source.
   */
  private shouldHandleDrag = (_movement: number, target: Element | null) =>
    this.#onHandle(target);

  /**
   * Whether `target` is in a drawer nested in this one (in its tray, a
   * handle or its backdrop): its gestures belong to that drawer only, see
   * the class docs.
   */
  #inNested(target: EventTarget | null): boolean {
    const root = this.#root;
    if (!root || !(target instanceof Element) || !root.contains(target)) {
      return false;
    }
    // The root of a mounted drawer, not any element with the
    // `mobile-drawer` class (e.g. an app element that reuses it). A drawer
    // nested with `Nested` is not in this drawer's DOM: its events never get
    // here.
    for (
      let element: Element | null = target;
      element && element !== root;
      element = element.parentElement
    ) {
      if (mountedRoots.has(element)) return true;
    }
    return false;
  }

  private onHandleInstall = (element: HTMLElement): void => {
    this.#handles.add(element);
  };

  private onHandleTeardown = (element: HTMLElement): void => {
    this.#handles.delete(element);
    this.onDragSourceTeardown(element);
  };

  /**
   * A touch on a drag source holds a running animation right away, like
   * native sheets, instead of only once a pan is recognised (past didPan's
   * threshold). If no drag starts, lifting the finger resumes the animation,
   * so taps on content keep working. Not a touch in a nested drawer (see
   * `#inNested`).
   */
  private onPointerDown = (event: PointerEvent): void => {
    const spring = this.#spring;
    if (
      !spring?.isAnimating ||
      this.#drag ||
      this.#hold ||
      this.#destroyed ||
      this.#inNested(event.target)
    ) {
      return;
    }
    spring.stop();
    this.#stopScrollReset();
    const end = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      this.#endHold();
      this.#moveToActive(true);
    };
    this.#hold = { pointerId: event.pointerId, end };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  };

  /**
   * While scrolling is locked, locks the marked scroll containers around
   * the target of a `pointerdown`, `wheel` or `focusin` on the tray before
   * the browser scrolls them: those added after the lock, and those whose
   * inline style the app has rewritten since (see `#lockScroll`). Listens
   * on the tray itself, so it works with `@handleOnly` and any pointer type.
   */
  #onTrayInput = (event: Event): void => {
    const tray = this.#tray;
    const { target } = event;
    if (!tray || !this.#scrollLockProperty || !(target instanceof Element)) {
      return;
    }
    this.#lockScroll(tray);
    for (
      let element: Element | null = target;
      element && element !== tray && tray.contains(element);
      element = element.parentElement
    ) {
      if (
        element instanceof HTMLElement &&
        element.hasAttribute(SCROLL_ATTRIBUTE) &&
        element.closest('.mobile-drawer__tray') === tray
      ) {
        this.#lockScroll(element);
      }
    }
  };

  /**
   * Keyboard focus on an element in the tray that isn't fully visible at
   * the active snap point moves a visible drawer below its highest snap
   * point to its highest snap point, like `open`: uncontrolled it moves
   * there, controlled it asks the parent through `@onSnapPointChange`, as
   * after a drag. Below the highest snap point the content can't scroll
   * along the axis, so this is the only way to show it. Modal or not: the
   * focused element is hidden either way. Also at a peek (a smallest snap
   * point above `0`), where Tab reaches the content from the page: the
   * drawer then opens, so `@onOpen` is called, but it doesn't become modal
   * (see `#openedByFocus`): Tab goes on through the drawer and out to the
   * page, and the drawer goes back to its peek when focus leaves it (see
   * `#onRootFocusOut`). Not while the drawer closes to `0`. When the drawer arrives, the tray scrolls the
   * element into view if the browser didn't (see `#revealFocus`).
   *
   * Only keyboard focus (focus after a key press, see `focusInputOf`, also
   * programmatic focus after a key press, such as the Tab wrap): a tap
   * focuses what is under the finger, which shows. Not the initial focus of
   * a modal drawer (see `#activateModal`): the drawer moves focus in itself,
   * and the app chose the snap point it opens (or is inserted) at, so that
   * one is kept. Also any focus on a field the user types in (see
   * `isTypingField`): a tap on a text field that is only partly visible
   * moves the drawer too, which shows the field above an on-screen keyboard.
   * Not a tap on a `readonly` text field, which opens no keyboard. Not
   * during a drag or while a touch holds the drawer, and not for the tray
   * itself or for the content of a drawer nested in this one, whose own tray
   * handles it.
   *
   * Visibility is checked where the element will be once the drawer rests
   * at its active snap point, not where it is now: a drawer that is still
   * on its way there (e.g. one that opens) must not move for an element
   * that will show. Visible means inside both the tray and the root (the space
   * the tray opens into), along the axis.
   */
  #onTrayFocusIn = (event: FocusEvent): void => {
    const tray = this.#tray;
    const { target, relatedTarget: from } = event;
    // The focused element itself, also inside an open shadow root.
    const element = event.composedPath()[0];
    if (element instanceof Element) {
      this.#focused = { element, input: focusInputOf(element) };
    }
    if (
      (from instanceof HTMLElement || from instanceof SVGElement) &&
      !this.#contains(from)
    ) {
      this.#enteredFrom = from;
    }
    if (
      !tray ||
      !this.#layout ||
      this.#destroyed ||
      this.#drag ||
      this.#hold ||
      this.#hidden ||
      this.#initialFocusing ||
      target === tray ||
      !(target instanceof Element) ||
      target.closest('.mobile-drawer__tray') !== tray
    ) {
      return;
    }
    if (
      !(element instanceof Element) ||
      (this.#inputOf(element) !== 'keyboard' && !isTypingField(element))
    ) {
      return;
    }
    const offset = this.#offsetOf(this.activeSnapPoint);
    if (this.#isHighest(offset) || this.#isVisibleAt(element, offset)) return;
    this.#reveal = element;
    // Not during rendering (an app may focus an element as it renders).
    queueMicrotask(() => {
      if (
        this.#destroyed ||
        this.#reveal !== element ||
        this.#drag ||
        this.#hidden ||
        this.#isHighest(this.#offsetOf(this.activeSnapPoint))
      ) {
        return;
      }
      this.#resetRootScroll();
      if (!this.#open) {
        // From the peek: the drawer opens, but not as a modal dialog. A
        // controlled parent that doesn't take the new index in this task
        // doesn't get a drawer that is not modal later.
        this.#focusOpenPending = true;
        setTimeout(() => (this.#focusOpenPending = false));
      }
      this.open();
    });
  };

  /**
   * A drawer that keyboard focus opened from its peek (see
   * `#openedByFocus`) goes back to its peek when focus moves to an element
   * outside it, e.g. Tab past its last element: like a peek that only shows
   * what has focus. Not when focus goes nowhere (`relatedTarget` `null`,
   * e.g. the window loses focus or a click on something that can't take
   * focus), nor during a drag. Like `close`, so through
   * `@onSnapPointChange` when controlled. Also forgets the initial focus of
   * a modal drawer when focus moves on from it (see `#focusHoldsReset`).
   */
  #onRootFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    // Focus moved on from the modal drawer's initial focus (not only the
    // window that lost focus), see `#focusHoldsReset`.
    if (to && event.target === this.#initialFocused) {
      this.#initialFocused = undefined;
    }
    if (
      !this.#openedByFocus ||
      !this.#open ||
      this.#destroyed ||
      this.#drag ||
      !(to instanceof Node) ||
      this.#contains(to)
    ) {
      return;
    }
    queueMicrotask(() => {
      if (
        this.#openedByFocus &&
        this.#open &&
        !this.#destroyed &&
        !this.#drag &&
        !this.#hasFocus()
      ) {
        this.close();
      }
    });
  };

  /**
   * Scrolls the sheet and the root back to their start. Both are
   * `overflow: hidden` and never meant to scroll, but a browser that scrolls
   * a focused element into view scrolls them too: below the highest snap
   * point part of the tray is outside the sheet, so the browser moves the
   * tray up in the sheet to show the element, and the tray leaves its
   * edge, while the drawer stays at its snap point. The sheet takes that
   * scroll, so it doesn't go on to the page behind. (The root only scrolls
   * if something else in it overflows.) Called before a move for keyboard
   * focus (Chrome scrolls before the focus events), and on every `scroll`
   * of the sheet or the root (`#onRootScroll`), for browsers that scroll
   * after them and for focus that doesn't move the drawer (a tap on a
   * partly visible button, a peek of a drawer whose parent declines the
   * move).
   */
  #resetRootScroll(): void {
    for (const element of [this.#sheet!, this.#root!]) {
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
        element.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
    }
  }

  #onRootScroll = (): void => {
    if (!this.#destroyed) this.#resetRootScroll();
  };

  /**
   * The part of the root that the tray covers along the axis, in screen px,
   * with the tray moved by `shift` px from where it is rendered: where the
   * content can show. The sheet clips the tray too: a floating sheet (see
   * `--mobile-drawer-inset`) ends above the root's bottom edge. A scroll of
   * the root moves the sheet; that is undone, like `shift` undoes it for
   * the tray (see `#isVisibleAt`).
   */
  #visibleRange(shift: number): { start: number; end: number } {
    const vertical = this.axis === 'vertical';
    const tray = this.#tray!.getBoundingClientRect();
    const root = this.#root!;
    const rootRect = root.getBoundingClientRect();
    const sheet = this.#sheet!.getBoundingClientRect();
    const scroll = vertical ? root.scrollTop : root.scrollLeft;
    const unscroll = scroll ? scroll * this.#screenScale() : 0;
    return {
      start: Math.max(
        (vertical ? tray.top : tray.left) + shift,
        vertical ? rootRect.top : rootRect.left,
        (vertical ? sheet.top : sheet.left) + unscroll,
      ),
      end: Math.min(
        (vertical ? tray.bottom : tray.right) + shift,
        vertical ? rootRect.bottom : rootRect.right,
        (vertical ? sheet.bottom : sheet.right) + unscroll,
      ),
    };
  }

  /**
   * Whether `element` is fully inside the visible part of the tray along
   * the axis (see `#visibleRange`) once the drawer is at `offset` (px open).
   * Forces layout, so only for focus changes.
   */
  #isVisibleAt(element: Element, offset: number): boolean {
    const root = this.#root!;
    const sheet = this.#sheet!;
    const vertical = this.axis === 'vertical';
    // Also undoes a scroll of the sheet or the root (see
    // `#resetRootScroll`), which moves the tray and the element alike, but
    // not the root.
    const shift =
      (OPENING_DIRECTION[this.placement] * (offset - this.#renderedOffset) +
        (vertical
          ? root.scrollTop + sheet.scrollTop
          : root.scrollLeft + sheet.scrollLeft)) *
      this.#screenScale();
    const visible = this.#visibleRange(shift);
    const rect = element.getBoundingClientRect();
    const start = (vertical ? rect.top : rect.left) + shift;
    const end = (vertical ? rect.bottom : rect.right) + shift;
    return start >= visible.start - EPSILON && end <= visible.end + EPSILON;
  }

  /**
   * Called when a run of the spring ends. If keyboard focus moved the drawer
   * to its highest snap point (see `#onTrayFocusIn`), the drawer rests there
   * and the element still has focus, scrolls the tray of a vertical drawer
   * so the element shows: below the highest snap point the tray was locked,
   * and the browser may not have scrolled it (e.g. focus that came with
   * `preventScroll`, such as the initial focus of a modal drawer). Only the
   * tray scrolls, not the page. Left and right drawers scroll across their
   * axis, which isn't locked, so the browser already did.
   */
  #revealFocus(): void {
    const element = this.#reveal;
    this.#reveal = undefined;
    const tray = this.#tray;
    if (
      !element ||
      !tray ||
      !this.#layout ||
      this.#destroyed ||
      this.#drag ||
      this.axis !== 'vertical' ||
      !this.#isHighest(this.#renderedOffset)
    ) {
      return;
    }
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    if (active !== element) return;
    const visible = this.#visibleRange(0);
    const rect = element.getBoundingClientRect();
    // Show the element's end if it is below, but its start first of all.
    let delta = Math.max(0, rect.bottom - visible.end);
    delta = Math.min(delta, rect.top - visible.start);
    if (Math.abs(delta) <= EPSILON) return;
    tray.scrollBy({ top: delta / this.#screenScale(), behavior: 'instant' });
  }

  #onTrayTouchStart = (event: TouchEvent): void => {
    const current = this.#lockedTouch;
    // A gesture whose touch is gone ended without its touchend reaching the
    // tray (e.g. its element was removed): start over.
    if (
      current &&
      Array.from(event.touches).some((touch) => touch.identifier === current.id)
    ) {
      return;
    }
    this.#lockedTouch = undefined;
    const touch = event.changedTouches[0];
    if (!touch || !this.handleOnly || !this.#scrollLockProperty) return;
    this.#lockedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      far: false,
    };
  };

  /**
   * With `@handleOnly` below the highest snap point, the content can't
   * scroll along the axis, and the content isn't a drag source, so nothing
   * else would cancel a swipe along the axis: iOS then skips the locked tray
   * and scrolls the page behind it, whatever `overscroll-behavior` says.
   * So such a swipe has its touchmoves cancelled, decided as in
   * `dragSource`: once the finger has moved `DECISION_SLOP` px along the
   * axis and further along it than across it, and released to the browser
   * if it turns sideways before it has moved `TAP_SLOP` px along the axis.
   * It never drags the drawer. Swipes across the axis (a carousel, a side
   * drawer's list) are left alone. Without `@handleOnly`, `dragSource` does
   * this as part of dragging.
   */
  #onTrayTouchMove = (event: TouchEvent): void => {
    const gesture = this.#lockedTouch;
    if (!gesture) return;
    const touch = Array.from(event.changedTouches).find(
      (changed) => changed.identifier === gesture.id,
    );
    if (!touch) return;
    const vertical = this.axis === 'vertical';
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    const along = Math.abs(vertical ? dy : dx);
    const across = Math.abs(vertical ? dx : dy);
    if (gesture.cancels === undefined) {
      if (along >= DECISION_SLOP && along > across) gesture.cancels = true;
    } else if (gesture.cancels && !gesture.far && across > along) {
      gesture.cancels = false;
    }
    if (along >= TAP_SLOP) gesture.far = true;
    if (gesture.cancels && event.cancelable) event.preventDefault();
  };

  #onTrayTouchEnd = (event: TouchEvent): void => {
    const gesture = this.#lockedTouch;
    if (
      gesture &&
      Array.from(event.changedTouches).some(
        (touch) => touch.identifier === gesture.id,
      )
    ) {
      this.#lockedTouch = undefined;
    }
  };

  #endHold(): void {
    const hold = this.#hold;
    if (!hold) return;
    this.#hold = undefined;
    document.removeEventListener('pointerup', hold.end, true);
    document.removeEventListener('pointercancel', hold.end, true);
  }

  private onPanStart = (data: PanData, source: HTMLElement): void => {
    const spring = this.#spring;
    const position = this.#positionOf(data);
    if (
      !spring ||
      !this.#layout ||
      this.#destroyed ||
      position === undefined ||
      // One drag at a time: a second finger on another handle is ignored.
      this.#drag
    ) {
      return;
    }

    // Catch a running animation where it is on screen: the rendered offset,
    // not the spring's value, which may be past an edge the render clamps.
    spring.stop();
    this.#stopScrollReset();
    // A drag keeps the content where it is until its release. A drag from
    // a scrolled tray (on a handle, or with `@handleOnly`) can take it
    // below the highest snap point with the content away from its start.
    this.#markScrollReset(this.#awayFromScrollStart());
    this.#endHold();
    const offset = this.#renderedOffset;
    // didPan recognises the pan once the finger has moved past its threshold.
    // Anchored at the touchdown the tray would jump by that distance, so the
    // tray starts where it is and catches up with the finger over the first
    // frames (`#follow`). Anchored on the offset shown, also when that is
    // past an end (`dragOffset`).
    const scale = this.#screenScale();
    const initial = data.initial;
    let down = this.axis === 'vertical' ? initial?.y : initial?.x;
    let recognisedAt =
      (OPENING_DIRECTION[this.placement] * (position - (down ?? NaN))) / scale;
    if (!Number.isFinite(recognisedAt)) {
      // No usable touchdown: follow from here, without a catch-up.
      down = position;
      recognisedAt = 0;
    }
    const drag: Drag = {
      source,
      startOffset: offset,
      startPosition: down!,
      scale,
      lagFrom: recognisedAt,
      lagStart: this.#now(),
      holding: false,
      moved: false,
      peak: recognisedAt,
      delta: recognisedAt,
      drawn: 0,
      target: offset,
      offset,
    };
    this.#drag = drag;
    drag.target = this.#dragOffset(drag, recognisedAt);
    this.#velocity.reset();
    // The velocity of the finger (see `onPan`), not of the catch-up.
    this.#velocity.add(this.#timeOf(data.originalEvent), drag.target);
    this.#queueState({ isDragging: true });
    this.#follow(drag, drag.lagStart);
    this.args.onDragStart?.({ snapPoint: this.activeSnapPoint, offset });
  };

  private onPan = (data: PanData, source: HTMLElement): void => {
    const drag = this.#drag;
    const position = this.#positionOf(data);
    if (
      !drag ||
      drag.source !== source ||
      !this.#layout ||
      this.#destroyed ||
      position === undefined
    ) {
      return;
    }

    // How far the finger moved since it went down, in drawer px.
    const delta =
      (OPENING_DIRECTION[this.placement] * (position - drag.startPosition)) /
      drag.scale;
    if (!Number.isFinite(delta)) return;

    const now = this.#now();
    const lag = drag.delta - drag.drawn;
    const step = delta - drag.delta;
    // The way the tray catches up: 1 or -1, 0 when it has caught up.
    const way = Math.sign(drag.lagFrom);
    if (drag.holding) {
      if (lag === 0) {
        // The finger reached the tray: 1:1 from here.
        drag.holding = false;
      } else if (step * lag > 0) {
        // On again, away from the tray: ease the gap from here.
        drag.lagFrom = lag;
        drag.lagStart = now;
        drag.holding = false;
        drag.peak = delta;
      } else {
        // Holds until the finger reaches it.
        const drawn =
          way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
        drag.lagFrom = delta - drawn;
      }
    } else if (
      lag !== 0 &&
      (drag.peak - delta) * way > TURN_SLOP / drag.scale
    ) {
      // Back towards the tray during the catch-up, further than a jitter of
      // the finger: the tray holds still until the finger reaches it, and
      // then follows it. Easing on would take it against the finger, and
      // past it. A jitter doesn't stop the easing: the tray then stays
      // behind the finger by the lag.
      const drawn =
        way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
      drag.lagFrom = delta - drawn;
      drag.lagStart = now;
      drag.holding = true;
    } else if (way !== 0) {
      drag.peak =
        way > 0 ? Math.max(drag.peak, delta) : Math.min(drag.peak, delta);
    }
    drag.moved = true;
    drag.delta = delta;
    drag.target = this.#dragOffset(drag, delta);
    // The velocity of the drawer where the finger puts it (after
    // resistance), so a release past an end doesn't hand the spring more
    // speed than the tray had, and the catch-up adds none.
    this.#velocity.add(this.#timeOf(data.originalEvent), drag.target);
    this.#follow(drag, now);
  };

  /** The time (ms) on the clock that runs the frames. */
  #now(): number {
    return (this.#clock ?? browserClock).now();
  }

  /**
   * Renders the drag at `time`: the tray follows the finger 1:1, but at the
   * start of the drag it is behind it by the catch-up lag (`catchUpLag`),
   * which eases from the distance moved before the pan was recognised to
   * `0`. While it lags it is also moved every frame, so it catches up when
   * the finger holds still. It is never past the finger: while the finger
   * comes back towards it, it holds still (`holding`, see `onPan`).
   */
  #follow(drag: Drag, time: number): void {
    const lag = drag.holding
      ? drag.lagFrom
      : catchUpLag(drag.lagFrom, time - drag.lagStart);
    drag.drawn = drag.delta - lag;
    drag.offset = lag === 0 ? drag.target : this.#dragOffset(drag, drag.drawn);
    this.#render(drag.offset);
    if (lag === 0) {
      this.#cancelCatchUp(drag);
    } else if (drag.frame === undefined) {
      drag.frame = (this.#clock ?? browserClock).requestFrame(
        this.#catchUpFrame,
      );
    }
  }

  #cancelCatchUp(drag: Drag | undefined): void {
    if (drag?.frame === undefined) return;
    (this.#clock ?? browserClock).cancelFrame(drag.frame);
    drag.frame = undefined;
  }

  /**
   * A frame of the catch-up. At the time on the clock, not the frame's time
   * stamp: input of the same frame is handled after that time stamp, and
   * going back to it would move the tray back a little.
   */
  #catchUpFrame = (): void => {
    const drag = this.#drag;
    if (!drag || this.#destroyed) return;
    drag.frame = undefined;
    const now = this.#now();
    if (drag.holding && !drag.moved) {
      // The finger stopped before it reached the tray: catch up from here.
      drag.holding = false;
      drag.lagFrom = drag.delta - drag.drawn;
      drag.lagStart = now;
      drag.peak = drag.delta;
    }
    drag.moved = false;
    this.#follow(drag, now);
  };

  private onPanEnd = (data: PanData, source: HTMLElement): void => {
    if (this.#drag?.source !== source) return;
    // A cancelled pointer (e.g. the browser took over the gesture) has no
    // meaningful position or velocity: settle from where the drawer is.
    const cancelled = data.originalEvent?.type === 'pointercancel';
    if (!cancelled) this.onPan(data, source);
    const drag = this.#endDrag()!;
    const velocity = cancelled
      ? 0
      : this.#velocity.velocity(this.#timeOf(data.originalEvent));
    this.#release(drag.offset, velocity, drag.target);
  };

  /**
   * The pan modifier of `source` was torn down (its element removed, or,
   * for the tray, `@handleOnly` changed). If it owned the drag, its pointer
   * events won't arrive any more: settle from where the drawer is, as on
   * `pointercancel`.
   * Teardown happens during rendering, so the release waits for a microtask.
   */
  private onDragSourceTeardown = (source: HTMLElement): void => {
    if (this.#drag?.source !== source) return;
    const drag = this.#endDrag()!;
    queueMicrotask(() => {
      if (!this.#destroyed && !this.#drag) {
        this.#release(drag.offset, 0, drag.target);
      }
    });
  };

  #endDrag(): Drag | undefined {
    const drag = this.#drag;
    this.#drag = undefined;
    this.#cancelCatchUp(drag);
    this.#queueState({ isDragging: false });
    return drag;
  }

  /**
   * Hands the release to the spring and settles on the snap point the
   * projection picks. Uncontrolled, that becomes the active snap point.
   * Controlled, the drawer asks the parent through `@onSnapPointChange` and
   * meanwhile heads for the active snap point: the parent always wins, so the
   * drawer turns towards the new one once (and only if) the parent passes it
   * in. A parent that answers synchronously does so before the next frame.
   * The spring starts at `offset`, where the tray is; the snap point is
   * picked for `released`, where the finger put it (ahead of `offset` while
   * the tray still catches up, see `#follow`), which `@onDragEnd` reports.
   */
  #release(offset: number, velocity: number, released = offset): void {
    const spring = this.#spring;
    const layout = this.#layout;
    if (!spring || !layout || this.#destroyed) return;

    const target = selectSnapPoint(layout.resolved, released, velocity, {
      flingVelocity: FLING_VELOCITY,
    });
    const index = this.#indexOf(target);
    const previous = this.activeSnapPoint;

    spring.set(offset, velocity);
    this.#overshoot = Math.max(0, offset - layout.trayLength);
    if (index !== previous && !this.isControlled) {
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.#moveToActive(true);
    this.args.onDragEnd?.({ snapPoint: index, offset: released, velocity });
    if (index !== previous) this.args.onSnapPointChange?.(index);
  }

  /**
   * Updates tracked state in a microtask. The lifecycle hooks run during
   * rendering, where writing tracked state that was already rendered is an
   * error, and batching keeps the state coarse (a run that starts and ends in
   * the same task never flips `isAnimating`).
   */
  #queueState(state: PendingState): void {
    const flush = !this.#pendingState;
    this.#pendingState = { ...this.#pendingState, ...state };
    if (!flush) return;

    queueMicrotask(() => {
      const pending = this.#pendingState!;
      this.#pendingState = undefined;
      if (this.#destroyed) return;
      if (
        pending.isAnimating !== undefined &&
        pending.isAnimating !== this.isAnimating
      ) {
        this.isAnimating = pending.isAnimating;
      }
      if (
        pending.progress !== undefined &&
        pending.progress !== this.progress
      ) {
        this.progress = pending.progress;
      }
      if (
        pending.isDragging !== undefined &&
        pending.isDragging !== this.isDragging
      ) {
        this.isDragging = pending.isDragging;
      }
    });
  }

  <template>
    <div
      class="mobile-drawer"
      data-placement={{this.placement}}
      data-closed
      role={{if this.isModal "dialog"}}
      aria-modal={{if this.modalActive "true"}}
      ...attributes
      {{lifecycle
        this.hooks
        this.placement
        this.snapPoints
        this.activeSnapPoint
        this.isModal
      }}
    >
      {{#if this.showBackdrop}}
        <div
          class="mobile-drawer__backdrop"
          {{lifecycle this.backdropHooks}}
        ></div>
        <div class="mobile-drawer__backdrop-tint" aria-hidden="true"></div>
      {{/if}}
      <div class="mobile-drawer__sheet">
        <div
          class="mobile-drawer__tray"
          tabindex={{if this.isModal "-1"}}
          {{(if
            this.handleOnly
            noop
            (modifier
              dragSource
              axis=this.axis
              pointerTypes=POINTER_TYPES
              onPointerDown=this.onPointerDown
              onPanStart=this.onPanStart
              onPan=this.onPan
              onPanEnd=this.onPanEnd
              onTeardown=this.onDragSourceTeardown
              shouldDrag=this.shouldDrag
              touchAction=this.trayTouchAction
            )
          )}}
        >
          <div class="mobile-drawer__content">
            {{yield
              (hash
                snapTo=this.snapTo
                open=this.open
                close=this.close
                activeSnapPoint=this.activeSnapPoint
                handle=(modifier
                  dragSource
                  axis=this.axis
                  pointerTypes=POINTER_TYPES
                  onPointerDown=this.onPointerDown
                  onPanStart=this.onPanStart
                  onPan=this.onPan
                  onPanEnd=this.onPanEnd
                  onInstall=this.onHandleInstall
                  shouldDrag=this.shouldHandleDrag
                  onTeardown=this.onHandleTeardown
                )
                isDragging=this.isDragging
                isAnimating=this.isAnimating
                progress=this.progress
                Nested=(component
                  NestedPortal owner=this.nestedOwner fallback=this.nestedParent
                )
              )
            }}
          </div>
        </div>
      </div>
      <div class="mobile-drawer__bar-tint" aria-hidden="true"></div>
    </div>
  </template>
}
