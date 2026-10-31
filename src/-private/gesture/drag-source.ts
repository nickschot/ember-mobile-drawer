import didPan from 'ember-gesture-modifiers/modifiers/did-pan';
import { registerDestructor } from '@ember/destroyable';
import type { ModifierLike } from '@glint/template';

/** The subset of `didPan`'s event data the drawer reads. */
export interface PanData {
  current: { x: number; y: number };
  originalEvent?: Event;
}

type PanCallback = (data: PanData, element: HTMLElement) => void;

interface DragSourceNamedArgs {
  axis: 'horizontal' | 'vertical';
  pointerTypes: readonly ('touch' | 'mouse' | 'pen')[];
  onPointerDown: (event: PointerEvent, element: HTMLElement) => void;
  onPanStart: PanCallback;
  onPan: PanCallback;
  onPanEnd: PanCallback;
  /** Called when the modifier is torn down, e.g. in the middle of a drag. */
  onTeardown: (element: HTMLElement) => void;
}

export interface DragSourceSignature {
  Element: HTMLElement;
  Args: { Named: DragSourceNamedArgs };
}

/**
 * The part of ember-gesture-modifiers' `DidPanModifier` this extends: the
 * standard ember-modifier `modify` hook, called with `didPan`'s public named
 * arguments.
 */
interface DidPanModifier {
  modify(
    element: HTMLElement,
    positional: unknown[],
    named: Record<string, unknown>,
  ): void;
}

const DidPan = didPan as unknown as new (
  owner: unknown,
  args: unknown,
) => DidPanModifier;

/**
 * `didPan` that also tells the drawer which element a pan came from, when a
 * pointer goes down on it (before a pan is recognised) and when it is torn
 * down. `didPan` removes its listeners on teardown, so without that a drag
 * whose element is removed (or whose modifier is swapped out, e.g. when
 * `@handleOnly` changes) would never end.
 *
 * Extends the modifier class, so it uses `didPan`'s own modifier manager.
 * It relies only on that class being a class-based ember-modifier (its
 * `modify` hook and destructors) and on `didPan`'s documented arguments; the
 * callbacks go in through `onPanStart`/`onPan`/`onPanEnd`. The gesture tests
 * cover this, so a breaking change in a future ember-gesture-modifiers
 * shows up there.
 *
 * @internal
 */
class DragSourceModifier extends DidPan {
  #element?: HTMLElement;
  #named?: DragSourceNamedArgs;

  constructor(owner: unknown, args: unknown) {
    super(owner, args);
    registerDestructor(this, () => {
      const element = this.#element;
      this.#element?.removeEventListener('pointerdown', this.#onPointerDown);
      this.#element = undefined;
      if (element) this.#named?.onTeardown(element);
    });
  }

  #onPointerDown = (event: PointerEvent): void => {
    const element = this.#element;
    const named = this.#named;
    if (element && named?.pointerTypes.includes(event.pointerType as 'touch')) {
      named.onPointerDown(event, element);
    }
  };

  override modify(
    element: HTMLElement,
    positional: unknown[],
    named: Record<string, unknown>,
  ): void {
    const args = named as unknown as DragSourceNamedArgs;
    super.modify(element, positional, {
      axis: args.axis,
      pointerTypes: args.pointerTypes,
      onPanStart: (data: PanData) => args.onPanStart(data, element),
      onPan: (data: PanData) => args.onPan(data, element),
      onPanEnd: (data: PanData) => args.onPanEnd(data, element),
    });

    if (this.#element !== element) {
      this.#element?.removeEventListener('pointerdown', this.#onPointerDown);
      element.addEventListener('pointerdown', this.#onPointerDown, {
        passive: true,
      });
    }
    this.#element = element;
    this.#named = args;
  }
}

export const dragSource =
  DragSourceModifier as unknown as ModifierLike<DragSourceSignature>;
