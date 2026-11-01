/**
 * The sheet's colour below a bottom drawer while an on-screen keyboard is
 * open in iOS Safari.
 *
 * When a field gets focus, iOS Safari scrolls the visual viewport up in the
 * layout viewport to show the field above the keyboard. Fixed elements stay
 * in the layout viewport, and Safari clips them to it (also with negative
 * insets): so the drawer's fixed root ends that far above the bottom of the
 * screen, at about the level of Safari's floating URL bar, and above the
 * top of the keyboard. Safari's URL bar, its keyboard accessory bar and the
 * keyboard are translucent, and in the strip between the root and the
 * bottom of the screen the page shows through them instead of the sheet.
 * No part of the drawer can paint there.
 *
 * Measured in the iOS 27 simulator (iPhone 17, layout viewport 714px): a
 * field in a sheet at 40% gets focus, the visual viewport becomes 384px
 * high and moves 310px down in the layout viewport (`offsetTop`), and the
 * client coordinates (`getBoundingClientRect`) follow the visual viewport.
 * So the fixed root is at `top: -310px` and ends 404px below the top of the
 * visual viewport, 20px below its bottom. The keyboard starts about 80px
 * lower; the screen ends 310px lower. At full height the field is near the
 * top, the visual viewport doesn't move and there is no strip.
 *
 * This fills that strip: an element in the document (not fixed, so Safari
 * doesn't clip it), a child of `<html>`, so that a fixed `<body>` (the iOS
 * scroll lock) doesn't contain it, from the bottom of the root to the
 * bottom of the screen, with the tray's background colour and backdrop
 * filter. It doesn't take pointer events and is hidden from assistive
 * technology. While it shows, the root gets `data-keyboard`, so the
 * floating sheet goes to the edges and the bottom of the root and meets
 * it (see styles.css). It changes nothing that is in the drawer: the field
 * and the content don't move.
 *
 * The strip is `-top` of the root's client rect: the screen is as high as
 * the layout viewport, from the top of the visual viewport. Other browsers
 * (e.g. Chrome) keep the client coordinates in the layout viewport, so the
 * root's top is 0 there, also with a keyboard open, and nothing is filled.
 * Only while the visual viewport is lower than the root, the page isn't
 * zoomed in (a pinch zoom also moves the visual viewport) and the root is
 * `position: fixed` (an embedded drawer's root is in the page, and can be
 * above the viewport because the page is scrolled).
 *
 * @module
 * @internal
 */

/** The class of the fill element, a child of `<html>`. */
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
  /** The visual viewport, or `null` where there is none. */
  viewport: ViewportLike | null;
  /** Whether the drawer can need the fill now: open, from the bottom. */
  active: () => boolean;
  /**
   * Whether focus on `element` keeps an on-screen keyboard open (a field
   * the user edits).
   */
  keepsKeyboard: (element: Element) => boolean;
}

/** Below this (px), the strip counts as none. */
const MIN_STRIP = 1;

export class KeyboardFill {
  #options: KeyboardFillOptions;
  #element?: HTMLElement;
  #listening = false;

  constructor(options: KeyboardFillOptions) {
    this.#options = options;
    options.root.addEventListener('focusout', this.#onFocusOut);
  }

  /** Whether the fill shows. */
  get showing(): boolean {
    return this.#element?.isConnected ?? false;
  }

  /**
   * Listens to the visual viewport while the drawer is active, and shows,
   * moves or hides the fill. Call it when the drawer opens or closes; the
   * viewport's own `resize` and `scroll` events call it too.
   */
  sync = (): void => {
    const { viewport, active } = this.#options;
    const on = active();
    if (viewport && on !== this.#listening) {
      this.#listening = on;
      const method = on ? 'addEventListener' : 'removeEventListener';
      viewport[method]('resize', this.sync);
      viewport[method]('scroll', this.sync);
    }
    const strip = on && viewport ? this.#strip(viewport) : undefined;
    if (strip) {
      this.#show(strip.top, strip.height);
    } else {
      this.#hide();
    }
  };

  /**
   * Copies the tray's colour to the fill again, e.g. after the drawer moved
   * to a snap point where a theme changes it. Does nothing while the fill
   * is hidden.
   */
  paint(): void {
    const element = this.#element;
    if (!element?.isConnected) return;
    const tray = getComputedStyle(this.#options.tray);
    const { style } = element;
    style.backgroundColor = tray.backgroundColor;
    const filter =
      tray.backdropFilter ||
      tray.getPropertyValue('-webkit-backdrop-filter') ||
      'none';
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
    this.#hide();
  }

  /**
   * Hides the fill at once when focus leaves a field in the drawer for an
   * element that doesn't keep the keyboard open (or for nothing, e.g. the
   * keyboard's Done button). Safari moves the fixed root back down as the
   * keyboard starts to close, before the visual viewport's events: the fill
   * would then cover the bottom of the sheet until they come. Focus that
   * moves to another field keeps it; the viewport's events move it.
   */
  #onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget;
    if (to instanceof Element && this.#options.keepsKeyboard(to)) return;
    this.#hide();
  };

  /**
   * The strip between the root's bottom and the screen's, in client px, or
   * `undefined` if there is none.
   */
  #strip(viewport: ViewportLike): { top: number; height: number } | undefined {
    if ((viewport.scale ?? 1) > 1.01) return undefined;
    const { root } = this.#options;
    const rect = root.getBoundingClientRect();
    if (viewport.height >= rect.height - MIN_STRIP) return undefined;
    if (getComputedStyle(root).position !== 'fixed') return undefined;
    const height = -rect.top;
    if (height < MIN_STRIP) return undefined;
    return { top: rect.bottom, height };
  }

  #show(top: number, height: number): void {
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
    // Where its containing block puts it now, so `top` is right whatever
    // that block is and however far the document is scrolled.
    const current = parseFloat(style.top) || 0;
    const offset = element.getBoundingClientRect().top - current;
    style.top = `${top - offset}px`;
    style.height = `${height}px`;
  }

  #hide(): void {
    if (!this.#element?.isConnected) return;
    this.#element.remove();
    this.#options.root.removeAttribute(KEYBOARD_ATTRIBUTE);
  }
}
