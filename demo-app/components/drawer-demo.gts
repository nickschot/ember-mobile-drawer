import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import type Owner from '@ember/owner';
import { MobileDrawer, type Placement, type SnapPoint } from '#src/index.ts';
import { formatSnapPoints, parseSnapPoints } from '../lib/parse-snap-points.ts';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

const SNAP_POINT_PRESETS: { label: string; snapPoints: SnapPoint[] }[] = [
  { label: "0, '50%', '100%'", snapPoints: [0, '50%', '100%'] },
  { label: "0, 'content'", snapPoints: [0, 'content'] },
  { label: "0, 120, 'content', '90%'", snapPoints: [0, 120, 'content', '90%'] },
];

/** The `preset` value of snap points typed into the text field. */
const CUSTOM = -1;

/** Default of `--mobile-drawer-backdrop-opacity` in the base styles. */
const DEFAULT_BACKDROP_OPACITY = 0.4;

/** Lines of filler for trying out scrolling inside the drawer. */
const TALL_CONTENT = Array.from(
  { length: 40 },
  (_, index) => `Line ${index + 1} of the tall content`,
);

const isPlacement = (value: unknown): value is Placement =>
  PLACEMENTS.includes(value as Placement);

/**
 * The playground: every control here changes an argument of the drawer (or,
 * for the backdrop opacity, a custom property) live. Controls for features
 * that haven't landed yet are shown disabled, with the issue that adds them.
 *
 * The initial state can be set from the URL, e.g.
 * `/?placement=left&preset=0&snap=1&handle=1&tall=1`, or with custom snap points
 * `/?points=0,200,'content'&snap=2&backdrop=0.6`, which is handy for
 * screenshots.
 */
export default class DrawerDemo extends Component {
  @tracked placement: Placement = 'bottom';
  @tracked preset = 0;
  @tracked snapPoints: SnapPoint[] = SNAP_POINT_PRESETS[0]!.snapPoints;
  @tracked snapPointsText = formatSnapPoints(this.snapPoints);
  @tracked snapPointsError?: string;
  @tracked active = 0;
  @tracked handleOnly = false;
  @tracked tall = false;
  @tracked backdropOpacity = DEFAULT_BACKDROP_OPACITY;

  constructor(owner: Owner, args: object) {
    super(owner, args);
    const params = new URLSearchParams(window.location.search);
    const placement = params.get('placement');
    if (isPlacement(placement)) this.placement = placement;
    // The constructor runs during rendering, where reading `active` and then
    // writing it fails Ember's tracking assertion. It is still 0 here, so the
    // presets don't need to clamp it.
    const preset = Number(params.get('preset'));
    if (SNAP_POINT_PRESETS[preset]) this.selectPreset(preset, false);
    const points = params.get('points');
    if (points !== null) this.setSnapPointsText(points, false);
    const snap = Number(params.get('snap'));
    if (snap >= 0 && snap < this.snapPoints.length) this.active = snap;
    this.handleOnly = params.get('handle') === '1';
    this.tall = params.get('tall') === '1';
    const backdrop = Number(params.get('backdrop') ?? NaN);
    if (backdrop >= 0 && backdrop <= 1) this.backdropOpacity = backdrop;
  }

  get snapPointButtons() {
    return this.snapPoints.map((snapPoint, index) => ({
      index,
      label: String(snapPoint),
    }));
  }

  /**
   * Set on a wrapper: the drawer's custom properties must be declared on an
   * ancestor of `.mobile-drawer`, not on the root itself.
   */
  get drawerStyle() {
    return htmlSafe(
      `--mobile-drawer-backdrop-opacity: ${this.backdropOpacity}`,
    );
  }

  /** The invocation for the current settings, to copy into an app. */
  get code(): string {
    const args = [
      `@placement="${this.placement}"`,
      '@snapPoints={{this.snapPoints}}',
      '@activeSnapPoint={{this.active}}',
      '@onSnapPointChange={{this.setActive}}',
      ...(this.handleOnly ? ['@handleOnly={{true}}'] : []),
    ];
    const lines = [
      `snapPoints: SnapPoint[] = [${formatSnapPoints(this.snapPoints)}];`,
      '',
      `<MobileDrawer\n  ${args.join('\n  ')}\n  as |drawer|\n>\n  …\n</MobileDrawer>`,
    ];
    if (this.backdropOpacity !== DEFAULT_BACKDROP_OPACITY) {
      lines.push(
        '',
        `/* CSS */\n:root { --mobile-drawer-backdrop-opacity: ${this.backdropOpacity}; }`,
      );
    }
    return lines.join('\n');
  }

  selectPreset(preset: number, clampActive = true) {
    this.preset = preset;
    this.snapPoints = SNAP_POINT_PRESETS[preset]!.snapPoints;
    this.snapPointsText = formatSnapPoints(this.snapPoints);
    this.snapPointsError = undefined;
    if (clampActive)
      this.active = Math.min(this.active, this.snapPoints.length - 1);
  }

