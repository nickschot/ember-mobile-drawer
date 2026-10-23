import { capabilities, setModifierManager } from '@ember/modifier';
import type { ModifierLike } from '@glint/template';

/**
 * A modifier that does nothing, for yielding a modifier that only has an
 * effect in some configurations.
 *
 * @internal
 */
export const noop = setModifierManager(
  () => ({
    capabilities: capabilities('3.22'),
    createModifier() {},
    installModifier() {},
    updateModifier() {},
    destroyModifier() {},
  }),
  {},
) as unknown as ModifierLike<{ Element: HTMLElement }>;
