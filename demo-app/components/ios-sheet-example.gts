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
];

/**
 * A bottom sheet with the optional iOS theme
 * (`ember-mobile-drawer/themes/ios.css`): the `mobile-drawer-theme-ios`
 * class on an ancestor of the drawer opts in, and
 * `mobile-drawer-theme-ios__grabber` draws the grabber bar.
 */
export default class IosSheetExample extends Component {
  snapPoints: SnapPoint[] = [0, '40%', 'content'];
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>
      Open iOS sheet
    </button>

    <div class="mobile-drawer-theme-ios">
      <MobileDrawer
        @placement="bottom"
        @snapPoints={{this.snapPoints}}
        @activeSnapPoint={{this.active}}
        @onSnapPointChange={{this.setActive}}
        class="example-ios-sheet"
        as |drawer|
      >
        <div class="mobile-drawer-theme-ios__grabber"></div>
        <div class="example-ios-title">
          <h3>Find nearby</h3>
          <button type="button" {{on "click" drawer.close}}>Done</button>
        </div>
        <ul class="example-ios-list">
          {{#each ITEMS as |item|}}
            <li>{{item}}</li>
          {{/each}}
        </ul>
      </MobileDrawer>
    </div>
  </template>
}
