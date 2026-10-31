import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { assert, warn } from '@ember/debug';
import { Spring, type FrameClock } from '../-private/spring/spring.ts';
import {
  dragOffset,
  findSnapPoint,
  resolveSnapPoints,
  selectSnapPoint,
  type ResolvedSnapPoint,
  type SnapPoint,
} from '../-private/snap-points/index.ts';
import { dragSource, type PanData } from '../-private/gesture/drag-source.ts';
import { drawerEnvironment } from '../-private/environment.ts';
import {
  lifecycle,
  type LifecycleHooks,
} from '../-private/lifecycle-modifier.ts';
import { noop } from '../-private/noop-modifier.ts';
import { VelocityTracker } from '../-private/gesture/velocity.ts';

import type { MobileDrawerApi, Placement } from '../types.ts';

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
 * Rubber-band dimension (px) past the largest snap point: the most the tray
 * can be pulled past fully open. Small, because the tray then leaves its
 * edge and the backdrop shows in the gap. Past the smallest snap point the
 * container size is used.
 */
const OPEN_RUBBER_BAND = 24;

/**
 * Marks an element inside the tray as a scroll container for scroll vs drag
 * handling. The tray itself always is one.
 */
const SCROLL_ATTRIBUTE = 'data-mobile-drawer-scroll';

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
  /** Pointer coordinate along the drawer axis where the drag started. */
  startPosition: number;
  /** Screen px per px of drawer offset, see `#screenScale`. */
  scale: number;
  /** Rendered offset, after rubber-banding. */
  offset: number;
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
     * gestures, or should always scroll natively. Without it, scrollable
     * content (the tray and elements marked `data-mobile-drawer-scroll`)
     * scrolls at the highest snap point and drags elsewhere, see the class
     * docs. Default `false`.
     */
    handleOnly?: boolean;
    /**
     * Whether to render the backdrop behind the tray. Without it nothing
     * covers the page, so the page stays interactive while the drawer is
     * open. Default `true`.
     */
    backdrop?: boolean;
    /**
     * Whether a tap (or click) on the backdrop closes the drawer, like
     * `close`: to the smallest snap point, through `@onSnapPointChange` when
     * controlled. A pointer that moves more than a few px before it lifts
     * isn't a tap. Default `true`.
     */
    closeOnBackdropClick?: boolean;
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
 * with rubber-band resistance past the first and last snap point (stiff past
 * the last one: at most `OPEN_RUBBER_BAND` px). On release the drawer's
 * velocity is handed to the spring and the snap point nearest to where the
 * release would carry the drawer is picked; a release faster than
 * `FLING_VELOCITY` always moves at least one snap point its way. A touch
 * holds a running animation where it is, and a drag continues from there.
 * With `@handleOnly`, only elements with the yielded `handle` modifier start
 * a drag. One finger drags at a time.
 *
 * Scroll vs drag: the tray is a scroll container, as is every element in it
 * marked with `data-mobile-drawer-scroll`. Each touch gesture is decided
 * once the finger has moved a few px along the axis, and further along it
 * than across it (see `dragSource`), and keeps that decision until the
 * finger lifts:
 * - below the highest snap point every gesture along the axis drags;
 * - at the highest snap point a gesture scrolls if a scroll container
 *   between the touched element and the tray (inclusive) can scroll the way
 *   the finger pushes the content, and drags otherwise. So at the start of
 *   the content, pulling a bottom drawer down closes it.
 * The tray gets `touch-action: pan-x` (vertical drawers) or `pan-y`
 * (horizontal ones) while it is below the highest snap point, so the
 * browser never scrolls along the axis there, and `pan-x pan-y` at the
 * highest snap point, where a drag cancels its `touchmove` events instead
 * (see `dragSource`). Below the highest snap point touchmoves are never
 * cancelled, so swipes across the axis (a carousel, a list in a side
 * drawer) always work. Handles always drag and keep `didPan`'s
 * `touch-action`.
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` (unless
 * `@backdrop={{false}}`) and a `.mobile-drawer__tray`, with the block inside
 * `.mobile-drawer__content`. Attributes are applied to the root element.
 *
 * Backdrop: its opacity follows the drawer frame by frame through
 * `--mobile-drawer-progress`, written in `#render` like the transform. A tap
 * on it calls `close` (unless `@closeOnBackdropClick={{false}}`); a pointer
 * that moved more than `TAP_SLOP` isn't a tap. The backdrop
 * is not a drag source: touching it doesn't hold a running animation, and
 * a drag on it doesn't move the drawer.
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

  /**
   * The snap point when uncontrolled. Not tracked (see `uncontrolledVersion`)
   * because it is also written during rendering, to remember the last
   * controlled index: dropping `@activeSnapPoint` keeps the drawer where it
   * is.
   */
  #uncontrolledSnapPoint = 0;
  #lastWarning?: string;

  #root?: HTMLElement;
  #tray?: HTMLElement;
  #backdrop?: HTMLElement;
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
   * Whether the tray was at (or past) the highest snap point at the last
   * render, i.e. whether its content may scroll. See `#trayTouchAction`.
   */
  #atTop = false;
  /** Backdrop progress written by the last `#render`, see `#paintBackdrop`. */
  #backdropProgress = 0;
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

  get showBackdrop(): boolean {
    return this.args.backdrop !== false;
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
      this.#tray = root.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__tray',
      )!;
      const { clock } = drawerEnvironment;
      this.#clock = clock;
      this.#spring = new Spring({
        clock,
        prefersReducedMotion: drawerEnvironment.prefersReducedMotion,
        onUpdate: ({ value }) => this.#render(value),
      });
      this.#placement = this.placement;
      this.#measure();
      // Appear at the initial snap point without animating in.
      this.#moveToActive(false);

      if (typeof ResizeObserver !== 'undefined') {
        this.#resizeObserver = new ResizeObserver(() => this.#onResize());
        this.#resizeObserver.observe(root);
        this.#resizeObserver.observe(
          root.querySelector(':scope > * > .mobile-drawer__content')!,
        );
      }
    },

    update: () => {
      const placementChanged = this.placement !== this.#placement;
      this.#placement = this.placement;
      this.#measure();
      if (this.#drag) {
        // The finger wins until it lets go; the release then picks a snap
        // point (and asks the parent, when controlled). A new placement is a
        // new axis, so that drag is over.
        if (!placementChanged) return;
        this.#endDrag();
      }
      // A new placement is a different layout: jump instead of animating
      // along the new axis from the old position.
      this.#moveToActive(!placementChanged);
    },

    destroy: () => {
      this.#destroyed = true;
      this.#endHold();
      this.#endBackdropPointer();
      this.#resizeObserver?.disconnect();
      this.#spring?.stop();
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
    if (!spring || !this.#layout || this.#destroyed || this.#drag) return;

    const target = this.#offsetOf(index);
    this.#queueState({ progress: this.#progressOf(target) });
    spring.retarget(target);

    if (!animate) {
      spring.stop();
      spring.set(target, 0);
      this.#render(target);
      this.#queueState({ isAnimating: false });
      return;
    }

    if (spring.isAnimating) return; // Retargeted; the run continues.

    void spring.start().then(() => {
      if (!spring.isAnimating) this.#queueState({ isAnimating: false });
    });
    // With reduced motion the run ends synchronously.
    this.#queueState({ isAnimating: spring.isAnimating });
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

    const target = this.#offsetOf(this.activeSnapPoint);
    this.#queueState({ progress: this.#progressOf(target) });

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
    const open = clamp(offset, 0, max);
    if (!this.#drag) {
      this.#overshoot = clamp(open - layout.trayLength, 0, this.#overshoot);
    }
    this.#renderedOffset = open;
    const distance = layout.trayLength - open;
    const transform = {
      bottom: `translate3d(0, ${distance}px, 0)`,
      top: `translate3d(0, ${-distance}px, 0)`,
      left: `translate3d(${-distance}px, 0, 0)`,
      right: `translate3d(${distance}px, 0, 0)`,
    }[this.placement];

    this.#tray!.style.transform = transform;
    const atTop = open >= layout.maxOffset - EPSILON;
    if (atTop !== this.#atTop) {
      this.#atTop = atTop;
      // Only while the tray is a drag source (not with @handleOnly).
      if (this.#tray!.style.touchAction) {
        this.#tray!.style.touchAction = this.trayTouchAction();
      }
    }
    this.#backdropProgress = this.#progressOf(open);
    this.#paintBackdrop();
    root.toggleAttribute(
      'data-closed',
      open <= 0 && !this.#spring!.isAnimating && !this.#drag,
    );
  }

  /**
   * Writes the progress of the last render on the backdrop, if there is one:
   * `--mobile-drawer-progress` for its opacity, and `pointer-events: none`
   * at progress 0, so an invisible backdrop (e.g. while the drawer closes,
   * before `data-closed` hides it) never blocks the page.
   */
  #paintBackdrop(): void {
    const backdrop = this.#backdrop;
    if (!backdrop) return;
    const progress = this.#backdropProgress;
    backdrop.style.setProperty('--mobile-drawer-progress', String(progress));
    const pointerEvents = progress > 0 ? '' : 'none';
    if (backdrop.style.pointerEvents !== pointerEvents) {
      backdrop.style.pointerEvents = pointerEvents;
    }
  }

  /**
   * The backdrop is optional (`@backdrop`), so it registers itself. It is a
   * pointer convenience and deliberately not focusable or a button: a
   * keyboard closes the drawer through the app's own controls (and Escape
   * once modal drawers land), so its listeners are added here rather than
   * with `{{on}}`.
   */
  backdropHooks: LifecycleHooks = {
    install: (backdrop) => {
      this.#backdrop = backdrop;
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
    if (this.#clock) return this.#clock.now();
    return event?.timeStamp ?? performance.now();
  }

  /**
   * Where the drag puts the drawer after the finger moved `delta` px (in
   * drawer px, positive opens) since the drag started: 1:1 inside the snap
   * range and back towards it, rubber-banded outside it (stiff past fully
   * open, see `OPEN_RUBBER_BAND`). See `dragOffset`.
   */
  #dragOffset(drag: Drag, delta: number): number {
    const { resolved, container } = this.#layout!;
    return dragOffset(
      drag.startOffset,
      delta,
      resolved[0]!.offset,
      resolved[resolved.length - 1]!.offset,
      {
        below: { dimension: container },
        above: { dimension: OPEN_RUBBER_BAND },
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
   * the class docs). Called once per gesture, after a touch on a moving
   * drawer has held it.
   */
  private shouldDrag = (movement: number, target: Element | null): boolean => {
    const layout = this.#layout;
    const tray = this.#tray;
    if (!layout || !tray) return true;
    if (this.#renderedOffset < layout.maxOffset - EPSILON) return true;
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
   * A touch on a drag source holds a running animation right away, like
   * native sheets, instead of only once a pan is recognised (past didPan's
   * threshold). If no drag starts, lifting the finger resumes the animation,
   * so taps on content keep working.
   */
  private onPointerDown = (event: PointerEvent): void => {
    const spring = this.#spring;
    if (!spring?.isAnimating || this.#drag || this.#hold || this.#destroyed) {
      return;
    }
    spring.stop();
    const end = (up: PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      this.#endHold();
      this.#moveToActive(true);
    };
    this.#hold = { pointerId: event.pointerId, end };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
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
    this.#endHold();
    const offset = this.#renderedOffset;
    // Anchored where didPan recognised the pan (past its threshold), so the
    // drawer doesn't jump by the threshold and then follows 1:1. Anchored on
    // the offset shown, also when that is past an end (`dragOffset`).
    this.#drag = {
      source,
      startOffset: offset,
      startPosition: position,
      offset,
      scale: this.#screenScale(),
    };
    this.#velocity.reset();
    this.#velocity.add(this.#timeOf(data.originalEvent), offset);
    this.#queueState({ isDragging: true });
    this.#render(offset);
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

    // How far the finger moved since the drag started, in drawer px.
    const delta =
      (OPENING_DIRECTION[this.placement] * (position - drag.startPosition)) /
      drag.scale;
    if (!Number.isFinite(delta)) return;

    drag.offset = this.#dragOffset(drag, delta);
    // The velocity of the drawer as shown (after resistance), so a release
    // past an end doesn't hand the spring more speed than the tray had.
    this.#velocity.add(this.#timeOf(data.originalEvent), drag.offset);
    this.#render(drag.offset);
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
    this.#release(drag.offset, velocity);
  };

  /**
   * The pan modifier of `source` was torn down (its element removed, or
   * `@handleOnly` changed). If it owned the drag, its pointer events won't
   * arrive any more: settle from where the drawer is, as on `pointercancel`.
   * Teardown happens during rendering, so the release waits for a microtask.
   */
  private onDragSourceTeardown = (source: HTMLElement): void => {
    if (this.#drag?.source !== source) return;
    const drag = this.#endDrag()!;
    queueMicrotask(() => {
      if (!this.#destroyed && !this.#drag) this.#release(drag.offset, 0);
    });
  };

  #endDrag(): Drag | undefined {
    const drag = this.#drag;
    this.#drag = undefined;
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
   */
  #release(offset: number, velocity: number): void {
    const spring = this.#spring;
    const layout = this.#layout;
    if (!spring || !layout || this.#destroyed) return;

    const target = selectSnapPoint(layout.resolved, offset, velocity, {
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
      ...attributes
      {{lifecycle
        this.hooks
        this.placement
        this.snapPoints
        this.activeSnapPoint
      }}
    >
      {{#if this.showBackdrop}}
        <div
          class="mobile-drawer__backdrop"
          {{lifecycle this.backdropHooks}}
        ></div>
      {{/if}}
      <div
        class="mobile-drawer__tray"
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
              handle=(if
                this.handleOnly
                (modifier
                  dragSource
                  axis=this.axis
                  pointerTypes=POINTER_TYPES
                  onPointerDown=this.onPointerDown
                  onPanStart=this.onPanStart
                  onPan=this.onPan
                  onPanEnd=this.onPanEnd
                  onTeardown=this.onDragSourceTeardown
                )
                noop
              )
              isDragging=this.isDragging
              isAnimating=this.isAnimating
              progress=this.progress
            )
          }}
        </div>
      </div>
    </div>
  </template>
}
