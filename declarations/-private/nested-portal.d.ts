import Component from '@glimmer/component';
import { type LifecycleHooks } from './lifecycle-modifier.ts';
/** What the drawer that yields `Nested` gives it, see `MobileDrawer`. */
export interface NestedOwner {
    /** Called when the portal element is in the DOM. */
    add(portal: HTMLElement): void;
    /** Called when the portal element is about to be removed. */
    remove(portal: HTMLElement): void;
}
export interface NestedPortalSignature {
    Args: {
        /**
         * Where to render the block. Default: the parent element of the drawer
         * that yields `Nested`.
         */
        destination?: Element | null;
        /** Bound by the drawer. */
        owner: NestedOwner;
        /**
         * Bound by the drawer: the parent element of its root, once the drawer
         * is in the DOM.
         */
        fallback?: Element;
    };
    Blocks: {
        default: [];
    };
}
/**
 * The yielded `Nested` component of `<MobileDrawer>`: renders its block (a
 * nested drawer) outside the drawer's tray, at the end of `@destination`
 * (default: the parent element of the drawer's root, or of the outermost
 * drawer whose tray the drawer is in, see `#nestedDestination`, so the
 * nested drawer gets the same ancestors, such as a theme class), in a
 * `.mobile-drawer-nested` element. The drawer registers that element as a
 * part of its tray (see `nesting.ts`), so the nesting relation stays the
 * same as for a drawer inside the tray.
 *
 * Without `@destination` the block renders once the drawer is in the DOM
 * (a render later): before that, the drawer's parent element isn't known.
 *
 * @internal
 */
export default class NestedPortal extends Component<NestedPortalSignature> {
    #private;
    get destination(): Element | undefined;
    hooks: LifecycleHooks;
}
//# sourceMappingURL=nested-portal.d.ts.map