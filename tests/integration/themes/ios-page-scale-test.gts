import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { MobileDrawer, type Placement, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import { resizeObserversDelivered } from '../../helpers/resize-observers.ts';
import '#src/styles.css';
import '#src/themes/ios.css';

// In a 400 x 600 px container the snap points resolve to 0, 300 and 600 px,
// so the page progress is 0, 0.5 and 1.
const SNAP_POINTS: SnapPoint[] = [0, '50%', '100%'];
const containerStyle = htmlSafe(
  'position: relative; width: 400px; height: 600px',
);
const PAGE_CLASS = 'mobile-drawer-theme-ios__page';

class State {
  @tracked active = 0;
  @tracked modal = true;
  @tracked inner = 0;
  @tracked placement: Placement = 'bottom';
  @tracked shown = true;
  @tracked snapPoints: SnapPoint[] = SNAP_POINTS;
}

/** Adds CSS to the page for the duration of a test. */
function addStyles(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return style;
}

/** The theme's rules that style the page element, with their parents. */
function pageRules(): CSSStyleRule[] {
  const found: CSSStyleRule[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes(PAGE_CLASS)
      ) {
        found.push(rule);
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    visit(sheet.cssRules);
  }
  return found;
}

/**
 * Applies the theme's page rules as if `prefers-reduced-motion:
 * no-preference` matched, also on a machine with reduced motion: same layer,
 * later in source order.
 */
function applyMotion(): HTMLStyleElement {
  const text = pageRules()
    .map((rule) => rule.cssText)
    .join('\n');
  return addStyles(`@layer ember-mobile-drawer { ${text} }`);
}

/**
 * A page element as a child of `<body>`, outside the test container where
 * the drawers render, with a `position: fixed` element in it.
 */
function addPage({ opted = true, marked = true } = {}): HTMLElement {
  const page = document.createElement('div');
  if (opted) page.classList.add(PAGE_CLASS);
  if (marked) page.setAttribute('data-mobile-drawer-page', '');
  page.style.marginTop = '50px';
  page.style.height = '200px';
  const fixed = document.createElement('div');
  fixed.className = 'fixed-header';
  fixed.style.cssText = 'position: fixed; top: 0; height: 10px';
  page.append(fixed);
  document.body.append(page);
  return page;
}

async function renderDrawer(state: State) {
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div style={{containerStyle}}>
        {{#if state.shown}}
          <MobileDrawer
            @snapPoints={{state.snapPoints}}
            @activeSnapPoint={{state.active}}
            @modal={{state.modal}}
            @placement={{state.placement}}
            aria-label="Sheet"
            style="position: absolute"
            data-test-drawer
          >
            <p>Sheet</p>
          </MobileDrawer>
        {{/if}}
      </div>
    </template>,
  );
}

/** The page's scale and vertical move, from its computed transform. */
function matrix(page: HTMLElement): { scale: number; y: number } {
  const { a, d, f } = new DOMMatrix(getComputedStyle(page).transform);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { scale: round(a) === round(d) ? round(a) : NaN, y: round(f) };
}

function progress(page: HTMLElement): string {
  return page.style.getPropertyValue('--mobile-drawer-page-progress');
}

function bodyIsBlack(): boolean {
  return getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)';
}

module('Integration | themes/ios.css | page scale', function (hooks) {
  setupRenderingTest(hooks);

  let added: HTMLElement[] = [];

  hooks.beforeEach(function () {
    // Jump to each snap point.
    drawerEnvironment.prefersReducedMotion = () => true;
    added = [];
  });

  hooks.afterEach(function () {
    delete drawerEnvironment.prefersReducedMotion;
    for (const element of added) element.remove();
  });

  test('off by default: without the opt-in nothing is written and nothing moves', async function (assert) {
    added.push(applyMotion());
    const page = addPage({ opted: false, marked: false });
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    state.active = 2;
    await settled();

    assert.strictEqual(
      page.getAttribute('style'),
      'margin-top: 50px; height: 200px;',
    );
    const style = getComputedStyle(page);
    assert.strictEqual(style.transform, 'none');
    assert.strictEqual(style.clipPath, 'none');
    assert.notStrictEqual(
      getComputedStyle(document.body).backgroundColor,
      'rgb(0, 0, 0)',
    );
  });

  test('with the opt-in the page follows the drawer, and is left alone when it closes', async function (assert) {
    added.push(applyMotion());
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);

    const fixed = page.querySelector<HTMLElement>('.fixed-header')!;
    assert.strictEqual(progress(page), '', 'closed: no progress');
    assert.strictEqual(getComputedStyle(page).transform, 'none');
    assert.strictEqual(
      fixed.getBoundingClientRect().top,
      0,
      'closed: fixed content is fixed to the viewport',
    );

    state.active = 1;
    await settled();
    assert.strictEqual(progress(page), '0.5');
    assert.deepEqual(matrix(page), { scale: 0.96, y: 5 });

    state.active = 2;
    await settled();
    assert.strictEqual(progress(page), '1');
    const style = getComputedStyle(page);
    assert.deepEqual(matrix(page), { scale: 0.92, y: 10 });
    assert.true(
      style.clipPath.startsWith('inset(') && style.clipPath.includes('round'),
      `rounded clip: ${style.clipPath}`,
    );
    assert.strictEqual(style.backgroundColor, 'rgb(255, 255, 255)', 'Canvas');
    assert.strictEqual(
      getComputedStyle(document.body).backgroundColor,
      'rgb(0, 0, 0)',
      'black around the page',
    );

    state.active = 0;
    await settled();
    assert.strictEqual(progress(page), '', 'closed: progress removed');
    assert.strictEqual(
      page.style.getPropertyValue('--mobile-drawer-page-viewport-top'),
      '',
    );
    assert.strictEqual(getComputedStyle(page).transform, 'none');
    assert.strictEqual(getComputedStyle(page).clipPath, 'none');
    assert.strictEqual(fixed.getBoundingClientRect().top, 0);
    assert.notStrictEqual(
      getComputedStyle(document.body).backgroundColor,
      'rgb(0, 0, 0)',
    );
  });

  test('the viewport top is where the page is scrolled to', async function (assert) {
    added.push(applyMotion());
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    const top = page.getBoundingClientRect().top;

    state.active = 2;
    await settled();
    assert.strictEqual(
      page.style.getPropertyValue('--mobile-drawer-page-viewport-top'),
      `${-top}px`,
    );
  });

  test('the progress is written without the theme class, for other themes', async function (assert) {
    const page = addPage({ opted: false });
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    state.active = 2;
    await settled();

    assert.strictEqual(progress(page), '1');
    assert.strictEqual(getComputedStyle(page).transform, 'none', 'not scaled');
  });

  test('a non-modal drawer leaves the page alone', async function (assert) {
    const page = addPage();
    added.push(page);
    const state = new State();
    state.modal = false;
    await renderDrawer(state);
    state.active = 2;
    await settled();

    assert.strictEqual(progress(page), '');
  });

  test('a drawer inside the page does not drive it', async function (assert) {
    const state = new State();
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div class={{PAGE_CLASS}} data-mobile-drawer-page data-test-page>
          <div style={{containerStyle}}>
            <MobileDrawer
              @snapPoints={{SNAP_POINTS}}
              @activeSnapPoint={{state.active}}
              aria-label="Sheet"
              style="position: absolute"
            >
              <p>Sheet</p>
            </MobileDrawer>
          </div>
        </div>
      </template>,
    );
    state.active = 2;
    await settled();

    const page = document.querySelector<HTMLElement>('[data-test-page]')!;
    assert.strictEqual(progress(page), '');
  });

  test('with several open drawers the page follows the one that is most open', async function (assert) {
    const page = addPage();
    added.push(page);
    const state = new State();
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style={{containerStyle}}>
          <MobileDrawer
            @snapPoints={{SNAP_POINTS}}
            @activeSnapPoint={{state.active}}
            aria-label="Sheet"
            style="position: absolute"
          />
        </div>
        <div style={{containerStyle}}>
          <MobileDrawer
            @snapPoints={{SNAP_POINTS}}
            @activeSnapPoint={{state.inner}}
            aria-label="Sheet"
            style="position: absolute"
          />
        </div>
      </template>,
    );
    state.active = 1;
    await settled();
    assert.strictEqual(progress(page), '0.5');

    state.inner = 2;
    await settled();
    assert.strictEqual(progress(page), '1');

    state.inner = 0;
    await settled();
    assert.strictEqual(progress(page), '0.5', 'back to the other drawer');

    state.active = 0;
    await settled();
    assert.strictEqual(progress(page), '');
  });

  for (const placement of ['top', 'left', 'right'] as const) {
    test(`a ${placement} drawer does not drive the page`, async function (assert) {
      added.push(applyMotion());
      const page = addPage();
      added.push(page);
      const state = new State();
      state.placement = placement;
      await renderDrawer(state);
      state.active = 2;
      await settled();

      assert.strictEqual(progress(page), '');
      assert.false(page.hasAttribute('data-mobile-drawer-page-active'));
      assert.strictEqual(getComputedStyle(page).transform, 'none');
      assert.false(bodyIsBlack(), 'no black around the page');
    });
  }

  test('a bottom drawer that changes to the top while open stops driving the page', async function (assert) {
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settled();
    assert.strictEqual(progress(page), '0.5');

    state.placement = 'top';
    await settled();
    assert.strictEqual(progress(page), '');
  });

  test('the page is marked active only while it is driven', async function (assert) {
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    assert.false(page.hasAttribute('data-mobile-drawer-page-active'));

    state.active = 1;
    await settled();
    assert.true(page.hasAttribute('data-mobile-drawer-page-active'));

    state.active = 0;
    await settled();
    assert.false(page.hasAttribute('data-mobile-drawer-page-active'));
  });

  test('a page element rendered while a drawer is open follows the drawer from its next move', async function (assert) {
    const first = addPage();
    added.push(first);
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settled();
    assert.strictEqual(progress(first), '0.5');

    // A route change replaces the page element.
    first.remove();
    const second = addPage();
    added.push(second);
    await settled();

    state.active = 2;
    await settled();
    assert.strictEqual(progress(second), '1', 'the new element follows');
    assert.strictEqual(
      progress(first),
      '',
      'the detached element is cleared and not kept',
    );
    assert.false(first.hasAttribute('data-mobile-drawer-page-active'));

    // Also a second marked element next to one that stays.
    const third = addPage();
    added.push(third);
    await settled();
    state.active = 1;
    await settled();
    assert.strictEqual(progress(second), '0.5');
    assert.strictEqual(progress(third), '0.5');

    state.active = 0;
    await settled();
    assert.strictEqual(progress(second), '');
    assert.strictEqual(progress(third), '');
  });

  test('a page element replaced while the drawer is open at rest follows at once', async function (assert) {
    const first = addPage();
    added.push(first);
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settled();
    assert.strictEqual(progress(first), '0.5');
    // Let the first ResizeObserver callbacks run (they render the drawer
    // again), so nothing renders the drawer after this.
    await resizeObserversDelivered();

    // The drawer doesn't move after this.
    first.remove();
    const second = addPage();
    added.push(second);
    await settled();

    assert.strictEqual(progress(second), '0.5', 'the new element follows');
    assert.true(second.hasAttribute('data-mobile-drawer-page-active'));
    assert.notStrictEqual(
      second.style.getPropertyValue('--mobile-drawer-page-viewport-top'),
      '',
    );
    assert.strictEqual(progress(first), '', 'the old element is cleared');
    assert.false(first.hasAttribute('data-mobile-drawer-page-active'));
    assert.strictEqual(
      first.style.getPropertyValue('--mobile-drawer-page-viewport-top'),
      '',
    );

    state.active = 0;
    await settled();
    assert.strictEqual(progress(second), '');
    assert.false(second.hasAttribute('data-mobile-drawer-page-active'));
  });

  test('destroying an open drawer leaves the page alone', async function (assert) {
    added.push(applyMotion());
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    state.active = 2;
    await settled();
    assert.strictEqual(progress(page), '1');

    state.shown = false;
    await settled();
    assert.strictEqual(progress(page), '');
    assert.strictEqual(
      page.style.getPropertyValue('--mobile-drawer-page-viewport-top'),
      '',
    );
    assert.false(page.hasAttribute('data-mobile-drawer-page-active'));
    assert.strictEqual(getComputedStyle(page).transform, 'none');
    assert.false(bodyIsBlack());
  });

  test('@modal toggled while open removes and writes the progress again', async function (assert) {
    const page = addPage();
    added.push(page);
    const state = new State();
    await renderDrawer(state);
    state.active = 1;
    await settled();
    assert.strictEqual(progress(page), '0.5');

    state.modal = false;
    await settled();
    assert.strictEqual(progress(page), '', 'non-modal: removed');

    state.modal = true;
    await settled();
    assert.strictEqual(progress(page), '0.5', 'modal again: written');
  });

  test('a modal drawer that rests at a peek does not make <body> black', async function (assert) {
    added.push(applyMotion());
    const page = addPage();
    added.push(page);
    const state = new State();
    state.snapPoints = ['20%', '100%'];
    await renderDrawer(state);
    await settled();

    const drawer = document.querySelector('[data-test-drawer]')!;
    assert.false(drawer.hasAttribute('data-closed'), 'the peek shows');
    assert.strictEqual(progress(page), '');
    assert.false(bodyIsBlack(), 'not black at the peek');

    state.active = 1;
    await settled();
    assert.true(bodyIsBlack(), 'black when open above the peek');
  });

  test('reduced motion: every page rule is in a prefers-reduced-motion: no-preference block', function (assert) {
    const rules = pageRules();
    assert.true(rules.length >= 2, 'the page rule and the <body> rule');
    for (const rule of rules) {
      const media = rule.parentRule;
      assert.true(
        media instanceof CSSMediaRule &&
          media.conditionText === '(prefers-reduced-motion: no-preference)',
        rule.selectorText,
      );
    }
  });
});
