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

/**
 * Renders the drawer markup inside a wrapper with the given `color-scheme`,
 * with or without the theme class on the wrapper.
 */
async function renderDrawer({
  themed = true,
  placement = 'bottom',
  scheme = 'light',
}: { themed?: boolean; placement?: Placement; scheme?: Scheme } = {}) {
  const wrapperClass = themed ? 'mobile-drawer-theme-ios' : '';
  const wrapperStyle = htmlSafe(`color-scheme: ${scheme}`);
  await render(
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div class={{wrapperClass}} style={{wrapperStyle}}>
        <div class="mobile-drawer" data-placement={{placement}} data-test-root>
          <div class="mobile-drawer__backdrop" data-test-backdrop></div>
          <div class="mobile-drawer__tray" data-test-tray>
            <div class="mobile-drawer__content">
              <div
                class="mobile-drawer-theme-ios__grabber"
                data-test-grabber
              ></div>
              Content
            </div>
          </div>
        </div>
      </div>
    </template>,
  );
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

      // Apply the rules inside the @media block as if it matched: same
      // layer, later in source order.
      const media = themeMediaRule('prefers-reduced-transparency: reduce');
      assert.true(
        media.conditionText.includes('prefers-contrast: more'),
        'also for increased contrast',
      );
      const inner = Array.from(media.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = addStyles(`@layer ember-mobile-drawer { ${inner} }`);

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
    const style = getComputedStyle(grabber);
    assert.strictEqual(style.width, '36px');
    assert.strictEqual(style.height, '5px');
    assert.strictEqual(style.borderTopLeftRadius, '2.5px');
    assert.notStrictEqual(style.backgroundColor, 'rgba(0, 0, 0, 0)');

    const trayRect = el('[data-test-tray]').getBoundingClientRect();
    const rect = grabber.getBoundingClientRect();
    assert.strictEqual(
      rect.left - trayRect.left,
      trayRect.right - rect.right,
      'centred horizontally',
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
      .mobile-drawer-theme-ios__grabber { width: 50px; }
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
        getComputedStyle(el('[data-test-grabber]')).width,
        '50px',
        'grabber',
      );
    } finally {
      style.remove();
    }
  });
});
