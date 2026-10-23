import Component from '@glimmer/component';
import { type SnapPoint } from '../-private/snap-points/index.ts';
import { type LifecycleHooks } from '../-private/lifecycle-modifier.ts';
import type { MobileDrawerApi, Placement } from '../types.ts';
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
         * `close`) only call `@onSnapPointChange`. When omitted, the drawer starts
         * at index `0` and manages its snap point itself.
         */
        activeSnapPoint?: number;
        /**
         * Called with the new index when the drawer wants to move to another snap
         * point (through `snapTo`, `open` or `close`). Not called when
         * `@activeSnapPoint` is changed from outside.
         */
        onSnapPointChange?: (index: number) => void;
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
    #private;
    isAnimating: boolean;
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
    get placement(): Placement;
    get snapPoints(): readonly SnapPoint[];
    get isControlled(): boolean;
    /**
     * The active index into `@snapPoints`. An `@activeSnapPoint` that isn't a
     * valid index (e.g. `@snapPoints` shrank before the parent updated
     * `@activeSnapPoint`) is clamped to the nearest valid index, with a warning
     * in development, rather than throwing during rendering.
     */
    get activeSnapPoint(): number;
    snapTo: (index: number) => void;
    open: () => void;
    close: () => void;
    hooks: LifecycleHooks;
}
//# sourceMappingURL=mobile-drawer.d.ts.map