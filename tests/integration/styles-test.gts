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
    `.mobile-drawer[data-placement="${placement}"] > .mobile-drawer__tray`,
  );
}

function contentRule(placement: Placement): CSSStyleRule {
  return baseRule(
    `.mobile-drawer[data-placement="${placement}"] > .mobile-drawer__tray > .mobile-drawer__content`,
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
        <div class="mobile-drawer__tray" data-test-tray>
          <div class="mobile-drawer__content" data-test-content-wrapper>
            {{! template-lint-disable no-inline-styles }}
            <div style="width: 100px; height: 80px" data-test-content>
              Content
            </div>
          </div>
        </div>
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

    test(`${placement}: unlayered app styles can change the content alignment`, async function (assert) {
      await renderDrawer(placement);
      const style = addAppStyles(`
        .mobile-drawer__tray { display: block; }
        .mobile-drawer__content { margin: 0; }
      `);

      try {
        const tray = el('[data-test-tray]');
        tray.style.transform = 'none';
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
            <div class="mobile-drawer__tray" data-test-tray></div>
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
});
