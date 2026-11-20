/**
 * Focus helpers for the focus trap, instead of a dependency such as
 * `tabbable`. Not covered: shadow DOM; each radio button is its own stop.
 *
 * @module
 * @internal
 */

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isVisible(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true });
  }
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}

function isTabbable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 &&
    !element.matches(':disabled') &&
    !element.closest('[inert]') &&
    // Content of a closed <details>, except its <summary>, isn't rendered;
    // `checkVisibility` covers that, the fallback doesn't.
    isVisible(element)
  );
}

export function tabbables(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    isTabbable,
  );
}

/**
 * Skips the yielded `Grabber`: it comes first in a bottom drawer, but focus
 * (and a screen reader) should start at the content.
 */
export function initialFocus(
  container: Element,
  fallback: HTMLElement,
): HTMLElement {
  const autofocus = [
    ...container.querySelectorAll<HTMLElement>('[autofocus]'),
  ].find((element) => !element.closest('[inert]') && isVisible(element));
  return (
    autofocus ??
    tabbables(container).find(
      (element) => !element.hasAttribute('data-mobile-drawer-grabber'),
    ) ??
    fallback
  );
}

export function focusWithoutScrolling(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}
