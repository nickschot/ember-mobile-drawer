/**
 * Which form fields open an on-screen keyboard, and which take text.
 *
 * @module
 * @internal
 */
/**
 * A field whose focus can open a keyboard or picker (and the browser scrolls
 * it into view). An iframe counts: what is focused inside it is unknown.
 */
export declare function isEditable(element: Element): boolean;
/** A `readonly` or `disabled` text field: it opens no keyboard. */
export declare function isInactiveTextField(element: Element): boolean;
/** Like `isEditable`, but not a select or an iframe: opens a keyboard. */
export declare function isTypingField(element: Element): boolean;
/** Whether `element` contains an `isTypingField` field. */
export declare function containsTypingField(element: HTMLElement): boolean;
/** Unlike `isEditable`, `readonly` counts: its text can be selected. */
export declare function isTextField(element: Element): boolean;
//# sourceMappingURL=fields.d.ts.map