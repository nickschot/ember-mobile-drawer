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
 * scrolls under the grabber when the sheet is fully open. The grabber has
 * the `handle` modifier, so a drag on it always moves the sheet, also when
 * the list is scrolled, and `data-mobile-drawer-pinned`, so it stays at the
 * sheet's edge while the list bounces past fully open. It moves with `springPresets.ios`.
 *
 * "Scale the page" turns on the theme's page scale effect: the application
 * template's page element gets `mobile-drawer-theme-ios__page` and
 * `data-mobile-drawer-page`. The drawer must not be inside that element, so
 * it renders at the end of `<body>` with `in-element`.
 *
 * A tap on a place opens a nested sheet with its details, also while the
 * sheet is at 40%. The nested sheet renders with the yielded `Nested`,
 * outside the sheet's tray (the tray would clip it), next to the sheet in
 * the theme wrapper, so it gets the theme too. The sheet behind dims while
 * the nested sheet is open (`data-nested`).
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
  /** The place the nested sheet shows, if it is open. */
  @tracked detail?: string;
  /** The nested sheet's snap point: open while `detail` is set. */
  @tracked detailActive = 0;
  detailSnapPoints: SnapPoint[] = [0, 'content'];

  get isTop() {
    return this.placement === 'top';
  }

  setActive = (index: number) => (this.active = index);

  showDetail = (item: string) => {
    this.detail = item;
    this.detailActive = 1;
  };

  setDetailActive = (index: number) => (this.detailActive = index);

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
              <div
                class="mobile-drawer-theme-ios__grabber"
                data-mobile-drawer-pinned
                {{drawer.handle}}
              ></div>
            {{/unless}}
            <div class="example-ios-title">
              <h3 id="example-ios-title">Find nearby</h3>
              <button type="button" {{on "click" drawer.close}}>Done</button>
            </div>
            <ul class="example-ios-list">
              {{#each ITEMS as |item|}}
                <li>
                  <button
                    type="button"
                    class="example-ios-item"
                    {{on "click" (fn this.showDetail item)}}
                  >{{item}}</button>
                </li>
              {{/each}}
            </ul>
            <drawer.Nested>
              <MobileDrawer
                @snapPoints={{this.detailSnapPoints}}
                @activeSnapPoint={{this.detailActive}}
                @onSnapPointChange={{this.setDetailActive}}
                @spring={{this.spring}}
                class="example-ios-sheet"
                aria-labelledby="example-ios-detail-title"
                as |detail|
              >
                <div
                  class="mobile-drawer-theme-ios__grabber"
                  data-mobile-drawer-pinned
                  {{detail.handle}}
                ></div>
                <div class="example-ios-title">
                  <h3 id="example-ios-detail-title">{{this.detail}}</h3>
                  <button
                    type="button"
                    {{on "click" detail.close}}
                  >Done</button>
                </div>
                <p class="example-ios-detail">
                  A nested sheet, rendered outside the sheet behind it with the
                  yielded Nested component, so it shows also while that sheet is
                  at 40%.
                </p>
              </MobileDrawer>
            </drawer.Nested>
            {{#if this.isTop}}
              <div
                class="mobile-drawer-theme-ios__grabber"
                data-mobile-drawer-pinned
                {{drawer.handle}}
              ></div>
            {{/if}}
          </MobileDrawer>
        </div>
      {{/in-element}}
    {{/if}}
  </template>
}
