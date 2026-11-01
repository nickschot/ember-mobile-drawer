# ember-mobile-drawer

A gesture-enabled drawer component for Ember, built as a v2 addon.

- Drag to open, close, or snap to any point in between
- Spring physics animations
- Configurable snap points (px, %, or content height)
- Placements: bottom, top, left, right (`left` and `right` are physical and don't flip under `dir="rtl"`)
- Minimal base styles, with an optional iOS theme

Try it in the [playground](https://nickschot.github.io/ember-mobile-drawer/).

> Work in progress. Planning and progress are tracked in [GitHub issues](https://github.com/nickschot/ember-mobile-drawer/issues).

## Compatibility

- Ember.js v5.12 or above
- Embroider or ember-auto-import v2

## Installation

```
pnpm add ember-mobile-drawer
```

or, in an ember-cli app:

```
ember install ember-mobile-drawer
```

## Usage

```gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from 'ember-mobile-drawer';

export default class Example extends Component {
  snapPoints: SnapPoint[] = [0, '50%', '100%'];
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>Open</button>

    <MobileDrawer
      @placement="bottom"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      aria-labelledby="drawer-title"
      as |drawer|
    >
      <h2 id="drawer-title">Details</h2>
      <button type="button" {{on "click" drawer.open}}>Expand</button>
      <button type="button" {{on "click" drawer.close}}>Close</button>
    </MobileDrawer>
  </template>
}
```

Arguments:

- `@placement`: `'bottom'` (default), `'top'`, `'left'` or `'right'`.
- `@snapPoints`: where the drawer can rest, as the distance it is opened: px (`240`), a percentage of the space it can open into (`'50%'`) or `'content'` (the drawer's natural size). Include `0` to let it close. Default `[0, 'content']`.
- `@activeSnapPoint`: the index into `@snapPoints` the drawer should be at. Changing it animates the drawer there. Leave it out to let the drawer keep track of its snap point itself (it then starts at index `0`, or stays where it was if you stop passing it). Update it together with `@snapPoints`: an index that doesn't exist is clamped to the nearest valid one, with a warning in development.
- `@onSnapPointChange`: called with the new index when the drawer wants to move (through `snapTo`, `open`, `close` or a drag). When `@activeSnapPoint` is set, the drawer only moves once you pass the new index back in.
- `@handleOnly`: only start a drag on elements with the yielded `handle` modifier. Default `false`: the whole tray drags.
- `@modal`: whether the drawer is a modal dialog while it is open. Default `true`. See [Accessibility](#accessibility).
- `@backdrop`: whether to render the backdrop behind the tray. Defaults to the value of `@modal`: `true`, unless the drawer is non-modal. With `@backdrop={{false}}` nothing covers the page.
- `@closeOnBackdropClick`: whether a tap or click on the backdrop closes the drawer (like `close()`, so through `@onSnapPointChange` when `@activeSnapPoint` is set). Default `true`.
- `@onOpen`, `@onClose`, `@onDragStart`, `@onDragEnd`: lifecycle callbacks, see [Events](#events).
- `@spring`: the spring that moves the drawer to a snap point, for example `springPresets.ios`. See [Spring](#spring).

Attributes such as `class`, `aria-label` and `aria-labelledby` go on the drawer's root element.

The block receives `snapTo(index)`, `open()` (largest snap point), `close()` (smallest snap point), the `handle` modifier, and the state `activeSnapPoint`, `isAnimating`, `isDragging` and `progress` (`0` closed to `1` at the largest snap point, for the snap point it is at or moving to). Snap points are recalculated when the viewport or the content changes size, and the drawer stays at the same snap point.

### Backdrop

The backdrop covers the page behind the drawer. Its opacity follows the drawer as it moves, from transparent when closed to `--mobile-drawer-backdrop-opacity` (default `0.4`) at the largest snap point; set its colour with `--mobile-drawer-backdrop-color` (see [Styles](#styles)). While the drawer is open the backdrop catches taps, so the page behind it can't be clicked; a tap closes the drawer. A pointer that moves more than 10px before it lifts (a drag or a scroll that happens to start on the backdrop) doesn't count as a tap. At its smallest snap point the backdrop doesn't block the page: not when the drawer is closed, and not for a "peek" drawer whose smallest snap point is above `0` (for example `[120, '100%']`), so the page stays usable next to the peeking drawer.

Turn off tap-to-close with `@closeOnBackdropClick={{false}}`, or leave the backdrop out entirely with `@backdrop={{false}}`. Non-modal drawers have no backdrop unless you pass `@backdrop={{true}}`.

### Spring

The drawer moves to a snap point on a damped spring. The release velocity of a drag carries over into it. Change the spring with `@spring`: an object with `stiffness`, `damping` and `mass` (all finite numbers greater than `0`). Keys that you leave out keep their default. A change applies from the next animation. With `prefers-reduced-motion: reduce` the drawer jumps to its snap point, whatever the spring.

```gts
import { MobileDrawer, springPresets } from 'ember-mobile-drawer';

<template>
  <MobileDrawer @spring={{springPresets.ios}} aria-label="Details">
    ...
  </MobileDrawer>
</template>
```

`springPresets` has these presets:

| Preset      | Stiffness | Damping | Mass | Like                                     |
| ----------- | --------- | ------- | ---- | ---------------------------------------- |
| `default`   | 400       | 40      | 1    | The drawer without `@spring`             |
| `ios`       | 157.9     | 25.1    | 1    | SwiftUI `.smooth`: 0.5s, no bounce       |
| `iosSnappy` | 157.9     | 21.4    | 1    | SwiftUI `.snappy`: 0.5s, bounce 0.15     |
| `iosBouncy` | 157.9     | 17.6    | 1    | SwiftUI `.bouncy`: 0.5s, bounce 0.3      |

`default` and `ios` are critically damped: they don't oscillate, but a fast flick can still carry the drawer past a snap point once. `iosSnappy` and `iosBouncy` overshoot a snap point and come back. The rendered tray never leaves its edge: at fully open (the tray's full size) the render stops at the edge, so the overshoot shows at snap points below that. When a bouncing spring arrives at the highest snap point, the tray stays there for the rest of the animation, also while the spring itself swings back a little below it. So the content can scroll from the moment the tray arrives.

Apple doesn't document the spring of the system sheet. `ios` is SwiftUI's `.smooth` spring (iOS 17 and later), the same as `Spring(duration: 0.5, bounce: 0)` and SwiftUI's `.spring` without arguments. To use other values from Apple's frameworks, convert a duration and bounce with `springFromDuration`, which uses the formulas from Apple's [Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/) (WWDC23): `stiffness = (2π / duration)²`, `damping = 4π × (1 − bounce) / duration` and `mass = 1`.

```ts
import { springFromDuration } from 'ember-mobile-drawer';

// Like SwiftUI's .snappy(duration: 0.4, extraBounce: 0.05).
const spring = springFromDuration({ duration: 0.4, bounce: 0.2 });
```

`duration` is in seconds and must be greater than `0`. `bounce` goes from `0` (the default, no bounce) up to, but not including, `1`. Negative values (over-damped springs in SwiftUI) are not supported. The presets and the result of `springFromDuration` are frozen, and typed `Readonly<MobileDrawerSpring>`. The types `MobileDrawerSpring` and `SpringDuration` are exported too.

### Events

Each callback gets one object argument. The types are exported from `ember-mobile-drawer`.

| Argument       | Called                                                                                                               | Argument type                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@onOpen`      | when the drawer opens: its snap point moves from the smallest one to a larger one                                    | `MobileDrawerToggleEvent`: `{ snapPoint }`, the snap point it opens to                            |
| `@onClose`     | when the drawer closes: its snap point moves back to the smallest one                                                | `MobileDrawerToggleEvent`: `{ snapPoint }`, always the smallest snap point                           |
| `@onDragStart` | when a drag starts (once a pan along the axis is recognised; `isDragging` turns `true` right after)                       | `MobileDrawerDragStartEvent`: `{ snapPoint, offset }`, the active snap point and px open          |
| `@onDragEnd`   | once for every `@onDragStart`, when the finger lifts, before `@onSnapPointChange`                                    | `MobileDrawerDragEndEvent`: `{ snapPoint, offset, velocity }`, see below                          |

- `@onOpen` and `@onClose` are called once per change, whatever caused it: `open()`, `close()`, `snapTo()`, a drag, the backdrop, Escape or a new `@activeSnapPoint`. They are called when the drawer starts to move, not when it arrives (in a microtask, at the same time as the modal behaviour turns on or off), so the drawer is still animating. A move between two open snap points calls neither, and so does a drawer that opens and closes again within the same task. They are not called for the snap point the drawer is inserted at (also when it is inserted hidden, for example in a `display: none` container, and shown later), or when it is removed.
- `@onDragEnd` gets the snap point the release picked (the one passed to `@onSnapPointChange` if it differs from the active one), the px open at the release, and the release velocity in px/s (positive opens, negative closes; `0` when the browser cancelled the pointer). When `@activeSnapPoint` is set, the drawer only moves to that snap point once you pass it in. A drag that ends without a release, because its handle was removed or `@placement` changed, gives the active snap point and velocity `0`. A drag that is still going when the drawer is removed calls no `@onDragEnd`. If you change `@snapPoints` in `@onDragEnd`, the index that `@onSnapPointChange` gets next is an index into the old list.
- A touch that only stops a moving drawer, without dragging it, calls neither drag callback.

```gts
<MobileDrawer
  @onOpen={{this.trackOpen}}
  @onClose={{this.trackClose}}
  @onDragEnd={{this.logRelease}}
/>
```

### Accessibility

A drawer is "open" while it is above its smallest snap point.

By default the drawer is modal (`@modal={{true}}`), like a dialog. While it is open:

- focus moves into it: to the first element with `autofocus`, else the first focusable element, else the tray itself;
- Tab and Shift+Tab stay inside the drawer, wrapping around at the ends;
- the rest of the page is [`inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert): the siblings of the drawer and of each of its ancestors, up to `<body>` (see the limits below);
- the page doesn't scroll. On iOS the body is fixed in place at its scroll position, which is restored on close;
- Escape closes it, like `close()` (so through `@onSnapPointChange` when `@activeSnapPoint` is set). Not while the drawer is being dragged: the release decides where it goes.

When it closes, focus returns to the element that had it when the drawer opened. If that element is no longer on the page (for example, the drawer deleted the list item it was opened from), focus goes to the first focusable element in the nearest of its former ancestors that is still on the page, but not all the way up to `<body>`; if there is none, focus stays where the browser puts it. Move focus yourself after the close if you want it somewhere else.

Several modal drawers can be open at once: the inert page and the scroll lock last until the last one closes, and Escape closes the top one. A modal drawer inside another drawer is only modal while the outer drawer is open: if your app closes the outer one first, the page is usable again, and focus returns to the outer drawer's trigger.

The drawer only removes the `inert` attributes it added. An element that was already inert when the drawer opened, or on which your app sets or removes `inert` while the drawer is open, is left to your app.

The root gets `role="dialog"`, and `aria-modal="true"` while open. Give it a name with `aria-labelledby` (pointing at a heading in the drawer) or `aria-label`; a modal drawer without one logs a warning in development. A closed drawer is hidden (`visibility: hidden`), also from assistive technology.

With `@modal={{false}}` the drawer doesn't move focus, trap it, make the page inert or lock scrolling, and has no role (add one yourself if it fits, for example a `<nav>` inside a side drawer). Escape closes it while focus is inside it, and focus then returns to where it was when the drawer opened. Use it for drawers that sit next to the page, such as a peek drawer:

```gts
<MobileDrawer @modal={{false}} @snapPoints={{array 120 "100%"}}>
  …
</MobileDrawer>
```

A modal drawer with a smallest snap point above `0` is only modal above its peek.

Limits of modal drawers:

- **Content rendered elsewhere becomes inert.** Popovers, dropdowns and menus that belong to the drawer's content must be rendered inside the drawer. Addons that render into a `<body>`-level element (a "wormhole" or portal, such as ember-basic-dropdown and ember-power-select) put their content next to the drawer, where it is inert and can't be clicked. Render them in place (`@renderInPlace={{true}}` for ember-basic-dropdown and ember-power-select). Elements added to `<body>` after the drawer opened are not made inert.
- **The scroll lock assumes the document scrolls.** It sets `overflow: hidden` on `<html>`. If your app scrolls inside `<body>` or a wrapper element instead (common in app-like layouts), that element keeps scrolling; lock it yourself while the drawer is open. Fixed-position page elements are not adjusted for the scrollbar that disappears.
- **Content below the visible part of a partly open drawer.** At a snap point below the highest one, Tab can move focus to elements that are off screen. Give keyboard users a way to expand the drawer (for example, open it to its highest snap point when it is opened with the keyboard). See [#83](https://github.com/nickschot/ember-mobile-drawer/issues/83).
- **Safari doesn't focus buttons on click**, so after opening a drawer with a mouse or touch there, no element gets focus back on close.

Animations respect `prefers-reduced-motion`: with reduced motion the drawer jumps to its snap point instead of animating.

### Dragging

The drawer can be dragged with touch or pen input along its axis: up and down for `bottom` and `top`, sideways for `left` and `right`. It follows the finger, with resistance past the first and last snap point. Past fully open the resistance is stiff: the tray moves off its edge by at most 24px, with the backdrop showing in the gap. When you let go it settles on a snap point: the nearest one after a slow drag, further along after a flick. Touching a moving drawer stops it where it is.

When `@activeSnapPoint` is set, letting go calls `@onSnapPointChange` with the snap point the drag ended on. Until you pass that index back in, the drawer heads back to the current `@activeSnapPoint`; if you never do, it stays there.

To drag only from a grabber, for example because the content scrolls, use `@handleOnly` and the `handle` modifier:

```gts
<MobileDrawer @handleOnly={{true}} as |drawer|>
  <div class="grabber" {{drawer.handle}}></div>
  <ul class="long-list">...</ul>
</MobileDrawer>
```

Without `@handleOnly` the `handle` modifier does nothing, so you can keep it on your grabber either way. A handle gets `touch-action: pan-x` (for `bottom` and `top`) or `pan-y` (for `left` and `right`) and always drags.

#### Keep the grabber at the leading edge

Put the grabber (with or without the `handle` modifier) at the tray's leading edge, the edge that faces the page, and make it sticky there, so it doesn't scroll with the content. The tray is the scroll container, and the content scrolls at the highest snap point (also with `@handleOnly`, see [Scrolling content](#scrolling-content)). A grabber that scrolls out of view can't be dragged, and with `@handleOnly` it is the only way to drag the drawer at all. Give it the tray's background, so content doesn't show through as it scrolls under it.

```css
/* Bottom drawer: the grabber is the first element in the drawer. */
.grabber {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.75rem 0; /* A larger touch target around a small bar. */
  background: var(--mobile-drawer-background, Canvas);
}
```

For the other placements, stick it to the other leading edges:

- `top`: put the grabber last and use `bottom: 0` instead of `top: 0`.
- `left` and `right`: a vertical bar along the tray's right (for `left`) or left (for `right`) edge. A sticky element needs room to stay in view, so let the content fill at least the tray's height and stick the bar in the middle of the visible area, for example `top: calc(50% - 1.25rem)` for a 2.5rem bar. The tray of a side drawer scrolls vertically at every snap point, because that is across its axis.

Padding on the tray's leading edge needs one more line. A sticky element sticks inside the padding of its scroll container, so the grabber sticks below the padding, and the content scrolls into the gap above it. Give the grabber minus that padding as its offset, for example `top: -1rem` for `padding-top: 1rem` on the tray of a bottom drawer (`bottom: -1rem` for a top drawer). At rest the grabber stays below the padding; when the content scrolls, it sticks at the tray's edge. Or pad the grabber itself or your own elements instead of the tray.

The demo app's playground (`demo-app/styles.css`, `.demo-grabber`) does this for all four placements.

### Scrolling content

The tray is a scroll container (`overflow: auto`), so content longer than the drawer scrolls. Without `@handleOnly`, each touch gesture on the tray either scrolls or drags the drawer. It is decided once the finger has moved 4px along the drawer's axis, and further along it than across it, and stays that way until the finger lifts. A swipe across the axis (a horizontal carousel in a bottom drawer, a list in a side drawer) is left to the browser, also when it starts with a slight lean along the axis; if a gesture that was going to drag turns sideways before the drag starts (10px), it is left to the browser too.

- While the drawer is below its highest snap point, the content can't scroll along the drawer's axis at all (also with `@handleOnly`, and also with a mouse wheel or the keyboard), and every gesture along the axis drags the drawer. Dragging a half-open bottom drawer up expands it instead of scrolling.
- When a bottom or top drawer leaves its highest snap point, the tray scrolls back to its scroll start, so the part of the content that shows at a lower snap point is always the same and you never see content that you can't scroll back. The scroll start is the start of the content for a bottom drawer (`scrollTop` 0). A top drawer's leading edge is its bottom, so below its highest snap point its scroll start is the end of the content: at a partial snap point it shows the end of its content. At the highest snap point every drawer opens at `scrollTop` 0, the top of its content.
  - On a close the tray scrolls back once the drawer is closed, so the content doesn't move while the drawer closes. The drawer then opens again at the start (at `scrollTop` 0 when it opens to its highest snap point).
  - On a move to a lower open snap point (a release, `@activeSnapPoint`, `snapTo`), the scroll position moves to the start in step with the tray, never faster than the tray. When the tray is close to its target, for example when it is released just past a snap point, or caught while it closes and released below one, the scroll position moves to the start on a spring of its own instead (the drawer's spring settings), so it never jumps. With reduced motion it resets at once.
  - A drag, or a touch that holds the drawer, stops a reset where it is. The release starts a new one if the drawer then heads for a snap point below the highest. (A drag down from the top of a bottom drawer only starts with the content at its start anyway; with `@handleOnly` the handle can start one anywhere.)
  - The scroll position is kept while the drawer stays at its highest snap point, and when it moves up to it from a lower one.
  - When the content or the drawer changes size below the highest snap point, the tray scrolls back to its start again, but not while a field in the tray has focus (a text `<input>` or `<textarea>` that isn't `readonly` or `disabled`, a `<select>`, contenteditable content or an `<iframe>`), or while an element in it has keyboard focus (`:focus-visible`, for example after Tab): the browser may have scrolled it into view (for example above an on-screen keyboard). Other focus, such as a tapped button or the tray itself (a modal drawer focuses it when it opens), doesn't keep the position. A `<select>` keeps focus after a choice with a mouse or on Android, so it holds the reset until it loses focus. A blur doesn't scroll the tray by itself; it scrolls back on the next size change. A size change while the tray scrolls back on its own spring keeps that spring's speed, so repeated changes don't slow the reset down.
  - Left and right drawers keep their scroll position, and so do elements marked `data-mobile-drawer-scroll`: only the tray scrolls back.
- At the highest snap point, a gesture scrolls if the content can scroll the way the finger pushes it, and drags the drawer otherwise. For a bottom drawer: with the content scrolled to the top, dragging down closes the drawer; anywhere else it scrolls. Top, left and right drawers work the same way along their own axis, so a top drawer closes by dragging up once its content is scrolled to the end.
- A gesture that started as a scroll never turns into a drag, also when the content reaches its start (or its momentum carries it there) while the finger is still down. Lift the finger and drag again to move the drawer.

The tray is the default scroll container. For scrolling elements inside it, add the `data-mobile-drawer-scroll` attribute so they take part, and give them `overscroll-behavior: contain` so their scrolling doesn't chain to the page:

```gts
<MobileDrawer as |drawer|>
  <h2>Comments</h2>
  <ul class="comments" data-mobile-drawer-scroll>...</ul>
</MobileDrawer>
```

A gesture that starts inside a marked element (or the tray) scrolls if any of those between the touched element and the tray can scroll that way. Scrolling elements without the attribute don't count, so gestures on them drag the drawer like any other content. That includes a scrollable `<textarea>`: add `data-mobile-drawer-scroll` to it too. Scrolling across the drawer's axis (e.g. a horizontal carousel in a bottom drawer) is always left to the browser.

How it works: below the highest snap point the component writes an inline `overflow-y: hidden` (`overflow-x` for `left` and `right`) on the tray and on the marked elements in it, and removes it again at the highest snap point, putting back any inline `overflow-y`/`overflow-x` the element had. A marked element added while the drawer is below the top, or whose inline style the app rewrote, is locked again when a pointer goes down, a wheel turns or focus moves inside it; on unlock, a value the app set in the meantime is kept. Scrolling across the axis isn't affected. Once a gesture is decided as a drag, at any snap point, its `touchmove` events are cancelled, so the browser can't scroll the content or the page under it; that needs a non-passive `touchmove` listener on the tray (handles don't get one). The tray also gets `touch-action: pan-x` (`pan-y` for `left` and `right`) below the highest snap point and `pan-x pan-y` at it, but iOS Safari doesn't reliably apply `touch-action` to a scroll container, so the drawer doesn't rely on it alone. Only the finger that started on the tray counts; other fingers on the screen don't affect the decision. Pinch-zoom doesn't start on the tray. With `@handleOnly` only the handles drag, and the content still only scrolls along the axis at the highest snap point. Below it, a swipe along the axis on the content has its `touchmove` events cancelled (decided the same way, 4px and further along the axis than across it), without dragging the drawer: otherwise iOS would scroll the page behind the locked tray. Swipes across the axis are left to the browser.

### Public imports

These are the package's public API:

- `ember-mobile-drawer`: the components, the spring presets (`springPresets`, `springFromDuration`) and types
- `ember-mobile-drawer/components/mobile-drawer`: the `<MobileDrawer>` component as a default export
- `ember-mobile-drawer/template-registry`: the Glint template registry, for apps that use loose-mode (`.hbs`) templates
- `ember-mobile-drawer/styles.css`: the base stylesheet (see [Styles](#styles))
- `ember-mobile-drawer/themes/ios.css`: the optional iOS theme (see [iOS theme](#ios-theme))
- `ember-mobile-drawer/test-support`: test helpers (see [Testing](#testing))

The package's `exports` also lists a few entries that are for tools, not for imports in your app:

- `ember-mobile-drawer/addon-main.js`: the entry point ember-cli loads
- `ember-mobile-drawer/_app_/components/mobile-drawer`: the app re-export Embroider uses to merge the component into your app
- `ember-mobile-drawer/package.json`

Every other path is blocked, including modules under `-private`, which are internal and can change in any release.

### TypeScript

The package ships its own types.

- **Module resolution:** use `"moduleResolution": "bundler"`, which `@ember/app-tsconfig` and `@ember/library-tsconfig` already set. `node16` and `nodenext` are not supported: like other addons built from the v2 addon blueprint, the package has no `"type": "module"`, so TypeScript reads its declarations as CommonJS in those modes.
- **`@glint/template`:** the component's types import it, so it is an optional peer dependency. Apps that use Glint already have it. If you type-check with `skipLibCheck: false` and don't use Glint, add `@glint/template` to your `devDependencies`.

## Styles

The drawer ships a small base stylesheet that only handles layout: positioning for each placement, overflow and safe-area insets. Import it once, for example in your `app/app.ts`:

```js
import 'ember-mobile-drawer/styles.css';
```

Customise it with CSS custom properties, set on `:root`, any ancestor or the drawer itself:

| Property                           | Default        | Purpose                                         |
| ---------------------------------- | -------------- | ----------------------------------------------- |
| `--mobile-drawer-background`       | `Canvas`       | Tray background                                 |
| `--mobile-drawer-color`            | `CanvasText`   | Tray text colour                                |
| `--mobile-drawer-radius`           | `0`            | Radius of the tray corners away from its edge   |
| `--mobile-drawer-shadow`           | subtle shadow  | Tray `box-shadow`                               |
| `--mobile-drawer-backdrop-color`   | `rgb(0 0 0)`   | Backdrop colour                                 |
| `--mobile-drawer-backdrop-opacity` | `0.4`          | Backdrop opacity when the drawer is fully open, a number from 0 to 1 |
| `--mobile-drawer-z-index`          | `1000`         | Stacking order of the drawer overlay            |

The base styles are easy to override. Every selector is wrapped in `:where()` (zero specificity), and the whole file lives in the `ember-mobile-drawer` cascade layer.

- Unlayered app CSS always wins, whatever its specificity or import order. For example, `.mobile-drawer__tray { width: 20rem; }` gives a side drawer a width.
- If your app uses cascade layers (your own `@layer` rules or Tailwind v4), declare the drawer's layer after your resets and before your components and utilities. Put this line at the top of your main stylesheet:

  ```css
  @layer theme, base, ember-mobile-drawer, components, utilities;
  ```

  Placing the drawer's layer after `base` means a reset such as Tailwind's preflight (`* { padding: 0 }`) can't remove the safe-area padding on `.mobile-drawer__content`. Placing it before `components` and `utilities` means those still override the base styles. Without the declaration, the order in which the layers are first loaded decides, so the result can depend on import order.

Cascade layers need Safari/iOS 15.4+, Chrome 99+ or Firefox 97+.

When a snap point makes the tray larger than its content, the content sits against the tray's leading edge, the edge that comes into view first. A drawer that is partly open shows its content rather than empty space. Bottom and right drawers do this through normal block layout. For top and left drawers the tray is a flex container and `.mobile-drawer__content` gets an auto start margin (`margin-top: auto` for top, `margin-left: auto` for left). Content taller or wider than the tray still scrolls; below its highest snap point, a top drawer's tray is scrolled to the end of its content, so the end of the content is at its leading edge (see [Scrolling content](#scrolling-content)). To align the content differently, override `display` on `.mobile-drawer__tray` or `margin` on `.mobile-drawer__content`, for example:

```css
.mobile-drawer[data-placement="top"] > .mobile-drawer__tray {
  display: block;
}
```

The safe-area insets are padding on the `.mobile-drawer__content` element inside the tray. The base styles set no padding on the tray itself, so padding you add to `.mobile-drawer__tray` adds to the insets instead of replacing them. Don't set padding on `.mobile-drawer__content`, because that would remove the insets. Unlayered resets that set padding on `*` or `div` remove them too, because unlayered CSS always wins over the drawer's layer. In the same way, an unlayered `* { margin: 0 }` reset undoes the leading-edge alignment of top and left drawers. Put such resets in a layer before `ember-mobile-drawer`.

### State attributes

The drawer root (`.mobile-drawer`) carries state attributes you can style on:

- `data-placement`: `bottom`, `top`, `left` or `right`.
- `data-closed`: while the drawer is fully closed and at rest. The base styles hide the drawer then.
- `data-expanded`: while the drawer rests at its highest snap point, or is animating towards it. It doesn't change during a drag or while a touch holds the drawer, so small movements at the top don't flicker it: a drag that starts at the top keeps it until the finger lifts, and loses it only if the drawer is then released towards a lower snap point; a drag up from a lower snap point gets it on release, when the drawer heads for the top. It is never set when the highest snap point is closed (`0`). Use it for a look that only applies when the drawer is fully open, for example:

  ```css
  .mobile-drawer[data-expanded] > .mobile-drawer__tray {
    --mobile-drawer-radius: 0;
  }
  ```

  The scroll lock (see [Scrolling content](#scrolling-content)) doesn't use it: that follows where the drawer is shown, frame by frame.

Safe-area insets need `viewport-fit=cover` in your viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

#### iOS Safari 26 bars

iOS 26 Safari doesn't let fixed elements paint under the status bar or the floating toolbar. It clips them to the area between the bars, also with `100lvh` heights or negative insets. Instead, it fills each bar with a colour that it takes from the fixed element at that edge of the screen. The base styles have an iOS-only rule (in `@supports (-webkit-touch-callout: none)`) that gives Safari the right colours:

- The bar at the sheet's edge gets the sheet colour, so the sheet seems to go on under the bar: the toolbar for a bottom drawer, the status bar for a top drawer. For this, the drawer renders an empty `.mobile-drawer__bar-tint` element after the tray. On iOS it is a 16px fixed strip at that edge, in front of the tray. It paints nothing and takes no pointer events. Its background is `--mobile-drawer-background`, and Safari takes that colour for the bar from the first frame of an opening drawer. When the colour changes, Safari takes the new colour. Left and right drawers don't get the strip. On other browsers it is `display: none`.
- Set the sheet colour with `--mobile-drawer-background`. If your app sets a `background` on `.mobile-drawer__tray` directly, also set the same `background-color` on `.mobile-drawer__bar-tint`. A gradient or an image can't be a bar colour: use its main colour.
- A translucent sheet colour (for example the glass of the [iOS theme](#ios-theme)) is blended over the page background. Safari doesn't blur the page under the bar.
- The bar at the far edge shows the page with the backdrop over it, as on iOS: the status bar for a bottom drawer, the toolbar for a top drawer. It never shows the sheet colour, also not at full height, where the sheet touches that edge. For this, the drawer renders an empty `.mobile-drawer__backdrop-tint` element after the backdrop (only when it has a backdrop). On iOS it is the same kind of invisible 16px strip, at the far edge. Its colour is the backdrop as it shows: `--mobile-drawer-backdrop-color` with `--mobile-drawer-backdrop-opacity` times the drawer's progress as its alpha. The component writes `--mobile-drawer-progress` on it, as on the backdrop. Safari blends it over the page background, so the bar follows the dim of the page at every snap point, during a drag and during the close animation.
- The bars of left and right drawers (and the far bar of a drawer without a backdrop) dim with the backdrop in a different way. The backdrop fades with `filter: opacity()` over a background that has the max opacity as its alpha, instead of with `opacity`, so that Safari sees the dimmed colour from the first frame.
- Safari keeps that backdrop colour until the drawer is closed (`data-closed`), not only while it is open. So those bars show the backdrop at its max opacity also at a lower snap point, while a drawer with a backdrop rests at a peek, and during the close animation. When the drawer comes to rest closed, the bars change to the page colour in one step. Safari's hit test ignores `pointer-events`, so the backdrop's `pointer-events: none` at the smallest snap point doesn't change this.
- The tray is `position: fixed` and the root has `contain: layout`, so the tray still sits in the root, also in an embedded drawer.
- **Markup change:** the root has two more children: `.mobile-drawer__backdrop-tint` after the backdrop (only with a backdrop) and `.mobile-drawer__bar-tint` after the tray. Both are empty and `aria-hidden`. If your app CSS or tests select the root's children with `:last-child`, `> div`, `> *` or a child count, change them to use the class names, for example `.mobile-drawer > .mobile-drawer__tray`.

On iOS, set the backdrop's colour and max opacity only with `--mobile-drawer-backdrop-color` and `--mobile-drawer-backdrop-opacity` (a number from 0 to 1). The base background holds the max opacity as its alpha and `opacity` is `1`, so an app's own `background` on the backdrop shows at full strength there, and an app's `opacity` on the backdrop multiplies with the fade.

Content stays between the bars, so the safe-area padding doesn't change. Other browsers don't get this rule.

### iOS theme

An optional theme gives the drawer the look of an iOS 26/27 sheet ("Liquid Glass"): a translucent, blurred sheet with a light rim and a darkened edge, large rounded corners on the page-facing side, a dimming backdrop and a grabber bar. At the highest snap point the sheet becomes opaque, as an iOS sheet does at full height. Import it after the base styles; it does not import them itself:

```js
import 'ember-mobile-drawer/styles.css';
import 'ember-mobile-drawer/themes/ios.css';
```

The theme only applies under the `mobile-drawer-theme-ios` class. Put it on an ancestor of the drawer: `<body>` to theme every drawer, or a wrapper element for one drawer. Don't put it on `<MobileDrawer>` itself.

```hbs
<div class="mobile-drawer-theme-ios">
  <MobileDrawer as |drawer|>
    <div class="mobile-drawer-theme-ios__grabber"></div>
    ...
  </MobileDrawer>
</div>
```

`mobile-drawer-theme-ios__grabber` draws a 36×5px bar for bottom and top drawers. Put it directly in the drawer: first in a bottom drawer and last in a top drawer. The element is a 15px strip across the tray that stays at the tray's leading edge (see [Keep the grabber at the leading edge](#keep-the-grabber-at-the-leading-edge)): sticky at the top of a bottom drawer and at the bottom of a top drawer, so it stays in view while the content scrolls at the highest snap point. Don't wrap the grabber in another element: a sticky element only sticks inside its parent, so a wrapped grabber scrolls away with its wrapper. While the drawer is expanded (`data-expanded`, at the highest snap point) the sheet is opaque (see **Full height** below) and the strip has the same colour, so the content scrolling under it doesn't show through and the strip doesn't show as a band (browsers that can't make the colour opaque, such as Safari before 18, keep the glass sheet and give the strip the translucent sheet colour). Below the highest snap point the strip is transparent, so it looks like the rest of the sheet. That works because no content is under the strip there: the component keeps the tray at its scroll start below the highest snap point (the start of the content at the top of a bottom drawer, the end of the content at the bottom of a top drawer; see [Scrolling content](#scrolling-content)). There is one short exception, a run down from a scrolled sheet. `data-expanded` goes away when the run starts, but the tray only gets back to its scroll start during the run, in step with the tray (or, for a close, once the drawer is closed). So for that moment the rows that were scrolled under the strip show under the bar. In the demo, when you close a fully open, scrolled sheet with "Done", a part of a row shows under the bar while the sheet slides away (about half a second). The strip's 5px padding above and below the bar doesn't collapse with a neighbour's margin, as the old 5px margins did. The bar is drawn by the strip's `::before`, so style the bar there, for example `.mobile-drawer-theme-ios__grabber::before { width: 48px; }`. With `@handleOnly`, put the `handle` modifier on the grabber itself, not on a wrapper; for a larger touch target, give it more padding, for example `.mobile-drawer-theme-ios__grabber { padding-block: 12px; }`.

The glass rim (the light inner edge of the sheet, an inset shadow in `--mobile-drawer-shadow`) is part of the tray's background, so the content paints over it. While the strip has the opaque colour, the strip's `::after` draws the rim again over the strip, along the leading edge and its rounded corners. The strip spans the full width of the tray, also over the side safe areas that the content pads (for example in iPhone landscape), so the rim follows the sheet edge. The strip rim always uses the theme's rim colour, not the value in your `--mobile-drawer-shadow`. If you remove the rim from `--mobile-drawer-shadow`, also remove it from the strip: `.mobile-drawer-theme-ios__grabber::after { box-shadow: none; }`. If you change only the rim colour, also give the strip rim your colour. Use the same selector and `@supports` condition as the theme, so the strip gets the rim only where it is opaque:

```css
@supports (color: rgb(from light-dark(red, red) r g b / 1)) {
  .mobile-drawer-theme-ios
    .mobile-drawer[data-expanded]
    > .mobile-drawer__tray
    > .mobile-drawer__content
    > .mobile-drawer-theme-ios__grabber::after {
    box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.5);
  }
}
```

- **Light and dark** follow the page's `color-scheme` (through `light-dark()`), like the base styles' `Canvas` default. Declare `color-scheme: light dark` (for example on `:root`) to get the dark sheet in dark mode. Browsers without `light-dark()` (Safari before 17.5, Chrome before 123) always get the light sheet.
- **Glass** needs `backdrop-filter`; without it the sheet is solid. With reduced transparency or increased contrast (`prefers-reduced-transparency: reduce`, `prefers-contrast: more`) the sheet is solid too.
- **Full height**: while the drawer is expanded (`data-expanded`: at its highest snap point, or animating towards it) the sheet is opaque and not blurred. Its colour is the sheet colour (`--mobile-drawer-background`, the theme's or yours) without its transparency: white in light mode, `rgb(28 28 30)` in dark mode. The corners keep the theme's radius (`--mobile-drawer-radius`), which is the full-height radius. `data-expanded` doesn't change during a drag or while a touch holds the drawer, so small movements at the top don't switch the sheet between glass and opaque. The change fades in 0.25s (not with `prefers-reduced-motion: reduce`): towards the top the blur and the grabber strip's colour change when the fade ends, away from the top they change at once. This needs relative colours with a `light-dark()` origin (Safari 18, Chrome 123, Firefox 128 or later); other browsers keep the glass sheet at full height. In iOS Safari 26 the toolbar area under a bottom sheet also gets the opaque colour, at the end of the same fade: the theme sets it on `.mobile-drawer__bar-tint` (see [iOS Safari 26 bars](#ios-safari-26-bars)).
  - It follows the highest snap point, not the height of the screen. A drawer with one open snap point, for example the default `[0, 'content']` or most left and right drawers, is `data-expanded` whenever it is open: its sheet is opaque at rest, and fades from glass to opaque each time it opens. On iOS, a sheet with only a medium or a content-sized detent stays glass. To keep such a drawer glass, give it a lower snap point, or override the expanded tray. A background alone is not sufficient: the expanded tray also has no `backdrop-filter`, so put the blur back too. If you use the grabber, also change its strip: while the drawer is expanded the strip has the opaque sheet colour, which shows as a band on the glass sheet. A translucent colour on the strip also shows as a band, because it adds to the tray's tint. So make the strip transparent: it then shows the tray's own glass, and the content that scrolls under the grabber stays visible there. App CSS that is not in a layer wins over the theme:

    ```css
    .mobile-drawer-theme-ios .mobile-drawer[data-expanded] > .mobile-drawer__tray {
      background: var(--mobile-drawer-background);
      -webkit-backdrop-filter: blur(30px) saturate(1.8);
      backdrop-filter: blur(30px) saturate(1.8);
    }

    .mobile-drawer-theme-ios
      .mobile-drawer[data-expanded]
      > .mobile-drawer__tray
      > .mobile-drawer__content
      > .mobile-drawer-theme-ios__grabber {
      background: transparent;
    }

    .mobile-drawer-theme-ios .mobile-drawer[data-expanded] > .mobile-drawer__bar-tint {
      background-color: var(--mobile-drawer-background);
    }
    ```

    The last rule gives the iOS Safari 26 toolbar area the glass colour again (see [iOS Safari 26 bars](#ios-safari-26-bars)). In the `ember-mobile-drawer` layer, these selectors also win, because they have more than one class (see the end of this section). The example also puts the blur back with reduced transparency or increased contrast. There the sheet is opaque, so you can't see the blur, but it still costs GPU time.
  - `--mobile-drawer-background` must be a colour with this theme. The theme can't make a non-colour value, such as a gradient or an image, opaque: then the expanded tray gets no background at all, so it is transparent and not blurred.
- **Blur cost**: the glass is a 30px `backdrop-filter` blur on the tray, and the tray moves every frame while it is dragged or animates, so the browser blurs the page behind it again on every frame. On slower devices that can cost frames. At full height the sheet is opaque and not blurred, so the blur costs nothing there, also while the content scrolls. To turn the blur off, override it on the tray and give the sheet a solid background, so the page doesn't show through unblurred:

  ```css
  .mobile-drawer-theme-ios {
    --mobile-drawer-background: light-dark(rgb(255 255 255), rgb(28 28 30));
  }

  .mobile-drawer-theme-ios .mobile-drawer__tray {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  ```

- **Spring**: the theme is CSS only, so it doesn't change how the drawer moves. For iOS-like motion, also pass `@spring={{springPresets.ios}}` (see [Spring](#spring)).
- The sheet stays attached to the screen edge at every snap point. On iOS a partial-height sheet floats inset from the screen edges and only becomes edge-to-edge when fully expanded; the theme can't do the inset sheet yet.

#### Grabber strip limits

- **Padding on the tray's leading edge.** A sticky element sticks inside the padding of its scroll container. With padding at the top of the tray (bottom drawer) or at the bottom (top drawer), the strip sticks below that padding, and the content scrolls into the gap above the grabber. The rim that the strip draws is then also below the padding. CSS can't read the tray's padding, so the theme can't move the strip into it by itself. The app can: give the grabber minus the padding as its offset.

  ```css
  /* Bottom drawer, with `padding-top: 16px` on the tray. */
  .mobile-drawer-theme-ios__grabber {
    top: -16px;
  }
  ```

  For a top drawer with `padding-bottom` on the tray, set `bottom` instead. Side padding on the tray makes the strip and its rim narrower than the sheet in the same way; pad your own elements instead.
- **Changed side padding on the content.** In bottom and top drawers the strip moves out of the side padding that the base styles give `.mobile-drawer__content` (`env(safe-area-inset-left)` and `env(safe-area-inset-right)`), so it spans the full tray width. If your app changes that padding, change the strip to match: minus your padding as the side margins, and your padding as the strip's side padding. For example, for content without side padding:

  ```css
  .mobile-drawer-theme-ios .mobile-drawer-theme-ios__grabber {
    margin-left: 0;
    margin-right: 0;
    padding-left: 0;
    padding-right: 0;
  }
  ```

  If you don't, the strip doesn't match the content padding: with less padding the tray scrolls sideways by the difference, with more the strip and its rim are narrower than the sheet. Left and right drawers don't get the side margins.
- **App content with a `z-index`.** The strip has `z-index: 1` in the tray. Positioned content in the tray with a `z-index` of 1 or more (for example a menu with `position: relative; z-index: 2`) paints above the strip when it scrolls under it. The theme can't put a stacking context around the content after the grabber without changing how that content stacks. Keep such content at `z-index: 0` or lower, put it in a wrapper with `isolation: isolate` (its children then stack inside the wrapper, under the strip), or give the strip a higher `z-index`.

#### Page scale

Optional, and off by default: while a modal bottom sheet is open, the page behind it scales down, moves down and gets rounded top corners, like the page behind an iOS sheet. It follows the sheet frame by frame, and the area around the page is black. To turn it on, put the `mobile-drawer-theme-ios__page` class and the `data-mobile-drawer-page` attribute on the element that holds your page, for example a wrapper around your application template:

```hbs
{{! app/templates/application.hbs }}
<div class="mobile-drawer-theme-ios__page" data-mobile-drawer-page>
  {{outlet}}
</div>
```

`data-mobile-drawer-page` tells the drawers to write their progress on the element (see "The page behind" in `styles.css`). The class makes the iOS theme use it. The element doesn't need to be inside the `mobile-drawer-theme-ios` class.

- **The drawer must not be inside the page element.** A drawer inside it doesn't scale the page (the page can't move without moving the drawer). Render the drawer outside it, for example at the end of `<body>` with `{{#in-element}}`, and put the `mobile-drawer-theme-ios` class around the drawer there. Drawers that stay inside the page still work; they just don't scale it.
- Only modal drawers (the default) with `@placement="bottom"` (the default) scale the page. As on iOS, top, left and right drawers never move the page. A non-modal drawer leaves the page usable, so the page stays as it is. With several open drawers it follows the one that is open furthest.
- The page follows the drawer linearly, from its smallest snap point (no scale) to its largest (full scale), so a sheet at `'40%'` of `[0, '40%', 'content']` scales the page part of the way. iOS scales the page only when a sheet is at its large detent. For that look, give the sheet only a closed and a full-height snap point.
- A page element that is rendered while a sheet is open (for example after a route change) follows the sheet at once, also while the sheet is at rest. A page element that is removed gets its properties removed.
- **`position: fixed`**: while the page is scaled it has a `transform`, so `position: fixed` content in it is positioned against the page element instead of the viewport. That is only right when the page element fills the viewport (for example an app shell whose content scrolls inside it); otherwise such content can move while a sheet is open. While no modal sheet is open the page has no `transform` at all, so fixed content works as usual.
- **Black around the page**: the theme makes `<body>` black while a drawer moves the page (the component then puts `data-mobile-drawer-page-active` on the page element). This only works when the page element is a direct child of `<body>`. A sheet that rests at a peek (its smallest snap point, with the page not scaled) doesn't make `<body>` black. An unlayered `background` on `<body>` wins over that: put the page colour on `<html>` and on the page element instead. The page element gets `Canvas` as its background (set `--mobile-drawer-ios-page-background`, or a `background` of your own). Give `<body>` no margin or padding, so the black only shows around the scaled page. In iOS Safari 26 the toolbar area under the sheet has the sheet colour, not black, and the status bar is black, the colour around the scaled page: the theme makes `.mobile-drawer__backdrop-tint` black while the page is `data-mobile-drawer-page-active` (see [iOS Safari 26 bars](#ios-safari-26-bars)).
- **Leave a gap at the top**: the theme doesn't add it, your app's CSS does. A sheet that covers the whole screen hides the scaled page. On iOS the full-height sheet stops a little below the top, so the page shows behind it as a card. Do the same with a `max-height` on the tray, for example `.my-sheet > .mobile-drawer__tray { max-height: calc(100% - env(safe-area-inset-top, 0px) - 24px); }`, as the demo does.
- **Performance**: the page's `transform` (a `translate3d` and a `scale`) changes every frame, and the `translate3d` puts the page on a compositing layer of its own while it is scaled, so the browser doesn't paint the page again on every frame. The rounded corners are a `clip-path` with a fixed radius, which only changes when a sheet opens.
- **Reduced motion**: with `prefers-reduced-motion: reduce` the page doesn't scale or move.
- **Inherited properties**: the theme registers `--mobile-drawer-page-progress` and `--mobile-drawer-page-viewport-top` with `@property` as not inherited (`inherits: false`), for the whole document, so the page's content isn't styled again on every frame. So when you load `ios.css`, app CSS can't read these properties on a child of the page element. Read them on the page element itself.

Settings, as custom properties on the page element or an ancestor of it:

| Property                              | Default                                   | Purpose                              |
| ------------------------------------- | ----------------------------------------- | ------------------------------------ |
| `--mobile-drawer-ios-page-scale`      | `0.92`                                    | Scale of the page when fully open    |
| `--mobile-drawer-ios-page-offset`     | `calc(env(safe-area-inset-top) + 10px)`   | How far the page moves down          |
| `--mobile-drawer-ios-page-radius`     | `12px`                                    | Radius of the page's top corners     |
| `--mobile-drawer-ios-page-background` | `Canvas`                                  | Background of the page element       |

Like the rest of the theme, these values are approximations: Apple doesn't document them.

The theme sets the custom properties from the table above on the element with the theme class, plus `backdrop-filter` and `transition` on the tray, and `background` on the tray while the drawer is expanded, in the same `ember-mobile-drawer` layer with zero-specificity selectors. One rule is an exception: the expanded tray's `background` has the specificity of one class, so it wins over the base styles' tray background in either load order. Unlayered app CSS, and app CSS in a later layer, win over all of the theme. In the `ember-mobile-drawer` layer itself, app CSS needs more than one class (or must come later) to override the expanded tray's `background`. To change a theme value, set the property on the element with the theme class or closer to the drawer, for example `.mobile-drawer-theme-ios { --mobile-drawer-radius: 16px; }`. A value on `:root` doesn't override the theme when the class is on a descendant of `:root`, such as `<body>`.

## Testing

The drawer's animations are registered with [`@ember/test-waiters`](https://github.com/emberjs/ember-test-waiters), so `await settled()` (and every helper of `@ember/test-helpers` that waits for it, such as `click`) waits until the drawer is at rest. In production builds the waiter does nothing. The animations run on `requestAnimationFrame`, which the browser stops in a hidden tab or a background window: there, `settled()` waits until the test times out. Keep the test browser visible, or run it headless.

`ember-mobile-drawer/test-support` has helpers for rendering and application tests. They need `@ember/test-helpers` (an optional peer dependency, which apps with tests already have).

```ts
import { click } from '@ember/test-helpers';
import {
  openDrawer,
  closeDrawer,
  dragDrawer,
} from 'ember-mobile-drawer/test-support';

await openDrawer(); // the first .mobile-drawer
await closeDrawer('[data-test-cart]');
await dragDrawer('[data-test-cart]', { to: 1 });
await dragDrawer('[data-test-cart-grabber]', { distance: -80, velocity: -1200 });
```

Every helper takes the drawer as a selector or an element. A selector is only looked up inside the test's root element (`getRootElement()`); for a drawer rendered elsewhere, for example with `{{#in-element}}` outside it, pass the element. The element is the drawer's root element, or any element inside it. For nested drawers, the innermost drawer is used. Each helper waits for `settled()`.

- `openDrawer(target = '.mobile-drawer')`: does what the yielded `open()` does: moves to the largest snap point. When `@activeSnapPoint` is set it only calls `@onSnapPointChange`, like `open()`.
- `closeDrawer(target = '.mobile-drawer')`: does what `close()` does: moves to the smallest snap point.
- `dragDrawer(target, { to, velocity })` or `dragDrawer(target, { distance, velocity })`: drags the drawer with one finger and lets go. The finger goes down in the middle of `target`: an element in the tray, or the tray when `target` is the drawer's root element. With `@handleOnly`, pass a handle. It sends touch pointer events (and touch events, in browsers that can create them), so it goes through the same code as a real drag and calls `@onDragStart`, `@onDragEnd` and `@onSnapPointChange`.
  - `to`: the index of the snap point to drag to.
  - `distance`: how far to move the finger along the drawer's axis, in px: positive opens, negative closes. Past the first and last snap point the drawer follows with resistance.
  - `velocity`: the velocity at the release, in px/s, positive opens. It must have the same direction as the drag. Default `0`: the finger stops before it lifts, and the drawer settles on the nearest snap point. A release faster than 400 px/s moves at least one snap point that way.
  - The finger first moves 11px to start the drag; the drawer does not follow over that distance. A moving drawer is stopped where it is. If no drag starts (for example, because the gesture scrolled the content, or `target` is not a handle of a `@handleOnly` drawer), `dragDrawer` throws.

## Development

The toolchain is managed with [proto](https://moonrepo.dev/proto). Run `proto install` in the repository to get the pinned node and pnpm versions from `.prototools`.

- `pnpm install` installs dependencies
- `pnpm start` runs the demo app (`demo-app/`) at http://localhost:4200
- `pnpm test` builds and runs the test suite in headless Chrome
- `pnpm lint` / `pnpm lint:fix` lint the project
- `pnpm build` builds the addon into `dist/`

Try scenarios for other Ember versions are defined in `.try.mjs` and run in CI via [`@embroider/try`](https://github.com/embroider-build/try).

See the [Contributing](CONTRIBUTING.md) guide and the [Release](RELEASE.md) guide for details.

## License

This project is licensed under the [MIT License](LICENSE.md).
