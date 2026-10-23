import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import { MobileDrawer, type Placement, type SnapPoint } from '#src/index.ts';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

const SNAP_POINT_PRESETS: { label: string; snapPoints: SnapPoint[] }[] = [
  { label: "0, '50%', '100%'", snapPoints: [0, '50%', '100%'] },
  { label: "0, 'content'", snapPoints: [0, 'content'] },
  { label: "0, 120, 'content', '90%'", snapPoints: [0, 120, 'content', '90%'] },
];

const isPlacement = (value: unknown): value is Placement =>
  PLACEMENTS.includes(value as Placement);

/**
 * Lets the drawer be tried out. The initial state can be set from the URL,
 * e.g. `/?placement=left&preset=0&snap=1&handle=1`, which is handy for
 * screenshots.
 */
export default class DrawerDemo extends Component {
  @tracked placement: Placement = 'bottom';
  @tracked preset = 0;
  @tracked active = 0;
  @tracked handleOnly = false;

  constructor(owner: Owner, args: object) {
    super(owner, args);
    const params = new URLSearchParams(window.location.search);
    const placement = params.get('placement');
    if (isPlacement(placement)) this.placement = placement;
    const preset = Number(params.get('preset'));
    if (SNAP_POINT_PRESETS[preset]) this.preset = preset;
    const snap = Number(params.get('snap'));
    if (snap >= 0 && snap < this.snapPoints.length) this.active = snap;
    this.handleOnly = params.get('handle') === '1';
  }

  setHandleOnly = (event: Event) => {
    this.handleOnly = (event.target as HTMLInputElement).checked;
  };

  get snapPoints(): SnapPoint[] {
    return SNAP_POINT_PRESETS[this.preset]!.snapPoints;
  }

  get snapPointButtons() {
    return this.snapPoints.map((snapPoint, index) => ({
      index,
      label: String(snapPoint),
    }));
  }

  setPlacement = (event: Event) => {
    const { value } = event.target as HTMLSelectElement;
    if (isPlacement(value)) this.placement = value;
  };

  setPreset = (event: Event) => {
    this.preset = Number((event.target as HTMLSelectElement).value);
    this.active = Math.min(this.active, this.snapPoints.length - 1);
  };

  onSnapPointChange = (index: number) => {
    this.active = index;
  };

  isSelected = (a: unknown, b: unknown) => a === b;

  <template>
    <MobileDrawer
      @placement={{this.placement}}
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.onSnapPointChange}}
      @handleOnly={{this.handleOnly}}
      class="demo-drawer"
      as |drawer|
    >
      <div class="demo-drawer-content" data-placement={{this.placement}}>
        <div
          class="demo-grabber"
          data-placement={{this.placement}}
          data-active={{if this.handleOnly "true"}}
          {{drawer.handle}}
        ></div>
        <h2>Drawer ({{this.placement}})</h2>
        <p>
          Snap point
          {{drawer.activeSnapPoint}}
          · progress
          {{drawer.progress}}
          {{#if drawer.isDragging}}· dragging{{/if}}
          {{#if drawer.isAnimating}}· animating{{/if}}
        </p>
        <div class="demo-buttons">
          {{#each this.snapPointButtons as |snapPoint|}}
            <button
              type="button"
              aria-pressed={{if
                (this.isSelected snapPoint.index drawer.activeSnapPoint)
                "true"
                "false"
              }}
              {{on "click" (fn drawer.snapTo snapPoint.index)}}
            >{{snapPoint.label}}</button>
          {{/each}}
          <button type="button" {{on "click" drawer.open}}>Open</button>
          <button type="button" {{on "click" drawer.close}}>Close</button>
        </div>
        <p>
          Drag the drawer with touch or a pen
          {{#if this.handleOnly}}
            by the grabber
          {{/if}}
          (on a desktop, turn on device emulation in the browser's developer
          tools). The buttons in here use the yielded snapTo, open and close
          actions.
        </p>
      </div>
    </MobileDrawer>

    <fieldset class="demo-controls">
      <legend>Drawer</legend>
      <label>
        Placement
        <select {{on "change" this.setPlacement}}>
          {{#each PLACEMENTS as |placement|}}
            <option
              value={{placement}}
              selected={{this.isSelected placement this.placement}}
            >{{placement}}</option>
          {{/each}}
        </select>
      </label>
      <label>
        Snap points
        <select {{on "change" this.setPreset}}>
          {{#each SNAP_POINT_PRESETS as |preset index|}}
            <option
              value={{index}}
              selected={{this.isSelected index this.preset}}
            >[{{preset.label}}]</option>
          {{/each}}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={{this.handleOnly}}
          {{on "change" this.setHandleOnly}}
        />
        Drag by the grabber only (@handleOnly)
      </label>
      <div class="demo-buttons">
        Set @activeSnapPoint:
        {{#each this.snapPointButtons as |snapPoint|}}
          <button
            type="button"
            data-snap-point={{snapPoint.index}}
            {{on "click" (fn this.onSnapPointChange snapPoint.index)}}
          >{{snapPoint.label}}</button>
        {{/each}}
      </div>
    </fieldset>
  </template>
}