  /**
   * Applies typed snap points once they parse. While they don't, the drawer
   * keeps the last valid ones and the error is shown under the field.
   */
  setSnapPointsText(text: string, clampActive = true) {
    this.snapPointsText = text;
    const result = parseSnapPoints(text);
    if (result.error !== undefined) {
      this.snapPointsError = result.error;
      return;
    }
    this.snapPointsError = undefined;
    this.snapPoints = result.snapPoints;
    const formatted = formatSnapPoints(result.snapPoints);
    this.preset = SNAP_POINT_PRESETS.findIndex(
      (preset) => formatSnapPoints(preset.snapPoints) === formatted,
    );
    if (clampActive)
      this.active = Math.min(this.active, this.snapPoints.length - 1);
  }

  setPlacement = (event: Event) => {
    const { value } = event.target as HTMLSelectElement;
    if (isPlacement(value)) this.placement = value;
  };

  setPreset = (event: Event) => {
    const preset = Number((event.target as HTMLSelectElement).value);
    if (SNAP_POINT_PRESETS[preset]) this.selectPreset(preset);
  };

  onSnapPointsInput = (event: Event) => {
    this.setSnapPointsText((event.target as HTMLInputElement).value);
  };

  setHandleOnly = (event: Event) => {
    this.handleOnly = (event.target as HTMLInputElement).checked;
  };

  setTall = (event: Event) => {
    this.tall = (event.target as HTMLInputElement).checked;
  };

  setBackdropOpacity = (event: Event) => {
    this.backdropOpacity = Number((event.target as HTMLInputElement).value);
  };

  onSnapPointChange = (index: number) => {
    this.active = index;
  };

  isSelected = (a: unknown, b: unknown) => a === b;

  formatProgress = (progress: number) => progress.toFixed(2);

  <template>
    <div class="demo-playground-drawer" style={{this.drawerStyle}}>
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
            {{this.formatProgress drawer.progress}}
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
          {{#if this.tall}}
            <ol class="demo-tall-content">
              {{#each TALL_CONTENT as |line|}}
                <li>{{line}}</li>
              {{/each}}
            </ol>
          {{/if}}
        </div>
      </MobileDrawer>
    </div>

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
        Snap point preset
        <select {{on "change" this.setPreset}}>
          {{#each SNAP_POINT_PRESETS as |preset index|}}
            <option
              value={{index}}
              selected={{this.isSelected index this.preset}}
            >[{{preset.label}}]</option>
          {{/each}}
          <option
            value={{CUSTOM}}
            disabled
            selected={{this.isSelected CUSTOM this.preset}}
          >Custom</option>
        </select>
      </label>
      <label>
        Snap points (@snapPoints)
        <input
          type="text"
          class="demo-snap-points"
          spellcheck="false"
          autocomplete="off"
          aria-invalid={{if this.snapPointsError "true"}}
          aria-describedby="demo-snap-points-hint"
          value={{this.snapPointsText}}
          {{on "input" this.onSnapPointsInput}}
        />
      </label>
      <p
        id="demo-snap-points-hint"
        class="demo-hint {{if this.snapPointsError 'demo-error'}}"
      >
        {{#if this.snapPointsError}}
          {{this.snapPointsError}}
          The drawer keeps the last valid snap points.
        {{else}}
          Comma-separated: px (120), percentages ('50%') or 'content'.
        {{/if}}
      </p>
      <label>
        <input
          type="checkbox"
          checked={{this.handleOnly}}
          {{on "change" this.setHandleOnly}}
        />
        Drag by the grabber only (@handleOnly)
      </label>
      <label>
        <input
          type="checkbox"
          checked={{this.tall}}
          {{on "change" this.setTall}}
        />
        Tall content (to try scrolling)
      </label>
      <label>
        Backdrop opacity (--mobile-drawer-backdrop-opacity:
        {{this.backdropOpacity}})
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={{this.backdropOpacity}}
          {{on "input" this.setBackdropOpacity}}
        />
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

    <fieldset class="demo-controls" disabled>
      <legend>Not available yet</legend>
      <p class="demo-hint">
        These options land with later issues and show up here once they do.
      </p>
      <div class="demo-pending">
        <label>
          <input type="checkbox" />
          Modal (@modal: focus trap, inert page, Escape closes)
        </label>
        <a
          href="https://github.com/nickschot/ember-mobile-drawer/issues/26"
        >#26</a>
      </div>
      <div class="demo-pending">
        <label>
          <input type="checkbox" checked />
          Backdrop (@backdrop: show it, tap it to close)
        </label>
        <a
          href="https://github.com/nickschot/ember-mobile-drawer/issues/25"
        >#25</a>
      </div>
      <div class="demo-pending">
        <label>
          Spring
          <select>
            <option>Default</option>
            <option>iOS</option>
          </select>
        </label>
        <a
          href="https://github.com/nickschot/ember-mobile-drawer/issues/29"
        >#29</a>
      </div>
    </fieldset>

    <details class="demo-code">
      <summary>Code for these settings</summary>
      <pre><code>{{this.code}}</code></pre>
    </details>
  </template>
}
