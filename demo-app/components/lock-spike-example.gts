import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { lockSpike } from '../lib/lock-spike.ts';

const ITEMS = Array.from({ length: 30 }, (_, index) => `Row ${index + 1}`);

/**
 * SPIKE (#113): a sheet to test the iOS scroll lock with: a text field (the
 * on-screen keyboard), a scrollable list and a nested drawer. `?modal=0`
 * makes it non-modal.
 */
export default class LockSpikeExample extends Component {
  snapPoints: SnapPoint[] = [0, '50%', 'content'];
  nestedSnapPoints: SnapPoint[] = [0, 'content'];
  modal = lockSpike.modal;
  field = lockSpike.field;
  @tracked active = 0;
  @tracked nested = 0;

  setActive = (index: number) => (this.active = index);
  setNested = (index: number) => (this.nested = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 2)}}>
      Open scroll lock test
    </button>

    <MobileDrawer
      @transparentStatusBar={{lockSpike.statusBar}}
      @placement="bottom"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      @modal={{this.modal}}
      class="demo-drawer example-sheet"
      aria-labelledby="lock-spike-title"
      as |drawer|
    >
      <div
        class="example-sheet-header"
        data-mobile-drawer-pinned
        {{drawer.handle}}
      >
        <div class="demo-grabber"></div>
        <div class="example-sheet-title">
          <h3 id="lock-spike-title">Scroll lock test</h3>
          <button type="button" {{on "click" drawer.close}}>Close</button>
        </div>
      </div>
      <div class="lock-spike-fields">
        {{#if this.field}}
          <label>
            Text
            <input type="text" placeholder="Tap for the keyboard" />
          </label>
        {{/if}}
        <button type="button" {{on "click" (fn this.setNested 1)}}>
          Open nested
        </button>
      </div>
      <ul class="example-list">
        {{#each ITEMS as |item|}}
          <li><strong>{{item}}</strong></li>
        {{/each}}
      </ul>

      <MobileDrawer
        @transparentStatusBar={{lockSpike.statusBar}}
        @placement="bottom"
        @snapPoints={{this.nestedSnapPoints}}
        @activeSnapPoint={{this.nested}}
        @onSnapPointChange={{this.setNested}}
        class="demo-drawer"
        aria-label="Nested drawer"
        as |nested|
      >
        <div class="demo-drawer-content">
          <div class="demo-grabber" {{nested.handle}}></div>
          <p>A nested drawer, without scrollable content.</p>
          <button type="button" {{on "click" nested.close}}>Close</button>
        </div>
      </MobileDrawer>
    </MobileDrawer>
  </template>
}
