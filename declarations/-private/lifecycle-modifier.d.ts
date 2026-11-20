import type { ModifierLike } from '@glint/template';
export interface LifecycleHooks {
    install(element: HTMLElement): void;
    /** Called when any of the other positional arguments changed. */
    update(): void;
    destroy(): void;
}
/**
 * A minimal modifier, to avoid a runtime dependency on `ember-modifier`:
 * `{{lifecycle this.hooks @foo @bar}}`. The hooks run during rendering, so
 * they must not write tracked state synchronously.
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