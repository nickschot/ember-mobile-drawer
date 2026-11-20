import Component from '@glimmer/component';
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
        owner: GrabberOwner;
        handle: ModifierLike<{
            Element: HTMLElement;
        }>;
        activeSnapPoint: number;
        /** Indices per open snap point, ascending; empty until measured. */
        openSnapPoints: readonly (readonly number[])[];
    };
}
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
    #private;
    readonly valueId: string;
    /** A new `id` renders a new text node. */
    announcement?: Announcement;
    get label(): string;
    get valueText(): string;
    /**
     * Shows once the snap point is active (a controlled parent can pass it in
     * later), and goes for good when the drawer moves in another way, so no
     * stale text stays. The flags are untracked: they change only here.
     */
    get announcements(): Announcement[];
    /** Else 'Expanded', 'Partly expanded', 'Collapsed' or 'Closed'. */
    stateText(index: number): string;
    onPointerDown: () => void;
    onClick: (event: MouseEvent) => void;
}
export {};
//# sourceMappingURL=grabber.d.ts.map