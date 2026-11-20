/**
 * Focus helpers for the focus trap, instead of a dependency such as
 * `tabbable`. Not covered: shadow DOM; each radio button is its own stop.
 *
 * @module
 * @internal
 */
export declare function tabbables(container: Element): HTMLElement[];
/**
 * Skips the yielded `Grabber`: it comes first in a bottom drawer, but focus
 * (and a screen reader) should start at the content.
 */
export declare function initialFocus(container: Element, fallback: HTMLElement): HTMLElement;
export declare function focusWithoutScrolling(element: HTMLElement): void;
//# sourceMappingURL=focus.d.ts.map