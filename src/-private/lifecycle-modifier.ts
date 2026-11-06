import { capabilities, setModifierManager } from '@ember/modifier';
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

interface Bucket {
  hooks: LifecycleHooks;
}

interface Arguments {
  positional: readonly unknown[];
}

function consume(args: Arguments): LifecycleHooks {
  // Read every positional argument, so a change to any of them (and only to
  // them) triggers `updateModifier`.
  const [hooks, ...deps] = args.positional;
  void deps;
  return hooks as LifecycleHooks;
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
export const lifecycle = setModifierManager(
  () => ({
    capabilities: capabilities('3.22'),
    createModifier(_definition: unknown, args: Arguments): Bucket {
      return { hooks: args.positional[0] as LifecycleHooks };
    },
    installModifier(bucket: Bucket, element: Element, args: Arguments) {
      bucket.hooks = consume(args);
      bucket.hooks.install(element as HTMLElement);
    },
    updateModifier(bucket: Bucket, args: Arguments) {
      bucket.hooks = consume(args);
      bucket.hooks.update();
    },
    destroyModifier(bucket: Bucket) {
      bucket.hooks.destroy();
    },
  }),
  {},
) as unknown as ModifierLike<{
  Element: HTMLElement;
  Args: { Positional: [hooks: LifecycleHooks, ...deps: unknown[]] };
}>;
