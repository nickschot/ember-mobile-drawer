import { tracked } from '@glimmer/tracking';

/**
 * Whether the iOS example's page scale effect is on. Shared between the
 * example (the toggle) and the application template (the page element).
 */
class PageScale {
  @tracked enabled = false;

  setEnabled = (event: Event) => {
    this.enabled = (event.target as HTMLInputElement).checked;
  };
}

export const pageScale = new PageScale();
