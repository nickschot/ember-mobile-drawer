/**
 * Small focus helpers for the modal drawer's focus trap, instead of a
 * runtime dependency such as `focus-trap`/`tabbable`. They cover the common
 * cases: native interactive elements and `tabindex`; not shadow DOM, and
 * every radio button in a group counts as its own stop.
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

/** Whether `element` can be focused by the user and is in the tab order. */
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

/** The elements inside `container` that Tab moves through, in order. */
export function tabbables(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    isTabbable,
  );
}

/**
 * The element to focus when a modal drawer opens: the first element with
 * `autofocus`, else the first tabbable element that isn't a yielded
 * `Grabber` (`data-mobile-drawer-grabber`), else `fallback`. The grabber
 * comes first in a bottom drawer, but it is a control for the drawer, not
 * its content, so focus (and a screen reader) starts at the content.
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

/** `element.focus()` without scrolling to it. */
export function focusWithoutScrolling(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}
