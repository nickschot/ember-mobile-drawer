import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { MobileDrawer } from '#src/index.ts';

type Placement = 'bottom' | 'top' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

/**
 * Static preview of the base stylesheet's markup contract. It drives the
 * tray transform and backdrop progress by hand, the way <MobileDrawer> will
 * once it has real behaviour.
 */
export default class StylesPreview extends Component {
  @tracked placement: Placement = 'bottom';
  @tracked progress = 0;

  get closed() {
    return this.progress === 0;
  }

  get trayStyle() {
    const offset = 100 - this.progress;
    const transform = {
      bottom: `translate3d(0, ${offset}%, 0)`,
      top: `translate3d(0, -${offset}%, 0)`,
      left: `translate3d(-${offset}%, 0, 0)`,
      right: `translate3d(${offset}%, 0, 0)`,
    }[this.placement];
    return htmlSafe(`transform: ${transform}`);
  }

  get backdropStyle() {
    return htmlSafe(`--mobile-drawer-progress: ${this.progress / 100}`);
  }

  setPlacement = (event: Event) => {
    this.placement = (event.target as HTMLSelectElement).value as Placement;
  };

  setProgress = (event: Event) => {
    this.progress = Number((event.target as HTMLInputElement).value);
  };

  close = () => {
    this.progress = 0;
  };

  <template>
    <fieldset class="styles-preview-controls">
      <legend>Base styles preview</legend>
      <label>
        Placement
        <select {{on "change" this.setPlacement}}>
          {{#each PLACEMENTS as |placement|}}
            <option value={{placement}}>{{placement}}</option>
          {{/each}}
        </select>
      </label>
      <label>
        Open
        <input
          type="range"
          min="0"
          max="100"
          value={{this.progress}}
          {{on "input" this.setProgress}}
        />
      </label>
    </fieldset>

    <MobileDrawer data-placement={{this.placement}} data-closed={{this.closed}}>
      {{! template-lint-disable no-invalid-interactive }}
      <div
        class="mobile-drawer__backdrop"
        style={{this.backdropStyle}}
        {{on "click" this.close}}
      ></div>
      <div class="mobile-drawer__tray" style={{this.trayStyle}}>
        <div class="mobile-drawer__content">
          <div class="styles-preview-content">
            <p>Drawer content ({{this.placement}})</p>
            <button type="button" {{on "click" this.close}}>Close</button>
          </div>
        </div>
      </div>
    </MobileDrawer>
  </template>
}
