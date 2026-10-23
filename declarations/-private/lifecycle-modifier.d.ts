import type { ModifierLike } from '@glint/template';
/** Callbacks for {@link lifecycle}. */
export interface LifecycleHooks {
    /** Called once the element is in the DOM. */
    install(element: HTMLElement): void;
    /** Called when any of the other positional arguments changed. */
    update(): void;
    /** Called when the element is about to be removed. */
    destroy(): void;
}
/**
 * A minimal element modifier with install/update/destroy hooks, so the addon
 * doesn't need a runtime dependency on `ember-modifier`:
 *
 * ```hbs
 * <div {{lifecycle this.hooks @foo @bar}}></div>
 * ```
 *
 * `update` runs when `@foo` or `@bar` (or anything tracked that `install` or
 * `update` read) changes. The hooks run during rendering, so they must not
 * write tracked state synchronously.
 *
 * @internal
 */
export declare const lifecycle: ModifierLike<{
    Element: HTMLElement;
    Args: {
        Positional: [hooks: LifecycleHooks, ...deps: unknown[]];
    };
}>;
//# sourceMappingURL=lifecycle-modifier.d.ts.map