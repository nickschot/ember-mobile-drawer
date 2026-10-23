import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { assert, warn } from '@ember/debug';
import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { Spring } from '../-private/spring/spring.ts';
import {
  findSnapPoint,
  resolveSnapPoints,
  rubberBand,
  selectSnapPoint,
  type ResolvedSnapPoint,
  type SnapPoint,
} from '../-private/snap-points/index.ts';
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

/** The subset of `didPan`'s event data the drawer reads. */
interface PanData {
  current: { x: number; y: number };
  originalEvent?: Event;
}

interface Drag {
  /** Offset (px open) the drag started at. */
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
     * instead of anywhere on the tray. Use it when the content scrolls or has
     * its own gestures. Default `false`.
     */
    handleOnly?: boolean;
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
 * with rubber-band resistance past the first and last snap point. On release
 * the finger's velocity is handed to the spring and the snap point nearest
 * to where the release would carry the drawer is picked; a release faster
 * than `FLING_VELOCITY` always moves at least one snap point its way. A drag
 * catches a running animation where it is. With `@handleOnly`, only elements
 * with the yielded `handle` modifier start a drag.
 *
 * The element that drags gets `touch-action: pan-x` (vertical drawers) or
 * `pan-y` (horizontal ones), so the browser doesn't scroll along the
 * drawer's axis while it drags. Scrolling content inside the tray along that
 * axis isn't handled yet; use `@handleOnly` for scrolling content.
 *
 * Renders the markup contract of `ember-mobile-drawer/styles.css`: a
 * `.mobile-drawer` root with a `.mobile-drawer__backdrop` and a
 * `.mobile-drawer__tray`, with the block inside `.mobile-drawer__content`.
 * Attributes are applied to the root element.
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
  #now: () => number = () => performance.now();
  #drag?: Drag;
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
      this.#backdrop = root.querySelector<HTMLElement>(
        ':scope > .mobile-drawer__backdrop',
      )!;
      const { clock } = drawerEnvironment;
      if (clock) this.#now = () => clock.now();
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
    // While dragging, the next pointer event renders with the new layout.
    if (this.#drag) return;

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
    this.#backdrop!.style.setProperty(
      '--mobile-drawer-progress',
      String(this.#progressOf(open)),
    );
    root.toggleAttribute(
      'data-closed',
      open <= 0 && !this.#spring!.isAnimating && !this.#drag,
    );
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

  private onPanStart = (data: PanData): void => {
    const spring = this.#spring;
    const position = this.#positionOf(data);
    if (!spring || !this.#layout || this.#destroyed || position === undefined) {
      return;
    }

    // Catch a running animation where it is on screen: the rendered offset,
    // not the spring's value, which may be past an edge the render clamps.
    spring.stop();
    const offset = this.#renderedOffset;
    // Anchored where didPan recognised the pan (past its threshold), so the
    // drawer doesn't jump by the threshold and then follows 1:1.
    this.#drag = {
      startOffset: offset,
      startPosition: position,
      offset,
      scale: this.#screenScale(),
    };
    this.#velocity.reset();
    this.#velocity.add(this.#now(), offset);
    this.#queueState({ isDragging: true });
    this.#render(offset);
  };

  private onPan = (data: PanData): void => {
    const drag = this.#drag;
    const layout = this.#layout;
    const position = this.#positionOf(data);
    if (!drag || !layout || this.#destroyed || position === undefined) return;

    // Where the finger puts the drawer, before resistance. Its velocity is
    // the release velocity.
    const raw =
      drag.startOffset +
      (OPENING_DIRECTION[this.placement] * (position - drag.startPosition)) /
        drag.scale;
    if (!Number.isFinite(raw)) return;
    this.#velocity.add(this.#now(), raw);

    const { resolved, container } = layout;
    drag.offset = rubberBand(
      raw,
      resolved[0]!.offset,
      resolved[resolved.length - 1]!.offset,
      { dimension: container },
    );
    this.#render(drag.offset);
  };

  private onPanEnd = (data: PanData): void => {
    if (!this.#drag) return;
    // A cancelled pointer (e.g. the browser took over the gesture) has no
    // meaningful position or velocity: settle from where the drawer is.
    const cancelled = data.originalEvent?.type === 'pointercancel';
    if (!cancelled) this.onPan(data);
    const drag = this.#endDrag()!;
    const velocity = cancelled ? 0 : this.#velocity.velocity(this.#now());
    this.#release(drag.offset, velocity);
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
      <div class="mobile-drawer__backdrop"></div>
      <div
        class="mobile-drawer__tray"
        {{(if
          this.handleOnly
          noop
          (modifier
            didPan
            axis=this.axis
            pointerTypes=POINTER_TYPES
            onPanStart=this.onPanStart
            onPan=this.onPan
            onPanEnd=this.onPanEnd
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
                  didPan
                  axis=this.axis
                  pointerTypes=POINTER_TYPES
                  onPanStart=this.onPanStart
                  onPan=this.onPan
                  onPanEnd=this.onPanEnd
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
