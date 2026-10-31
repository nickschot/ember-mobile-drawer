import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';

const ITEMS = [
  'Coffee',
  'Restaurants',
  'Groceries',
  'Parking',
  'Petrol stations',
  'Pharmacies',
  'Hotels',
  'Museums',
  'Parks',
  'Cinemas',
  'Bakeries',
  'Libraries',
  'Gyms',
  'Hospitals',
  'Post offices',
  'Banks',
  'Bookshops',
  'Swimming pools',
  'Train stations',
  'Charging stations',
];

type Placement = 'bottom' | 'top';

/**
 * A bottom (or top) sheet with the optional iOS theme
 * (`ember-mobile-drawer/themes/ios.css`): the `mobile-drawer-theme-ios`
 * class on an ancestor of the drawer opts in, and
 * `mobile-drawer-theme-ios__grabber` draws the grabber bar, sticky at the
 * sheet's page-facing edge. The list is longer than the screen, so it
 * scrolls under the grabber when the sheet is fully open.
 */
export default class IosSheetExample extends Component {
  snapPoints: SnapPoint[] = [0, '40%', 'content'];
  @tracked active = 0;
  @tracked placement: Placement = 'bottom';

  get isTop() {
    return this.placement === 'top';
  }

  setActive = (index: number) => (this.active = index);

  open = (placement: Placement) => {
    this.placement = placement;
    this.active = 1;
  };

  <template>
    <button type="button" {{on "click" (fn this.open "bottom")}}>
      Open iOS sheet
    </button>
    <button type="button" {{on "click" (fn this.open "top")}}>
      From the top
    </button>

    <div class="mobile-drawer-theme-ios">
      <MobileDrawer
        @placement={{this.placement}}
        @snapPoints={{this.snapPoints}}
        @activeSnapPoint={{this.active}}
        @onSnapPointChange={{this.setActive}}
        class="example-ios-sheet"
        aria-labelledby="example-ios-title"
        as |drawer|
      >
        {{#unless this.isTop}}
          <div class="mobile-drawer-theme-ios__grabber"></div>
        {{/unless}}
        <div class="example-ios-title">
          <h3 id="example-ios-title">Find nearby</h3>
          <button type="button" {{on "click" drawer.close}}>Done</button>
        </div>
        <ul class="example-ios-list">
          {{#each ITEMS as |item|}}
            <li>{{item}}</li>
          {{/each}}
        </ul>
        {{#if this.isTop}}
          <div class="mobile-drawer-theme-ios__grabber"></div>
        {{/if}}
      </MobileDrawer>
    </div>
  </template>
}
