import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { statusBar } from '../lib/status-bar.ts';

const LINKS = ['Inbox', 'Starred', 'Sent', 'Drafts', 'Archive', 'Settings'];

/** A navigation drawer from the left that opens to its content width. */
export default class SideDrawerExample extends Component {
  snapPoints: SnapPoint[] = [0, 'content'];
  @tracked active = 0;
  @tracked current = LINKS[0]!;

  setActive = (index: number) => (this.active = index);

  select = (link: string, event: Event) => {
    event.preventDefault();
    this.current = link;
    this.active = 0;
  };

  isCurrent = (link: string) => link === this.current;

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>
      Open side drawer
    </button>
    <span class="demo-hint">Current: {{this.current}}</span>

    <MobileDrawer
      @transparentStatusBar={{statusBar.transparent}}
      @placement="left"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      class="demo-drawer"
      aria-labelledby="example-nav-title"
      as |drawer|
    >
      <nav class="example-nav" aria-label="Example navigation">
        <h3 id="example-nav-title">Mail</h3>
        <ul>
          {{#each LINKS as |link|}}
            <li>
              <a
                href="#"
                aria-current={{if (this.isCurrent link) "page"}}
                {{on "click" (fn this.select link)}}
              >{{link}}</a>
            </li>
          {{/each}}
        </ul>
        <button type="button" {{on "click" drawer.close}}>Close</button>
      </nav>
    </MobileDrawer>
  </template>
}
