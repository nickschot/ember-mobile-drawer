/**
 * Inline style values that the drawer overrides, saved to put back later.
 *
 * @module
 * @internal
 */
export interface SavedStyle {
    property: string;
    value: string;
    priority: string;
}
/** One property per element. */
export declare class InlineOverrides {
    #private;
    save(element: HTMLElement, property: string): void;
    set(element: HTMLElement, property: string, value: string): void;
    get(element: HTMLElement): SavedStyle | undefined;
    delete(element: HTMLElement): void;
    /** With `ifStill`, a value the app set in the meantime is kept. */
    restore(element: HTMLElement, ifStill?: string): void;
    restoreAll(): void;
    [Symbol.iterator](): IterableIterator<[HTMLElement, SavedStyle]>;
    keys(): IterableIterator<HTMLElement>;
}
//# sourceMappingURL=inline-style.d.ts.map