/**
 * Inline style values that the drawer overrides on elements, saved to put
 * back later.
 *
 * @module
 * @internal
 */

export interface SavedStyle {
  property: string;
  value: string;
  priority: string;
}

/**
 * The inline value of one property per element from before the drawer
 * changed it.
 */
export class InlineOverrides {
  #saved = new Map<HTMLElement, SavedStyle>();

  /** Saves the inline value of `property` on `element`. */
  save(element: HTMLElement, property: string): void {
    const { style } = element;
    this.#saved.set(element, {
      property,
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property),
    });
  }

  /** Saves the inline value of `property` on `element`, then sets `value`. */
  set(element: HTMLElement, property: string, value: string): void {
    this.save(element, property);
    element.style.setProperty(property, value);
  }

  get(element: HTMLElement): SavedStyle | undefined {
    return this.#saved.get(element);
  }

  /** Forgets `element` without putting its value back. */
  delete(element: HTMLElement): void {
    this.#saved.delete(element);
  }

  /**
   * Puts back the saved value of `element` and forgets it. With `ifStill`,
   * only when the inline value is still `ifStill` without priority: a value
   * the app set in the meantime is kept.
   */
  restore(element: HTMLElement, ifStill?: string): void {
    const saved = this.#saved.get(element);
    if (!saved) return;
    this.#saved.delete(element);
    const { style } = element;
    if (
      ifStill === undefined ||
      (style.getPropertyValue(saved.property) === ifStill &&
        !style.getPropertyPriority(saved.property))
    ) {
      style.setProperty(saved.property, saved.value, saved.priority);
    }
  }

  /** Puts back the saved values of all elements. */
  restoreAll(): void {
    for (const element of [...this.#saved.keys()]) this.restore(element);
  }

  [Symbol.iterator](): IterableIterator<[HTMLElement, SavedStyle]> {
    return this.#saved.entries();
  }

  keys(): IterableIterator<HTMLElement> {
    return this.#saved.keys();
  }
}
