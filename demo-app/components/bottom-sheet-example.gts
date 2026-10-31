import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';

const ITEMS = Array.from({ length: 30 }, (_, index) => ({
  title: `Place ${index + 1}`,
  detail: `${((index + 1) * 0.3).toFixed(1)} km away`,
}));

/**
 * A bottom sheet with a long, scrollable list: half open, then as tall as
 * its content allows (capped at 90% of the viewport by the demo CSS, so the
 * whole list can be scrolled into view at the last snap point).
 *
 * The whole sheet drags. Below the last snap point dragging up expands it;
 * at the last snap point the list scrolls, and with the list at its top
 * dragging down closes the sheet. The tray is the scroll container, so the
 * list needs no `data-mobile-drawer-scroll`.
 */
export default class BottomSheetExample extends Component {
  snapPoints: SnapPoint[] = [0, '50%', 'content'];
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>
      Open bottom sheet
    </button>

    <MobileDrawer
      @placement="bottom"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      class="demo-drawer example-sheet"
      aria-labelledby="example-sheet-title"
      as |drawer|
    >
      <div class="example-sheet-header">
        <div class="demo-grabber"></div>
        <div class="example-sheet-title">
          <h3 id="example-sheet-title">Nearby</h3>
          <button type="button" {{on "click" drawer.close}}>Close</button>
        </div>
      </div>
      <ul class="example-list">
        {{#each ITEMS as |item|}}
          <li>
            <strong>{{item.title}}</strong>
            <span>{{item.detail}}</span>
          </li>
        {{/each}}
      </ul>
    </MobileDrawer>
  </template>
}
