import type { TOC } from '@ember/component/template-only';

export interface MobileDrawerSignature {
  Element: HTMLDivElement;
  Blocks: {
    default: [];
  };
}

/**
 * Placeholder for the gesture-enabled drawer. It only renders its block
 * for now; behaviour is added in follow-up issues.
 */
const MobileDrawer: TOC<MobileDrawerSignature> = <template>
  <div class="mobile-drawer" ...attributes>
    {{yield}}
  </div>
</template>;

export default MobileDrawer;
