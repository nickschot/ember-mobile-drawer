import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import type { ModifierLike } from '@glint/template';

export interface GrabberOwner {
  /** Moves to the next open snap point and returns its index. */
  cycle(): number | undefined;
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
    // Bound by the drawer.
    owner: GrabberOwner;
    handle: ModifierLike<{ Element: HTMLElement }>;
    activeSnapPoint: number;
    /** Indices per open snap point, ascending; empty until measured. */
    openSnapPoints: readonly (readonly number[])[];
  };
}

let ids = 0;

interface Announcement {
  id: number;
  text: string;
  index: number;
  from: number;
  reached: boolean;
  /** The drawer moved on in another way: the text is stale. */
  gone: boolean;
}

/**
 * The yielded `Grabber`: a drag handle `<button>` that moves the drawer to its
 * next open snap point on activation, like the grabber of an iOS sheet.
 *
 * @internal
 */
export default class Grabber extends Component<GrabberSignature> {
  readonly valueId = `mobile-drawer-grabber-${++ids}`;

  /** A new `id` renders a new text node. */
  @tracked announcement?: Announcement;

  /** `dragCount` at the last pointerdown, until its click. */
  #downDrags?: number;

  get label(): string {
    return this.args.label ?? 'Sheet grabber';
  }

  get valueText(): string {
    return this.stateText(this.args.activeSnapPoint);
  }

  /**
   * Shows once the snap point is active (a controlled parent can pass it in
   * later), and goes for good when the drawer moves in another way, so no
   * stale text stays. The flags are untracked: they change only here.
   */
  get announcements(): Announcement[] {
    const announcement = this.announcement;
    if (!announcement || announcement.gone) return [];
    const active = this.args.activeSnapPoint;
    if (active === announcement.index) {
      announcement.reached = true;
      return [announcement];
    }
    if (!announcement.reached && active === announcement.from) return [];
    announcement.gone = true;
    return [];
  }

  /** Else 'Expanded', 'Partly expanded', 'Collapsed' or 'Closed'. */
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
    // A click that ends a drag isn't a tap. Keyboard clicks (`detail` 0) are.
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
