import { capabilities, setModifierManager } from '@ember/modifier';
import type { ModifierLike } from '@glint/template';

/** @internal */
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
