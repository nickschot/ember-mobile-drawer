import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import type Owner from '@ember/owner';
import {
  MobileDrawer,
  springPresets,
  type MobileDrawerSpring,
  type Placement,
  type SnapPoint,
} from '#src/index.ts';
import { formatSnapPoints, parseSnapPoints } from '../lib/parse-snap-points.ts';
import {
  CUSTOM,
  CUSTOM_SPRING,
  DEFAULT_BACKDROP_OPACITY,
  PLACEMENTS,
  SNAP_POINT_PRESETS,
  SPRING_FIELDS,
  SPRING_PRESETS,
  roundSpringValue,
  type SpringFieldName,
  isPlacement,
  isSpringPresetName,
  type SpringPresetName,
  parsePlaygroundParams,
} from '../lib/parse-playground-params.ts';

/** The spring fields, with the rounded values of `spring` as their text. */
const springFieldsFor = (spring: MobileDrawerSpring) =>
  SPRING_FIELDS.map((field) => ({
    ...field,
    value: roundSpringValue(spring[field.name]),
  }));

/** Lines of filler for trying out scrolling inside the drawer. */
const TALL_CONTENT = Array.from(
  { length: 40 },
  (_, index) => `Line ${index + 1} of the tall content`,
);

/**
 * The playground: every control here changes an argument of the drawer (or,
 * for the backdrop opacity, a custom property) live.
 *
 * The initial state can be set from the URL, e.g.
 * `/?placement=left&preset=0&snap=1&handle=1&tall=1`, or with custom snap points
 * `/?points=0,200,'content'&snap=2&backdrop=0.6&spring=ios`, which is handy for
 * screenshots.
 */
