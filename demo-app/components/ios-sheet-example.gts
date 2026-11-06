import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type { TOC } from '@ember/component/template-only';
import {
  MobileDrawer,
  springPresets,
  type SnapPoint,
  type MobileDrawerSpring,
} from '#src/index.ts';
import { statusBar } from '../lib/status-bar.ts';
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

/** The rows of the nested detail sheet: enough to scroll it. */
const DETAILS = [
  'Monday: 8:00 to 18:00',
  'Tuesday: 8:00 to 18:00',
  'Wednesday: 8:00 to 18:00',
  'Thursday: 8:00 to 21:00',
  'Friday: 8:00 to 21:00',
  'Saturday: 9:00 to 17:00',
  'Sunday: closed',
  'Address: 1 Main Street',
  'Phone: 555 0100',
  'Wheelchair access: yes',
  'Parking: 20 places',
  'Card payment: yes',
  'Wi-Fi: free',
  'Rating: 4.5 of 5',
  'Reviews: 128',
  'Price level: medium',
  'Opened: 1998',
  'Toilets: yes',
  'Baby changing: yes',
  'Outdoor seating: no',
  'Pets: allowed',
  'Takeaway: yes',
  'Delivery: yes',
  'Bike parking: yes',
  'Last update: today',
];

type Placement = 'bottom' | 'top';

interface DetailSheetSignature {
  Args: {
    title?: string;
    snapPoints: SnapPoint[];
    active: number;
    onChange: (index: number) => void;
    spring: MobileDrawerSpring;
  };
}

/**
 * The nested detail sheet: snap points [0, '50%', 'content']. It opens at
 * 50%; dragged up to full height, its list scrolls (#119).
 */
const DetailSheet: TOC<DetailSheetSignature> = <template>
  <MobileDrawer
    @transparentStatusBar={{statusBar.transparent}}
    @snapPoints={{@snapPoints}}
    @activeSnapPoint={{@active}}
    @onSnapPointChange={{@onChange}}
    @spring={{@spring}}
    class="example-ios-sheet example-ios-detail-sheet"
    aria-labelledby="example-ios-detail-title"
    as |detail|
  >
    <div
      class="mobile-drawer-theme-ios__grabber"
      data-mobile-drawer-pinned
      {{detail.handle}}
    ></div>
    <div class="example-ios-title">
      <h3 id="example-ios-detail-title">{{@title}}</h3>
      <button type="button" {{on "click" detail.close}}>Done</button>
    </div>
    <p class="example-ios-detail">
      A nested sheet. Drag it to full height, then scroll its list: the sheet
      behind doesn't scroll.
    </p>
    <ul class="example-ios-list">
      {{#each DETAILS as |row|}}
        <li class="example-ios-row">{{row}}</li>
      {{/each}}
    </ul>
  </MobileDrawer>
</template>;

/**
 * A bottom (or top) sheet with the optional iOS theme
 * (`ember-mobile-drawer/themes/ios.css`): the `mobile-drawer-theme-ios`
 * class on an ancestor of the drawer opts in, and
 * `mobile-drawer-theme-ios__grabber` draws the grabber bar, sticky at the
 * sheet's page-facing edge. The grabber is in the `header` block (the
 * header mode): it stays out of the scroll, so the list scrolls under it
 * when the sheet is fully open, and bounces at its start under a grabber
 * that doesn't move, as in a native iOS sheet. For a top sheet the header
 * goes last by itself. The grabber is the yielded `Grabber`: a button that
 * is a drag handle, so a drag on it always moves the sheet, also when the
 * list is scrolled, and a tap (or Enter or Space) moves the sheet between
 * 40% and full height, as on iOS. The nested sheet has no header: its
 * grabber stays a
 * sticky `<div>` with the `handle` modifier in the content (the classic
 * mode), with `data-mobile-drawer-pinned`, so it stays at the sheet's edge
 * while the content bounces past fully open. It moves with
 * `springPresets.ios`.
 *
 * "Scale the page" turns on the theme's page scale effect: the application
 * template's page element gets `mobile-drawer-theme-ios__page` and
 * `data-mobile-drawer-page`. The drawer must not be inside that element, so
 * it renders at the end of `<body>` with `in-element`.
 *
 * The search field opens the on-screen keyboard, also at 40%: the sheet
 * then goes on behind the keyboard, as a native sheet does.
 *
 * A tap on a place opens a nested sheet with its details, also while the
 * sheet is at 40%. The nested sheet renders with the yielded `Nested`,
 * outside the sheet's tray (the tray would clip it), next to the sheet in
 * the theme wrapper, so it gets the theme too. The sheet behind dims while
 * the nested sheet is open (`data-nested`). Its list scrolls at full
 * height, so a device can check that a scroll in it never scrolls the sheet
 * behind (#119). "Detail sheet in the tray" renders the nested sheet
 * directly in the sheet's tray instead (without `Nested`), the other way
 * to nest a drawer; open the sheet to full height first, as the tray clips
 * it (#118).
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
  detailSnapPoints: SnapPoint[] = [0, '50%', 'content'];
  /** Render the nested sheet in the tray, not in `Nested`. */
  @tracked detailInTray = false;

  setDetailInTray = (event: Event) => {
    this.detailInTray = (event.target as HTMLInputElement).checked;
  };

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
    <label class="example-ios-scale">
      <input
        type="checkbox"
        checked={{this.detailInTray}}
        {{on "change" this.setDetailInTray}}
      />
      Detail sheet in the tray
    </label>

    {{#if this.destination}}
      {{#in-element this.destination insertBefore=null}}
        <div class="mobile-drawer-theme-ios">
          <MobileDrawer
            @transparentStatusBar={{statusBar.transparent}}
            @placement={{this.placement}}
            @snapPoints={{this.snapPoints}}
            @activeSnapPoint={{this.active}}
            @onSnapPointChange={{this.setActive}}
            @spring={{this.spring}}
            class="example-ios-sheet
              {{if this.pageScale.enabled 'example-ios-sheet--card'}}"
            aria-labelledby="example-ios-title"
          >
            <:header as |drawer|>
              <drawer.Grabber class="mobile-drawer-theme-ios__grabber" />
            </:header>
            <:default as |drawer|>
              <div class="example-ios-title">
                <h3 id="example-ios-title">Find nearby</h3>
                <button type="button" {{on "click" drawer.close}}>Done</button>
              </div>
              <input
                type="search"
                class="example-ios-search"
                placeholder="Search"
                aria-label="Search places"
              />
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
              {{#if this.detailInTray}}
                <DetailSheet
                  @title={{this.detail}}
                  @snapPoints={{this.detailSnapPoints}}
                  @active={{this.detailActive}}
                  @onChange={{this.setDetailActive}}
                  @spring={{this.spring}}
                />
              {{else}}
                <drawer.Nested>
                  <DetailSheet
                    @title={{this.detail}}
                    @snapPoints={{this.detailSnapPoints}}
                    @active={{this.detailActive}}
                    @onChange={{this.setDetailActive}}
                    @spring={{this.spring}}
                  />
                </drawer.Nested>
              {{/if}}
            </:default>
          </MobileDrawer>
        </div>
      {{/in-element}}
    {{/if}}
  </template>
}
