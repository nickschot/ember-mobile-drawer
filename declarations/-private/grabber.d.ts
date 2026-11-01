import Component from '@glimmer/component';
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
        handle: ModifierLike<{
            Element: HTMLElement;
        }>;
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
    #private;
    readonly valueId: string;
    /** The last announcement; a new `id` renders a new text node. */
    announcement?: Announcement;
    get label(): string;
    get valueText(): string;
    /**
     * The status text: the last activation's announcement while the drawer is
     * at its snap point. It shows once the snap point is active (a controlled
     * parent can pass it in later), and goes for good when the drawer moves
     * in another way (a drag, the backdrop, Escape, the app), so no stale
     * text stays in the status element. The flags are not tracked: they only
     * change here, as `activeSnapPoint` changes.
     */
    get announcements(): Announcement[];
    /**
     * The text for the snap point at `index`: `@snapPointLabels[index]`, else
     * by its place among the open snap points: `'Expanded'` for the largest,
     * `'Collapsed'` for the smallest (of two or more), `'Partly expanded'`
     * between them, and `'Closed'` for a snap point that isn't open.
     */
    stateText(index: number): string;
    onPointerDown: () => void;
    onClick: (event: MouseEvent) => void;
}
export {};
//# sourceMappingURL=grabber.d.ts.map