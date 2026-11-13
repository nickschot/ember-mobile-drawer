/**
 * Small focus helpers for the modal drawer's focus trap, instead of a
 * runtime dependency such as `focus-trap`/`tabbable`. They cover the common
 * cases: native interactive elements and `tabindex`; not shadow DOM, and
 * every radio button in a group counts as its own stop.
 *
 * @module
 * @internal
 */
/** The elements inside `container` that Tab moves through, in order. */
export declare function tabbables(container: Element): HTMLElement[];
/**
 * The element to focus when a modal drawer opens: the first element with
 * `autofocus`, else the first tabbable element that isn't a yielded
 * `Grabber` (`data-mobile-drawer-grabber`), else `fallback`. The grabber
 * comes first in a bottom drawer, but it is a control for the drawer, not
 * its content, so focus (and a screen reader) starts at the content.
 */
export declare function initialFocus(container: Element, fallback: HTMLElement): HTMLElement;
/** `element.focus()` without scrolling to it. */
export declare function focusWithoutScrolling(element: HTMLElement): void;
//# sourceMappingURL=focus.d.ts.map