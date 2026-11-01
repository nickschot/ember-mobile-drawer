import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, find, settled } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { MobileDrawer, type SnapPoint } from '#src/index.ts';
import { drawerEnvironment } from '#src/-private/environment.ts';
import '#src/styles.css';
import '#src/themes/ios.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';
type Scheme = 'light' | 'dark';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];
const SCHEMES: Scheme[] = ['light', 'dark'];

const ROUNDED: Record<Placement, string[]> = {
  bottom: ['top-left', 'top-right'],
  top: ['bottom-right', 'bottom-left'],
  left: ['top-right', 'bottom-right'],
  right: ['top-left', 'bottom-left'],
};

const BASE_SHADOW = 'rgba(0, 0, 0, 0.2) 0px 0px 12px 0px';

const GLASS: Record<Scheme, { background: string; color: string }> = {
  light: { background: 'rgba(255, 255, 255, 0.72)', color: 'rgb(0, 0, 0)' },
  dark: { background: 'rgba(28, 28, 30, 0.72)', color: 'rgb(255, 255, 255)' },
};

const SOLID: Record<Scheme, string> = {
  light: 'rgb(255, 255, 255)',
  dark: 'rgb(28, 28, 30)',
};

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

function corners(element: HTMLElement): Record<string, string> {
  const style = getComputedStyle(element);
  return {
    'top-left': style.borderTopLeftRadius,
    'top-right': style.borderTopRightRadius,
    'bottom-right': style.borderBottomRightRadius,
    'bottom-left': style.borderBottomLeftRadius,
  };
}

/**
 * Computed colours from relative colour syntax serialize as
 * `color(srgb r g b)` with 0-1 channels; turn an opaque one into `rgb()`.
 */
function rgb(color: string): string {
  const match = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color);
  if (!match) return color;
  const [r, g, b] = match
    .slice(1)
    .map((channel) => Math.round(Number(channel) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Adds CSS to the page for the duration of a test. */
function addStyles(css: string, { prepend = false } = {}): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  if (prepend) {
    document.head.prepend(style);
  } else {
    document.head.append(style);
  }
  return style;
}

/** Finds the theme's @media rule with the given condition. */
function themeMediaRule(condition: string): CSSMediaRule {
  const visit = (rules: CSSRuleList): CSSMediaRule | undefined => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes(condition) &&
        rule.cssText.includes('.mobile-drawer-theme-ios')
      ) {
        return rule;
      }
      if (rule instanceof CSSGroupingRule) {
        const found = visit(rule.cssRules);
        if (found) return found;
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    const found = visit(sheet.cssRules);
    if (found) return found;
  }
  throw new Error(`No theme @media rule for ${condition}`);
}

/** Ends the theme's running CSS transitions, as if they had run. */
function finishTransitions() {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
}

/**
 * Whether a computed colour is fully transparent. A colour in a running
 * transition can serialize in another colour space, e.g. `oklab(0 0 0 / 0)`.
 */
function isTransparent(color: string): boolean {
  return color === 'transparent' || /[,/]\s*0\)$/.test(color);
}

/** The colour of the 0.5px inset rim in a computed box-shadow, or null. */
function insetRim(boxShadow: string): string | null {
  const match = /((?:rgba?|color)\([^)]*\)) 0px 0px 0px 0\.5px inset/.exec(
    boxShadow,
  );
  return match?.[1] ?? null;
}

/**
 * Whether a computed box-shadow draws nothing. During a transition from
 * `none`, it serializes as a transparent shadow of size 0.
 */
function noRim(boxShadow: string): boolean {
  return (
    boxShadow === 'none' ||
    /^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px inset$/.test(boxShadow)
  );
}

const TALL_LINES = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);

/**
 * Renders the drawer markup inside a wrapper with the given `color-scheme`,
 * with or without the theme class on the wrapper. The grabber goes first,
 * or last for a top drawer. With `tall` the content is much longer than the
 * drawer and the tray rests fully open (`transform: none`). With
 * `expanded` the root gets `data-expanded`, as the component sets it at the
 * highest snap point.
 */
