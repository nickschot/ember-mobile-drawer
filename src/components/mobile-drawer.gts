import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { assert, warn } from '@ember/debug';
import { buildWaiter } from '@ember/test-waiters';
import {
  DEFAULT_SPRING_CONFIG,
  Spring,
  browserClock,
  browserPrefersReducedMotion,
  type FrameClock,
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
import {
  drawerEnvironment,
  type CloseWatcherConstructor,
  type CloseWatcherLike,
} from '../-private/environment.ts';
import {
  lifecycle,
  type LifecycleHooks,
} from '../-private/lifecycle-modifier.ts';
import { noop } from '../-private/noop-modifier.ts';
import { VelocityTracker } from '../-private/gesture/velocity.ts';
import { TURN_SLOP, catchUpLag } from '../-private/gesture/catch-up.ts';
import {
  MIN_MOMENTUM_VELOCITY,
  Momentum,
} from '../-private/gesture/momentum.ts';
import { inertOutside } from '../-private/modal/inert.ts';
import {
  lockBodyScroll,
  onLockChange,
  transparentStatusBarLock,
} from '../-private/modal/scroll-lock.ts';
import { PageDim } from '../-private/status-bar.ts';
import {
  canScroll,
  scrollBounds,
  scrollRange,
  scrollsAlong,
} from '../-private/scroll-bounds.ts';
import {
  focusWithoutScrolling,
  initialFocus,
  tabbables,
} from '../-private/modal/focus.ts';
import {
  isDrawerRoot,
  registerDrawer,
  unregisterDrawer,
} from '../-private/registry.ts';
import {
  addPortal,
  logicalParent,
  logicallyContains,
  portalsOf,
  removePortal,
} from '../-private/nesting.ts';
import NestedPortal, { type NestedOwner } from '../-private/nested-portal.gts';
import Grabber, { type GrabberOwner } from '../-private/grabber.gts';
import { setPageProgress } from '../-private/page-progress.ts';
import { KeyboardFill } from '../-private/keyboard-fill.ts';
import { InlineOverrides } from '../-private/inline-style.ts';
import {
  isEditable,
  isInactiveTextField,
  isTextField,
  isTypingField,
} from '../-private/fields.ts';
import type { MobileDrawerSpring } from '../springs.ts';

import type {
  MobileDrawerApi,
  MobileDrawerDragEndEvent,
  MobileDrawerDragStartEvent,
  MobileDrawerToggleEvent,
  Placement,
} from '../types.ts';

/** Keeps `settled()` waiting while the drawer animates. */
const animationWaiter = buildWaiter('ember-mobile-drawer:animation');

const PLACEMENTS: readonly Placement[] = ['bottom', 'top', 'left', 'right'];

const DEFAULT_SNAP_POINTS: readonly SnapPoint[] = Object.freeze([0, 'content']);

/**
 * Pointer types that can drag the drawer. Mouse is left out: a mouse drag
 * would also select text and end in a click on whatever is under the pointer.
 */
const POINTER_TYPES = Object.freeze(['touch', 'pen'] as const);

/** A release this fast (px/s) moves at least to the next snap point. */
const FLING_VELOCITY = 400;

/**
 * How far (px) past closed the spring aims when the drawer closes to offset
 * 0. The run ends when the tray reaches 0, so the tray leaves the screen
 * while it still moves (about 0.6 px/ms with `springPresets.ios`), as a
 * native iOS sheet does, instead of creeping to the edge. A fixed distance,
 * not a fraction of the move, so a short close does not creep either.
 */
const CLOSE_OVERSHOOT = 60;

/** `1` when opening moves towards larger client coordinates, else `-1`. */
const OPENING_DIRECTION: Record<Placement, 1 | -1> = {
  bottom: -1,
  top: 1,
  left: 1,
  right: -1,
};

/**
 * The rubber band past the largest snap point, like an iOS sheet's content:
 * the UIScrollView curve `(1 - 1 / (x * c / d + 1)) * d` with `c = 0.55` and
 * `d` this ratio times the tray's length. Only the content moves; the tray
 * stays at its edge. Past the smallest snap point `d` is the container size.
 */
const OPEN_RUBBER_BAND_RATIO = 0.55;

/** Content that stays at the tray's edge while the content bounces. */
const PINNED_ATTRIBUTE = 'data-mobile-drawer-pinned';

/** Marks a scroll container in the tray. The tray itself always is one. */
const SCROLL_ATTRIBUTE = 'data-mobile-drawer-scroll';

/**
 * Events on the tray that (re)lock the scroll containers they reach. `wheel`
 * isn't passive, so the lock applies before the wheel scrolls.
 */
const TRAY_INPUT_EVENTS = ['pointerdown', 'wheel', 'focusin'] as const;
const CAPTURE_PASSIVE = { capture: true, passive: true } as const;
const CAPTURE_ACTIVE = { capture: true, passive: false } as const;

/** Tolerance (px): offsets and scroll positions can be fractional. */
const EPSILON = 0.5;

/** How far (screen px) a backdrop tap may move. The same as `didPan`. */
const TAP_SLOP = 10;

/** How long (ms) after stopping momentum its click is still cancelled. */
const SWALLOW_CLICK_TIME = 1000;

/** How far (px) a click may be from where the pointer lifted (rounding). */
const CLICK_MATCH = 2;

/**
 * The open modal drawers in the order they became modal, but a drawer always
 * comes before the modal drawers inside it. Only the last one handles Escape
 * and Tab.
 */
const modalStack: MobileDrawer[] = [];

/**
 * One `CloseWatcher` while a modal drawer is open, so the Android back
 * gesture closes the front one. Only where the browser has it (Chromium).
 */
let closeWatcher: CloseWatcherLike | undefined;

function closeWatcherConstructor(): CloseWatcherConstructor | undefined {
  if ('CloseWatcher' in drawerEnvironment) {
    return drawerEnvironment.CloseWatcher ?? undefined;
  }
  return 'CloseWatcher' in window
    ? (window as unknown as { CloseWatcher: CloseWatcherConstructor })
        .CloseWatcher
    : undefined;
}

/**
 * Creates the watcher when a modal drawer is open, destroys it when none is.
 * Only `onclose`: `oncancel` needs a user activation.
 */
function syncCloseWatcher(): void {
  if (modalStack.length === 0) {
    closeWatcher?.destroy();
    closeWatcher = undefined;
    return;
  }
  if (closeWatcher) return;
  const Watcher = closeWatcherConstructor();
  if (!Watcher) return;
  const watcher = new Watcher();
  closeWatcher = watcher;
  watcher.onclose = () => {
    // The browser destroyed it.
    if (closeWatcher === watcher) closeWatcher = undefined;
    // The front one, which is not always the last one that became modal.
    modalStack[modalStack.length - 1]?.close();
    // A new one for the next back gesture: modal drawers stay open, or a
    // controlled drawer didn't take the close yet. Destroyed when the last
    // one stops being modal.
    syncCloseWatcher();
  };
}

const mountedDrawers = new Set<MobileDrawer>();

type InputType = 'keyboard' | 'pointer';

/** The drawers that show (open or at a peek). */
const shownDrawers = new Set<object>();

/** The input the user gave last while a drawer showed. */
let lastInput: { type: InputType; time: number } | undefined;

/**
 * How long (ms) after an input a focus still counts as caused by it. A long
 * press can take more time; then the browser decides.
 */
const INPUT_WINDOW = 1000;

/** The drawer's clock, as for its animations. */
const inputTime = (): number => (drawerEnvironment.clock ?? performance).now();

const onInputKeyDown = (): void => {
  lastInput = { type: 'keyboard', time: inputTime() };
};

const onInputPointerDown = (): void => {
  lastInput = { type: 'pointer', time: inputTime() };
};

const INPUT_LISTENER = { capture: true, passive: true } as const;

/**
 * While a drawer shows, window listeners record the last input. They capture,
 * so the record is there before the focus the input causes (also when the
 * app moves focus in its handler) and an app that stops the event can't hide
 * it.
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
 * The input that gives `element` focus now: the recent input when there is
 * one, the same in every browser (Chrome gives a clicked `readonly` field
 * `:focus-visible`). Else, as for a screen reader or switch access, which
 * send no key or pointer event, `:focus-visible` decides, but never for an
 * inactive text field. Safari before 15.4 throws on `:focus-visible`.
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

/** Whether `element` is nearer the end that a finger moving `way` pushes to. */
function nearEnd(element: Element, vertical: boolean, way: number): boolean {
  if (!(scrollRange(element, vertical) > EPSILON)) return true;
  const { range, min, position } = scrollBounds(
    element,
    vertical,
    getComputedStyle(element),
  );
  const fromMin = position - min;
  // A finger moving down (right) pushes the content towards `min`.
  return way > 0 ? fromMin <= range / 2 : fromMin >= range / 2;
}

interface Drag {
  source: HTMLElement;
  startOffset: number;
  startPosition: number;
  /** Screen px per px of drawer offset. */
  scale: number;
  /** How far (drawer px) the tray was behind the finger at catch-up start. */
  lagFrom: number;
  lagStart: number;
  /** The tray holds still while the finger comes back during the catch-up. */
  holding: boolean;
  moved: boolean;
  /** The furthest `delta` the way the tray catches up, since the start. */
  peak: number;
  /** How far (drawer px) the finger has moved. */
  delta: number;
  /** `delta` minus the lag, as last drawn. */
  drawn: number;
  target: number;
  /** Rendered offset, after rubber-banding. */
  offset: number;
  frame?: number;
  /**
   * The drag took over a gesture that scrolled the content. Its touchmoves
   * can't be cancelled, so the content stays locked for the whole drag.
   */
  handoff?: boolean;
  /** The `delta` at the highest snap point, for a drag that may scroll. */
  scrollAt?: number;
  from: Element | null;
  /** The content scrolled past the highest snap point, `null` for none. */
  scroll?: ContentScroll | null;
  /** How far (drawer px towards open) the content is scrolled. */
  written: number;
}

/** A scroll container that a drag scrolls from script past the top. */
interface ContentScroll {
  element: HTMLElement;
  vertical: boolean;
  start: number;
  /** Which way the position moves as the finger moves towards open. */
  sign: 1 | -1;
  min: number;
  max: number;
  /** How far (px) it can scroll from `start` as the finger opens. */
  room: number;
  /** How far (px) it can scroll back from `start`. */
  back: number;
}

interface ScrollReset {
  /** `scrollTop` of the scroll start. */
  start: number;
  /** Which way `scrollTop` moves away from the start. */
  sign: 1 | -1;
  distance: number;
  from: number;
  target: number;
  /** The part of `distance` left, as last written. */
  fraction: number;
}

interface PendingState {
  isAnimating?: boolean;
  isDragging?: boolean;
  progress?: number;
  openSnapPoints?: readonly (readonly number[])[];
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
    /**
     * Optional. Content that stays at the tray's leading edge, outside the
     * scroll container, such as a grabber or a title bar: the header
     * mode. The content then scrolls (and bounces at its start, as in a
     * native iOS sheet) under it. See "Header" in the README.
     */
    header: [drawer: MobileDrawerApi];
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
 * The border-box length of `element` along the axis, or `undefined` outside
 * the render tree (computed styles then aren't px). Not
 * `getBoundingClientRect()`, which includes transforms, nor `offsetHeight`,
 * which is rounded. `extra` is the padding and border of `content-box`.
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

/**
 * Whether `element` handles its own touch gestures, so a swipe on it in a
 * nested drawer is never cancelled. `:disabled` also matches a control in a
 * disabled fieldset.
 */
function handlesOwnGesture(
  element: Element,
  style: CSSStyleDeclaration,
): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.matches(':disabled')) return false;
    return (
      !(element instanceof HTMLInputElement) ||
      element.type === 'range' ||
      isTextField(element)
    );
  }
  if (element instanceof HTMLMediaElement) return element.controls;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  if (element.getAttribute('draggable') === 'true') return true;
  return style.touchAction === 'none';
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clampIndex = (index: number, count: number) =>
  Number.isFinite(index) ? clamp(Math.round(index), 0, count - 1) : 0;

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
  @tracked isAnimating = false;
  @tracked isDragging = false;
  /**
   * The real value needs the measured layout, so a drawer inserted open
   * renders its block once more after insertion.
   */
  @tracked progress = 0;
  /** Bumped when the drawer changes its own (uncontrolled) snap point. */
  @tracked uncontrolledVersion = 0;
  @tracked modalActive = false;
  /** For the `Grabber`: the open snap point indices, ascending by offset. */
  @tracked openSnapPoints: readonly (readonly number[])[] = [];
  /** Where the yielded `Nested` renders without `@destination`. */
  @tracked nestedParent?: Element;

  /** The `Nested` portals: a part of the tray, hidden with the drawer. */
  #portals = new Set<HTMLElement>();

  private nestedOwner: NestedOwner = {
    add: (portal) => {
      this.#portals.add(portal);
      this.#listenNested(portal, true);
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
      this.#listenNested(portal, false);
      removePortal(portal);
      MobileDrawer.#portalsChanged();
    },
  };

  /**
   * The snap point when uncontrolled. Not tracked: it is also written during
   * rendering, so dropping `@activeSnapPoint` keeps the drawer where it is.
   */
  #uncontrolledSnapPoint = 0;
  #lastWarning?: string;

  #root?: HTMLElement;
  #sheet?: HTMLElement;
  #tray?: HTMLElement;
  #content?: HTMLElement;
  #header?: HTMLElement;

  /**
   * The tray, or with a header the content, so the header stays out of the
   * scroll and the content bounces under it, as in a native iOS sheet.
   */
  get #scroller(): HTMLElement | undefined {
    return this.#header ? this.#content : this.#tray;
  }

  /** The DOM order (tab and reading order) is the order on screen. */
  get headerFirst(): boolean {
    return this.placement === 'bottom' || this.placement === 'right';
  }

  /** A placement change renders the header again, as a new element. */
  #syncHeader(): void {
    const header =
      this.#tray?.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__header',
      ) ?? undefined;
    if (header === this.#header) return;
    if (this.#header) this.#resizeObserver?.unobserve(this.#header);
    this.#header = header;
    if (header) this.#resizeObserver?.observe(header);
  }
  #barTint?: HTMLElement;
  #shadow?: HTMLElement;
  #shadowBody?: HTMLElement;
  #glass?: HTMLElement;
  /** Fills below the root while the iOS Safari keyboard is open. */
  #keyboardFill?: KeyboardFill;
  /** Whether the content is moved past fully open. */
  #bouncing = false;
  /** The pinned elements' own inline `translate`, put back after a bounce. */
  #pinned = new InlineOverrides();
  #contentWillChange = new InlineOverrides();
  #backdrop?: HTMLElement;
  #backdropTint?: HTMLElement;
  /** Whether the root has `data-status-bar="transparent"`. */
  #statusBar = false;
  #pageDim?: PageDim;
  #offLockChange?: () => void;
  #listeners?: AbortController;
  #backdropListeners?: AbortController;
  #spring?: Spring;
  #resizeObserver?: ResizeObserver;
  #layout?: Layout;
  /** Whether the tray is below the lowest open snap point. */
  #below = false;
  #floats = false;
  /** How far (px) `#paintSink` moved the sheet down. */
  #moved = 0;
  #placement?: Placement;
  #destroyed = false;
  #pendingState?: PendingState;
  /** The injected clock, if any (tests). */
  #clock?: FrameClock;
  #drag?: Drag;
  /** A pointer that stopped a running animation, until a drag or its lift. */
  #hold?: { pointerId: number; end: (event: PointerEvent) => void };
  #velocity = new VelocityTracker();
  /** The velocity of the content part of a drag, for its momentum. */
  #scrollVelocity = new VelocityTracker();
  #momentum?: Momentum;
  /** The click that a tap which stopped the momentum may not do. */
  #clickSwallow?: {
    click: (event: MouseEvent) => void;
    release: () => void;
    /** Whether the pointer lifted: a later pointer is a new tap. */
    released: boolean;
    timer: ReturnType<typeof setTimeout>;
  };
  #renderedOffset = 0;
  /**
   * How far (px) the tray may be rendered past fully open while not dragged.
   * Only shrinks after the release, so the tray returns from a rubber band
   * without a jump but the spring never pulls it further off its edge.
   */
  #overshoot = 0;
  /** Holds the tray at the highest snap point for the rest of the run. */
  #arrivedAtHighest = false;
  /** Whether the tray was at the highest snap point at the last render. */
  #atTop = false;
  #scrollReset?: ScrollReset;
  /** The spring of a scroll reset that runs on its own. */
  #scrollSpring?: Spring;
  /** The locked elements, with their own inline overflow. */
  #scrollLock = new InlineOverrides();
  #scrollLockProperty?: string;
  #overscroll = new InlineOverrides();
  /**
   * With `@handleOnly`, a touch that started while scrolling was locked.
   * `cancels` is `undefined` until decided; `far` past `TAP_SLOP`.
   */
  #lockedTouch?: {
    id: number;
    x: number;
    y: number;
    cancels?: boolean;
    far: boolean;
  };
  /**
   * A touch that started in a nested drawer: the elements that may scroll
   * for it, whether it is on an element with its own gestures (`own`) and
   * whether it is cancelled (`undefined` until decided).
   */
  #nestedTouch?: {
    id: number;
    x: number;
    y: number;
    scrollers: Element[];
    own: boolean;
    cancels?: boolean;
  };
  #handles = new Set<HTMLElement>();

  #dragCount = 0;
  /** The element that keyboard focus reveals once the drawer arrives. */
  #reveal?: Element;
  #backdropProgress = 0;
  #expandProgress = NaN;
  /** Whether the backdrop catches pointers (above the smallest snap point). */
  #backdropBlocks = false;
  /**
   * Whether the active snap point is above the smallest one. Updated during
   * rendering; the modal behaviour and focus follow in a microtask.
   */
  #open = false;
  /**
   * Whether the active snap point is at 0, so `data-closed` hides the drawer.
   * Unlike `!#open`, not set at a peek. Also set until the first measure.
   */
  #hidden = true;
  /**
   * `#open` as last reported through `@onOpen`/`@onClose`. The first value
   * counts as reported.
   */
  #reportedOpen = false;
  #hasReportBaseline = false;
  #returnFocus?: HTMLElement | SVGElement;
  /** Its ancestors when the drawer opened. */
  #returnFocusPath: Element[] = [];
  /**
   * Set while keyboard focus opened the drawer from its peek: it is then not
   * modal, and goes back to its peek when focus leaves it. A move between
   * open snap points keeps it; an open from the peek by other means doesn't
   * set it.
   */
  #openedByFocus = false;
  /** Until the drawer opens, or the next task if the parent says no. */
  #focusOpenPending = false;
  /** Where focus came from into the tray, for a drawer opened by focus. */
  #enteredFrom?: HTMLElement | SVGElement;
  #initialFocusing = false;
  /** Its keyboard focus doesn't hold the scroll reset. */
  #initialFocused?: Element;
  /**
   * The last focused element in the tray, with its input read at focus time:
   * a later key press (typing, Space on a tapped button) doesn't change it.
   */
  #focused?: { element: Element; input: InputType };
  /** Whether focus was inside when the drawer closed, until it returns. */
  #closedWithFocusInside?: boolean;
  #applyQueued = false;
  #releaseModal?: () => void;
  #releaseInert?: () => void;
  #warnedLabel = false;
  /**
   * The pointer that went down on the backdrop, until its click, cancel or
   * the next pointer. `moved` past `TAP_SLOP`: no tap. Only a click at `up`
   * belongs to it.
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
   * An invalid `@activeSnapPoint` (e.g. `@snapPoints` shrank first) is
   * clamped with a warning, rather than throwing during rendering.
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
    warn(message, false, { id: 'ember-mobile-drawer.invalid-snap-point' });
  }

  snapTo = (index: number): void => {
    assert(
      `<MobileDrawer>: snapTo needs an index into @snapPoints (0-${this.snapPoints.length - 1}), got ${index}.`,
      Number.isInteger(index) && index >= 0 && index < this.snapPoints.length,
    );
    if (index === this.activeSnapPoint) {
      // E.g. after a resize stopped an animation.
      this.#moveToActive(true);
      return;
    }
    if (!this.isControlled) {
      // Re-renders the lifecycle modifier, whose `update` animates to it.
      this.#uncontrolledSnapPoint = index;
      this.uncontrolledVersion++;
    }
    this.args.onSnapPointChange?.(index);
  };

  /**
   * The `Grabber`'s action, like an iOS sheet's grabber: the next larger
   * open snap point, from the largest back to the smallest. Never closes.
   */
  #cycle(): number | undefined {
    const layout = this.#layout;
    if (!layout || this.#drag || this.#destroyed) return undefined;
    const open = layout.resolved.filter((snapPoint) => snapPoint.offset > 0);
    if (open.length < 2) return undefined;
    const active = this.activeSnapPoint;
    const at = open.findIndex((snapPoint) =>
      snapPoint.indices.includes(active),
    );
    const next = open[at === -1 || at === open.length - 1 ? 0 : at + 1]!;
    const index = this.#indexOf(next);
    this.snapTo(index);
    return index;
  }

  grabberOwner: GrabberOwner = {
    cycle: () => this.#cycle(),
    dragCount: () => this.#dragCount,
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
      this.#shadow =
        root.querySelector<HTMLElement>(':scope > .mobile-drawer__shadow') ??
        undefined;
      this.#shadowBody =
        this.#shadow?.querySelector<HTMLElement>(
          '.mobile-drawer__shadow-body',
        ) ?? undefined;
      this.#glass =
        this.#sheet.querySelector<HTMLElement>(
          ':scope > .mobile-drawer__glass',
        ) ?? undefined;
      this.#content = this.#tray.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__content',
      )!;
      this.#header =
        this.#tray.querySelector<HTMLElement>(
          ':scope > .mobile-drawer__header',
        ) ?? undefined;
      const { clock } = drawerEnvironment;
      this.#clock = clock;
      this.#spring = new Spring({
        ...this.#springConfig(),
        clock,
        prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
        onUpdate: ({ value }) => this.#onSpringUpdate(value),
      });
      this.#placement = this.placement;
      this.#listeners = new AbortController();
      const { signal } = this.#listeners;
      root.addEventListener('keydown', this.#onKeyDown, { signal });
      root.addEventListener('scroll', this.#onRootScroll, {
        passive: true,
        signal,
      });
      root.addEventListener('focusout', this.#onRootFocusOut, { signal });
      this.#sheet.addEventListener('scroll', this.#onRootScroll, {
        passive: true,
        signal,
      });
      mountedDrawers.add(this);
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
      MobileDrawer.#syncNested();
      // Tracked state, so not during rendering (and the drawers around this
      // one are in the DOM by then).
      queueMicrotask(() => {
        if (!this.#destroyed) this.nestedParent = this.#nestedDestination();
      });
      this.#measure();
      this.#moveToActive(false);
      this.#syncScrollLock();
      // A drawer with a text field opened in front: the lock is now the
      // fixed `<body>`, so the status bar is solid again.
      this.#offLockChange = onLockChange(() => this.#endStatusBar());
      const tray = this.#tray;
      for (const type of TRAY_INPUT_EVENTS) {
        tray.addEventListener(type, this.#onTrayInput, {
          ...(type === 'wheel' ? CAPTURE_ACTIVE : CAPTURE_PASSIVE),
          signal,
        });
      }
      tray.addEventListener('focusin', this.#onTrayFocusIn, { signal });
      tray.addEventListener('touchstart', this.#onTrayTouchStart, {
        passive: true,
        signal,
      });
      tray.addEventListener('touchmove', this.#onTrayTouchMove, {
        passive: false,
        signal,
      });
      tray.addEventListener('touchend', this.#onTrayTouchEnd, { signal });
      tray.addEventListener('touchcancel', this.#onTrayTouchEnd, { signal });
      this.#listenNested(tray, true);
      this.#keyboardFill = new KeyboardFill({
        root,
        tray,
        glass: this.#glass,
        viewport: drawerEnvironment.visualViewport
          ? drawerEnvironment.visualViewport()
          : (window.visualViewport ?? null),
        // Only a bottom drawer has its background at the screen's bottom.
        active: () =>
          !this.#destroyed &&
          this.placement === 'bottom' &&
          !root.hasAttribute('data-closed'),
        keepsKeyboard: isEditable,
        contains: logicallyContains,
      });
      this.#keyboardFill.sync();

      if (typeof ResizeObserver !== 'undefined') {
        // Not the tray: the component sizes it, so the observer would fire
        // on its own writes. A tray-only padding change waits for the next.
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(this.#content);
        if (this.#header) this.#resizeObserver.observe(this.#header);
      }
    },

    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      if (placementChanged) {
        this.#stopMomentum();
        this.#syncHeader();
      }
      this.#measure();
      this.#syncScrollLock();
      if (this.#drag) {
        // The finger wins until it lets go. A new placement is a new axis, so
        // that drag is over.
        if (!placementChanged) {
          this.#syncOpen();
          return;
        }
        const drag = this.#endDrag()!;
        // Not during rendering.
        queueMicrotask(() => {
          if (this.#destroyed) return;
          this.args.onDragEnd?.({
            snapPoint: this.activeSnapPoint,
            offset: drag.target,
            velocity: 0,
          });
        });
      }
      // A new placement jumps instead of animating along the new axis.
      this.#moveToActive(!placementChanged);
      if (placementChanged) this.#keyboardFill?.sync();
    },

    destroy: () => {
      this.#destroyed = true;
      this.#listeners?.abort();
      this.#listeners = undefined;
      const tray = this.#tray;
      if (tray) this.#listenNested(tray, false);
      for (const portal of this.#portals) this.#listenNested(portal, false);
      this.#lockedTouch = undefined;
      this.#nestedTouch = undefined;
      this.#reveal = undefined;
      this.#keyboardFill?.destroy();
      this.#endHold();
      this.#cancelCatchUp(this.#drag);
      this.#endBackdropPointer();
      this.#resizeObserver?.disconnect();
      this.#spring?.stop();
      this.#stopScrollReset();
      this.#stopMomentum();
      this.#endSwallowClick();
      this.#syncScrollLock();
      this.onTrayScrollEnd();
      mountedDrawers.delete(this);
      if (this.#root) unregisterDrawer(this.#root);
      MobileDrawer.#syncNested();
      trackInput(this, false);
      this.#focused = undefined;
      if (this.#root) setPageProgress(this.#root, 0);
      // Focus can only move back once the drawer is gone from the DOM.
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
   * Resolves the snap points and sizes the tray. Forces layout, so never per
   * frame. `false` while the tray can't be measured (e.g. hidden): the resize
   * observer measures again once it gets a size.
   */
  #measure(): boolean {
    const tray = this.#tray!;
    const vertical = this.placement === 'bottom' || this.placement === 'top';
    const size = vertical ? 'height' : 'width';
    const { style } = tray;
    const { height, width } = style;

    style.height = '';
    style.width = '';
    const content = measureLength(tray, vertical);

    // The root minus the opposite safe-area inset, or the tray's max size.
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
      style[size] = `${maxOffset - extra}px`;
      trayLength = maxOffset;
    } else {
      style[size] = '';
    }

    this.#layout = { resolved, container, trayLength, maxOffset };
    const layerHeight = this.placement === 'bottom' ? `${trayLength}px` : '';
    if (this.#shadow) this.#shadow.style.height = layerHeight;
    if (this.#glass) this.#glass.style.height = layerHeight;
    const open = resolved
      .filter((snapPoint) => snapPoint.offset > 0)
      .map((snapPoint) => snapPoint.indices);
    if (JSON.stringify(open) !== JSON.stringify(this.openSnapPoints)) {
      this.#queueState({ openSnapPoints: open });
    }
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

  /** Does nothing while dragging: the release moves to the active one. */
  #moveToActive(animate: boolean): void {
    const spring = this.#spring;
    const index = this.activeSnapPoint;
    // So dropping @activeSnapPoint keeps it.
    this.#uncontrolledSnapPoint = index;
    if (!spring || !this.#layout || this.#destroyed) return;
    this.#syncOpen();
    if (this.#drag) return;

    const target = this.#offsetOf(index);
    this.#queueState({ progress: this.#progressOf(target) });
    spring.retarget(animate ? this.#aimFor(target) : target);
    this.#markExpanded(target);

    if (!animate) {
      spring.stop();
      spring.set(target, 0);
      this.#render(target);
      this.#scrollToStart(target);
      this.#queueState({ isAnimating: false });
      return;
    }
    this.#planScrollReset(target);

    if (spring.isAnimating) return;

    void this.#startSpring(spring).then(() => {
      if (spring.isAnimating) return;
      this.#queueState({ isAnimating: false });
      this.#revealFocus();
    });
    // With reduced motion the run ended synchronously.
    this.#queueState({ isAnimating: spring.isAnimating });
    // Now rather than at the first frame, so focus can move in at once.
    if (spring.isAnimating) this.#setClosed(false);
  }

  /**
   * `data-expanded` follows the target, not the rendered position, and only
   * outside a drag, so small movements at the top never flicker it.
   */
  #markExpanded(target: number): void {
    const { maxOffset } = this.#layout!;
    const root = this.#root!;
    const expanded = maxOffset > 0 && target >= maxOffset - EPSILON;
    if (root.hasAttribute('data-expanded') === expanded) return;
    root.toggleAttribute('data-expanded', expanded);
    // A theme may change the tray's colour with it.
    this.#keyboardFill?.paint();
  }

  /**
   * Below the highest snap point a vertical drawer's content goes back to its
   * scroll start (the end of the range for a top drawer), where it is locked.
   * Opening from closed to the highest snap point starts at `scrollTop` 0.
   * Not for side drawers: their tray isn't sized by the snap point along its
   * scroll axis.
   *
   * The reset never jumps while the tray shows: towards closed it waits until
   * the tray is closed; when the tray has at least as far to go as the
   * content, it follows the tray in `#render`, so the content never moves
   * faster than the tray; otherwise it runs on a spring of its own from rest.
   * Reads layout only here, so the render loop only writes.
   */
  #planScrollReset(target: number): void {
    // A new plan (e.g. each frame of a resize) keeps the running speed.
    const running = this.#scrollSpring?.isAnimating
      ? this.#scrollSpring
      : undefined;
    const velocity = running?.velocity ?? 0;
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    if (this.#isHighest(target)) {
      // A move up from a lower snap point keeps the position.
      if (this.#renderedOffset <= EPSILON) this.#scrollToStart(target);
      return;
    }
    const scroller = this.#scroller!;
    const top = this.placement === 'top';
    const start = top
      ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      : 0;
    let distance = Math.abs(scroller.scrollTop - start);
    // The browser rounds scroll positions: go on from the spring's exact
    // value, or a resize on every frame could keep the reset a pixel short.
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
      this.#writeScroll(reset, 0);
      return;
    }
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

  #applyScrollReset(open: number): void {
    const reset = this.#scrollReset;
    if (!reset) return;
    let fraction: number;
    if (reset.target <= EPSILON) {
      fraction = open <= EPSILON ? 0 : 1;
    } else {
      // At least `distance` (more than EPSILON) when planned.
      const span = Math.abs(reset.from - reset.target);
      fraction = clamp(Math.abs(open - reset.target) / span, 0, 1);
    }
    if (fraction >= reset.fraction) return;
    this.#writeScroll(reset, fraction);
    if (fraction === 0) this.#scrollReset = undefined;
  }

  /** `instant`, so an app's `scroll-behavior: smooth` doesn't apply. */
  #writeScroll(reset: ScrollReset, fraction: number): void {
    reset.fraction = fraction;
    const top = reset.start + reset.sign * reset.distance * fraction;
    this.#scroller!.scrollTo({ top, behavior: 'instant' });
  }

  /**
   * Registers the run with the test waiter, but not with an injected clock:
   * those tests run the frames themselves, so `settled()` would hang.
   */
  #startSpring(spring: Spring): Promise<void> {
    if (!spring.isAnimating) spring.configure(this.#springConfig());
    const run = spring.start();
    if (spring.isAnimating && !this.#clock) {
      const token = animationWaiter.beginAsync();
      void run.then(() => animationWaiter.endAsync(token));
    }
    return run;
  }

  /** Production builds use the default instead of an invalid value. */
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

  #stopScrollReset(): void {
    this.#scrollReset = undefined;
    this.#scrollSpring?.stop();
    this.#scrollSpring = undefined;
  }

  #isHighest(offset: number): boolean {
    const { maxOffset } = this.#layout!;
    return maxOffset > 0 && offset >= maxOffset - EPSILON;
  }

  /** `scrollTop` 0 at the highest snap point, else the scroll start. */
  #scrollToStart(target: number): void {
    this.#stopScrollReset();
    if (this.axis !== 'vertical') return;
    const scroller = this.#scroller!;
    const top =
      this.placement === 'top' && !this.#isHighest(target)
        ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        : 0;
    scroller.scrollTo({ top, behavior: 'instant' });
  }

  /**
   * Whether focus in the tray holds a resize's scroll reset: the browser
   * scrolled keyboard focus into view, and an editable element can open an
   * on-screen keyboard. The drawer's own initial focus doesn't scroll, so it
   * doesn't hold it.
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

  /** As read when it got focus, or now when the drawer didn't see that. */
  #inputOf(element: Element): InputType {
    const focused = this.#focused;
    return focused?.element === element ? focused.input : focusInputOf(element);
  }

  #onResize(): void {
    const spring = this.#spring;
    if (!spring || this.#destroyed || !this.#measure()) return;
    // A drag or a hold stays at the offset shown until the finger moves.
    if (this.#drag || this.#hold) {
      this.#render(this.#drag?.offset ?? this.#renderedOffset);
      return;
    }

    this.#syncOpen();
    const target = this.#offsetOf(this.activeSnapPoint);
    this.#queueState({ progress: this.#progressOf(target) });
    this.#markExpanded(target);
    // Not when the browser may have scrolled focus into view (e.g. above an
    // Android keyboard that resizes the page): the reset would hide it.
    if (!this.#focusHoldsReset()) this.#planScrollReset(target);

    if (spring.isAnimating) {
      spring.retarget(this.#aimFor(target));
      this.#render(spring.value);
    } else {
      // Before the next paint, so the old position never shows at the new
      // size.
      spring.retarget(target);
      spring.set(target, 0);
      this.#render(target);
    }
  }

  /**
   * Where the spring aims for `target`: past closed (`CLOSE_OVERSHOOT`) for
   * a close to offset 0 while the tray is open by any amount, so the tray
   * doesn't creep to the edge. Also in the last pixel of such a run, where a
   * retarget to 0 (a resize, a changed argument) would give a long invisible
   * tail. `#onSpringUpdate` ends that run at 0.
   */
  #aimFor(target: number): number {
    return target <= 0 && this.#spring!.value > 0 ? -CLOSE_OVERSHOOT : target;
  }

  /**
   * Ends a run aimed past closed when it reaches closed, at exactly 0 and at
   * rest. Also after reduced motion jumped to that target.
   */
  #onSpringUpdate(value: number): void {
    const spring = this.#spring!;
    if (spring.target < 0 && value <= 0) {
      spring.stop();
      spring.retarget(0);
      spring.set(0, 0);
      value = 0;
    }
    this.#render(value);
  }

  /** Runs every frame: only inline styles, never tracked state. */
  #render(offset: number): void {
    const layout = this.#layout;
    const root = this.#root;
    if (!layout || !root || this.#destroyed) return;

    const max = this.#drag ? Infinity : layout.trayLength + this.#overshoot;
    let open = clamp(offset, 0, max);
    // A bouncing spring comes back below its target. At the highest snap
    // point that would lock the content for a moment (and make a touch drag
    // instead of scroll), so the tray stays there for the rest of the run.
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
    // Past the tray's length only the content moves.
    const distance = Math.max(0, layout.trayLength - open);
    const shift = -OPENING_DIRECTION[this.placement] * distance;
    const transform =
      this.axis === 'vertical'
        ? `translate3d(0, ${shift}px, 0)`
        : `translate3d(${shift}px, 0, 0)`;

    this.#tray!.style.transform = transform;
    this.#paintShadow(transform, distance, this.#sinkOf(open));
    this.#renderBounce(Math.max(0, open - layout.trayLength));
    const atTop = open >= layout.maxOffset - EPSILON;
    this.#paintExpand(open, atTop);
    root.toggleAttribute('data-at-highest', atTop && layout.maxOffset > 0);
    if (atTop !== this.#atTop) {
      this.#atTop = atTop;
      if (!atTop) this.#stopMomentum();
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
    this.#barTint?.style.setProperty(
      '--mobile-drawer-progress',
      String(this.#backdropProgress),
    );
    // Like on iOS, only a modal sheet from the bottom moves the page back.
    setPageProgress(
      root,
      this.isModal && this.placement === 'bottom' && layout.maxOffset > smallest
        ? clamp((open - smallest) / (layout.maxOffset - smallest), 0, 1)
        : 0,
    );
    this.#setClosed(open <= 0 && !this.#spring!.isAnimating && !this.#drag);
    // At rest without the modal behaviour: no transparent status bar.
    if (!this.#releaseModal && !this.#spring!.isAnimating && !this.#drag) {
      this.#endStatusBar();
    }
  }

  /** Also on the `Nested` portals, so they hide with this drawer. */
  #setClosed(closed: boolean): void {
    const root = this.#root!;
    const changed = root.hasAttribute('data-closed') !== closed;
    root.toggleAttribute('data-closed', closed);
    // The next open reads the inset again.
    if (closed) this.#below = false;
    for (const portal of this.#portals) {
      portal.toggleAttribute('data-closed', closed);
    }
    if (changed) this.#keyboardFill?.sync();
  }

  /**
   * The shadow and glass layers move with the tray; the shadow body gets the
   * opposite transform, so it stays at the sheet's bottom edge. Transforms
   * only, so a theme's shadow is not painted again while the drawer moves.
   */
  #paintShadow(transform: string, distance: number, sink: number): void {
    // Also for other placements, to clear a bottom drawer's move.
    const moved = this.#paintSink(sink);
    if (this.placement !== 'bottom') return;
    if (this.#glass) this.#glass.style.transform = transform;
    const shadow = this.#shadow;
    if (!shadow) return;
    shadow.style.transform = transform;
    if (this.#shadowBody) {
      this.#shadowBody.style.transform = `translate3d(0, ${moved - distance}px, 0)`;
    }
  }

  /**
   * Moves a floating sheet, and with it its clip, down by `sink` px; the tray
   * and glass get the opposite `translate`. Only written on a change, so an
   * app's inline `translate` on the tray stays above the lowest open snap
   * point. A sheet without an inset doesn't move: its clip would cut the
   * tray's top shadow. The inset is read once per move below, so a change
   * (e.g. the iOS page scale) applies to the next one.
   */
  #paintSink(sink: number): number {
    const below = sink > 0;
    if (below && !this.#below) this.#floats = this.#isFloating();
    this.#below = below;
    const value = below && this.#floats ? sink : 0;
    if (value === this.#moved) return value;
    this.#moved = value;
    const down = value > 0 ? `0px ${value}px` : '';
    const up = value > 0 ? `0px ${-value}px` : '';
    this.#sheet!.style.translate = down;
    this.#tray!.style.translate = up;
    if (this.#glass) this.#glass.style.translate = up;
    return value;
  }

  #isFloating(): boolean {
    const inset = getComputedStyle(this.#sheet!)
      .getPropertyValue('--mobile-drawer-inset')
      .trim();
    return inset !== '' && parseFloat(inset) !== 0;
  }

  /**
   * Below the lowest open snap point the sheet moves down as one piece, as a
   * native iOS sheet does when it closes, instead of getting shorter.
   */
  #sinkOf(open: number): number {
    if (this.placement !== 'bottom' || !this.#layout) return 0;
    const lowest =
      this.#layout.resolved.find((snapPoint) => snapPoint.offset > 0)?.offset ??
      0;
    return Math.max(0, lowest - open);
  }

  /**
   * Not on the root: the property is not inherited and only the tray takes
   * it from the sheet, so the content isn't styled again on every frame.
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
    this.#shadow?.style.setProperty('--mobile-drawer-expand-progress', value);
    // A theme may change the tray's colour with it.
    this.#keyboardFill?.paint();
  }

  /**
   * Moves the content past fully open with `translate`, which composes with
   * an app `transform`. Scrolling is locked meanwhile: the moved content
   * widens a top or left tray's scrollable overflow, and no scroll may start
   * on top of the bounce.
   */
  #renderBounce(bounce: number): void {
    const content = this.#content;
    if (!content) return;
    const bouncing = bounce > 0;
    const value = (b: number) => {
      if (!bouncing) return '';
      const shift = OPENING_DIRECTION[this.placement] * b;
      return this.axis === 'vertical' ? `0px ${shift}px` : `${shift}px 0px`;
    };
    if (bouncing !== this.#bouncing) {
      this.#bouncing = bouncing;
      if (bouncing) {
        this.#contentWillChange.set(content, 'will-change', 'translate');
        for (const element of content.querySelectorAll<HTMLElement>(
          `[${PINNED_ATTRIBUTE}]`,
        )) {
          if (element.closest('.mobile-drawer__content') !== content) continue;
          this.#pinned.save(element, 'translate');
        }
      } else {
        this.#contentWillChange.restoreAll();
        this.#pinned.restoreAll();
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
   * Below the highest snap point the scroll containers get an inline
   * `overflow: hidden` along the axis, so content and drag never fight.
   * `hidden` keeps their scroll position. Inline, not a CSS rule: their
   * `overflow` usually comes from unlayered app CSS, which beats the
   * drawer's layer, and the lock must follow the rendered position.
   */
  #syncScrollLock(): void {
    const tray = this.#tray;
    if (!tray) return;
    const lock =
      !this.#destroyed &&
      (!this.#atTop || this.#bouncing || this.#drag?.handoff === true);
    const property = this.axis === 'vertical' ? 'overflow-y' : 'overflow-x';
    this.#scrollLockProperty = lock ? property : undefined;
    for (const [element, saved] of this.#scrollLock) {
      if (!element.isConnected) {
        this.#scrollLock.delete(element);
      } else if (!lock || saved.property !== property) {
        // Keeps a value the app has set since.
        this.#scrollLock.restore(element, 'hidden');
      }
    }
    if (!lock) return;
    this.#lockContainers(
      tray,
      tray.querySelectorAll<HTMLElement>(`[${SCROLL_ATTRIBUTE}]`),
    );
  }

  /** Not the scroll containers of a nested drawer. */
  #lockContainers(tray: HTMLElement, marked: Iterable<Element>): void {
    this.#lockScroll(tray);
    if (this.#header) this.#lockScroll(this.#content!);
    for (const element of marked) {
      if (
        element instanceof HTMLElement &&
        element.hasAttribute(SCROLL_ATTRIBUTE) &&
        element.closest('.mobile-drawer__tray') === tray
      ) {
        this.#lockScroll(element);
      }
    }
  }

  /** If the app has rewritten the inline style, its value is put back. */
  #lockScroll(element: HTMLElement): void {
    const property = this.#scrollLockProperty;
    if (!property) return;
    const { style } = element;
    if (
      style.getPropertyValue(property) === 'hidden' &&
      !style.getPropertyPriority(property) &&
      this.#scrollLock.get(element)
    ) {
      return;
    }
    this.#scrollLock.set(element, property, 'hidden');
  }

  /**
   * `pointer-events: none` at or below the smallest snap point, so an
   * invisible (closing) backdrop or a peek's backdrop never blocks the page.
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
   * The backdrop is a pointer convenience, deliberately not focusable or a
   * button: a keyboard closes with Escape or the app's own controls.
   */
  backdropHooks: LifecycleHooks = {
    install: (backdrop) => {
      this.#backdrop = backdrop;
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
   * Tells a tap from a drag when the click arrives. A mouse has no implicit
   * capture, so movement is followed on the document.
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
    this.#backdropListeners = new AbortController();
    const { signal } = this.#backdropListeners;
    document.addEventListener('pointermove', this.#onBackdropPointerMove, {
      capture: true,
      passive: true,
      signal,
    });
    document.addEventListener('pointerup', this.#onBackdropPointerUp, {
      capture: true,
      signal,
    });
    document.addEventListener('pointercancel', this.#onBackdropPointerCancel, {
      capture: true,
      signal,
    });
  };

  #onBackdropPointerMove = (event: PointerEvent): void => {
    if (this.#backdropPointer?.pointerId === event.pointerId) {
      this.#trackBackdropPointer(event.clientX, event.clientY);
    }
  };

  #trackBackdropPointer(x: number, y: number): void {
    const pointer = this.#backdropPointer;
    if (!pointer) return;
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    // NaN (no coordinates) doesn't count as moved.
    if (distance > TAP_SLOP) pointer.moved = true;
  }

  /**
   * Keeps the pointer for its click. A click elsewhere (e.g. a mouse dragged
   * onto the tray) never comes; the next click then ignores the record.
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
    this.#backdropListeners?.abort();
    this.#backdropListeners = undefined;
  }

  #endBackdropPointer(): void {
    this.#removeBackdropListeners();
    this.#backdropPointer = undefined;
  }

  /**
   * A click whose pointer moved isn't a tap. A pointer's click lands where
   * it lifted; any other click (`element.click()`, assistive technology) is.
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
   * Queues `#applyOpen` for the modal behaviour and focus, which must not run
   * during rendering. Runs on every argument change, which covers `@modal`.
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
      // The first known open state is not a change.
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
      // Focus is already inside: return it to where it came from.
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
   * A drawer that opens and closes again before this runs reports neither
   * `@onOpen` nor `@onClose`. The modal behaviour is off inside a closed or
   * closing drawer, so a hidden drawer never keeps the page inert and locked.
   */
  #applyOpen(): void {
    if (this.#destroyed) return;
    const root = this.#root;
    const insideClosed = !!root && this.#hiddenByDrawer(root);
    const modal =
      this.#open && this.isModal && !insideClosed && !this.#openedByFocus;
    const wasModal = this.#releaseModal !== undefined;
    if (modal && !wasModal) {
      this.#activateModal();
    } else if (!modal && wasModal) {
      this.#deactivateModal();
      if (insideClosed && this.#open) this.#moveFocusOutOfClosedDrawer();
    }
    // Before focus returns: a modal drawer inside would keep its target inert.
    this.#applyNested();
    const focusInside = this.#closedWithFocusInside;
    if (focusInside !== undefined) {
      this.#closedWithFocusInside = undefined;
      this.#returnFocusAfterClose(focusInside, wasModal);
    }
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
    const releaseScroll = lockBodyScroll(
      (target) => logicallyContains(tray, target),
      {
        fields: [tray, ...this.#portals],
        transparentStatusBar:
          this.args.transparentStatusBar === true && this.placement !== 'top',
      },
    );
    this.#syncStatusBar();
    // Below the modal drawers inside this one (e.g. a peek that opens under
    // its open nested drawer), which keep Escape and the Tab wrap.
    const nested = modalStack.findIndex((other) =>
      logicallyContains(root, other.#root),
    );
    modalStack.splice(nested === -1 ? modalStack.length : nested, 0, this);
    MobileDrawer.#syncNested();
    syncCloseWatcher();
    document.addEventListener('keydown', this.#onDocumentKeyDown);
    this.#releaseModal = () => {
      document.removeEventListener('keydown', this.#onDocumentKeyDown);
      modalStack.splice(modalStack.indexOf(this), 1);
      MobileDrawer.#syncNested();
      syncCloseWatcher();
      releaseScroll();
      // Not moving: `#render` won't run again to end it.
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
      // The drawer's own focus never moves it: the app chose the snap point.
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
   * The first modal drawer's lock decides, so a nested drawer follows. Stays
   * until the drawer rests without the modal behaviour, so the dim fades out
   * while it closes. Not for an embedded (not `position: fixed`) root.
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

  #endStatusBar(): void {
    if (!this.#statusBar) return;
    this.#statusBar = false;
    this.#root?.removeAttribute('data-status-bar');
    this.#pageDim?.destroy();
    this.#pageDim = undefined;
  }

  /** Leaves focus alone. */
  #deactivateModal(): void {
    const release = this.#releaseModal;
    if (!release) return;
    this.#releaseModal = undefined;
    this.#initialFocused = undefined;
    release();
    if (!this.#destroyed) this.modalActive = false;
  }

  /**
   * The root's parent, or, inside another drawer's tray (also through its
   * `Nested`), the outermost such drawer's parent: a transformed tray is the
   * containing block of the fixed drawers in it, so it would clip.
   */
  #nestedDestination(): Element | undefined {
    let root = this.#root!;
    for (;;) {
      const inner = root;
      const outer = [...mountedDrawers].find(
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
   * Closes the drawers in the `Nested` portals with this drawer: unlike one
   * in the tray, they would else stay on the screen and then vanish. In a
   * microtask: `@onSnapPointChange` must not run during rendering.
   */
  #closePortaled(): void {
    if (this.#portals.size === 0) return;
    queueMicrotask(() => {
      if (this.#destroyed || !this.#hidden) return;
      const root = this.#root!;
      for (const other of mountedDrawers) {
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

  #closestDrawerRoot(): Element | undefined {
    for (
      let node = this.#root ? logicalParent(this.#root) : null;
      node;
      node = logicalParent(node)
    ) {
      if (isDrawerRoot(node)) return node;
    }
    return undefined;
  }

  /**
   * Sets the new `inert` attributes before it releases the old ones, so an
   * element that stays inert never loses it in between.
   */
  #makeOutsideInert(): void {
    const root = this.#root!;
    const release = this.#releaseInert;
    this.#releaseInert = inertOutside(root, ...portalsOf(root));
    release?.();
  }

  /**
   * A portal can be added in an element that is inert already. In a
   * microtask: portals change during rendering.
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
    for (const drawer of modalStack) {
      if (drawer.#releaseInert) drawer.#makeOutsideInert();
    }
    MobileDrawer.#syncNested();
    for (const drawer of mountedDrawers) {
      if (drawer.#portals.size > 0) drawer.#applyNested();
    }
  }

  /** Also in a portal of a drawer nested in it. */
  #contains(node: Node | null | undefined): boolean {
    const root = this.#root;
    return !!root && logicallyContains(root, node);
  }

  #hasFocus(): boolean {
    return this.#contains(document.activeElement);
  }

  /**
   * Runs after the modal behaviour was undone, so the element isn't inert.
   * If it has left the page (e.g. a deleted list item), focus goes into its
   * nearest former ancestor still on the page, but never `<body>`.
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

  #hiddenByDrawer(element: Element): boolean {
    for (const other of mountedDrawers) {
      if (other !== this && other.#hidden && other.#contains(element)) {
        return true;
      }
    }
    return false;
  }

  /**
   * A drawer around this open one closes. Else focus goes to `<body>`, where
   * the outer drawer returns it from. `#returnFocus` is kept, for when this
   * drawer closes after the outer one opens again.
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

  /** `data-nested` on every shown drawer that the front modal one covers. */
  static #syncNested(): void {
    const front = modalStack[modalStack.length - 1];
    const frontRoot = front ? front.#root : undefined;
    for (const drawer of mountedDrawers) {
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

  #applyNested(): void {
    const root = this.#root;
    if (!root) return;
    for (const other of mountedDrawers) {
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
   * `defaultPrevented` is left alone, so only the innermost nested drawer
   * closes. Not during a drag: the release decides where it goes, so the
   * parent never sees a close and a reopen. Still cancelled then, or the
   * `CloseWatcher` would close the drawer.
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    this.#stopMomentum();
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      event.isComposing ||
      !this.#open ||
      this.#destroyed
    ) {
      return;
    }
    event.preventDefault();
    if (!this.#drag) this.close();
  };

  /** Escape with focus outside (e.g. on `<body>`), and the Tab wrap. */
  #onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      modalStack[modalStack.length - 1] !== this ||
      this.#destroyed
    ) {
      return;
    }
    if (event.key === 'Escape') {
      if (event.isComposing || !this.#open) return;
      event.preventDefault();
      if (!this.#drag) this.close();
    } else if (
      event.key === 'Tab' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      this.#trapTab(event);
    }
  };

  /** Only wraps at the ends: the rest of the page is inert anyway. */
  #trapTab(event: KeyboardEvent): void {
    const tray = this.#tray!;
    const items = tabbables(tray);
    const active = document.activeElement;
    const inside = !!active && tray.contains(active);
    const first = items[0];
    const last = items[items.length - 1];
    // The focused element may not be tabbable itself (`tabindex="-1"`).
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
   * Screen px per px of drawer offset: not `1` under a scaled ancestor.
   * Forces layout, so once per drag.
   */
  #screenScale(): number {
    const layout = this.#layout!;
    const rect = this.#tray!.getBoundingClientRect();
    const scale =
      (this.axis === 'vertical' ? rect.height : rect.width) / layout.trayLength;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  #positionOf(data: PanData): number | undefined {
    const position = this.axis === 'vertical' ? data.current.y : data.current.x;
    return Number.isFinite(position) ? position : undefined;
  }

  /**
   * The event's time stamp is when the input happened, also when the main
   * thread was busy. Tests can't set it, so they use the injected clock.
   */
  #timeOf(event: Event | undefined): number {
    const { dragTime } = drawerEnvironment;
    if (dragTime) return dragTime();
    if (this.#clock) return this.#clock.now();
    return event?.timeStamp ?? performance.now();
  }

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

  /** Read when a touch starts, so `#render` keeps it up to date. */
  private trayTouchAction = (): string => {
    if (this.#atTop) return 'pan-x pan-y';
    return this.axis === 'vertical' ? 'pan-x' : 'pan-y';
  };

  /** Once per gesture, after a touch on a moving drawer has held it. */
  private shouldDrag = (movement: number, target: Element | null): boolean => {
    const layout = this.#layout;
    const tray = this.#tray;
    if (this.#inNested(target)) return false;
    if (!layout || !tray) return true;
    if (this.#renderedOffset < layout.maxOffset - EPSILON) return true;
    if (this.#onHandle(target)) return true;
    return !this.#scrollChain(target).some((element) =>
      canScroll(element, this.axis === 'vertical', movement),
    );
  };

  /** Innermost first. A gesture on the header has none. */
  #scrollChain(target: Element | null): HTMLElement[] {
    const tray = this.#tray;
    const scroller = this.#scroller;
    if (!tray || !scroller) return [];
    const chain: HTMLElement[] = [];
    for (
      let element = target instanceof Element ? target : scroller;
      element && tray.contains(element);
      element = element.parentElement!
    ) {
      if (
        element instanceof HTMLElement &&
        (element === scroller || element.hasAttribute(SCROLL_ATTRIBUTE))
      ) {
        chain.push(element);
      }
      if (element === scroller || element === tray) break;
    }
    return chain;
  }

  /**
   * The scroll handoff of a native sheet: a drag takes over a scroll that
   * reaches its scroll start while the finger pulls towards close. Only
   * while the finger is down: momentum never moves the drawer. Before that,
   * `overscroll-behavior: none` near that end, so the content doesn't bounce
   * (iOS) and then jump back when the drag locks it.
   */
  private onTrayScroll = (step: number, target: Element | null): boolean => {
    const layout = this.#layout;
    if (!layout || this.#destroyed || this.#drag || this.#inNested(target)) {
      return false;
    }
    const vertical = this.axis === 'vertical';
    const closing = -OPENING_DIRECTION[this.placement];
    const chain = this.#scrollChain(target);
    for (const element of chain) {
      this.#setOverscroll(element, nearEnd(element, vertical, closing));
    }
    if (Math.sign(step) !== closing || !this.#isHighest(this.#renderedOffset)) {
      return false;
    }
    return !chain.some((element) => canScroll(element, vertical, step));
  };

  private onTrayScrollEnd = (): void => {
    this.#overscroll.restoreAll();
  };

  /** iOS applies a change during a scroll. */
  #setOverscroll(element: HTMLElement, none: boolean): void {
    const property =
      this.axis === 'vertical'
        ? 'overscroll-behavior-y'
        : 'overscroll-behavior-x';
    if (none && this.#overscroll.get(element)?.property === property) return;
    this.#overscroll.restore(element);
    if (none) this.#overscroll.set(element, property, 'none');
  }

  /**
   * Not a nested drawer's handle. A text field in a handle is not part of
   * it, so text selection in it keeps working.
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
   * So the handle's drag source cancels the touchmoves too, also with
   * `@handleOnly`, where the tray isn't a drag source.
   */
  private shouldHandleDrag = (_movement: number, target: Element | null) =>
    this.#onHandle(target);

  /** Its gestures belong to the nested drawer only. */
  #inNested(target: EventTarget | null): boolean {
    const root = this.#root;
    if (!root || !(target instanceof Element) || !root.contains(target)) {
      return false;
    }
    // A mounted drawer's root, not any element with the `mobile-drawer`
    // class (an app element may reuse it).
    for (
      let element: Element | null = target;
      element && element !== root;
      element = element.parentElement
    ) {
      if (isDrawerRoot(element)) return true;
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
   * A touch holds a running animation at once, like native sheets, not only
   * once a pan is recognised. Lifting without a drag resumes it, so taps on
   * content keep working.
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
   * Locks scroll containers added, or rewritten by the app, after the lock,
   * before the browser scrolls them. On the tray itself, so it works with
   * `@handleOnly` and any pointer type.
   */
  #onTrayInput = (event: Event): void => {
    // As in a native scroll view.
    this.#stopMomentumOnInput(event);
    const tray = this.#tray;
    const { target } = event;
    if (!tray || !this.#scrollLockProperty || !(target instanceof Element)) {
      return;
    }
    const between: Element[] = [];
    for (
      let element: Element | null = target;
      element && element !== tray && tray.contains(element);
      element = element.parentElement
    ) {
      between.push(element);
    }
    this.#lockContainers(tray, between);
  };

  /**
   * Keyboard focus on an element that isn't fully visible moves the drawer
   * to its highest snap point: below it the content can't scroll, so this is
   * the only way to show it. From a peek the drawer opens but isn't modal.
   * A tap shows what it focuses, so only keyboard focus, and any focus on a
   * typing field (to show it above the on-screen keyboard). Not the drawer's
   * own initial focus: the app chose that snap point. Visibility is checked
   * at the active snap point, so an opening drawer doesn't move for an
   * element that will show.
   */
  #onTrayFocusIn = (event: FocusEvent): void => {
    const tray = this.#tray;
    const { target, relatedTarget: from } = event;
    // Also inside an open shadow root.
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
    // An app may focus an element as it renders.
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
        // Not modal. A controlled parent that doesn't take the new index in
        // this task doesn't get a non-modal drawer later.
        this.#focusOpenPending = true;
        setTimeout(() => (this.#focusOpenPending = false));
      }
      this.open();
    });
  };

  /**
   * A drawer that focus opened goes back to its peek when focus moves out,
   * but not when it goes nowhere (`relatedTarget` `null`: the window lost
   * focus, or a click on something that can't take it).
   */
  #onRootFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    // Not when only the window lost focus.
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
   * The sheet and root are `overflow: hidden`, but a browser that scrolls a
   * focused element into view scrolls them too, and the tray leaves its
   * edge. Chrome scrolls before the focus events, others after, so this
   * runs both before a focus move and on every `scroll`.
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
   * Where the content can show, in screen px, with the tray moved by
   * `shift`: the tray, the root and the sheet (a floating sheet ends above
   * the root's edge) clip it. A scroll of the root is undone.
   */
  #visibleRange(shift: number, sheetShift = 0): { start: number; end: number } {
    const vertical = this.axis === 'vertical';
    const tray = this.#tray!.getBoundingClientRect();
    const root = this.#root!;
    const rootRect = root.getBoundingClientRect();
    const sheet = this.#sheet!.getBoundingClientRect();
    const scroll = vertical ? root.scrollTop : root.scrollLeft;
    const unscroll = (scroll ? scroll * this.#screenScale() : 0) + sheetShift;
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

  /** Forces layout, so only for focus changes. */
  #isVisibleAt(element: Element, offset: number): boolean {
    const root = this.#root!;
    const sheet = this.#sheet!;
    const vertical = this.axis === 'vertical';
    // Also undoes a scroll of the sheet or the root, which moves the tray
    // and the element alike, but not the root.
    const shift =
      (OPENING_DIRECTION[this.placement] * (offset - this.#renderedOffset) +
        (vertical
          ? root.scrollTop + sheet.scrollTop
          : root.scrollLeft + sheet.scrollLeft)) *
      this.#screenScale();
    const sheetShift =
      ((this.#isFloating() ? this.#sinkOf(offset) : 0) - this.#moved) *
      this.#screenScale();
    const visible = this.#visibleRange(shift, sheetShift);
    const rect = element.getBoundingClientRect();
    const start = (vertical ? rect.top : rect.left) + shift;
    const end = (vertical ? rect.bottom : rect.right) + shift;
    return start >= visible.start - EPSILON && end <= visible.end + EPSILON;
  }

  /**
   * After focus moved the drawer up: the tray was locked, so the browser
   * may not have scrolled the element into view (e.g. `preventScroll`).
   * Side drawers scroll across their axis, which isn't locked.
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
    const header = this.#header;
    if (header) {
      // The header doesn't scroll.
      if (header.contains(element)) return;
      const box = this.#content!.getBoundingClientRect();
      visible.start = Math.max(visible.start, box.top);
      visible.end = Math.min(visible.end, box.bottom);
    }
    const rect = element.getBoundingClientRect();
    // Its start first of all.
    let delta = Math.max(0, rect.bottom - visible.end);
    delta = Math.min(delta, rect.top - visible.start);
    if (Math.abs(delta) <= EPSILON) return;
    this.#scroller!.scrollBy({
      top: delta / this.#screenScale(),
      behavior: 'instant',
    });
  }

  #onTrayTouchStart = (event: TouchEvent): void => {
    this.#stopMomentumOnInput(event);
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
    // A nested drawer's content can scroll.
    if (
      !touch ||
      !this.handleOnly ||
      !this.#scrollLockProperty ||
      this.#inNested(event.target)
    ) {
      return;
    }
    this.#lockedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      far: false,
    };
  };

  /**
   * With `@handleOnly` below the highest snap point nothing else cancels a
   * swipe along the axis on the locked content, and iOS then scrolls the
   * page behind it, whatever `overscroll-behavior` says. Decided as in
   * `dragSource`; never drags.
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

  #listenNested(element: HTMLElement, add: boolean): void {
    if (!add) {
      element.removeEventListener('touchstart', this.#onNestedTouchStart);
      element.removeEventListener('touchmove', this.#onNestedTouchMove);
      element.removeEventListener('touchend', this.#onNestedTouchEnd);
      element.removeEventListener('touchcancel', this.#onNestedTouchEnd);
      element.removeEventListener('wheel', this.#onNestedWheel);
      return;
    }
    element.addEventListener('touchstart', this.#onNestedTouchStart, {
      passive: true,
    });
    element.addEventListener('touchmove', this.#onNestedTouchMove, {
      passive: false,
    });
    element.addEventListener('touchend', this.#onNestedTouchEnd);
    element.addEventListener('touchcancel', this.#onNestedTouchEnd);
    element.addEventListener('wheel', this.#onNestedWheel, { passive: false });
  }

  /** The outermost nested drawer that `target` is in. */
  #nestedRoot(target: EventTarget | null): Element | undefined {
    const root = this.#root;
    let found: Element | undefined;
    for (
      let element = target instanceof Element ? target : null;
      element;
      element = element.parentElement
    ) {
      if (element === root || this.#portals.has(element as HTMLElement)) {
        return found;
      }
      if (isDrawerRoot(element)) found = element;
    }
    return undefined;
  }

  /** `composedPath()`, so elements in an open shadow root count too. */
  #nestedPath(event: Event, root: Element): Element[] {
    const path: Element[] = [];
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      path.push(node);
      if (node === root) break;
    }
    return path;
  }

  #onNestedTouchStart = (event: TouchEvent): void => {
    const current = this.#nestedTouch;
    // A gesture whose touch is gone ended without its touchend reaching
    // this drawer (e.g. its element was removed): start over.
    if (
      current &&
      Array.from(event.touches).some((touch) => touch.identifier === current.id)
    ) {
      return;
    }
    this.#nestedTouch = undefined;
    const touch = event.changedTouches[0];
    const root = this.#nestedRoot(event.target);
    if (!touch || !root) return;
    const scrollers: Element[] = [];
    let own = false;
    for (const element of this.#nestedPath(event, root)) {
      const style = getComputedStyle(element);
      if (handlesOwnGesture(element, style)) {
        own = true;
        break;
      }
      // `hidden` too: a locked scroll container can be unlocked meanwhile.
      if (
        /auto|scroll|hidden/.test(style.overflowX) ||
        /auto|scroll|hidden/.test(style.overflowY)
      ) {
        scrollers.push(element);
      }
    }
    this.#nestedTouch = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      scrollers,
      own,
    };
  };

  /**
   * A gesture in a nested drawer never scrolls this drawer or the page:
   * unless something in the nested drawer can scroll that way, it is
   * cancelled. Else iOS Safari scrolls the nearest ancestor that can, also
   * past `overscroll-behavior: contain` on an element with nothing to scroll
   * or that is locked. Decided once per gesture, as in `dragSource`.
   */
  #onNestedTouchMove = (event: TouchEvent): void => {
    const gesture = this.#nestedTouch;
    if (!gesture || gesture.own || event.touches.length > 1) return;
    const touch = Array.from(event.changedTouches).find(
      (changed) => changed.identifier === gesture.id,
    );
    if (!touch) return;
    if (gesture.cancels === undefined) {
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DECISION_SLOP) return;
      const vertical = Math.abs(dy) >= Math.abs(dx);
      gesture.cancels = !gesture.scrollers.some((element) =>
        canScroll(element, vertical, vertical ? dy : dx),
      );
    }
    if (gesture.cancels && event.cancelable) event.preventDefault();
  };

  #onNestedTouchEnd = (event: TouchEvent): void => {
    const gesture = this.#nestedTouch;
    if (
      gesture &&
      Array.from(event.changedTouches).some(
        (touch) => touch.identifier === gesture.id,
      )
    ) {
      this.#nestedTouch = undefined;
    }
  };

  /** As `#onNestedTouchMove` for a wheel. `ctrlKey` is a pinch-zoom. */
  #onNestedWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || !event.cancelable) return;
    const root = this.#nestedRoot(event.target);
    if (!root) return;
    // `deltaY` > 0 scrolls as a finger moving up does.
    const dx = -event.deltaX;
    const dy = -event.deltaY;
    if (dx === 0 && dy === 0) return;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    if (
      !this.#nestedPath(event, root).some((element) =>
        canScroll(element, vertical, vertical ? dy : dx),
      )
    ) {
      event.preventDefault();
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
      // One drag at a time.
      this.#drag
    ) {
      return;
    }

    // The rendered offset, not the spring's value, which the render clamps.
    spring.stop();
    this.#stopScrollReset();
    this.#stopMomentum();
    this.#endHold();
    const offset = this.#renderedOffset;
    // Anchored at the touchdown the tray would jump by didPan's threshold,
    // so it starts where it is and catches up over the first frames.
    const scale = this.#screenScale();
    const initial = data.initial;
    let down = this.axis === 'vertical' ? initial?.y : initial?.x;
    let recognisedAt =
      (OPENING_DIRECTION[this.placement] * (position - (down ?? NaN))) / scale;
    if (!Number.isFinite(recognisedAt)) {
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
      handoff: data.handoff === true,
      from: data.target ?? null,
      written: 0,
    };
    const { maxOffset } = this.#layout;
    if (
      source === this.#tray &&
      maxOffset > 0 &&
      offset <= maxOffset + EPSILON &&
      !this.#inNested(drag.from) &&
      !this.#onHandle(drag.from)
    ) {
      drag.scrollAt = Math.max(0, maxOffset - offset);
    }
    this.#drag = drag;
    this.#dragCount++;
    // The browser still scrolls a handed-off gesture.
    if (drag.handoff) this.#syncScrollLock();
    this.#velocity.reset();
    this.#scrollVelocity.reset();
    this.#queueState({ isDragging: true });
    this.#follow(drag, drag.lagStart);
    // The finger's velocity, not the catch-up's.
    this.#addVelocity(drag, data);
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
        drag.holding = false;
      } else if (step * lag > 0) {
        // On again, away from the tray: ease the gap from here.
        drag.lagFrom = lag;
        drag.lagStart = now;
        drag.holding = false;
        drag.peak = delta;
      } else {
        const drawn =
          way > 0 ? Math.min(drag.drawn, delta) : Math.max(drag.drawn, delta);
        drag.lagFrom = delta - drawn;
      }
    } else if (
      lag !== 0 &&
      (drag.peak - delta) * way > TURN_SLOP / drag.scale
    ) {
      // Back towards the tray, further than a jitter: the tray holds still
      // until the finger reaches it. Easing on would take it past the finger.
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
    this.#follow(drag, now);
    this.#addVelocity(drag, data);
  };

  /**
   * After resistance, so a release past an end doesn't hand the spring more
   * speed than the tray had, and the catch-up adds none.
   */
  #addVelocity(drag: Drag, data: PanData): void {
    const time = this.#timeOf(data.originalEvent);
    this.#velocity.add(time, drag.target);
    if (drag.scroll) {
      this.#scrollVelocity.add(time, this.#splitDrag(drag, drag.delta)[1]);
    }
  }

  #now(): number {
    return (this.#clock ?? browserClock).now();
  }

  /**
   * While it lags, the tray also moves every frame, so it catches up when
   * the finger holds still. It is never past the finger.
   */
  #follow(drag: Drag, time: number): void {
    const lag = drag.holding
      ? drag.lagFrom
      : catchUpLag(drag.lagFrom, time - drag.lagStart);
    drag.drawn = drag.delta - lag;
    this.#reachContent(drag);
    drag.target = this.#dragOffset(drag, this.#splitDrag(drag, drag.delta)[0]);
    const [tray, scrolled] = this.#splitDrag(drag, drag.drawn);
    drag.offset = lag === 0 ? drag.target : this.#dragOffset(drag, tray);
    this.#writeContentScroll(drag, scrolled);
    this.#render(drag.offset);
    if (lag === 0) {
      this.#cancelCatchUp(drag);
    } else if (drag.frame === undefined) {
      drag.frame = (this.#clock ?? browserClock).requestFrame(
        this.#catchUpFrame,
      );
    }
  }

  /**
   * `[tray, scroll]`. A drag past the highest snap point scrolls the content
   * from script: in iOS Safari a native scroll can't start in a gesture
   * whose touchmoves were cancelled. Back towards close the content scrolls
   * back first. Once the content is reached, the split only depends on
   * `delta`.
   */
  #splitDrag(drag: Drag, delta: number): [number, number] {
    const at = drag.scrollAt;
    const scroll = drag.scroll;
    if (at === undefined || !scroll) return [delta, 0];
    const scrolled = clamp(delta - at, -scroll.back, scroll.room);
    return [delta - scrolled, scrolled];
  }

  /** Reads layout once per drag. */
  #reachContent(drag: Drag): void {
    if (
      drag.scroll !== undefined ||
      drag.scrollAt === undefined ||
      !(drag.drawn > drag.scrollAt)
    ) {
      return;
    }
    drag.scroll = null;
    const vertical = this.axis === 'vertical';
    const sign = -OPENING_DIRECTION[this.placement] as 1 | -1;
    for (const element of this.#scrollChain(drag.from)) {
      if (!(scrollRange(element, vertical) > EPSILON)) continue;
      const style = this.#unlockedStyle(element);
      if (!scrollsAlong(style, vertical)) continue;
      const { min, max, position } = scrollBounds(element, vertical, style);
      const start = clamp(position, min, max);
      const room = sign > 0 ? max - start : start - min;
      if (!(room > EPSILON)) continue;
      drag.scroll = {
        element,
        vertical,
        start,
        sign,
        min,
        max,
        room,
        back: sign > 0 ? start - min : max - start,
      };
      return;
    }
  }

  /** The lock may still be on for this frame, or for a handed-off drag. */
  #unlockedStyle(element: HTMLElement): {
    overflowX: string;
    overflowY: string;
    direction: string;
  } {
    const saved = this.#scrollLock.get(element);
    const { style } = element;
    if (saved) style.setProperty(saved.property, saved.value, saved.priority);
    const { overflowX, overflowY, direction } = getComputedStyle(element);
    if (saved) style.setProperty(saved.property, 'hidden');
    return { overflowX, overflowY, direction };
  }

  /** `instant`, as `#writeScroll`. */
  #writeContentScroll(drag: Drag, scrolled: number): void {
    const scroll = drag.scroll;
    if (!scroll || scrolled === drag.written) return;
    drag.written = scrolled;
    this.#scrollContent(scroll, scroll.start + scroll.sign * scrolled);
  }

  #scrollContent(scroll: ContentScroll, position: number): void {
    scroll.element.scrollTo(
      scroll.vertical
        ? { top: position, behavior: 'instant' }
        : { left: position, behavior: 'instant' },
    );
  }

  /**
   * The content of a drag goes on after the release like a native scroll
   * view, since it was scrolled from script. Any input on the tray stops it.
   */
  #startMomentum(drag: Drag, velocity: number): void {
    const scroll = drag.scroll;
    if (!scroll) return;
    // px/s towards open to scroll px/ms.
    const speed = (scroll.sign * velocity) / 1000;
    if (
      Math.abs(speed) < MIN_MOMENTUM_VELOCITY ||
      (drawerEnvironment.prefersReducedMotion ?? browserPrefersReducedMotion)()
    ) {
      return;
    }
    this.#stopMomentum();
    const token = this.#clock ? undefined : animationWaiter.beginAsync();
    const momentum = new Momentum({
      clock: this.#clock ?? browserClock,
      from: scroll.start + scroll.sign * drag.written,
      velocity: speed,
      min: scroll.min,
      max: scroll.max,
      write: (position) => this.#scrollContent(scroll, position),
      onEnd: () => {
        if (this.#momentum === momentum) this.#momentum = undefined;
        if (token) animationWaiter.endAsync(token);
      },
    });
    this.#momentum = momentum;
  }

  /** Returns whether one was running. */
  #stopMomentum(): boolean {
    const momentum = this.#momentum;
    momentum?.stop();
    return momentum !== undefined;
  }

  /** As in a native scroll view, a tap that stops momentum doesn't click. */
  #swallowClick(): void {
    this.#endSwallowClick();
    const tray = this.#tray;
    if (!tray) return;
    const click = (event: MouseEvent) => {
      this.#endSwallowClick();
      if (event.target instanceof Node && tray.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const release = () => {
      if (this.#clickSwallow) this.#clickSwallow.released = true;
    };
    const timer = setTimeout(() => this.#endSwallowClick(), SWALLOW_CLICK_TIME);
    document.addEventListener('click', click, true);
    document.addEventListener('pointerup', release, CAPTURE_PASSIVE);
    document.addEventListener('touchend', release, CAPTURE_PASSIVE);
    this.#clickSwallow = { click, release, released: false, timer };
  }

  #endSwallowClick(): void {
    const swallow = this.#clickSwallow;
    if (!swallow) return;
    this.#clickSwallow = undefined;
    clearTimeout(swallow.timer);
    document.removeEventListener('click', swallow.click, true);
    document.removeEventListener('pointerup', swallow.release, true);
    document.removeEventListener('touchend', swallow.release, true);
  }

  #stopMomentumOnInput(event: Event): void {
    if (event.type === 'pointerdown' || event.type === 'touchstart') {
      if (this.#clickSwallow?.released) this.#endSwallowClick();
      if (this.#stopMomentum()) this.#swallowClick();
    } else {
      this.#stopMomentum();
    }
  }

  #cancelCatchUp(drag: Drag | undefined): void {
    if (drag?.frame === undefined) return;
    (this.#clock ?? browserClock).cancelFrame(drag.frame);
    drag.frame = undefined;
  }

  /**
   * The clock's time, not the frame's time stamp: input of the same frame is
   * handled after it, so the tray would move back a little.
   */
  #catchUpFrame = (): void => {
    const drag = this.#drag;
    if (!drag || this.#destroyed) return;
    drag.frame = undefined;
    const now = this.#now();
    if (drag.holding && !drag.moved) {
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
    // A cancelled pointer has no meaningful position or velocity.
    const type = data.originalEvent?.type;
    const cancelled = type === 'pointercancel' || type === 'touchcancel';
    if (!cancelled) this.onPan(data, source);
    const drag = this.#endDrag()!;
    const time = this.#timeOf(data.originalEvent);
    // Released while the content scrolls: the tray's velocity from before
    // (in the last samples) would carry it past the snap point.
    const scroll = drag.scroll;
    const scrolling =
      scroll &&
      drag.scrollAt !== undefined &&
      drag.delta >= drag.scrollAt - scroll.back &&
      drag.delta <= drag.scrollAt + scroll.room;
    const velocity = cancelled || scrolling ? 0 : this.#velocity.velocity(time);
    this.#release(drag.offset, velocity, drag.target);
    if (!cancelled && scrolling) {
      this.#startMomentum(drag, this.#scrollVelocity.velocity(time));
    }
  };

  /**
   * Its pointer events won't arrive any more: settle as on `pointercancel`.
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
    if (drag?.handoff) this.#syncScrollLock();
    this.#queueState({ isDragging: false });
    return drag;
  }

  /**
   * Controlled, the drawer heads for the active snap point until the parent
   * passes the new one in: the parent always wins. The spring starts at
   * `offset`, where the tray is; the snap point is picked for `released`,
   * where the finger put it (ahead while the tray catches up).
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
   * In a microtask: the hooks run during rendering, where writing rendered
   * tracked state is an error. Batching keeps it coarse: a run that starts
   * and ends in one task never flips `isAnimating`.
   */
  #queueState(state: PendingState): void {
    const flush = !this.#pendingState;
    this.#pendingState = { ...this.#pendingState, ...state };
    if (!flush) return;

    queueMicrotask(() => {
      const pending = this.#pendingState!;
      this.#pendingState = undefined;
      if (this.#destroyed) return;
      const { isAnimating, progress, isDragging } = pending;
      if (isAnimating !== undefined && isAnimating !== this.isAnimating) {
        this.isAnimating = isAnimating;
      }
      if (progress !== undefined && progress !== this.progress) {
        this.progress = progress;
      }
      if (isDragging !== undefined && isDragging !== this.isDragging) {
        this.isDragging = isDragging;
      }
      if (pending.openSnapPoints) {
        this.openSnapPoints = pending.openSnapPoints;
      }
    });
  }

  <template>
    <div
      class="mobile-drawer"
      data-placement={{this.placement}}
      data-header={{if (has-block "header") ""}}
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
      <div class="mobile-drawer__shadow" aria-hidden="true">
        <div class="mobile-drawer__shadow-edge"></div>
        <div class="mobile-drawer__shadow-clip">
          <div class="mobile-drawer__shadow-body"></div>
        </div>
      </div>
      <div class="mobile-drawer__sheet">
        <div class="mobile-drawer__glass" aria-hidden="true"></div>
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
              onScroll=this.onTrayScroll
              onScrollEnd=this.onTrayScrollEnd
            )
          )}}
        >
          {{#let
            (modifier
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
            as |handle|
          }}
            {{#let
              (hash
                snapTo=this.snapTo
                open=this.open
                close=this.close
                activeSnapPoint=this.activeSnapPoint
                handle=handle
                Grabber=(component
                  Grabber
                  owner=this.grabberOwner
                  handle=handle
                  activeSnapPoint=this.activeSnapPoint
                  openSnapPoints=this.openSnapPoints
                )
                isDragging=this.isDragging
                isAnimating=this.isAnimating
                progress=this.progress
                Nested=(component
                  NestedPortal owner=this.nestedOwner fallback=this.nestedParent
                )
              )
              as |drawer|
            }}
              {{! The header is at the leading edge, in the DOM order too. }}
              {{#if (has-block "header")}}
                {{#if this.headerFirst}}
                  <div class="mobile-drawer__header">
                    {{yield drawer to="header"}}
                  </div>
                {{/if}}
              {{/if}}
              <div class="mobile-drawer__content">
                {{yield drawer}}
              </div>
              {{#if (has-block "header")}}
                {{#unless this.headerFirst}}
                  <div class="mobile-drawer__header">
                    {{yield drawer to="header"}}
                  </div>
                {{/unless}}
              {{/if}}
            {{/let}}
          {{/let}}
        </div>
      </div>
      <div class="mobile-drawer__bar-tint" aria-hidden="true"></div>
    </div>
  </template>
}
