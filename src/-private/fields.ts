/**
 * Predicates for the form fields in a drawer: which ones open an on-screen
 * keyboard, and which ones take text.
 *
 * @module
 * @internal
 */

/** `<input>` types that take no typed text, so open no on-screen keyboard. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether `element` is a text `<input>` or a `<textarea>`. */
function isTextControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    (element instanceof HTMLInputElement &&
      !NON_TEXT_INPUTS.has(element.type)) ||
    element instanceof HTMLTextAreaElement
  );
}

/**
 * Whether `element` is a text `<input>` or a `<textarea>` that isn't
 * `readonly` or `disabled`: one the user types in.
 */
function isWritableTextControl(element: Element): boolean {
  return isTextControl(element) && !element.readOnly && !element.disabled;
}

/**
 * Whether `element` is a field the user edits: a text input, a textarea, a
 * select, or contenteditable content. Focus on one of them can open an
 * on-screen keyboard or picker, and the browser then scrolls the field into
 * view. An iframe counts too: the element focused inside it is unknown. A
 * `readonly` or `disabled` text field opens no keyboard, so it doesn't count.
 */
export function isEditable(element: Element): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return isWritableTextControl(element);
  }
  return (
    element instanceof HTMLSelectElement ||
    element instanceof HTMLIFrameElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/**
 * Whether `element` is a text `<input>` or a `<textarea>` that is `readonly`
 * or `disabled`: it opens no keyboard, see `isEditable`.
 */
export function isInactiveTextField(element: Element): boolean {
  return isTextControl(element) && (element.readOnly || element.disabled);
}

/**
 * Whether `element` is a field the user types in: a text `<input>` or a
 * `<textarea>` that isn't `readonly` or `disabled`, or contenteditable
 * content. Focus on one of them opens an on-screen keyboard, also after a
 * tap. Unlike `isEditable`, not a select or an iframe.
 */
export function isTypingField(element: Element): boolean {
  return (
    isEditable(element) &&
    !(element instanceof HTMLSelectElement) &&
    !(element instanceof HTMLIFrameElement)
  );
}

/**
 * Whether `element` contains a field the user types in: a text `<input>` or
 * a `<textarea>` that isn't `readonly` or `disabled`, or an element that is
 * contenteditable content (any element, unlike `isTypingField`).
 */
export function containsTypingField(element: HTMLElement): boolean {
  for (const field of element.querySelectorAll<HTMLElement>(
    'input, textarea, [contenteditable]',
  )) {
    if (
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? isWritableTextControl(field)
        : field.isContentEditable
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `element` is a field that takes text: a text `<input>` (not
 * `disabled`), a `<textarea>` or contenteditable content. Unlike
 * `isEditable`, `readonly` fields count: their text can still be selected.
 */
export function isTextField(element: Element): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return isTextControl(element) && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}
