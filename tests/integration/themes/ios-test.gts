import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, find } from '@ember/test-helpers';
import { htmlSafe } from '@ember/template';
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

const TALL_LINES = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);

/**
 * Renders the drawer markup inside a wrapper with the given `color-scheme`,
 * with or without the theme class on the wrapper. The grabber goes first,
 * or last for a top drawer. With `tall` the content is much longer than the
 * drawer and the tray rests fully open (`transform: none`), as at the
 * highest snap point.
 */
async function renderDrawer({
  themed = true,
  placement = 'bottom',
  scheme = 'light',
  tall = false,
}: {
  themed?: boolean;
  placement?: Placement;
  scheme?: Scheme;
  tall?: boolean;
} = {}) {
  const wrapperClass = themed ? 'mobile-drawer-theme-ios' : '';
  const wrapperStyle = htmlSafe(`color-scheme: ${scheme}`);
  const trayStyle = htmlSafe(tall ? 'transform: none' : '');
  const isTop = placement === 'top';
  const lines = tall ? TALL_LINES : ['Content'];
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div class={{wrapperClass}} style={{wrapperStyle}}>
        <div class="mobile-drawer" data-placement={{placement}} data-test-root>
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
        </div>
      </div>
    </template>,
  );
}

/**
 * Applies the rules inside the theme's reduced transparency @media block as
 * if it matched: same layer, later in source order. Remove the returned
 * style element when done.
 */
function applyReducedTransparency(): HTMLStyleElement {
  const media = themeMediaRule('prefers-reduced-transparency: reduce');
  const inner = Array.from(media.cssRules)
    .map((rule) => rule.cssText)
    .join('\n');
  return addStyles(`@layer ember-mobile-drawer { ${inner} }`);
}

module('Integration | themes/ios.css', function (hooks) {
  setupRenderingTest(hooks);

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
      await renderDrawer({ placement, tall: true });

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
    test(`${scheme}: on the glass sheet the grabber has the opaque sheet colour behind it`, async function (assert) {
      await renderDrawer({ scheme, tall: true });

      const tray = getComputedStyle(el('[data-test-tray]'));
      assert.strictEqual(tray.backgroundColor, GLASS[scheme].background);
      const grabber = getComputedStyle(el('[data-test-grabber]'));
      assert.strictEqual(grabber.position, 'sticky');
      // The glass tint without its transparency: the solid sheet colour.
      assert.strictEqual(rgb(grabber.backgroundColor), SOLID[scheme]);
      assert.strictEqual(grabber.backdropFilter, 'none', 'no second blur');
    });

    test(`${scheme}: on the solid sheet the grabber has the solid sheet colour behind it`, async function (assert) {
      await renderDrawer({ scheme, tall: true });
      const style = applyReducedTransparency();

      try {
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(tray.backgroundColor, SOLID[scheme]);
        const grabber = getComputedStyle(el('[data-test-grabber]'));
        assert.strictEqual(rgb(grabber.backgroundColor), SOLID[scheme]);
      } finally {
        style.remove();
      }
    });
  }

  test("the grabber follows the app's sheet background, made opaque", async function (assert) {
    await renderDrawer({ tall: true });
    const style = addStyles(
      '.mobile-drawer-theme-ios { --mobile-drawer-background: rgb(10 20 30 / 0.5); }',
    );

    try {
      const grabber = getComputedStyle(el('[data-test-grabber]'));
      assert.strictEqual(rgb(grabber.backgroundColor), 'rgb(10, 20, 30)');
    } finally {
      style.remove();
    }
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
