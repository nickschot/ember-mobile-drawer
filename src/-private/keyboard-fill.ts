/**
 * The sheet's colour below a bottom drawer while an on-screen keyboard is
 * open in iOS Safari.
 *
 * To show a focused field, iOS scrolls the visual viewport down in the layout
 * viewport. Safari clips fixed elements to the layout viewport, so the fixed
 * root ends above the bottom of the screen, and the page shows through the
 * translucent URL bar and keyboard in the strip below it. No part of the
 * drawer can paint there.
 *
 * The fill is an element in the document (not fixed, so it is not clipped), a
 * child of `<html>` so that a fixed `<body>` doesn't contain it, with the
 * tray's background and backdrop filter. While it shows, the root gets
 * `data-keyboard`. Other browsers keep client coordinates in the layout
 * viewport, so they never get a strip.
 *
 * Only one drawer shows a fill at a time, else nested bottom drawers would
 * show two at the same place: the innermost drawer that holds the focus, else
 * the drawer that became active last.
 *
 * @module
 * @internal
 */

/** A computed `backdrop-filter`, also where only the prefixed one is set. */
function backdropFilterOf(style: CSSStyleDeclaration): string {
  return (
    style.backdropFilter ||
    style.getPropertyValue('-webkit-backdrop-filter') ||
    'none'
  );
}

export const KEYBOARD_FILL_CLASS = 'mobile-drawer-keyboard-fill';
/** On the drawer's root while the fill shows. */
export const KEYBOARD_ATTRIBUTE = 'data-keyboard';

/** The part of `VisualViewport` this needs, see `drawerEnvironment`. */
export type ViewportLike = Pick<
  VisualViewport,
  'height' | 'addEventListener' | 'removeEventListener'
> &
  Partial<Pick<VisualViewport, 'scale'>>;

export interface KeyboardFillOptions {
  root: HTMLElement;
  tray: HTMLElement;
  /** A theme may put the tray's blur on this layer instead. */
  glass?: HTMLElement;
  viewport: ViewportLike | null;
  /** Open, from the bottom. */
  active: () => boolean;
  /** Whether focus on `element` keeps the keyboard open. */
  keepsKeyboard: (element: Element) => boolean;
  /** Also through the portals of the yielded `Nested`. */
  contains: (ancestor: Element, node: Node | null | undefined) => boolean;
}

const MIN_STRIP = 1;

interface Strip {
  top: number;
  height: number;
}

const fills = new Set<KeyboardFill>();
let activations = 0;

/** The focused element, also inside an open shadow root. */
function focusedElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  return element;
}

/** Shows the fill of the one drawer that should have it, hides the rest. */
function syncAll(): void {
  const candidates: { fill: KeyboardFill; strip: Strip }[] = [];
  for (const fill of fills) {
    const strip = fill.strip();
    if (strip) candidates.push({ fill, strip });
    else fill.hide();
  }
  const focused = focusedElement();
  const holding = candidates.filter(({ fill }) => fill.contains(focused));
  // The innermost drawer that holds the focus.
  let owner = holding.find(
    ({ fill }) =>
      !holding.some(
        (other) => other.fill !== fill && fill.contains(other.fill.root),
      ),
  );
  if (!owner) {
    for (const candidate of candidates) {
      if (!owner || candidate.fill.activation > owner.fill.activation) {
        owner = candidate;
      }
    }
  }
  for (const { fill, strip } of candidates) {
    if (owner?.fill === fill) fill.show(strip);
    else fill.hide();
  }
}

function hideAll(): void {
  for (const fill of fills) fill.hide();
}

export class KeyboardFill {
  #options: KeyboardFillOptions;
  #element?: HTMLElement;
  #listening = false;
  activation = 0;

