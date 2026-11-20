import Component from '@glimmer/component';
import { type LifecycleHooks } from './lifecycle-modifier.ts';
export interface NestedOwner {
    add(portal: HTMLElement): void;
    remove(portal: HTMLElement): void;
}
export interface NestedPortalSignature {
    Args: {
        /**
         * Where to render the block. Default: the parent element of the drawer
         * that yields `Nested`.
         */
        destination?: Element | null;
        owner: NestedOwner;
        fallback?: Element;
    };
    Blocks: {
        default: [];
    };
}
/**
 * The yielded `Nested`: renders a nested drawer outside the tray, which would
 * clip it. Without `@destination` it renders a render later: the drawer's
 * parent element isn't known before that.
 *
 * @internal
 */
export default class NestedPortal extends Component<NestedPortalSignature> {
    #private;
    get destination(): Element | undefined;
    hooks: LifecycleHooks;
}
//# sourceMappingURL=nested-portal.d.ts.map