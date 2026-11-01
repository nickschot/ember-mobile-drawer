import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, find } from '@ember/test-helpers';
import '#src/styles.css';

type Placement = 'bottom' | 'top' | 'left' | 'right';

const PLACEMENTS: Placement[] = ['bottom', 'top', 'left', 'right'];

function el(selector: string): HTMLElement {
  const element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`No element found for ${selector}`);
  }
  return element;
}

function translation(element: HTMLElement): { x: number; y: number } {
  const matrix = new DOMMatrix(getComputedStyle(element).transform);
  return { x: matrix.m41, y: matrix.m42 };
}

type Side = 'top' | 'right' | 'bottom' | 'left';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const OPPOSITE: Record<Placement, Side> = {
  bottom: 'top',
  top: 'bottom',
  left: 'right',
  right: 'left',
};

/**
 * Finds the base rule for a selector in the stylesheet. Every base selector
 * is wrapped in :where(), so the rule is matched on `:where(<selector>)`.
 * Safe-area insets compute to 0 in desktop Chrome, so their sides are
 * checked on the rule text instead of on computed styles.
 */
function baseRule(selector: string): CSSStyleRule {
  const wrapped = `:where(${selector})`;
  const visit = (rules: CSSRuleList): CSSStyleRule | undefined => {
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSStyleRule &&
        rule.selectorText.split(/\s*,\s*/).includes(wrapped)
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
  throw new Error(`No rule found for ${wrapped}`);
}

function trayRule(placement: Placement): CSSStyleRule {
  return baseRule(
    `.mobile-drawer[data-placement="${placement}"] > .mobile-drawer__sheet > .mobile-drawer__tray`,
  );
}

function contentRule(placement: Placement): CSSStyleRule {
  return baseRule(
    `.mobile-drawer[data-placement="${placement}"] > .mobile-drawer__sheet > .mobile-drawer__tray > .mobile-drawer__content`,
  );
}

/** Adds app CSS to the page for the duration of a test. */
function addAppStyles(css: string, { prepend = false } = {}): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  if (prepend) {
    document.head.prepend(style);
  } else {
    document.head.append(style);
  }
  return style;
}