export default class DrawerDemo extends Component<{
  Args: {
    /** The query string to start from. Defaults to the page's own. */
    search?: string;
  };
}> {
  // The constructor runs during rendering, so each field is assigned exactly
  // once, from a state parsed up front: reading a tracked field and then
  // writing it there fails Ember's tracking assertion in development.
  @tracked placement: Placement;
  @tracked preset: number;
  @tracked snapPoints: SnapPoint[];
  @tracked snapPointsText: string;
  @tracked snapPointsError: string | undefined;
  @tracked active: number;
  @tracked handleOnly: boolean;
  @tracked tall: boolean;
  @tracked backdropOpacity: number;
  /** A preset's name, or `'custom'` once a spring field is changed. */
  @tracked springPreset: SpringPresetName | typeof CUSTOM_SPRING;
  @tracked stiffness: number;
  @tracked damping: number;
  @tracked mass: number;
  /**
   * The spring fields with the text they start with: the rounded values of
   * the selected preset. Replaced (so the fields render again) only when a
   * preset is selected, never while you type, so a field keeps its focus and
   * its text.
   */
  @tracked springFields: ReturnType<typeof springFieldsFor>;
  // Not settable from the URL, so they start at the drawer's defaults.
  @tracked modal = true;
  @tracked backdrop = true;
  @tracked closeOnBackdropClick = true;

  constructor(owner: Owner, args: DrawerDemo['args']) {
    super(owner, args);
    const state = parsePlaygroundParams(args.search ?? window.location.search);
    this.placement = state.placement;
    this.preset = state.preset;
    this.snapPoints = state.snapPoints;
    this.snapPointsText = state.snapPointsText;
    this.snapPointsError = state.snapPointsError;
    this.active = state.active;
    this.handleOnly = state.handleOnly;
    this.tall = state.tall;
    this.backdropOpacity = state.backdropOpacity;
    this.springPreset = state.spring;
    const spring = springPresets[state.spring];
    this.stiffness = spring.stiffness;
    this.damping = spring.damping;
    this.mass = spring.mass;
    this.springFields = springFieldsFor(spring);
  }

  get spring(): MobileDrawerSpring {
    return {
      stiffness: this.stiffness,
      damping: this.damping,
      mass: this.mass,
    };
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
      ...(this.modal ? [] : ['@modal={{false}}']),
      // Unset, @backdrop follows @modal.
      ...(this.backdrop === this.modal
        ? []
        : [`@backdrop={{${this.backdrop}}}`]),
      ...(this.backdrop && !this.closeOnBackdropClick
        ? ['@closeOnBackdropClick={{false}}']
        : []),
      ...(this.springPreset === 'default' ? [] : ['@spring={{this.spring}}']),
    ];
    const lines = [
      `snapPoints: SnapPoint[] = [${formatSnapPoints(this.snapPoints)}];`,
      ...(this.springPreset === 'default'
        ? []
        : this.springPreset === CUSTOM_SPRING
          ? [
              `spring: MobileDrawerSpring = {\n${SPRING_FIELDS.map(
                (field) =>
                  `  ${field.name}: ${roundSpringValue(this[field.name])},`,
              ).join('\n')}\n};`,
            ]
          : [`spring = springPresets.${this.springPreset};`]),
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

  selectPreset(preset: number) {
    this.preset = preset;
    this.snapPoints = SNAP_POINT_PRESETS[preset]!.snapPoints;
    this.snapPointsText = formatSnapPoints(this.snapPoints);
    this.snapPointsError = undefined;
    this.active = Math.min(this.active, this.snapPoints.length - 1);
  }

  /**
   * Applies typed snap points once they parse. While they don't, the drawer
   * keeps the last valid ones and the error is shown under the field.
   */
  setSnapPointsText(text: string) {
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

  /** Like the drawer's default, the backdrop follows the modal setting. */
  setModal = (event: Event) => {
    this.modal = (event.target as HTMLInputElement).checked;
    this.backdrop = this.modal;
  };

  setBackdrop = (event: Event) => {
    this.backdrop = (event.target as HTMLInputElement).checked;
  };

  setCloseOnBackdropClick = (event: Event) => {
    this.closeOnBackdropClick = (event.target as HTMLInputElement).checked;
  };

  setSpring = (event: Event) => {
    const { value } = event.target as HTMLSelectElement;
    if (!isSpringPresetName(value)) return;
    this.springPreset = value;
    const spring = springPresets[value];
    this.stiffness = spring.stiffness;
    this.damping = spring.damping;
    this.mass = spring.mass;
    this.springFields = springFieldsFor(spring);
  };

  /**
   * Applies a typed stiffness, damping or mass once it is a number from the
   * field's `min` to its `max`. While it isn't, the drawer keeps the last
   * valid value. The field's text is not changed. The Spring control shows
   * the preset whose values, rounded as the fields show them, are these
   * values (and the drawer then gets the preset's exact values), or Custom.
   */
  setSpringField = (name: SpringFieldName, event: Event) => {
    const { min, max } = SPRING_FIELDS.find((field) => field.name === name)!;
    const value = Number((event.target as HTMLInputElement).value);
    if (!(value >= min && value <= max)) return;
    this[name] = value;
    const preset = SPRING_PRESETS.find(({ name: candidate }) =>
      SPRING_FIELDS.every(
        (field) =>
          roundSpringValue(springPresets[candidate][field.name]) ===
          roundSpringValue(this[field.name]),
      ),
    )?.name;
    if (preset === undefined) {
      this.springPreset = CUSTOM_SPRING;
      return;
    }
    // The preset's exact values, so the drawer agrees with the code.
    this.springPreset = preset;
    const spring = springPresets[preset];
    this.stiffness = spring.stiffness;
    this.damping = spring.damping;
    this.mass = spring.mass;
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
        @modal={{this.modal}}
        @backdrop={{this.backdrop}}
        @closeOnBackdropClick={{this.closeOnBackdropClick}}
        @spring={{this.spring}}
        class="demo-drawer"
        aria-labelledby="demo-drawer-title"
        as |drawer|
      >
        <div class="demo-drawer-content" data-placement={{this.placement}}>
          <div
            class="demo-grabber"
            data-placement={{this.placement}}
            data-active={{if this.handleOnly "true"}}
            {{drawer.handle}}
          ></div>
          <h2 id="demo-drawer-title">Drawer ({{this.placement}})</h2>
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
        <input
          type="checkbox"
          checked={{this.modal}}
          {{on "change" this.setModal}}
        />
        Modal (@modal: focus trap, inert page, Escape closes)
      </label>
      <label>
        <input
          type="checkbox"
          checked={{this.backdrop}}
          {{on "change" this.setBackdrop}}
        />
        Backdrop (@backdrop)
      </label>
      <label>
        <input
          type="checkbox"
          checked={{this.closeOnBackdropClick}}
          disabled={{if this.backdrop false true}}
          {{on "change" this.setCloseOnBackdropClick}}
        />
        Tap the backdrop to close (@closeOnBackdropClick)
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
      <label>
        Spring (@spring)
        <select {{on "change" this.setSpring}}>
          {{#each SPRING_PRESETS as |preset|}}
            <option
              value={{preset.name}}
              selected={{this.isSelected preset.name this.springPreset}}
            >{{preset.label}}</option>
          {{/each}}
          <option
            value={{CUSTOM_SPRING}}
            disabled
            selected={{this.isSelected CUSTOM_SPRING this.springPreset}}
          >Custom</option>
        </select>
      </label>
      <div class="demo-spring-fields">
        {{#each this.springFields as |field|}}
          <label>
            {{field.label}}
            <input
              type="number"
              min={{field.min}}
              max={{field.max}}
              step={{field.step}}
              inputmode="decimal"
              value={{field.value}}
              {{on "input" (fn this.setSpringField field.name)}}
            />
          </label>
        {{/each}}
      </div>
      <p class="demo-hint">
        Higher stiffness is faster, lower damping bounces more and a higher mass
        is slower. Stiffness 1 to 10000, damping 1 to 1000, mass 0.1 to 10. A
        change applies from the next animation.
      </p>
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

    <details class="demo-code">
      <summary>Code for these settings</summary>
      <pre><code>{{this.code}}</code></pre>
    </details>
  </template>
}
