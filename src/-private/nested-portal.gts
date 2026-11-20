import Component from '@glimmer/component';
import { lifecycle, type LifecycleHooks } from './lifecycle-modifier.ts';

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
    // Bound by the drawer.
    owner: NestedOwner;
    fallback?: Element;
  };
  Blocks: { default: [] };
}

/**
 * The yielded `Nested`: renders a nested drawer outside the tray, which would
 * clip it. Without `@destination` it renders a render later: the drawer's
 * parent element isn't known before that.
 *
 * @internal
 */
export default class NestedPortal extends Component<NestedPortalSignature> {
  #element?: HTMLElement;

  get destination(): Element | undefined {
    return this.args.destination ?? this.args.fallback;
  }

  hooks: LifecycleHooks = {
    install: (element) => {
      this.#element = element;
      this.args.owner.add(element);
    },
    update: () => {},
    destroy: () => {
      if (this.#element) this.args.owner.remove(this.#element);
      this.#element = undefined;
    },
  };

  <template>
    {{#if this.destination}}
      {{#in-element this.destination insertBefore=null}}
        <div class="mobile-drawer-nested" {{lifecycle this.hooks}}>
          {{yield}}
        </div>
      {{/in-element}}
    {{/if}}
  </template>
}