async function renderDrawer({
  themed = true,
  placement = 'bottom',
  scheme = 'light',
  tall = false,
  expanded = false,
}: {
  themed?: boolean;
  placement?: Placement;
  scheme?: Scheme;
  tall?: boolean;
  expanded?: boolean;
} = {}) {
  const wrapperClass = themed ? 'mobile-drawer-theme-ios' : '';
  const wrapperStyle = htmlSafe(`color-scheme: ${scheme}`);
  const trayStyle = htmlSafe(tall ? 'transform: none' : '');
  const isTop = placement === 'top';
  const lines = tall ? TALL_LINES : ['Content'];
  const expandedAttr = expanded ? '' : undefined;
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div class={{wrapperClass}} style={{wrapperStyle}}>
        <div
          class="mobile-drawer"
          data-placement={{placement}}
          data-expanded={{expandedAttr}}
          data-test-root
        >
          <div class="mobile-drawer__backdrop" data-test-backdrop></div>
          <div class="mobile-drawer__tray" style={{trayStyle}} data-test-tray>
            <div class="mobile-drawer__content">
              {{#unless isTop}}
                <div
                  class="mobile-drawer-theme-ios__grabber"
                  data-test-grabber
                ></div>
              {{/unless}}
              {{#each lines as |line|}}
                <p>{{line}}</p>
              {{/each}}
              {{#if isTop}}
                <div
                  class="mobile-drawer-theme-ios__grabber"
                  data-test-grabber
                ></div>
              {{/if}}
            </div>
          </div>
          <div class="mobile-drawer__bar-tint" data-test-bar-tint></div>
        </div>
      </div>
    </template>,
  );
}

/**
 * The rules of the base styles' iOS-only block (`-webkit-touch-callout`),
 * without the condition, in the drawer layer. Adding them after the theme
 * also loads them after it.
 */
function iosBaseRulesText(): string {
  const visit = (rules: CSSRuleList): CSSSupportsRule | undefined => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSSupportsRule &&
        rule.conditionText.includes('-webkit-touch-callout: none')
      ) {
        return rule;
      }
      if (rule instanceof CSSGroupingRule) {
        const found = visit(rule.cssRules);
        if (found) return found;
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    const found = visit(sheet.cssRules);
    if (found) {
      const inner = Array.from(found.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      return `@layer ember-mobile-drawer { ${inner} }`;
    }
  }
  throw new Error('No iOS @supports rule in the base styles');
}

/**
 * Applies the rules inside the theme's reduced transparency @media block as
 * if it matched: same layer, later in source order. Remove the returned
 * style element when done.
 */
function applyReducedTransparency(): HTMLStyleElement {
  return applyThemeMedia('prefers-reduced-transparency: reduce');
}

/**
 * Applies the rules inside the theme's @media block with the given condition
 * as if it matched: same layer, later in source order. Remove the returned
 * style element when done.
 */
function applyThemeMedia(condition: string): HTMLStyleElement {
  const media = themeMediaRule(condition);
  const inner = Array.from(media.cssRules)
    .map((rule) => rule.cssText)
    .join('\n');
  return addStyles(`@layer ember-mobile-drawer { ${inner} }`);
}

/**
 * Turns on the theme's transitions, also on a machine with reduced motion,
 * by applying the rules of its `prefers-reduced-motion: no-preference`
 * block. Remove the returned style element when done.
 */
function applyMotion(): HTMLStyleElement {
  return applyThemeMedia('prefers-reduced-motion: no-preference');
}

/**
 * The text of the base styles' layer block (styles.css), from the loaded
 * style sheets. Adding it again after the theme loads the base styles after
 * the theme.
 */
function baseLayerText(): string {
  const found: string[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSLayerBlockRule &&
        rule.cssText.includes(':where(.mobile-drawer__tray)') &&
        !rule.cssText.includes('mobile-drawer-theme-ios')
      ) {
        found.push(rule.cssText);
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    visit(sheet.cssRules);
  }
  if (!found[0]) throw new Error('No base styles layer block');
  return found[0];
}

module('Integration | themes/ios.css', function (hooks) {
  setupRenderingTest(hooks);

  /** Style elements a test added; removed after each test. */
  let styles: HTMLStyleElement[] = [];
  hooks.afterEach(function () {
    for (const style of styles) style.remove();
    styles = [];
  });

  test('without the theme class nothing changes', async function (assert) {
    await renderDrawer({ themed: false });

    const tray = el('[data-test-tray]');
    for (const [corner, value] of Object.entries(corners(tray))) {
      assert.strictEqual(value, '0px', `${corner} corner is square`);
    }
    const style = getComputedStyle(tray);
    assert.strictEqual(style.boxShadow, BASE_SHADOW, 'base shadow');
    assert.strictEqual(style.backdropFilter, 'none', 'no blur');

    const backdrop = el('[data-test-backdrop]');
    backdrop.style.setProperty('--mobile-drawer-progress', '1');
    assert.strictEqual(
      Number(getComputedStyle(backdrop).opacity),
      0.4,
      'base backdrop opacity',
    );

    const grabber = getComputedStyle(el('[data-test-grabber]'));
    assert.strictEqual(grabber.height, '0px', 'grabber is not drawn');
    assert.strictEqual(grabber.backgroundColor, 'rgba(0, 0, 0, 0)');
  });

  for (const scheme of SCHEMES) {
    test(`${scheme}: a translucent, blurred glass sheet with a rim and a dimming backdrop`, async function (assert) {
      await renderDrawer({ scheme });

      const tray = getComputedStyle(el('[data-test-tray]'));
      assert.strictEqual(tray.backgroundColor, GLASS[scheme].background);
      assert.strictEqual(tray.color, GLASS[scheme].color);
      assert.strictEqual(tray.backdropFilter, 'blur(30px) saturate(1.8)');
      assert.true(tray.boxShadow.includes('inset'), 'inner rim');
      assert.notStrictEqual(tray.boxShadow, BASE_SHADOW);

      const backdrop = el('[data-test-backdrop]');
      backdrop.style.setProperty('--mobile-drawer-progress', '1');
      const backdropStyle = getComputedStyle(backdrop);
      assert.strictEqual(backdropStyle.backgroundColor, 'rgb(0, 0, 0)');
      assert.strictEqual(Number(backdropStyle.opacity), 0.35);
    });

    test(`${scheme}: reduced transparency and increased contrast give a solid, unblurred sheet`, async function (assert) {
      await renderDrawer({ scheme });

      const media = themeMediaRule('prefers-reduced-transparency: reduce');
      assert.true(
        media.conditionText.includes('prefers-contrast: more'),
        'also for increased contrast',
      );
      const style = applyReducedTransparency();

      try {
        finishTransitions();
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(tray.backgroundColor, SOLID[scheme]);
        assert.strictEqual(tray.backdropFilter, 'none');
      } finally {
        style.remove();
      }
    });
  }

  for (const placement of PLACEMENTS) {
    test(`${placement}: the theme rounds the page-facing corners`, async function (assert) {
      await renderDrawer({ placement });

      for (const [corner, value] of Object.entries(
        corners(el('[data-test-tray]')),
      )) {
        assert.strictEqual(
          value,
          ROUNDED[placement].includes(corner) ? '32px' : '0px',
          `${corner} corner`,
        );
      }
    });
  }

  test('the grabber is drawn as a centred bar in the tray text colour', async function (assert) {
    await renderDrawer();

    const grabber = el('[data-test-grabber]');
    const bar = getComputedStyle(grabber, '::before');
    assert.strictEqual(bar.width, '36px');
    assert.strictEqual(bar.height, '5px');
    assert.strictEqual(bar.borderTopLeftRadius, '2.5px');
    assert.notStrictEqual(bar.backgroundColor, 'rgba(0, 0, 0, 0)');
    // 5px above and below the bar: the same space as before the strip.
    const strip = getComputedStyle(grabber);
    assert.strictEqual(strip.height, '5px');
    assert.strictEqual(strip.paddingTop, '5px');
    assert.strictEqual(strip.paddingBottom, '5px');

    const trayRect = el('[data-test-tray]').getBoundingClientRect();
    const rect = grabber.getBoundingClientRect();
    assert.strictEqual(
      rect.left - trayRect.left,
      trayRect.right - rect.right,
      'centred horizontally',
    );
  });

  for (const placement of ['bottom', 'top'] as const) {
    test(`${placement}: the grabber stays at the leading edge while the content scrolls`, async function (assert) {
      await renderDrawer({ placement, tall: true, expanded: true });

      const tray = el('[data-test-tray]');
      const grabber = el('[data-test-grabber]');
      // Phones have no classic scrollbar taking hits or layout space.
      tray.style.scrollbarWidth = 'none';
      const max = tray.scrollHeight - tray.clientHeight;
      assert.true(max > 100, 'the content scrolls');

      for (const scrollTop of [0, Math.round(max / 2), max]) {
        tray.scrollTop = scrollTop;
        const t = tray.getBoundingClientRect();
        const g = grabber.getBoundingClientRect();
        const gap =
          placement === 'bottom' ? g.top - t.top : t.bottom - g.bottom;
        assert.true(
          Math.abs(gap) < 1,
          `scrollTop ${scrollTop}: at the leading edge (${gap}px)`,
        );
        // Content that scrolls under it doesn't cover it.
        const hit = document.elementFromPoint(
          g.left + g.width / 2,
          g.top + g.height / 2,
        );
        assert.strictEqual(hit, grabber, `scrollTop ${scrollTop}: on top`);
      }
    });
  }

  for (const scheme of SCHEMES) {
    test(`${scheme}: below the highest snap point the grabber shows the glass sheet unchanged`, async function (assert) {
      await renderDrawer({ scheme, tall: true });

      const tray = getComputedStyle(el('[data-test-tray]'));
      assert.strictEqual(tray.backgroundColor, GLASS[scheme].background);
      const grabber = getComputedStyle(el('[data-test-grabber]'));
      assert.strictEqual(grabber.position, 'sticky', 'still sticky');
      // Transparent: no second tint over the tray's, so no band.
      assert.strictEqual(grabber.backgroundColor, 'rgba(0, 0, 0, 0)');
      assert.strictEqual(grabber.backdropFilter, 'none');
    });

    test(`${scheme}: expanded, the sheet is opaque and unblurred, and the strip has the same colour`, async function (assert) {
      await renderDrawer({ scheme, tall: true, expanded: true });

      const trayElement = el('[data-test-tray]');
      const tray = getComputedStyle(trayElement);
      // The glass tint without its transparency: the solid sheet colour.
      assert.strictEqual(rgb(tray.backgroundColor), SOLID[scheme], 'opaque');
      assert.strictEqual(tray.backdropFilter, 'none', 'no blur');
      assert.strictEqual(tray.color, GLASS[scheme].color);
      for (const [corner, value] of Object.entries(corners(trayElement))) {
        assert.strictEqual(
          value,
          ROUNDED.bottom.includes(corner) ? '32px' : '0px',
          `${corner} corner: the full-height radius`,
        );
      }

      const grabber = getComputedStyle(el('[data-test-grabber]'));
      assert.strictEqual(grabber.position, 'sticky');
      assert.strictEqual(
        grabber.backgroundColor,
        tray.backgroundColor,
        'the strip has the sheet colour: no band',
      );
      assert.strictEqual(grabber.backdropFilter, 'none', 'no second blur');
    });

    test(`${scheme}: expanded with reduced transparency, the solid sheet and the strip have the same colour`, async function (assert) {
      await renderDrawer({ scheme, tall: true, expanded: true });
      const style = applyReducedTransparency();

      try {
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(rgb(tray.backgroundColor), SOLID[scheme]);
        assert.strictEqual(tray.backdropFilter, 'none');
        assert.strictEqual(
          getComputedStyle(el('[data-test-grabber]')).backgroundColor,
          tray.backgroundColor,
        );
      } finally {
        style.remove();
      }
    });

    test(`${scheme}: on the solid sheet the grabber shows the solid sheet colour`, async function (assert) {
      await renderDrawer({ scheme, tall: true });
      const style = applyReducedTransparency();

      try {
        // The sheet colour transitions from glass to solid.
        finishTransitions();
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(tray.backgroundColor, SOLID[scheme]);
        assert.strictEqual(
          getComputedStyle(el('[data-test-grabber]')).backgroundColor,
          'rgba(0, 0, 0, 0)',
          'not expanded: the solid tray shows through',
        );

        el('[data-test-root]').setAttribute('data-expanded', '');
        finishTransitions();
        assert.strictEqual(
          rgb(getComputedStyle(el('[data-test-grabber]')).backgroundColor),
          SOLID[scheme],
          'expanded: solid',
        );
      } finally {
        style.remove();
      }
    });
  }

  for (const placement of ['bottom', 'top'] as const) {
    for (const scheme of SCHEMES) {
      test(`${placement}, ${scheme}: expanded, the strip draws the glass rim again over its colour`, async function (assert) {
        await renderDrawer({ placement, scheme, tall: true, expanded: true });
        finishTransitions();

        const trayElement = el('[data-test-tray]');
        const grabber = el('[data-test-grabber]');
        trayElement.style.scrollbarWidth = 'none';
        // Scrolled, so content is under the strip.
        trayElement.scrollTop =
          placement === 'bottom'
            ? 100
            : trayElement.scrollHeight - trayElement.clientHeight - 100;

        const trayRim = insetRim(getComputedStyle(trayElement).boxShadow);
        assert.ok(trayRim, `the tray has a rim: ${trayRim}`);
        const rim = getComputedStyle(grabber, '::after');
        assert.strictEqual(
          rim.boxShadow,
          `${trayRim} 0px 0px 0px 0.5px inset`,
          'the same rim as the tray',
        );
        assert.strictEqual(rim.pointerEvents, 'none', 'no hit target');
        assert.strictEqual(
          getComputedStyle(grabber).overflow,
          'hidden',
          'the strip clips the rim box',
        );

        // The rim box has the tray's leading corners and is at the tray's
        // leading edge; its far edge is outside the strip, so it is clipped.
        const style = rim;
        const leading =
          placement === 'bottom'
            ? [style.borderTopLeftRadius, style.borderTopRightRadius]
            : [style.borderBottomLeftRadius, style.borderBottomRightRadius];
        const far =
          placement === 'bottom'
            ? [style.borderBottomLeftRadius, style.borderBottomRightRadius]
            : [style.borderTopLeftRadius, style.borderTopRightRadius];
        assert.deepEqual(leading, ['32px', '32px'], 'leading corners');
        assert.deepEqual(far, ['0px', '0px'], 'far corners');

        const t = trayElement.getBoundingClientRect();
        const g = grabber.getBoundingClientRect();
        const edge =
          placement === 'bottom' ? g.top - t.top : t.bottom - g.bottom;
        assert.true(Math.abs(edge) < 1, `at the leading edge (${edge}px)`);
        assert.true(
          Math.abs(g.left - t.left) < 1 && Math.abs(t.right - g.right) < 1,
          'as wide as the tray',
        );
        // Taller than the strip by the radius, so the radius isn't scaled.
        assert.strictEqual(
          parseFloat(rim.height),
          grabber.offsetHeight + 32,
          'taller than the strip',
        );
      });
    }
  }

  for (const placement of ['bottom', 'top'] as const) {
    test(`${placement}: with side safe areas the strip and its rim span the full tray width`, async function (assert) {
      // env(safe-area-inset-*) can't be set in a test. Simulate side safe
      // areas: the content padding they give, and the theme's copies of them.
      styles.push(
        addStyles(`
          .mobile-drawer-theme-ios {
            --_mobile-drawer-ios-inset-left: 20px;
            --_mobile-drawer-ios-inset-right: 30px;
          }
          .mobile-drawer__content { padding-left: 20px; padding-right: 30px; }
        `),
      );
      await renderDrawer({ placement, tall: true, expanded: true });
      finishTransitions();

      const tray = el('[data-test-tray]');
      tray.style.scrollbarWidth = 'none';
      const grabber = el('[data-test-grabber]');
      const t = tray.getBoundingClientRect();
      const g = grabber.getBoundingClientRect();
      assert.true(
        Math.abs(g.left - t.left) < 1 && Math.abs(t.right - g.right) < 1,
        `the strip is as wide as the tray (${g.left - t.left}, ${t.right - g.right})`,
      );
      const strip = getComputedStyle(grabber);
      assert.strictEqual(strip.paddingLeft, '20px', 'bar clear of the left');
      assert.strictEqual(strip.paddingRight, '30px', 'bar clear of the right');
      assert.strictEqual(
        parseFloat(getComputedStyle(grabber, '::after').width),
        tray.clientWidth,
        'the rim box is as wide as the tray',
      );
      assert.strictEqual(
        tray.scrollWidth,
        tray.clientWidth,
        'no horizontal overflow',
      );
    });

    test(`${placement}: with padding on the tray's leading edge, a negative offset on the grabber removes the gap`, async function (assert) {
      const side = placement === 'bottom' ? 'top' : 'bottom';
      // The app fix from the README "Grabber strip limits".
      styles.push(
        addStyles(`
          [data-test-tray] { padding-${side}: 16px; }
          .mobile-drawer-theme-ios__grabber { ${side}: -16px; }
        `),
      );
      await renderDrawer({ placement, tall: true, expanded: true });
      const tray = el('[data-test-tray]');
      const grabber = el('[data-test-grabber]');
      tray.style.scrollbarWidth = 'none';
      const max = tray.scrollHeight - tray.clientHeight;
      // Tests render at a scale; gaps in CSS px.
      const scale = tray.getBoundingClientRect().height / tray.offsetHeight;
      const gap = () => {
        const t = tray.getBoundingClientRect();
        const g = grabber.getBoundingClientRect();
        return (side === 'top' ? g.top - t.top : t.bottom - g.bottom) / scale;
      };

      // At the scroll start (the top of a bottom drawer, the end of a top
      // drawer) the grabber is below the padding, as the app wants.
      tray.scrollTop = placement === 'bottom' ? 0 : max;
      assert.true(Math.abs(gap() - 16) < 1, `at rest: ${gap()}px`);
      // Scrolled: it sticks at the tray edge, no gap above it.
      tray.scrollTop = Math.round(max / 2);
      assert.true(Math.abs(gap()) < 1, `scrolled: ${gap()}px`);
    });
  }

  for (const placement of ['left', 'right'] as const) {
    test(`${placement}: with side safe areas the grabber doesn't make the tray scroll sideways`, async function (assert) {
      // Simulated side safe areas, as above. A side drawer's content pads
      // only its outer side (see styles.css).
      const side = placement === 'left' ? 'left' : 'right';
      styles.push(
        addStyles(`
          .mobile-drawer-theme-ios {
            --_mobile-drawer-ios-inset-left: 20px;
            --_mobile-drawer-ios-inset-right: 30px;
          }
          .mobile-drawer__content { padding-${side}: 20px; }
        `),
      );
      await renderDrawer({ placement, tall: true, expanded: true });
      const tray = el('[data-test-tray]');
      tray.style.scrollbarWidth = 'none';
      assert.strictEqual(
        tray.scrollWidth,
        tray.clientWidth,
        'no horizontal overflow',
      );
      const strip = getComputedStyle(el('[data-test-grabber]'));
      assert.deepEqual(
        [strip.marginLeft, strip.marginRight],
        ['0px', '0px'],
        'no side margins',
      );
    });
  }

  test("bottom: with the README rule, content without side padding doesn't make the tray scroll sideways", async function (assert) {
    styles.push(
      addStyles(`
        .mobile-drawer-theme-ios {
          --_mobile-drawer-ios-inset-left: 20px;
          --_mobile-drawer-ios-inset-right: 30px;
        }
        .mobile-drawer__content { padding-left: 0; padding-right: 0; }
        .mobile-drawer-theme-ios .mobile-drawer-theme-ios__grabber {
          margin-left: 0;
          margin-right: 0;
          padding-left: 0;
          padding-right: 0;
        }
      `),
    );
    await renderDrawer({ tall: true, expanded: true });
    const tray = el('[data-test-tray]');
    tray.style.scrollbarWidth = 'none';
    assert.strictEqual(tray.scrollWidth, tray.clientWidth, 'no overflow');
    const t = tray.getBoundingClientRect();
    const g = el('[data-test-grabber]').getBoundingClientRect();
    assert.true(
      Math.abs(g.left - t.left) < 1 && Math.abs(t.right - g.right) < 1,
      'the strip spans the tray',
    );
  });

  test('the rim over the strip is only drawn where the strip is opaque', function (assert) {
    // Without relative colours the expanded strip is translucent: the tray
    // rim shows through it, and a second rim would make it brighter.
    const found: { selector: string; inSupports: boolean }[] = [];
    const visit = (rules: CSSRuleList, inSupports: boolean) => {
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes('mobile-drawer-theme-ios__grabber') &&
          rule.selectorText.includes('::after') &&
          rule.style.getPropertyValue('box-shadow') !== ''
        ) {
          found.push({ selector: rule.selectorText, inSupports });
        }
        if (rule instanceof CSSGroupingRule) {
          visit(
            rule.cssRules,
            inSupports ||
              (rule instanceof CSSSupportsRule &&
                rule.conditionText.includes('rgb(from light-dark(')),
          );
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      visit(sheet.cssRules, false);
    }
    assert.true(found.length > 0, 'the theme draws a rim on the strip');
    for (const { selector, inSupports } of found) {
      assert.true(
        inSupports,
        `inside the relative colour @supports: ${selector}`,
      );
    }
  });

  test('below the highest snap point the strip draws no second rim', async function (assert) {
    await renderDrawer({ tall: true });
    assert.true(
      insetRim(getComputedStyle(el('[data-test-tray]')).boxShadow) !== null,
      'the tray rim shows through the transparent strip',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-grabber]'), '::after').boxShadow,
      'none',
    );
  });

  test("expanded, the sheet and the grabber follow the app's sheet background, made opaque", async function (assert) {
    await renderDrawer({ tall: true, expanded: true });
    const style = addStyles(
      '.mobile-drawer-theme-ios { --mobile-drawer-background: rgb(10 20 30 / 0.5); }',
    );

    try {
      finishTransitions();
      const tray = getComputedStyle(el('[data-test-tray]'));
      assert.strictEqual(rgb(tray.backgroundColor), 'rgb(10, 20, 30)');
      const grabber = getComputedStyle(el('[data-test-grabber]'));
      assert.strictEqual(rgb(grabber.backgroundColor), 'rgb(10, 20, 30)');
    } finally {
      style.remove();
    }
  });

  test('towards the top the glass fades to opaque before the strip and the blur change; away from it they change at once', async function (assert) {
    // Forced, so the test also runs on a machine with reduced motion.
    styles.push(applyMotion());
    await renderDrawer({ tall: true });
    const root = el('[data-test-root]');
    const tray = el('[data-test-tray]');
    const grabber = el('[data-test-grabber]');
    // Reading the styles also gives the transitions a style to start from.
    assert.strictEqual(
      getComputedStyle(tray).backgroundColor,
      GLASS.light.background,
      'glass to start with',
    );
    assert.true(isTransparent(getComputedStyle(grabber).backgroundColor));

    root.setAttribute('data-expanded', '');
    assert.strictEqual(
      getComputedStyle(tray).backdropFilter,
      'blur(30px) saturate(1.8)',
      'fading in: still blurred',
    );
    assert.true(
      isTransparent(getComputedStyle(grabber).backgroundColor),
      'fading in: the strip is still transparent, no band',
    );
    assert.true(
      noRim(getComputedStyle(grabber, '::after').boxShadow),
      'fading in: no second rim over the tray rim yet',
    );
    assert.true(
      tray.getAnimations().length > 0,
      'fading in: the sheet colour transitions',
    );

    finishTransitions();
    assert.strictEqual(
      rgb(getComputedStyle(tray).backgroundColor),
      SOLID.light,
    );
    assert.strictEqual(getComputedStyle(tray).backdropFilter, 'none');
    assert.strictEqual(
      rgb(getComputedStyle(grabber).backgroundColor),
      SOLID.light,
    );

    root.removeAttribute('data-expanded');
    assert.strictEqual(
      getComputedStyle(tray).backdropFilter,
      'blur(30px) saturate(1.8)',
      'fading out: blurred at once',
    );
    assert.true(
      isTransparent(getComputedStyle(grabber).backgroundColor),
      'fading out: the strip is transparent at once',
    );
    assert.strictEqual(
      getComputedStyle(grabber, '::after').boxShadow,
      'none',
      'fading out: the rim over the strip goes at once',
    );
    finishTransitions();
    assert.strictEqual(
      getComputedStyle(tray).backgroundColor,
      GLASS.light.background,
      'glass again',
    );
  });

  test('the strip and the blur wait exactly as long as the sheet fades, from one custom property', async function (assert) {
    styles.push(applyMotion());
    await renderDrawer({ tall: true, expanded: true });

    const timing = () => {
      const tray = getComputedStyle(el('[data-test-tray]'));
      const strip = getComputedStyle(el('[data-test-grabber]'));
      const property = tray.transitionProperty.split(', ');
      const duration = tray.transitionDuration.split(', ');
      const delay = tray.transitionDelay.split(', ');
      const at = (name: string) => property.indexOf(name);
      return {
        fade: duration[at('background-color')],
        blurDelay: delay[at('backdrop-filter')],
        stripDelay: strip.transitionDelay,
        rimDelay: getComputedStyle(el('[data-test-grabber]'), '::after')
          .transitionDelay,
      };
    };

    assert.deepEqual(timing(), {
      fade: '0.25s',
      blurDelay: '0.25s',
      stripDelay: '0.25s',
      rimDelay: '0.25s',
    });

    styles.push(
      addStyles(
        '.mobile-drawer-theme-ios { --_mobile-drawer-ios-fade: 0.4s; }',
      ),
    );
    assert.deepEqual(
      timing(),
      { fade: '0.4s', blurDelay: '0.4s', stripDelay: '0.4s', rimDelay: '0.4s' },
      'all follow the one property',
    );
  });

  test('the expanded sheet is opaque also when the base styles load after the theme', async function (assert) {
    // The base styles' tray background, later in the same layer.
    styles.push(addStyles(baseLayerText()));
    await renderDrawer({ tall: true, expanded: true });
    finishTransitions();

    const tray = getComputedStyle(el('[data-test-tray]'));
    assert.strictEqual(rgb(tray.backgroundColor), SOLID.light, 'opaque');
    assert.strictEqual(tray.backdropFilter, 'none');
    assert.strictEqual(
      getComputedStyle(el('[data-test-grabber]')).backgroundColor,
      tray.backgroundColor,
      'no band',
    );

    el('[data-test-root]').removeAttribute('data-expanded');
    finishTransitions();
    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).backgroundColor,
      GLASS.light.background,
      'not expanded: glass',
    );
  });

  for (const scheme of SCHEMES) {
    test(`${scheme}: the iOS Safari bar tint has the sheet colour, opaque while expanded, also with the base iOS rules after the theme`, async function (assert) {
      await renderDrawer({ scheme, tall: true });
      const tint = () => getComputedStyle(el('[data-test-bar-tint]'));

      // The iOS block only applies on iOS; force it, after the theme.
      styles.push(addStyles(iosBaseRulesText()));
      assert.strictEqual(tint().display, 'block');
      assert.strictEqual(
        tint().backgroundColor,
        GLASS[scheme].background,
        'below the top: the glass tint',
      );

      el('[data-test-root]').setAttribute('data-expanded', '');
      finishTransitions();
      assert.strictEqual(
        rgb(tint().backgroundColor),
        SOLID[scheme],
        'expanded: the opaque sheet colour',
      );
      assert.strictEqual(
        tint().backgroundColor,
        getComputedStyle(el('[data-test-tray]')).backgroundColor,
        'the same colour as the expanded tray',
      );
      assert.strictEqual(tint().transitionDuration, '0s', 'no transition');
    });
  }

  test('with motion, the bar tint turns opaque with the sheet, after the fade', async function (assert) {
    styles.push(applyMotion());
    await renderDrawer({ tall: true });
    const tint = () => getComputedStyle(el('[data-test-bar-tint]'));
    const tray = () => getComputedStyle(el('[data-test-tray]'));

    assert.strictEqual(
      tint().transitionDelay,
      '0s',
      'away from the top: at once',
    );

    el('[data-test-root]').setAttribute('data-expanded', '');
    assert.strictEqual(tint().transitionProperty, 'background-color');
    assert.strictEqual(tint().transitionDuration, '0s');
    assert.strictEqual(
      tint().transitionDelay,
      tray().transitionDuration.split(',')[0]!.trim(),
      'the delay is the sheet fade',
    );

    styles.push(
      addStyles(
        '.mobile-drawer-theme-ios { --_mobile-drawer-ios-fade: 0.4s; }',
      ),
    );
    assert.strictEqual(tint().transitionDelay, '0.4s', 'follows the fade');
  });

  test('unlayered app CSS still wins over the expanded tray background', async function (assert) {
    await renderDrawer({ tall: true, expanded: true });
    styles.push(
      addStyles('.mobile-drawer__tray { background: rgb(1, 2, 3); }', {
        prepend: true,
      }),
    );
    finishTransitions();
    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).backgroundColor,
      'rgb(1, 2, 3)',
    );
  });

  test('the opaque grabber colour is only used where a light-dark() origin works', function (assert) {
    // A browser with relative colours that can't take light-dark() as the
    // origin would make the declarations invalid at computed-value time, i.e.
    // a transparent sheet and strip. The feature query must test that
    // combination, so such a browser keeps the glass sheet and a translucent
    // strip instead.
    const conditions: string[] = [];
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSSupportsRule &&
          rule.cssText.includes('mobile-drawer-theme-ios__grabber') &&
          rule.cssText.includes('rgb(from')
        ) {
          conditions.push(rule.conditionText);
        }
        if (rule instanceof CSSGroupingRule) visit(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      visit(sheet.cssRules);
    }
    assert.strictEqual(conditions.length, 1, 'one feature query');
    assert.true(
      /rgb\(from light-dark\(/.test(conditions[0] ?? ''),
      `tests a light-dark() origin: ${conditions[0]}`,
    );
  });

  test('unlayered app CSS wins over the theme', async function (assert) {
    await renderDrawer();
    const style = addStyles(
      `
      .mobile-drawer-theme-ios {
        --mobile-drawer-radius: 3px;
        --mobile-drawer-background: rgb(1, 2, 3);
      }
      div { --mobile-drawer-backdrop-opacity: 0.9; }
      .mobile-drawer__tray { backdrop-filter: none; }
      .mobile-drawer-theme-ios__grabber::before { width: 50px; }
    `,
      // Before every other stylesheet: unlayered CSS wins regardless of order.
      { prepend: true },
    );

    try {
      finishTransitions();
      const tray = getComputedStyle(el('[data-test-tray]'));
      assert.strictEqual(tray.borderTopLeftRadius, '3px', 'radius');
      assert.strictEqual(tray.backgroundColor, 'rgb(1, 2, 3)', 'background');
      assert.strictEqual(tray.backdropFilter, 'none', 'blur');

      const backdrop = el('[data-test-backdrop]');
      backdrop.style.setProperty('--mobile-drawer-progress', '1');
      assert.strictEqual(
        Number(getComputedStyle(backdrop).opacity),
        0.9,
        'backdrop opacity',
      );

      assert.strictEqual(
        getComputedStyle(el('[data-test-grabber]'), '::before').width,
        '50px',
        'grabber',
      );
    } finally {
      style.remove();
    }
  });
});

class SheetState {
  @tracked active = 0;
  placement: 'bottom' | 'top';
  constructor(placement: 'bottom' | 'top') {
    this.placement = placement;
  }
  setActive = (index: number) => (this.active = index);
}

const SHEET_SNAP_POINTS: SnapPoint[] = [0, '40%', '100%'];

/** Waits a few animation frames, for the component's scroll reset. */
async function frames(count = 3) {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await settled();
}

/** The largest overlap (px) of the strip with any other content child. */
function contentOverlap(root: Element): number {
  const content = root.querySelector('.mobile-drawer__content')!;
  const strip = root
    .querySelector('.mobile-drawer-theme-ios__grabber')!
    .getBoundingClientRect();
  let overlap = 0;
  for (const child of Array.from(content.children)) {
    if (child.classList.contains('mobile-drawer-theme-ios__grabber')) continue;
    const r = child.getBoundingClientRect();
    overlap = Math.max(
      overlap,
      Math.min(r.bottom, strip.bottom) - Math.max(r.top, strip.top),
    );
  }
  return overlap;
}

module('Integration | themes/ios.css | with the component', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    drawerEnvironment.prefersReducedMotion = () => true;
  });

  hooks.afterEach(function () {
    delete drawerEnvironment.prefersReducedMotion;
  });

  async function renderSheet(state: SheetState) {
    const isTop = state.placement === 'top';
    const lines = TALL_LINES;
    await render(
      <template>
        <div class="mobile-drawer-theme-ios">
          <MobileDrawer
            @placement={{state.placement}}
            @snapPoints={{SHEET_SNAP_POINTS}}
            @activeSnapPoint={{state.active}}
            @onSnapPointChange={{state.setActive}}
          >
            {{#unless isTop}}
              <div class="mobile-drawer-theme-ios__grabber"></div>
            {{/unless}}
            {{#each lines as |line|}}
              <p>{{line}}</p>
            {{/each}}
            {{#if isTop}}
              <div class="mobile-drawer-theme-ios__grabber"></div>
            {{/if}}
          </MobileDrawer>
        </div>
      </template>,
    );
    await frames();
    return find('.mobile-drawer')!;
  }

  // The strip is transparent below the highest snap point. That is only
  // right if no content is under it there, which the component's scroll
  // reset guarantees (the tray is at its scroll start).
  test('top: at a partial snap point no content is under the transparent strip', async function (assert) {
    const state = new SheetState('top');
    const root = await renderSheet(state);
    state.active = 1;
    await frames();

    const tray = root.querySelector<HTMLElement>('.mobile-drawer__tray')!;
    assert.dom(root).doesNotHaveAttribute('data-expanded');
    assert.true(tray.scrollHeight > tray.clientHeight, 'the content scrolls');
    const strip = root.querySelector('.mobile-drawer-theme-ios__grabber')!;
    assert.strictEqual(
      getComputedStyle(strip).backgroundColor,
      'rgba(0, 0, 0, 0)',
      'transparent',
    );
    const overlap = contentOverlap(root);
    assert.true(overlap <= 0, `no content under the strip (${overlap}px)`);
  });

  test('bottom: reopened at a partial snap point after a scroll, no content is under the transparent strip', async function (assert) {
    const state = new SheetState('bottom');
    const root = await renderSheet(state);
    state.active = 2;
    await frames();
    assert.dom(root).hasAttribute('data-expanded');

    const tray = root.querySelector<HTMLElement>('.mobile-drawer__tray')!;
    tray.scrollTop = 200;
    assert.true(tray.scrollTop > 0, 'scrolled');
    assert.true(contentOverlap(root) > 0, 'expanded: content under the strip');

    state.active = 0;
    await frames();
    state.active = 1;
    await frames();

    assert.dom(root).doesNotHaveAttribute('data-expanded');
    const strip = root.querySelector('.mobile-drawer-theme-ios__grabber')!;
    assert.strictEqual(
      getComputedStyle(strip).backgroundColor,
      'rgba(0, 0, 0, 0)',
      'transparent',
    );
    const overlap = contentOverlap(root);
    assert.true(overlap <= 0, `no content under the strip (${overlap}px)`);
  });

  for (const placement of ['bottom', 'top'] as const) {
    test(`${placement}: glass at a partial snap point, opaque with a strip in the same colour at the highest`, async function (assert) {
      const state = new SheetState(placement);
      const root = await renderSheet(state);
      const tray = root.querySelector<HTMLElement>('.mobile-drawer__tray')!;
      const strip = root.querySelector('.mobile-drawer-theme-ios__grabber')!;

      state.active = 1;
      await frames();
      finishTransitions();
      assert.dom(root).doesNotHaveAttribute('data-expanded');
      assert.strictEqual(
        getComputedStyle(tray).backgroundColor,
        GLASS.light.background,
        'partial: glass',
      );
      assert.strictEqual(
        getComputedStyle(tray).backdropFilter,
        'blur(30px) saturate(1.8)',
      );

      state.active = 2;
      await frames();
      finishTransitions();
      assert.dom(root).hasAttribute('data-expanded');
      const trayStyle = getComputedStyle(tray);
      assert.strictEqual(
        rgb(trayStyle.backgroundColor),
        SOLID.light,
        'highest: opaque',
      );
      assert.strictEqual(trayStyle.backdropFilter, 'none');
      assert.strictEqual(
        getComputedStyle(strip).backgroundColor,
        trayStyle.backgroundColor,
        'highest: the strip has the sheet colour',
      );
    });
  }
});
