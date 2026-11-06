import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import type { ModifierLike } from '@glint/template';

/** What the drawer that yields `Grabber` gives it, see `MobileDrawer`. */
export interface GrabberOwner {
  /**
   * Moves the drawer to the next open snap point (see `MobileDrawer`'s
   * `#cycle`) and returns its index, or `undefined` when there is nothing
   * to move to.
   */
  cycle(): number | undefined;
  /** How many drags the drawer started so far. */
  dragCount(): number;
}

export interface GrabberSignature {
  Element: HTMLButtonElement;
  Args: {
    /** The accessible name. Default `'Sheet grabber'`. */
    label?: string;
    /**
     * Text for each snap point, indexed like `@snapPoints`: what a screen
     * reader says the drawer is at. Missing entries get the default (see
     * `stateText`).
     */
    snapPointLabels?: readonly (string | undefined)[];
    /** Bound by the drawer. */
    owner: GrabberOwner;
    /** Bound by the drawer: its `handle` modifier. */
    handle: ModifierLike<{ Element: HTMLElement }>;
    /** Bound by the drawer: its active snap point. */
    activeSnapPoint: number;
    /**
     * Bound by the drawer: the indices of the open snap points (offset above
     * `0`), one entry per resolved snap point, ascending by offset. Empty
     * before the drawer is measured.
     */
    openSnapPoints: readonly (readonly number[])[];
  };
}

let ids = 0;

/** An activation's announcement, see `Grabber#announcements`. */
interface Announcement {
  id: number;
  text: string;
  /** The snap point the activation moves to. */
  index: number;
  /** The active snap point at the activation. */
  from: number;
  /** Whether the drawer got to `index` (its snap point became active). */
  reached: boolean;
  /** Whether the drawer moved on in another way: the text is stale. */
  gone: boolean;
}

/**
 * The yielded `Grabber` component of `<MobileDrawer>`: a `<button>` that is
 * a drag handle (the drawer's `handle` modifier) and, on a tap, a click,
 * Enter or Space, moves the drawer to its next open snap point, like the
 * grabber of an iOS sheet. Its accessible description is the snap point the
 * drawer is at, and a status element after the button announces the new
 * snap point after an activation. A click that ends a drag is ignored.
 *
 * @internal
 */
export default class Grabber extends Component<GrabberSignature> {
  readonly valueId = `mobile-drawer-grabber-${++ids}`;

  /** The last announcement; a new `id` renders a new text node. */
  @tracked announcement?: Announcement;

  /** `dragCount` at the last pointerdown on the button, until its click. */
  #downDrags?: number;

  get label(): string {
    return this.args.label ?? 'Sheet grabber';
  }

  get valueText(): string {
    return this.stateText(this.args.activeSnapPoint);
  }

  /**
   * The status text: the last activation's announcement while the drawer is
   * at its snap point. It shows once the snap point is active (a controlled
   * parent can pass it in later), and goes for good when the drawer moves
   * in another way (a drag, the backdrop, Escape, the app), so no stale
   * text stays in the status element. The flags are not tracked: they only
   * change here, as `activeSnapPoint` changes.
   */
  get announcements(): Announcement[] {
    const announcement = this.announcement;
    if (!announcement || announcement.gone) return [];
    const active = this.args.activeSnapPoint;
    if (active === announcement.index) {
      announcement.reached = true;
      return [announcement];
    }
    // Not there yet: wait while the drawer is still where it was.
    if (!announcement.reached && active === announcement.from) return [];
    announcement.gone = true;
    return [];
  }

  /**
   * The text for the snap point at `index`: `@snapPointLabels[index]`, else
   * by its place among the open snap points: `'Expanded'` for the largest,
   * `'Collapsed'` for the smallest (of two or more), `'Partly expanded'`
   * between them, and `'Closed'` for a snap point that isn't open.
   */
  stateText(index: number): string {
    const custom = this.args.snapPointLabels?.[index];
    if (custom !== undefined) return custom;
    const open = this.args.openSnapPoints;
    const rank = open.findIndex((indices) => indices.includes(index));
    if (rank === -1) return 'Closed';
    if (rank === open.length - 1) return 'Expanded';
    if (rank === 0) return 'Collapsed';
    return 'Partly expanded';
  }

  onPointerDown = (): void => {
    this.#downDrags = this.args.owner.dragCount();
  };

  onClick = (event: MouseEvent): void => {
    const down = this.#downDrags;
    this.#downDrags = undefined;
    // A pointer that dragged the drawer since it went down on the button
    // isn't a tap. Keyboard clicks (`detail` 0) always count.
    if (
      event.detail !== 0 &&
      down !== undefined &&
      down !== this.args.owner.dragCount()
    ) {
      return;
    }
    const from = this.args.activeSnapPoint;
    const index = this.args.owner.cycle();
    if (index === undefined) return;
    this.announcement = {
      id: (this.announcement?.id ?? 0) + 1,
      index,
      from,
      reached: false,
      gone: false,
      text: this.stateText(index),
    };
  };

  <template>
    {{! The pointerdown only records the drag count; the action is on click. }}
    {{! template-lint-disable no-pointer-down-event-binding }}
    <button
      type="button"
      aria-label={{this.label}}
      aria-describedby={{this.valueId}}
      data-mobile-drawer-grabber
      ...attributes
      {{@handle}}
      {{on "pointerdown" this.onPointerDown}}
      {{on "click" this.onClick}}
    ><span
        id={{this.valueId}}
        class="mobile-drawer__visually-hidden"
      >{{this.valueText}}</span></button>
    <span
      class="mobile-drawer__visually-hidden"
      role="status"
      data-mobile-drawer-grabber-status
    >{{#each
        this.announcements key="id"
        as |announcement|
      }}{{announcement.text}}{{/each}}</span>
  </template>
}
