/**
 * Which form fields open an on-screen keyboard, and which take text.
 *
 * @module
 * @internal
 */

/** `<input>` types that open no on-screen keyboard. */
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

function isTextControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return (
    (element instanceof HTMLInputElement &&
      !NON_TEXT_INPUTS.has(element.type)) ||
    element instanceof HTMLTextAreaElement
  );
}

function isWritableTextControl(element: Element): boolean {
  return isTextControl(element) && !element.readOnly && !element.disabled;
}

/**
 * A field whose focus can open a keyboard or picker (and the browser scrolls
 * it into view). An iframe counts: what is focused inside it is unknown.
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

/** A `readonly` or `disabled` text field: it opens no keyboard. */
export function isInactiveTextField(element: Element): boolean {
  return isTextControl(element) && (element.readOnly || element.disabled);
}

/** Like `isEditable`, but not a select or an iframe: opens a keyboard. */
export function isTypingField(element: Element): boolean {
  return (
    isEditable(element) &&
    !(element instanceof HTMLSelectElement) &&
    !(element instanceof HTMLIFrameElement)
  );
}

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

/** Unlike `isEditable`, `readonly` counts: its text can be selected. */
export function isTextField(element: Element): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return isTextControl(element) && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}