  constructor(options: KeyboardFillOptions) {
    this.#options = options;
    options.root.addEventListener('focusout', this.#onFocusOut);
    fills.add(this);
  }

  get root(): HTMLElement {
    return this.#options.root;
  }

  contains(node: Node | null | undefined): boolean {
    return this.#options.contains(this.#options.root, node);
  }

  /** Call when the drawer opens or closes; syncs the fills of all drawers. */
  sync = (): void => {
    const { viewport, active } = this.#options;
    const on = active();
    if (viewport && on !== this.#listening) {
      this.#listening = on;
      if (on) this.activation = ++activations;
      const method = on ? 'addEventListener' : 'removeEventListener';
      viewport[method]('resize', this.sync);
      viewport[method]('scroll', this.sync);
    }
    syncAll();
  };

  /**
   * Copies the tray's colour to the fill again. It forces a style
   * calculation, so call it only when the colour can change.
   */
  paint(): void {
    const element = this.#element;
    if (!element?.isConnected) return;
    const tray = getComputedStyle(this.#options.tray);
    const { style } = element;
    style.backgroundColor = tray.backgroundColor;
    let filter = backdropFilterOf(tray);
    if (filter === 'none' && this.#options.glass) {
      const glass = getComputedStyle(this.#options.glass);
      if (glass.display !== 'none') filter = backdropFilterOf(glass);
    }
    style.setProperty('backdrop-filter', filter);
    style.setProperty('-webkit-backdrop-filter', filter);
    style.zIndex = getComputedStyle(this.#options.root).zIndex;
  }

  destroy(): void {
    const { viewport, root } = this.#options;
    root.removeEventListener('focusout', this.#onFocusOut);
    if (viewport && this.#listening) {
      viewport.removeEventListener('resize', this.sync);
      viewport.removeEventListener('scroll', this.sync);
    }
    this.#listening = false;
    fills.delete(this);
    this.hide();
    // Another drawer may need its fill now.
    if (fills.size > 0) syncAll();
  }

  /**
   * Hides every fill (also of the drawers around this one) when focus leaves
   * for an element that doesn't keep the keyboard: Safari moves the root back
   * down before the viewport's events come, and the fill would cover the
   * sheet until then.
   */
  #onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (to instanceof Element && this.#options.keepsKeyboard(to)) return;
    hideAll();
  };

  /** The strip between the root's bottom and the screen's, in client px. */
  strip(): Strip | undefined {
    const { viewport, root } = this.#options;
    if (!viewport || !this.#listening) return undefined;
    if ((viewport.scale ?? 1) > 1.01) return undefined;
    const rect = root.getBoundingClientRect();
    if (viewport.height >= rect.height - MIN_STRIP) return undefined;
    const style = getComputedStyle(root);
    if (style.position !== 'fixed') return undefined;
    // Without the root's own `top`, its client top is the screen's top.
    const height = (parseFloat(style.top) || 0) - rect.top;
    if (height < MIN_STRIP) return undefined;
    return { top: rect.bottom, height };
  }

  show({ top, height }: Strip): void {
    let element = this.#element;
    if (!element) {
      element = this.#element = document.createElement('div');
      element.className = KEYBOARD_FILL_CLASS;
      element.setAttribute('aria-hidden', 'true');
      const { style } = element;
      style.position = 'absolute';
      style.left = '0';
      style.width = '100%';
      style.top = '0px';
      style.margin = '0';
      style.pointerEvents = 'none';
    }
    const { style } = element;
    if (!element.isConnected) {
      document.documentElement.append(element);
      this.#options.root.setAttribute(KEYBOARD_ATTRIBUTE, '');
      this.paint();
    }
    // Relative to where its containing block puts it, however scrolled.
    const current = parseFloat(style.top) || 0;
    const offset = element.getBoundingClientRect().top - current;
    style.top = `${top - offset}px`;
    style.height = `${height}px`;
  }

  hide(): void {
    if (!this.#element?.isConnected) return;
    this.#element.remove();
    this.#options.root.removeAttribute(KEYBOARD_ATTRIBUTE);
  }
}