/** Splits a shorthand value into its top-level space-separated parts. */
function splitValue(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ' ' && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Expands a 1-4 value box shorthand into top/right/bottom/left. */
function boxSides(value: string): Record<Side, string> {
  const [top, right = top, bottom = top, left = right] = splitValue(value) as [
    string,
    string?,
    string?,
    string?,
  ];
  return { top, right, bottom, left };
}

async function renderDrawer(placement?: Placement, closed = false) {
  await render(
    <template>
      <div
        class="mobile-drawer"
        data-placement={{placement}}
        data-closed={{closed}}
        data-test-root
      >
        <div class="mobile-drawer__backdrop" data-test-backdrop></div>
        <div class="mobile-drawer__backdrop-tint" data-test-backdrop-tint></div>
        <div class="mobile-drawer__sheet">
          <div class="mobile-drawer__tray" data-test-tray>
            <div class="mobile-drawer__content" data-test-content-wrapper>
              {{! template-lint-disable no-inline-styles }}
              <div style="width: 100px; height: 80px" data-test-content>
                Content
              </div>
            </div>
          </div>
        </div>
        <div class="mobile-drawer__bar-tint" data-test-bar-tint></div>
      </div>
    </template>,
  );
}

module('Integration | styles.css', function (hooks) {
  setupRenderingTest(hooks);

  test('the root overlays its container without capturing pointer events', async function (assert) {
    await renderDrawer();

    const root = getComputedStyle(el('[data-test-root]'));
    assert.strictEqual(root.position, 'fixed');
    assert.strictEqual(root.pointerEvents, 'none');
    assert.strictEqual(root.overflow, 'hidden');
    assert.strictEqual(root.zIndex, '1000');

    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).pointerEvents,
      'auto',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-backdrop]')).pointerEvents,
      'auto',
    );
  });

  test('without a placement the tray uses the bottom layout', async function (assert) {
    await renderDrawer();

    const tray = el('[data-test-tray]');
    tray.style.transform = 'none';
    const rootRect = el('[data-test-root]').getBoundingClientRect();
    const trayRect = tray.getBoundingClientRect();

    assert.strictEqual(trayRect.bottom, rootRect.bottom);
    assert.strictEqual(trayRect.width, rootRect.width);
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: the tray rests flush against its edge at transform none`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      tray.style.transform = 'none';
      const rootRect = el('[data-test-root]').getBoundingClientRect();
      const trayRect = tray.getBoundingClientRect();

      assert.strictEqual(
        trayRect[placement],
        rootRect[placement],
        `tray touches the ${placement} edge`,
      );

      if (placement === 'bottom' || placement === 'top') {
        assert.strictEqual(trayRect.width, rootRect.width, 'spans the width');
        assert.true(trayRect.height < rootRect.height, 'sized by content');
      } else {
        assert.strictEqual(trayRect.height, rootRect.height, 'spans height');
        assert.true(trayRect.width < rootRect.width, 'sized by content');
      }
    });

    test(`${placement}: the tray starts fully closed until the component writes a transform`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      const { x, y } = translation(tray);
      const expected = {
        bottom: { x: 0, y: tray.offsetHeight },
        top: { x: 0, y: -tray.offsetHeight },
        left: { x: -tray.offsetWidth, y: 0 },
        right: { x: tray.offsetWidth, y: 0 },
      }[placement];

      assert.deepEqual({ x, y }, expected);

      tray.style.transform = 'translate3d(0, 0, 0)';
      assert.deepEqual(
        translation(tray),
        { x: 0, y: 0 },
        'an inline transform takes over',
      );
    });

    test(`${placement}: the tray is capped at the root and scrolls its overflow`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      tray.style.transform = 'none';
      el('[data-test-content]').style.cssText = 'width: 5000px; height: 5000px';
      const root = getComputedStyle(el('[data-test-root]'));
      const style = getComputedStyle(tray);
      const axis =
        placement === 'bottom' || placement === 'top' ? 'height' : 'width';

      assert.strictEqual(style[axis], root[axis], `${axis} is capped`);
      assert.strictEqual(style.overflowX, 'auto');
      assert.strictEqual(style.overflowY, 'auto');
      assert.strictEqual(style.overscrollBehaviorX, 'contain');
      assert.strictEqual(style.overscrollBehaviorY, 'contain');
      assert.true(
        axis === 'height'
          ? tray.scrollHeight > tray.clientHeight
          : tray.scrollWidth > tray.clientWidth,
        'content scrolls inside the tray',
      );
    });

    test(`${placement}: content sits against the leading edge of a larger tray`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      tray.style.transform = 'none';
      const vertical = placement === 'bottom' || placement === 'top';
      // As the component does when a snap point is larger than the content.
      tray.style[vertical ? 'height' : 'width'] = '300px';

      const trayRect = tray.getBoundingClientRect();
      const contentRect = el('[data-test-content]').getBoundingClientRect();
      // The edge that comes into view first, i.e. the one facing the root.
      const leading = OPPOSITE[placement];

      assert.strictEqual(
        contentRect[leading],
        trayRect[leading],
        `content touches the tray's ${leading} edge`,
      );
      assert.notStrictEqual(
        contentRect[placement],
        trayRect[placement],
        `content leaves the ${placement} edge empty`,
      );
      if (vertical) {
        assert.strictEqual(
          el('[data-test-content-wrapper]').getBoundingClientRect().width,
          trayRect.width,
          'the content element spans the width',
        );
      }
    });

    test(`${placement}: overflowing content scrolls from its start`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      tray.style.transform = 'none';
      el('[data-test-content]').style.cssText = 'width: 5000px; height: 5000px';
      const trayRect = tray.getBoundingClientRect();
      const contentRect = el(
        '[data-test-content-wrapper]',
      ).getBoundingClientRect();

      assert.strictEqual(tray.scrollTop, 0);
      assert.strictEqual(tray.scrollLeft, 0);
      assert.strictEqual(contentRect.top, trayRect.top, 'starts at the top');
      assert.strictEqual(contentRect.left, trayRect.left, 'starts at the left');

      // Content pushed out past the start (e.g. by justify-content) would be
      // cut off rather than scrollable.
      assert.true(tray.scrollHeight >= 5000, 'all of its height scrolls');
      assert.true(tray.scrollWidth >= 5000, 'all of its width scrolls');
    });

    test(`${placement}: the content's bottom padding stays at the end of a tall scroll`, async function (assert) {
      await renderDrawer(placement);
      // A stand-in for env(safe-area-inset-bottom), which is 0 on desktop.
      const style = addAppStyles(
        '.mobile-drawer__content { padding-bottom: 34px; }',
      );

      try {
        const tray = el('[data-test-tray]');
        tray.style.transform = 'none';
        el('[data-test-content]').style.cssText =
          'width: 100px; height: 5000px';

        assert.true(
          tray.scrollHeight > tray.clientHeight,
          'the content overflows the tray',
        );
        assert.strictEqual(
          tray.scrollHeight,
          5034,
          'the scroll range includes the padding after the content',
        );
      } finally {
        style.remove();
      }
    });

    test(`${placement}: unlayered app styles can change the content alignment`, async function (assert) {
      await renderDrawer(placement);
      const style = addAppStyles(`
        .mobile-drawer__tray { display: block; }
        .mobile-drawer__content { margin: 0; }
      `);

      try {
        const tray = el('[data-test-tray]');
        tray.style.transform = 'none';
        // As the component does when a snap point is larger than the content.
        tray.style.height = '300px';
        tray.style.width = '300px';
        const trayRect = tray.getBoundingClientRect();
        const contentRect = el(
          '[data-test-content-wrapper]',
        ).getBoundingClientRect();

        assert.strictEqual(getComputedStyle(tray).display, 'block');
        assert.strictEqual(contentRect.top, trayRect.top, 'at the top');
        assert.strictEqual(contentRect.left, trayRect.left, 'at the left');
      } finally {
        style.remove();
      }
    });

    test(`${placement}: the transform origin is the drawer's edge`, async function (assert) {
      await renderDrawer(placement);

      const style = getComputedStyle(el('[data-test-tray]'));
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const [x, y] = style.transformOrigin.split(' ').map(parseFloat);
      const expected = {
        bottom: [width / 2, height],
        top: [width / 2, 0],
        left: [0, height / 2],
        right: [width, height / 2],
      }[placement];

      assert.deepEqual([x, y], expected);
    });

    test(`${placement}: safe-area insets pad the content on the sides touching the viewport`, async function (assert) {
      await renderDrawer(placement);

      const rule = contentRule(placement);
      assert.true(
        el('[data-test-content-wrapper]').matches(rule.selectorText),
        'the rule applies to the content element',
      );

      const padding = boxSides(rule.style.getPropertyValue('padding'));
      const opposite = OPPOSITE[placement];

      for (const side of SIDES) {
        if (side === opposite) {
          assert.true(
            padding[side] === '0' || padding[side] === '0px',
            `no ${side} padding: ${padding[side]}`,
          );
        } else {
          assert.true(
            padding[side]?.startsWith(`env(safe-area-inset-${side}`),
            `${side} padding uses the ${side} inset: ${padding[side]}`,
          );
        }
      }

      const maxSize = trayRule(placement).style.getPropertyValue(
        opposite === 'top' || opposite === 'bottom'
          ? 'max-height'
          : 'max-width',
      );
      assert.true(
        maxSize.includes(`safe-area-inset-${opposite}`),
        `max size leaves room for the ${opposite} inset: ${maxSize}`,
      );
    });

    test(`${placement}: app padding on the tray keeps the safe-area padding`, async function (assert) {
      await renderDrawer(placement);
      const style = addAppStyles('.mobile-drawer__tray { padding: 16px; }');

      try {
        assert.strictEqual(
          getComputedStyle(el('[data-test-tray]')).padding,
          '16px',
          'app padding applies to the tray',
        );
        assert.strictEqual(
          trayRule(placement).style.getPropertyValue('padding'),
          '',
          'base tray rule sets no padding the app could overwrite',
        );
        assert.strictEqual(
          baseRule('.mobile-drawer__tray').style.getPropertyValue('padding'),
          '',
          'default tray rule sets no padding either',
        );
        assert.true(
          el('[data-test-content-wrapper]').matches(
            contentRule(placement).selectorText,
          ),
          'safe-area rule still applies to the content element',
        );
      } finally {
        style.remove();
      }
    });

    test(`${placement}: plain class selectors in the drawer layer beat the base styles`, async function (assert) {
      await renderDrawer(placement, true);
      // Same layer, as a theme would use: only specificity separates them.
      const style = addAppStyles(`
        @layer ember-mobile-drawer {
          .mobile-drawer { position: absolute; visibility: visible; }
          .mobile-drawer__tray {
            overflow: hidden;
            max-height: 7px;
            max-width: 7px;
            transform-origin: 1px 2px;
            border-radius: 3px;
            will-change: auto;
          }
        }
      `);

      try {
        const root = getComputedStyle(el('[data-test-root]'));
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(root.position, 'absolute');
        assert.strictEqual(root.visibility, 'visible', 'beats [data-closed]');
        assert.strictEqual(tray.overflowY, 'hidden');
        assert.strictEqual(tray.maxHeight, '7px');
        assert.strictEqual(tray.maxWidth, '7px');
        assert.strictEqual(tray.transformOrigin, '1px 2px');
        assert.strictEqual(tray.borderTopLeftRadius, '3px');
        assert.strictEqual(tray.borderBottomRightRadius, '3px');
      } finally {
        style.remove();
      }
    });

    test(`${placement}: layered app styles win when the drawer layer is declared first`, async function (assert) {
      await renderDrawer(placement);
      // Prepended, so the app's layer is seen before the drawer's stylesheet.
      const style = addAppStyles(
        `
        @layer ember-mobile-drawer, app;
        @layer app {
          .mobile-drawer { position: absolute; }
          .mobile-drawer__tray { transform-origin: 1px 2px; max-height: 7px; }
        }
      `,
        { prepend: true },
      );

      try {
        assert.strictEqual(
          getComputedStyle(el('[data-test-root]')).position,
          'absolute',
        );
        const tray = getComputedStyle(el('[data-test-tray]'));
        assert.strictEqual(tray.transformOrigin, '1px 2px');
        assert.strictEqual(tray.maxHeight, '7px');
      } finally {
        style.remove();
      }
    });

    test(`${placement}: the radius applies to the corners facing away from the edge`, async function (assert) {
      await renderDrawer(placement);

      const tray = el('[data-test-tray]');
      tray.style.setProperty('--mobile-drawer-radius', '12px');
      const style = getComputedStyle(tray);
      const corners = {
        'top-left': style.borderTopLeftRadius,
        'top-right': style.borderTopRightRadius,
        'bottom-right': style.borderBottomRightRadius,
        'bottom-left': style.borderBottomLeftRadius,
      };
      const rounded = {
        bottom: ['top-left', 'top-right'],
        top: ['bottom-right', 'bottom-left'],
        left: ['top-right', 'bottom-right'],
        right: ['top-left', 'bottom-left'],
      }[placement];

      for (const [corner, value] of Object.entries(corners)) {
        assert.strictEqual(
          value,
          rounded.includes(corner) ? '12px' : '0px',
          `${corner} corner`,
        );
      }
    });
  }

  test('data-closed hides the drawer and drops the layer hint', async function (assert) {
    await renderDrawer('bottom', true);

    assert.strictEqual(
      getComputedStyle(el('[data-test-root]')).visibility,
      'hidden',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).willChange,
      'auto',
    );

    await renderDrawer('bottom', false);

    assert.strictEqual(
      getComputedStyle(el('[data-test-root]')).visibility,
      'visible',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).willChange,
      'transform',
    );
  });

  test('backdrop opacity is the max opacity scaled by progress', async function (assert) {
    await renderDrawer();

    const backdrop = el('[data-test-backdrop]');
    const opacity = () => Number(getComputedStyle(backdrop).opacity);

    assert.strictEqual(opacity(), 0, 'transparent without progress');

    backdrop.style.setProperty('--mobile-drawer-progress', '1');
    assert.strictEqual(opacity(), 0.4, 'default max opacity');

    el('[data-test-root]').style.setProperty(
      '--mobile-drawer-backdrop-opacity',
      '0.6',
    );
    backdrop.style.setProperty('--mobile-drawer-progress', '0.5');
    assert.strictEqual(opacity(), 0.3, 'custom max opacity');
  });

  test('custom properties set on an ancestor override the defaults', async function (assert) {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          style="--mobile-drawer-background: rgb(1, 2, 3); --mobile-drawer-color: rgb(4, 5, 6); --mobile-drawer-shadow: none; --mobile-drawer-backdrop-color: rgb(7, 8, 9); --mobile-drawer-z-index: 5"
        >
          <div class="mobile-drawer" data-test-root>
            <div class="mobile-drawer__backdrop" data-test-backdrop></div>
            <div class="mobile-drawer__sheet">
              <div class="mobile-drawer__tray" data-test-tray></div>
            </div>
          </div>
        </div>
      </template>,
    );

    const tray = getComputedStyle(el('[data-test-tray]'));
    assert.strictEqual(tray.backgroundColor, 'rgb(1, 2, 3)');
    assert.strictEqual(tray.color, 'rgb(4, 5, 6)');
    assert.strictEqual(tray.boxShadow, 'none');
    assert.strictEqual(
      getComputedStyle(el('[data-test-backdrop]')).backgroundColor,
      'rgb(7, 8, 9)',
    );
    assert.strictEqual(getComputedStyle(el('[data-test-root]')).zIndex, '5');
  });

  test('without a layer order declaration, the first-seen layer loses', async function (assert) {
    await renderDrawer();
    const css = '@layer app { .mobile-drawer { position: absolute; } }';
    const position = () => getComputedStyle(el('[data-test-root]')).position;

    let style = addAppStyles(css);
    try {
      assert.strictEqual(position(), 'absolute', 'app layer seen after wins');
    } finally {
      style.remove();
    }

    style = addAppStyles(css, { prepend: true });
    try {
      assert.strictEqual(position(), 'fixed', 'app layer seen before loses');
    } finally {
      style.remove();
    }
  });

  test('unlayered app styles win regardless of order', async function (assert) {
    await renderDrawer();
    const style = addAppStyles('.mobile-drawer { position: absolute; }', {
      prepend: true,
    });

    try {
      assert.strictEqual(
        getComputedStyle(el('[data-test-root]')).position,
        'absolute',
      );
    } finally {
      style.remove();
    }
  });

  test('the recommended layer order keeps the insets safe from resets', async function (assert) {
    await renderDrawer();
    const content = () => getComputedStyle(el('[data-test-content-wrapper]'));
    const reset = `
      @layer base { * { padding: 5px; } }
      @layer utilities { .mobile-drawer__tray { max-height: 7px; } }
    `;

    let style = addAppStyles(
      `@layer theme, base, ember-mobile-drawer, components, utilities;${reset}`,
      { prepend: true },
    );
    try {
      assert.strictEqual(
        content().padding,
        '0px',
        'the reset does not override the safe-area padding',
      );
      assert.strictEqual(
        getComputedStyle(el('[data-test-tray]')).maxHeight,
        '7px',
        'utilities still win',
      );
    } finally {
      style.remove();
    }

    style = addAppStyles(
      `@layer ember-mobile-drawer, theme, base, components, utilities;${reset}`,
      { prepend: true },
    );
    try {
      assert.strictEqual(
        content().padding,
        '5px',
        'with the drawer layer first, the reset wipes the safe-area padding',
      );
    } finally {
      style.remove();
    }
  });

  /**
   * The iOS-only block for the Safari 26 bars (#85). Chrome doesn't match its
   * condition, so the tests check that it is in the layer and not applied,
   * and then apply a copy of its rules without the condition.
   */
  function iosEdgesRule(): CSSSupportsRule {
    const visit = (
      rules: CSSRuleList,
      layer: string | undefined,
    ): CSSSupportsRule | undefined => {
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSSupportsRule &&
          rule.conditionText.includes('-webkit-touch-callout: none') &&
          layer === 'ember-mobile-drawer'
        ) {
          return rule;
        }
        if (rule instanceof CSSGroupingRule) {
          const found = visit(
            rule.cssRules,
            rule instanceof CSSLayerBlockRule ? rule.name : layer,
          );
          if (found) return found;
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      const found = visit(sheet.cssRules, undefined);
      if (found) return found;
    }
    throw new Error('No iOS @supports rule in the ember-mobile-drawer layer');
  }

  test('the iOS bar rules are in the layer and do not apply in other browsers', async function (assert) {
    await renderDrawer();

    const rule = iosEdgesRule();
    assert.true(
      rule.conditionText.includes('color-mix('),
      'only where color-mix() is supported',
    );
    assert.false(CSS.supports(rule.conditionText), 'Chrome does not match');

    const backdrop = getComputedStyle(el('[data-test-backdrop]'));
    assert.strictEqual(backdrop.position, 'absolute');
    assert.strictEqual(backdrop.filter, 'none');
    assert.strictEqual(backdrop.backgroundColor, 'rgb(0, 0, 0)');
    assert.strictEqual(
      getComputedStyle(el('[data-test-tray]')).position,
      'absolute',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-root]')).contain,
      'none',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-bar-tint]')).display,
      'none',
      'no bar tint',
    );
    assert.strictEqual(
      getComputedStyle(el('[data-test-backdrop-tint]')).display,
      'none',
      'no backdrop tint',
    );
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: the tints are not shown in other browsers`, async function (assert) {
      await renderDrawer(placement);
      assert.strictEqual(
        getComputedStyle(el('[data-test-bar-tint]')).display,
        'none',
      );
      assert.strictEqual(
        getComputedStyle(el('[data-test-backdrop-tint]')).display,
        'none',
      );
    });
  }

  /** Applies a copy of the iOS block's rules without its condition. */
  function applyIosRules(): HTMLStyleElement {
    const inner = Array.from(iosEdgesRule().cssRules)
      .map((rule) => rule.cssText)
      .join('\n');
    return addAppStyles(`@layer ember-mobile-drawer { ${inner} }`);
  }

  for (const placement of ['bottom', 'top'] as const) {
    test(`${placement}: the iOS bar tint is an invisible strip in the sheet colour at the sheet's edge`, async function (assert) {
      await renderDrawer(placement);
      const style = applyIosRules();
      try {
        const root = el('[data-test-root]');
        const tint = el('[data-test-bar-tint]');
        const tray = el('[data-test-tray]');
        const computed = getComputedStyle(tint);

        assert.strictEqual(computed.display, 'block');
        assert.strictEqual(computed.position, 'fixed');
        assert.strictEqual(computed.pointerEvents, 'none', 'takes no hits');
        assert.true(
          Number(computed.zIndex) > 0,
          'in front of the tray, so Safari samples it first',
        );
        assert.strictEqual(
          tint.compareDocumentPosition(tray) & Node.DOCUMENT_POSITION_PRECEDING,
          Node.DOCUMENT_POSITION_PRECEDING,
          'after the tray in the markup',
        );

        // Invisible: all of its height is padding and the background is
        // clipped to the empty content box.
        assert.strictEqual(computed.height, '16px');
        assert.strictEqual(computed.backgroundClip, 'content-box');
        const padding =
          placement === 'bottom' ? computed.paddingTop : computed.paddingBottom;
        assert.strictEqual(padding, '16px', 'all of it is padding');
        assert.strictEqual(
          placement === 'bottom' ? computed.paddingBottom : computed.paddingTop,
          '0px',
        );
        assert.strictEqual(tint.clientHeight, 16);

        // At the sheet's edge of the root, across its full width.
        const rootBox = root.getBoundingClientRect();
        const box = tint.getBoundingClientRect();
        assert.strictEqual(box.left, rootBox.left);
        assert.strictEqual(box.width, rootBox.width);
        if (placement === 'bottom') {
          assert.strictEqual(box.bottom, rootBox.bottom, 'at the bottom');
        } else {
          assert.strictEqual(box.top, rootBox.top, 'at the top');
        }

        // The sheet colour, also an app value.
        assert.strictEqual(
          computed.backgroundColor,
          getComputedStyle(tray).backgroundColor,
          'the tray colour',
        );
        root.style.setProperty('--mobile-drawer-background', 'rgb(1 2 3)');
        assert.strictEqual(computed.backgroundColor, 'rgb(1, 2, 3)');

        root.setAttribute('data-closed', '');
        assert.strictEqual(
          computed.visibility,
          'hidden',
          'hidden while closed',
        );
        assert.strictEqual(
          computed.display,
          'block',
          'still rendered while closed, so a transition can run on open',
        );
      } finally {
        style.remove();
      }
    });

    test(`${placement}: the iOS backdrop tint is an invisible strip in the backdrop colour at the far edge`, async function (assert) {
      await renderDrawer(placement);
      const style = applyIosRules();
      try {
        const root = el('[data-test-root]');
        const tint = el('[data-test-backdrop-tint]');
        const computed = getComputedStyle(tint);

        assert.strictEqual(computed.display, 'block');
        assert.strictEqual(computed.position, 'fixed');
        assert.strictEqual(computed.pointerEvents, 'none', 'takes no hits');
        assert.true(
          Number(computed.zIndex) > 0,
          'in front of the tray, also at full height',
        );

        // Invisible: all of its height is padding on the side away from the
        // edge, and the background is clipped to the empty content box.
        assert.strictEqual(computed.height, '16px');
        assert.strictEqual(computed.backgroundClip, 'content-box');
        assert.strictEqual(tint.clientHeight, 16);
        assert.strictEqual(
          placement === 'bottom' ? computed.paddingBottom : computed.paddingTop,
          '16px',
        );

        // At the far edge of the root, across its full width.
        const rootBox = root.getBoundingClientRect();
        const box = tint.getBoundingClientRect();
        assert.strictEqual(box.left, rootBox.left);
        assert.strictEqual(box.width, rootBox.width);
        if (placement === 'bottom') {
          assert.strictEqual(box.top, rootBox.top, 'at the top');
        } else {
          assert.strictEqual(box.bottom, rootBox.bottom, 'at the bottom');
        }

        // The backdrop as it shows: max opacity times the progress, at
        // least 0.01.
        const alpha = () => {
          const match = /\/ ([\d.]+)\)$/.exec(computed.backgroundColor);
          return match ? Math.round(Number(match[1]) * 1000) / 1000 : NaN;
        };
        assert.true(
          computed.backgroundColor.startsWith('color(srgb 0 0 0 /'),
          `the backdrop colour (${computed.backgroundColor})`,
        );
        assert.strictEqual(alpha(), 0.01, 'progress 0: the minimum');
        tint.style.setProperty('--mobile-drawer-progress', '0.5');
        assert.strictEqual(alpha(), 0.2, 'half of the default max 0.4');
        tint.style.setProperty('--mobile-drawer-progress', '1');
        assert.strictEqual(alpha(), 0.4, 'the max opacity');
        root.style.setProperty('--mobile-drawer-backdrop-opacity', '0.6');
        root.style.setProperty('--mobile-drawer-backdrop-color', 'rgb(7 8 9)');
        assert.strictEqual(alpha(), 0.6, 'a custom max opacity');
        assert.true(
          computed.backgroundColor.startsWith('color(srgb 0.0'),
          `a custom colour (${computed.backgroundColor})`,
        );

        root.setAttribute('data-closed', '');
        assert.strictEqual(
          computed.visibility,
          'hidden',
          'hidden while closed',
        );
      } finally {
        style.remove();
      }
    });
  }

  for (const placement of ['left', 'right'] as const) {
    test(`${placement}: the iOS rules show no tints`, async function (assert) {
      await renderDrawer(placement);
      const style = applyIosRules();
      try {
        assert.strictEqual(
          getComputedStyle(el('[data-test-bar-tint]')).display,
          'none',
        );
        assert.strictEqual(
          getComputedStyle(el('[data-test-backdrop-tint]')).display,
          'none',
        );
      } finally {
        style.remove();
      }
    });
  }

  test('the iOS bar tint stays in an embedded root', async function (assert) {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style="position: relative; width: 300px; height: 200px">
          <div class="mobile-drawer" style="position: absolute" data-test-root>
            <div class="mobile-drawer__sheet">
              <div class="mobile-drawer__tray">
                <div class="mobile-drawer__content"></div>
              </div>
            </div>
            <div class="mobile-drawer__bar-tint" data-test-bar-tint></div>
          </div>
        </div>
      </template>,
    );
    const style = applyIosRules();
    try {
      const rootBox = el('[data-test-root]').getBoundingClientRect();
      const box = el('[data-test-bar-tint]').getBoundingClientRect();
      assert.strictEqual(box.width, rootBox.width);
      assert.strictEqual(box.bottom, rootBox.bottom);
    } finally {
      style.remove();
    }
  });

  test('the iOS bar rules fade the backdrop with a filter and fix the tray in the root', async function (assert) {
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style="position: relative; width: 300px; height: 200px">
          <div class="mobile-drawer" style="position: absolute" data-test-root>
            <div class="mobile-drawer__backdrop" data-test-backdrop></div>
            <div class="mobile-drawer__sheet">
              <div class="mobile-drawer__tray" data-test-tray>
                <div class="mobile-drawer__content" style="height: 50px"></div>
              </div>
            </div>
          </div>
        </div>
      </template>,
    );

    const inner = Array.from(iosEdgesRule().cssRules)
      .map((rule) => rule.cssText)
      .join('\n');
    const style = addAppStyles(`@layer ember-mobile-drawer { ${inner} }`);

    try {
      const root = el('[data-test-root]');
      const backdrop = el('[data-test-backdrop]');
      const tray = el('[data-test-tray]');
      const computed = getComputedStyle(backdrop);

      assert.strictEqual(getComputedStyle(root).contain, 'layout');
      assert.strictEqual(getComputedStyle(tray).position, 'fixed');
      assert.strictEqual(computed.opacity, '1', 'opacity stays 1');
      assert.strictEqual(computed.filter, 'opacity(0)', 'closed: faded out');
      assert.strictEqual(
        computed.backgroundColor,
        'color(srgb 0 0 0 / 0.4)',
        'the max opacity is the alpha of the background',
      );

      backdrop.style.setProperty('--mobile-drawer-progress', '0.5');
      root.style.setProperty('--mobile-drawer-backdrop-opacity', '0.6');
      root.style.setProperty('--mobile-drawer-backdrop-color', 'rgb(7 8 9)');
      assert.strictEqual(computed.filter, 'opacity(0.5)');
      assert.true(
        computed.backgroundColor.endsWith(' / 0.6)'),
        `custom colour and max opacity (${computed.backgroundColor})`,
      );

      // contain: layout keeps the fixed tray in an embedded root.
      tray.style.transform = 'none';
      // Compare boxes: the test container may be scaled.
      const rootBox = root.getBoundingClientRect();
      const trayBox = tray.getBoundingClientRect();
      assert.strictEqual(trayBox.width, rootBox.width, 'as wide as the root');
      assert.strictEqual(trayBox.bottom, rootBox.bottom, 'on the root bottom');
      assert.strictEqual(tray.offsetHeight, 50);

      // The sheet is the fixed tray's containing block, so it clips it.
      const sheet = tray.parentElement!;
      assert.strictEqual(getComputedStyle(sheet).contain, 'layout');
      root.style.contain = 'none';
      sheet.style.contain = 'none';
      // The open sheet's `will-change: translate` (#142) is a containing
      // block too.
      sheet.style.willChange = 'auto';
      assert.notStrictEqual(
        tray.getBoundingClientRect().width,
        rootBox.width,
        'without contain: layout the fixed tray leaves the root',
      );
    } finally {
      style.remove();
    }
  });

  for (const placement of PLACEMENTS) {
    test(`${placement}: the iOS bar rules keep the tray box of a full-screen drawer`, async function (assert) {
      await renderDrawer(placement);
      const tray = el('[data-test-tray]');
      tray.style.transform = 'none';
      const box = () => {
        const { top, right, bottom, left } = tray.getBoundingClientRect();
        return { top, right, bottom, left };
      };
      const before = box();
      assert.strictEqual(getComputedStyle(tray).position, 'absolute');

      const inner = Array.from(iosEdgesRule().cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = addAppStyles(`@layer ember-mobile-drawer { ${inner} }`);
      try {
        assert.strictEqual(getComputedStyle(tray).position, 'fixed');
        assert.deepEqual(box(), before, 'the same box with the iOS rules');
      } finally {
        style.remove();
      }
    });
  }
});
