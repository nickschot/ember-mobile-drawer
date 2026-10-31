// ember-gesture-modifiers ships without type declarations. These cover what
// this addon uses. They are not published: the addon's public types never
// reference this module.

declare module 'ember-gesture-modifiers/modifiers/did-pan' {
  import type { ModifierLike } from '@glint/template';

  export interface PanData {
    initial: { x: number; y: number; timeStamp: number };
    current: {
      x: number;
      y: number;
      distanceX: number;
      distanceY: number;
      velocityX: number;
      velocityY: number;
    };
    timeStamp: number;
    originalEvent: PointerEvent;
  }

  const didPan: ModifierLike<{
    Element: HTMLElement;
    Args: {
      Named: {
        axis?: 'horizontal' | 'vertical' | 'both';
        threshold?: number;
        capture?: boolean;
        preventScroll?: boolean;
        pointerTypes?: readonly ('touch' | 'mouse' | 'pen')[];
        onPanStart?: (data: PanData) => void;
        onPan?: (data: PanData) => void;
        onPanEnd?: (data: PanData) => void;
      };
    };
  }>;
  export default didPan;
}

declare module 'ember-gesture-modifiers/test-support' {
  export function pan(
    target: string | Element,
    direction: 'left' | 'right' | 'up' | 'down' | 'up-right',
    pointerType?: 'touch' | 'mouse' | 'pen',
  ): Promise<void>;
}
