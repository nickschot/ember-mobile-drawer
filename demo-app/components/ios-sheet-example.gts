import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, springPresets, type SnapPoint } from '#src/index.ts';
import { pageScale } from '../lib/page-scale.ts';

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
 * scrolls under the grabber when the sheet is fully open. It moves with
 * `springPresets.ios`.
 *
 * "Scale the page" turns on the theme's page scale effect: the application
 * template's page element gets `mobile-drawer-theme-ios__page` and
 * `data-mobile-drawer-page`. The drawer must not be inside that element, so
 * it renders at the end of `<body>` with `in-element`.
 */
export default class IosSheetExample extends Component {
  snapPoints: SnapPoint[] = [0, '40%', 'content'];
  spring = springPresets.ios;
  pageScale = pageScale;
  /**
   * Outside the page element, see the class docs. There is no `document`
   * during server-side rendering (FastBoot), so the sheet then renders only
   * in the browser.
   */
  destination = typeof document === 'undefined' ? undefined : document.body;
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

    <label class="example-ios-scale">
      <input
        type="checkbox"
        checked={{this.pageScale.enabled}}
        {{on "change" this.pageScale.setEnabled}}
      />
      Scale the page
    </label>

    {{#if this.destination}}
      {{#in-element this.destination insertBefore=null}}
        <div class="mobile-drawer-theme-ios">
          <MobileDrawer
            @placement={{this.placement}}
            @snapPoints={{this.snapPoints}}
            @activeSnapPoint={{this.active}}
            @onSnapPointChange={{this.setActive}}
            @spring={{this.spring}}
            class="example-ios-sheet
              {{if this.pageScale.enabled 'example-ios-sheet--card'}}"
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
      {{/in-element}}
    {{/if}}
  </template>
}
