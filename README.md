# ember-mobile-drawer

A gesture-enabled drawer component for Ember, built as a v2 addon.

- Drag to open, close, or snap to any point in between
- Spring physics animations
- Configurable snap points (px, %, or content height)
- Placements: bottom, top, left, right (`left` and `right` are physical and don't flip under `dir="rtl"`)
- Modal dialog behaviour by default: focus trap, inert page, scroll lock, Escape to close
- Minimal base styles, with an optional iOS theme
- Test helpers to open, close and drag drawers in your app's tests

Try it in the [playground](https://nickschot.github.io/ember-mobile-drawer/). It is built from `demo-app/` on every push to `main`. Open it on a phone, or with touch emulation in your browser's developer tools: the drawer drags with touch and pen input, not with a mouse.

> Work in progress. Planning and progress are tracked in [GitHub issues](https://github.com/nickschot/ember-mobile-drawer/issues).

## Contents

- [Compatibility](#compatibility)
- [Installation](#installation)
- [Quick start](#quick-start): [bottom](#bottom-sheet), [top](#top-drawer), [left](#left-drawer), [right](#right-drawer)
- [Usage](#usage): [snap points](#snap-points), [controlled and uncontrolled](#controlled-and-uncontrolled), [backdrop](#backdrop), [spring](#spring), [events](#events), [accessibility](#accessibility), [dragging](#dragging), [grabber](#grabber), [scrolling content](#scrolling-content), [nested drawers](#nested-drawers), [public imports](#public-imports), [TypeScript](#typescript)
- [Styles](#styles): [state attributes](#state-attributes), [floating sheet](#floating-sheet), [iOS theme](#ios-theme)
- [Testing](#testing)
- [API reference](#api-reference)
- [Development](#development)

## Compatibility

- `ember-source` 5.12 or above (the `ember-source` peer dependency is `>= 5.12`). CI tests the 5.12 LTS (with a classic ember-cli build), the 6.12 LTS and the latest release; beta and alpha are tested too, but are allowed to fail.
- Embroider, or ember-cli with ember-auto-import v2.
- `@glimmer/component` 1.1.2 or above.
- TypeScript and Glint are optional. The package ships its own types; see [TypeScript](#typescript).
- `@ember/test-helpers` 3 or above, only for the [test helpers](#testing).
- Browsers: dragging needs pointer events and works with touch and pen input. Mouse users open and close a drawer with your app's buttons, the backdrop or Escape. Some features need newer browsers; the sections that describe them give the versions.

## Installation

```sh
pnpm add ember-mobile-drawer
```

or, in an ember-cli app:

```sh
ember install ember-mobile-drawer
```

Then import the base styles once, for example in your `app/app.ts`:

```js
import 'ember-mobile-drawer/styles.css';
```

The drawer doesn't work without them: they position the drawer and hide it while it is closed. See [Styles](#styles) for how to customise them, and the [iOS theme](#ios-theme) for an optional look.

For the safe-area insets (the notch and the home indicator), add `viewport-fit=cover` to your viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

## Quick start

A drawer is closed at its snap point `0` and opens to its other snap points. To open it from a button on the page, pass the index of the snap point it should be at in `@activeSnapPoint`, and store the new index that `@onSnapPointChange` gives you, so drags, the backdrop and Escape can move it too. Inside the drawer, the yielded `open`, `close` and `snapTo` actions move it.

Give every modal drawer (the default) a name with `aria-labelledby` or `aria-label`.

### Bottom sheet

A sheet that opens to half the screen, then to full height, with a grabber that always drags it and that moves the sheet between half and full height on a tap:

```gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from 'ember-mobile-drawer';

export default class PlacesSheet extends Component {
  snapPoints: SnapPoint[] = [0, '50%', '100%'];
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>Show places</button>

    <MobileDrawer
      @placement="bottom"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      aria-labelledby="places-title"
      as |drawer|
    >
      <drawer.Grabber class="grabber" data-mobile-drawer-pinned />
      <h2 id="places-title">Places</h2>
      <button type="button" {{on "click" drawer.open}}>Expand</button>
      <button type="button" {{on "click" drawer.close}}>Close</button>
      <ul>...</ul>
    </MobileDrawer>
  </template>
}
```

`@placement="bottom"` is the default. The sheet scrolls its content at its highest snap point (see [Scrolling content](#scrolling-content)), and [Keep the grabber at the leading edge](#keep-the-grabber-at-the-leading-edge) has the CSS for a sticky grabber. The yielded `Grabber` is a button for keyboard and screen reader users too, see [Grabber](#grabber).

### Top drawer

A drawer that slides down from the top as far as its content needs:

```gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer, type SnapPoint } from 'ember-mobile-drawer';

export default class NotificationsDrawer extends Component {
  snapPoints: SnapPoint[] = [0, 'content'];
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>Notifications</button>

    <MobileDrawer
      @placement="top"
      @snapPoints={{this.snapPoints}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      aria-labelledby="notifications-title"
      as |drawer|
    >
      <h2 id="notifications-title">Notifications</h2>
      <ul>...</ul>
      <button type="button" {{on "click" drawer.close}}>Close</button>
    </MobileDrawer>
  </template>
}
```

`[0, 'content']` is the default for `@snapPoints`, so you can leave it out. A top drawer's leading edge is its bottom: put a grabber last, and below its highest snap point the drawer shows the end of its content.

### Left drawer

A navigation drawer from the left edge. The tray of a side drawer is as wide as its content, so give the content a width:

```gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer } from 'ember-mobile-drawer';

export default class NavDrawer extends Component {
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>Menu</button>

    <MobileDrawer
      @placement="left"
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      aria-label="Menu"
      as |drawer|
    >
      <nav class="nav-drawer">
        <a href="/inbox">Inbox</a>
        <a href="/sent">Sent</a>
        <button type="button" {{on "click" drawer.close}}>Close</button>
      </nav>
    </MobileDrawer>
  </template>
}
```

```css
.nav-drawer {
  width: min(20rem, 85vw);
}
```

The tray never grows wider than the screen (minus the safe area on the far side). A side drawer drags sideways and scrolls its content vertically at every snap point.

### Right drawer

The same for the right edge, for example a filter panel. This one is non-modal: the page stays usable while it is open, and it has no backdrop:

```gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { MobileDrawer } from 'ember-mobile-drawer';

export default class FilterPanel extends Component {
  @tracked active = 0;

  setActive = (index: number) => (this.active = index);

  <template>
    <button type="button" {{on "click" (fn this.setActive 1)}}>Filters</button>

    <MobileDrawer
      @placement="right"
      @modal={{false}}
      @activeSnapPoint={{this.active}}
      @onSnapPointChange={{this.setActive}}
      as |drawer|
    >
      <section class="filter-panel" aria-labelledby="filters-title">
        <h2 id="filters-title">Filters</h2>
        ...
        <button type="button" {{on "click" drawer.close}}>Done</button>
      </section>
    </MobileDrawer>
  </template>
}
```

```css
.filter-panel {
  width: min(22rem, 90vw);
}
```

A non-modal drawer has no `role`, so name the region in it yourself, as the `<section>` above does. See [Accessibility](#accessibility).

## Usage

### Snap points

`@snapPoints` lists where the drawer can rest, as the distance it is open along its axis:

- a number of px, for example `240`;
- a percentage of the space the tray can open into, for example `'50%'` (the type is `` `${number}%` ``);
- `'content'`: the tray's natural size, as large as its content.

Snap points are identified by their index in the array; their order doesn't matter. Include `0` to let the drawer close fully. A drawer without `0` is never fully closed: its smallest snap point is a "peek". The default is `[0, 'content']`. Snap points are recalculated when the viewport or the content changes size, and the drawer stays at the same snap point.

`open()` moves the drawer to the snap point with the largest offset, `close()` to the one with the smallest. Both need the drawer's measured size, so they do nothing before the drawer is in the DOM.

### Controlled and uncontrolled

With `@activeSnapPoint` the drawer is controlled: it moves to the snap point at that index, and animates there when the index changes. Its own actions (`snapTo`, `open`, `close`, a drag, the backdrop, Escape) don't move it; they call `@onSnapPointChange` with the new index, and the drawer moves once you pass that index back in. After a drag the drawer heads back to the current `@activeSnapPoint` until you do. `@onSnapPointChange` isn't called when you change `@activeSnapPoint` yourself.

Without `@activeSnapPoint` the drawer keeps track of its snap point itself. It starts at index `0`, and when you stop passing `@activeSnapPoint` it stays where it was. `@onSnapPointChange` is still called when it moves. Use an uncontrolled drawer when only the drawer itself (its yielded actions and drags) opens and closes it, for example a peek drawer:

```gts
import { on } from '@ember/modifier';
import { MobileDrawer, type SnapPoint } from 'ember-mobile-drawer';

const SNAP_POINTS: SnapPoint[] = [120, '100%'];

<template>
  <MobileDrawer @modal={{false}} @snapPoints={{SNAP_POINTS}} as |drawer|>
    <button type="button" {{on "click" drawer.open}}>More</button>
    ...
  </MobileDrawer>
</template>
```

Update `@activeSnapPoint` together with `@snapPoints`: an index that doesn't exist is clamped to the nearest valid one, with a warning in development.

Attributes such as `class`, `id`, `aria-label` and `aria-labelledby` go on the drawer's root element. All arguments, the yielded values and the markup are listed in the [API reference](#api-reference).

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
- `@onDragEnd` gets the snap point the release picked (the one passed to `@onSnapPointChange` if it differs from the active one), the px open at the release (where the finger put the drawer: right after a drag starts, the tray can still be a few px behind it), and the release velocity in px/s (positive opens, negative closes; `0` when the browser cancelled the pointer). When `@activeSnapPoint` is set, the drawer only moves to that snap point once you pass it in. A drag that ends without a release, because its handle was removed or `@placement` changed, gives the active snap point and velocity `0`. A drag that is still going when the drawer is removed calls no `@onDragEnd`. If you change `@snapPoints` in `@onDragEnd`, the index that `@onSnapPointChange` gets next is an index into the old list.
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

- focus moves into it: to the first element with `autofocus`, else the first focusable element (not a yielded [`Grabber`](#grabber)), else the tray itself;
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

Animations respect `prefers-reduced-motion`: with reduced motion the drawer jumps to its snap point instead of animating.

#### Keyboard focus and content off screen

Below its highest snap point the content of a drawer doesn't scroll along its axis, so part of it is off screen. When keyboard focus (focus after a key press, for example after Tab) moves to an element in the tray that isn't fully on screen, the drawer (modal or not) moves to its highest snap point, like `open()`: through `@onSnapPointChange` when `@activeSnapPoint` is set, the same as after a drag. When it gets there, the tray scrolls the element into view if the browser didn't. The focus that a modal drawer moves in itself when it opens doesn't move it: the drawer stays at the snap point your app opened it at, so open it at a snap point where its first focusable element (or the element with `autofocus`) shows.

Keyboard focus also moves a drawer at a peek (a smallest snap point above `0`), where Tab reaches the content from the page. From a peek the drawer opens (`@onOpen` is called), but it doesn't become modal: the page isn't inert, `aria-modal` isn't set and Tab goes on through the drawer and out to the page. When focus moves to an element outside the drawer, the drawer goes back to its peek (`@onClose` is called). Escape also sends it back, and focus then returns to the element it came from. A drawer that opens from its peek in another way (a drag, `open()`, `@activeSnapPoint`) is modal as before.

The drawer uses the last input to know keyboard focus: while a drawer shows, it records each key press and each pointer that goes down (mouse, touch or pen). Focus less than 1 second after a key press is keyboard focus, also when your app moves it, and focus less than 1 second after a pointer press is not. This is the same in every browser. Focus without a key or pointer event right before it (for example from a screen reader or switch access) uses `:focus-visible`, but a `readonly` or `disabled` text field then never counts as keyboard focus. Focus from a tap or a click on a button or a link doesn't move the drawer. A tap on a text field that is only partly on screen (an `<input>` or `<textarea>` that isn't `readonly` or `disabled`, or contenteditable content) does move the drawer, which also shows the field above the on-screen keyboard. A tap on a `readonly` text field doesn't: it opens no keyboard.

Focus at the highest snap point doesn't move the drawer, and neither does focus inside a drawer nested in this one (that drawer handles its own content). With reduced motion the drawer jumps there. The drawer's root never scrolls: browsers scroll it to show a focused element, which would move the whole drawer away from its edge, so the drawer scrolls it back at once.

#### Limits of modal drawers

- **Content rendered elsewhere becomes inert.** Popovers, dropdowns and menus that belong to the drawer's content must be rendered inside the drawer. Addons that render into a `<body>`-level element (a "wormhole" or portal, such as ember-basic-dropdown and ember-power-select) put their content next to the drawer, where it is inert and can't be clicked. Render them in place (`@renderInPlace={{true}}` for ember-basic-dropdown and ember-power-select). Elements added to `<body>` after the drawer opened are not made inert. Rendering in place also matters for a drawer that keyboard focus opened from its peek (see [Keyboard focus and content off screen](#keyboard-focus-and-content-off-screen)): it isn't modal, so content rendered into `<body>` can be used, but focus that moves into it is outside the drawer, so the drawer goes back to its peek.
- **The scroll lock assumes the document scrolls.** It sets `overflow: hidden` on `<html>`. If your app scrolls inside `<body>` or a wrapper element instead (common in app-like layouts), that element keeps scrolling; lock it yourself while the drawer is open. Fixed-position page elements are not adjusted for the scrollbar that disappears.
- **Safari doesn't focus buttons on click**, so after opening a drawer with a mouse or touch there, no element gets focus back on close.

### Dragging

The drawer can be dragged with touch or pen input along its axis: up and down for `bottom` and `top`, sideways for `left` and `right`. It follows the finger, with resistance past the first and last snap point. A drag starts once the finger has moved about 10px; the drawer does not jump at that point, but catches up with that distance over the first frames of the drag (about 100ms). If the finger turns back by more than 2px before then, the drawer holds still until the finger reaches it, so it never gets ahead of the finger. Past fully open the tray stays at its edge, and its content bounces, like the content of an iOS sheet. The bounce follows the classic UIScrollView rubber band, `(1 − 1 / (x × 0.55 / d + 1)) × d` for a pull of `x` px, with `d` = 0.55 × the tray's length (measured in the iOS simulator, see [#51](https://github.com/nickschot/ember-mobile-drawer/issues/51)). The component moves the content with an inline `translate` on `.mobile-drawer__content`, so an app `transform` on it still applies; don't set `translate` on it. Put `data-mobile-drawer-pinned` on an element in the content that must stay at the tray's edge during the bounce, such as a sticky grabber or header. The component writes the opposite inline `translate` on it during the bounce, and puts back the element's own inline `translate` after. On release the content springs back with the drawer's spring. When you let go it settles on a snap point: the nearest one after a slow drag, further along after a flick. Touching a moving drawer stops it where it is.

When `@activeSnapPoint` is set, letting go calls `@onSnapPointChange` with the snap point the drag ended on. Until you pass that index back in, the drawer heads back to the current `@activeSnapPoint`; if you never do, it stays there.

The yielded `handle` modifier marks an area that always drags the drawer, for example a grabber or a sticky header. A gesture that starts on a handle drags the drawer at every snap point and never scrolls the content, also when the content is scrolled. Without it, a pull on the sticky header of a scrolled sheet scrolls the content (see [Scrolling content](#scrolling-content)).

> **Behaviour change:** in earlier versions the `handle` modifier did nothing without `@handleOnly`. Now a handle always drags the drawer, also without `@handleOnly`, and gets an inline `touch-action`. If you have the modifier on a large area of a drawer without `@handleOnly`, that area no longer scrolls the content along the drawer's axis. Remove the modifier from it, or keep it on a small area only.

```gts
<MobileDrawer as |drawer|>
  <header class="sheet-header" {{drawer.handle}}>
    <div class="grabber"></div>
    <h2>Nearby</h2>
    <button type="button" {{on "click" drawer.close}}>Close</button>
  </header>
  <ul class="long-list">...</ul>
</MobileDrawer>
```

To drag only from a handle, for example because the content has its own gestures, also set `@handleOnly`. The rest of the tray then doesn't drag:

```gts
<MobileDrawer @handleOnly={{true}} as |drawer|>
  <div class="grabber" {{drawer.handle}}></div>
  <ul class="long-list">...</ul>
</MobileDrawer>
```

A handle gets `touch-action: pan-x` (for `bottom` and `top`) or `pan-y` (for `left` and `right`), so the browser doesn't scroll on it along the drawer's axis. A gesture that is decided as a drag also has its `touchmove` events cancelled, with or without `@handleOnly`, because iOS Safari doesn't reliably apply `touch-action`. A tap on a button or link in a handle still works: a drag only starts when the finger moves. Handles only drag with touch or pen input, like the tray; they don't add keyboard behaviour. A handle belongs to the drawer that yields it: a handle of a drawer inside another drawer doesn't drag the outer one.

A handle wins over the elements in it. A `data-mobile-drawer-scroll` element in a handle can't scroll along the drawer's axis: a gesture on it drags the drawer. Keep handles small: a grabber, a header with a title and buttons. Don't put scrolling content or form fields in a handle. One exception: a text field in a handle (a text `<input>`, a `<textarea>` or contenteditable content) is not part of the handle, so you can still select text in it. Without `@handleOnly` a gesture on it works as on the rest of the tray; with `@handleOnly` it doesn't drag.

The demo's bottom sheet example has the `handle` modifier on its sticky header, and the iOS sheet example a yielded `Grabber` (see below).

#### Grabber

The yielded `Grabber` component is an accessible grabber, like the grabber of an iOS sheet. It renders a `<button type="button">` with the `handle` modifier, so a drag that starts on it drags the drawer, with and without `@handleOnly`. Attributes go on the button. It has no styles of its own: give it a class, for example `mobile-drawer-theme-ios__grabber` (see [iOS theme](#ios-theme)).

```gts
<MobileDrawer @snapPoints={{array 0 "40%" "100%"}} aria-label="Places" as |drawer|>
  <drawer.Grabber class="grabber" data-mobile-drawer-pinned />
  ...
</MobileDrawer>
```

- **Tap, click, Enter or Space:** the drawer moves to the next larger open snap point. From the largest open snap point it moves back to the smallest open one. It never closes the drawer: a snap point at `0` is not in the cycle. A peek (a smallest snap point above `0`) is in the cycle. With fewer than two open snap points the grabber does nothing. When `@activeSnapPoint` is set, it calls `@onSnapPointChange`, as `snapTo` does.
- **Drag:** a drag that starts on the grabber drags the drawer. A pointer that dragged the drawer doesn't also click the grabber when it lifts, so a short drag doesn't also move the drawer to the next snap point.
- **Screen readers:** the button's name is `@label` (default `'Sheet grabber'`, as the iOS grabber). Its description is the snap point the drawer is at: `@snapPointLabels[index]`, else `'Expanded'` (the largest open snap point), `'Collapsed'` (the smallest of two or more open ones), `'Partly expanded'` (between them) or `'Closed'`. After an activation, a status element (`role="status"`) right after the button announces the new snap point, for VoiceOver and TalkBack. The text shows once the drawer's active snap point is that snap point (a controlled drawer: once you pass it in), and goes when the drawer moves in another way (a drag, the backdrop, Escape, your app), so no stale text stays in it. Pass translated texts with `@label` and `@snapPointLabels`.
- **Target size:** the iOS theme's strip is 14px high, as the native grabber. [WCAG 2.5.8 (target size, minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) asks for 24×24px, or enough space around a smaller target. The full-width strip usually meets the spacing exception, but a control near the centre of the strip can break it. Then make the strip taller with `padding-block`, for example `.mobile-drawer-theme-ios__grabber { padding-block: 10px; }` (24px in all). The bar stays centred in the strip.
- **Focus:** the grabber is in the tab order. A modal drawer that opens doesn't focus it: focus goes to the first other focusable element (or the element with `autofocus`), so a screen reader starts at the content.

| Argument           | Type                              | Default           | Description |
| ------------------ | --------------------------------- | ----------------- | ----------- |
| `@label`           | `string`                          | `'Sheet grabber'` | The button's accessible name. |
| `@snapPointLabels` | `readonly (string \| undefined)[]` | by position, see above | What a screen reader says the drawer is at, one text per snap point, indexed like `@snapPoints`. |

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

Give the grabber `data-mobile-drawer-pinned`, so it stays at the tray's edge while the content bounces past fully open (see [Dragging](#dragging)).

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
  - A drag, or a touch that holds the drawer, stops a reset where it is. The release starts a new one if the drawer then heads for a snap point below the highest. (A drag down from the top of a bottom drawer on the content only starts with the content at its start anyway; a handle can start one anywhere.)
  - The scroll position is kept while the drawer stays at its highest snap point, and when it moves up to it from a lower one.
  - When the content or the drawer changes size below the highest snap point, the tray scrolls back to its start again, but not while a field in the tray has focus (a text `<input>` or `<textarea>` that isn't `readonly` or `disabled`, a `<select>`, contenteditable content or an `<iframe>`), or while an element in it has keyboard focus (focus after a key press, for example after Tab, also on a `readonly` text field): the browser may have scrolled it into view (for example above an on-screen keyboard). Other focus, such as a tapped button, a clicked `readonly` text field or the tray itself (a modal drawer focuses it when it opens), doesn't keep the position. A `<select>` keeps focus after a choice with a mouse or on Android, so it holds the reset until it loses focus. A blur doesn't scroll the tray by itself; it scrolls back on the next size change. A size change while the tray scrolls back on its own spring keeps that spring's speed, so repeated changes don't slow the reset down.
  - Left and right drawers keep their scroll position, and so do elements marked `data-mobile-drawer-scroll`: only the tray scrolls back.
- At the highest snap point, a gesture scrolls if the content can scroll the way the finger pushes it, and drags the drawer otherwise. For a bottom drawer: with the content scrolled to the top, dragging down closes the drawer; anywhere else it scrolls. Top, left and right drawers work the same way along their own axis, so a top drawer closes by dragging up once its content is scrolled to the end.
- A gesture that started as a scroll turns into a drag when the content reaches its start and the finger keeps pulling towards close, as in a native iOS sheet: you scroll a bottom drawer's list to the top and pull the drawer down in one gesture. The drawer starts to follow the finger where it is, so it doesn't jump. From then on the content is locked and doesn't scroll or bounce, and the gesture stays a drag until the finger lifts; on release it settles as after any other drag. With several scroll containers (the tray and `data-mobile-drawer-scroll` elements around the touched element), all of them must be at their start. Momentum that carries the content to its start after the finger lifted never moves the drawer.
  - So that the content doesn't bounce at its start first, the component writes an inline `overscroll-behavior-y: none` (`-x` for `left` and `right`) on those scroll containers during a scroll, while they are nearer their start than their end, and puts back their own inline value when the finger lifts. Near the end, and during momentum, they bounce as before.
  - Not the other way: a drag up to the highest snap point doesn't turn into a scroll of the content in the same gesture. It bounces the content past fully open, as any drag does. Lift the finger and scroll again.
  - Not with `@handleOnly` (the content never drags there) and not for a gesture in a nested drawer.
  - It needs the browser to send `touchmove` events while it scrolls. iOS Safari and Chrome do; they are not cancelable then, which is why the content is locked with `overflow` instead. A browser that stops sending them during a scroll keeps the old behaviour: lift the finger and drag again.
- A gesture that starts on an element with the `handle` modifier always drags, at every snap point, also when the content is scrolled. Put the modifier on a sticky header to keep a way to drag a scrolled sheet.

The tray is the default scroll container. For scrolling elements inside it, add the `data-mobile-drawer-scroll` attribute so they take part, and give them `overscroll-behavior: contain` so their scrolling doesn't chain to the page:

```gts
<MobileDrawer as |drawer|>
  <h2>Comments</h2>
  <ul class="comments" data-mobile-drawer-scroll>...</ul>
</MobileDrawer>
```

A gesture that starts inside a marked element (or the tray) scrolls if any of those between the touched element and the tray can scroll that way. Scrolling elements without the attribute don't count, so gestures on them drag the drawer like any other content. That includes a scrollable `<textarea>`: add `data-mobile-drawer-scroll` to it too. Scrolling across the drawer's axis (e.g. a horizontal carousel in a bottom drawer) is always left to the browser.

How it works: below the highest snap point the component writes an inline `overflow-y: hidden` (`overflow-x` for `left` and `right`) on the tray and on the marked elements in it, and removes it again at the highest snap point, putting back any inline `overflow-y`/`overflow-x` the element had. A marked element added while the drawer is below the top, or whose inline style the app rewrote, is locked again when a pointer goes down, a wheel turns or focus moves inside it; on unlock, a value the app set in the meantime is kept. Scrolling across the axis isn't affected. Once a gesture is decided as a drag, at any snap point, its `touchmove` events are cancelled, so the browser can't scroll the content or the page under it; that needs a non-passive `touchmove` listener on the tray (and on each handle, for a drag that starts on it). The tray also gets `touch-action: pan-x` (`pan-y` for `left` and `right`) below the highest snap point and `pan-x pan-y` at it, but iOS Safari doesn't reliably apply `touch-action` to a scroll container, so the drawer doesn't rely on it alone. Only the finger that started on the tray counts; other fingers on the screen don't affect the decision. Pinch-zoom doesn't start on the tray. With `@handleOnly` only the handles drag, and the content still only scrolls along the axis at the highest snap point. Below it, a swipe along the axis on the content has its `touchmove` events cancelled (decided the same way, 4px and further along the axis than across it), without dragging the drawer: otherwise iOS would scroll the page behind the locked tray. Swipes across the axis are left to the browser.

Classic scrollbars: during the bounce past fully open (see [Dragging](#dragging)) the tray's overflow along the axis is `hidden` too, as below the highest snap point. With classic (not overlay) scrollbars, for example on a Windows touch laptop, the tray's vertical scrollbar then goes away for the moment, and the content gets wider by the scrollbar's width. Mobile browsers use overlay scrollbars, which take no space, so there this doesn't show. The base styles don't set `scrollbar-gutter: stable`, because it reserves the scrollbar's space all the time with classic scrollbars, also when the content doesn't overflow, and that changes the layout of every bottom and top drawer on those devices. If it matters for your app, set it yourself on a bottom or top tray:

```css
.my-sheet > .mobile-drawer__sheet > .mobile-drawer__tray {
  scrollbar-gutter: stable;
}
```

It doesn't help left and right drawers: `scrollbar-gutter` only reserves space for the vertical scrollbar, not the horizontal one.

### Nested drawers

A drawer can open another drawer, for example a sheet with a list that opens a details sheet for an item. Render the nested drawer in the yielded `Nested` component, not directly in the outer drawer's block:

```gts
<MobileDrawer
  @snapPoints={{this.snapPoints}}
  @activeSnapPoint={{this.active}}
  @onSnapPointChange={{this.setActive}}
  aria-label="Places"
  as |drawer|
>
  <button type="button" {{on "click" this.showDetails}}>Coffee</button>

  <drawer.Nested>
    <MobileDrawer
      @activeSnapPoint={{this.detailsActive}}
      @onSnapPointChange={{this.setDetailsActive}}
      aria-label="Details"
    >
      ...
    </MobileDrawer>
  </drawer.Nested>
</MobileDrawer>
```

Why: the outer drawer's tray moves with a `transform`, so it is the containing block of everything inside it, also of a nested drawer's fixed root. A drawer inside the tray covers the tray, not the screen: while the outer drawer isn't fully open (for example at `'40%'`), the nested sheet is in the part of the tray that is off screen, and only its backdrop shows. iOS shows a nested sheet over the whole screen. `Nested` does the same: it renders its block outside the tray with `{{#in-element}}`, at the end of the outer drawer's parent element (so the nested drawer has the same ancestors, for example the element with a theme class; when the outer drawer is itself inside the tray of another drawer, at the end of the parent element of the outermost of those drawers, so no tray clips it), in a `<div class="mobile-drawer-nested">` with `display: contents`. Use `@destination` to render it in another element, for example `<drawer.Nested @destination={{this.layer}}>`. Without `@destination` the block renders once the outer drawer is in the DOM, one render after the outer drawer. With server-side rendering (FastBoot) it is therefore not in the HTML from the server: it renders after the app boots in the browser. A nested drawer is usually closed at first, so that is fine; pass `@destination` if the nested drawer must be in the server HTML.

The nested drawer stays a part of the outer drawer, as if it were inside the tray:

- **Modal stack:** the nested drawer is in front. Escape and the Tab wrap go to it first, also when the outer drawer opens further while the nested drawer is open.
- **`inert`:** while a modal nested drawer is open, the outer drawer is inert. While the outer drawer is open, the nested drawer's element is not inert.
- **`data-nested`:** the outer drawer gets it while a modal nested drawer is open (the iOS theme dims the outer sheet).
- **Focus:** when the nested drawer closes, focus returns to the element that opened it, for example a button in the outer drawer.
- **Closing the outer drawer:** when the outer drawer starts to close (for example because your app sets its `@activeSnapPoint` to `0`), it closes the nested drawers in its `Nested` that are open, like `close()` (through `@onSnapPointChange` when `@activeSnapPoint` is set). They move away at the same time as the outer drawer: they don't move with the outer tray, so else they would stay on the screen during its close animation. The nested drawer is no longer modal, and stays closed when the outer drawer opens again. If your app keeps a controlled nested drawer open, it hides with the outer drawer (the `.mobile-drawer-nested` element gets `data-closed`) and shows again when the outer drawer opens again.
- **Gestures:** touches on the nested drawer don't reach the outer drawer, so a drag on the nested drawer never moves the outer one.

A drawer directly inside another drawer's block still works as before, but it only shows while the outer tray is on screen where the nested drawer opens (in practice: while the outer drawer is fully open). Use `Nested` at every level: for three drawers, put the second one in the first one's `Nested` and the third one in the second one's `Nested`.

### Public imports

These are the package's public API:

- `ember-mobile-drawer`: the `MobileDrawer` component, the spring presets (`springPresets`, `springFromDuration`) and the types (see [JavaScript exports](#javascript-exports))
- `ember-mobile-drawer/components/mobile-drawer`: the `<MobileDrawer>` component as a default export
- `ember-mobile-drawer/template-registry`: the Glint template registry, for apps that use loose-mode (`.hbs`) templates
- `ember-mobile-drawer/styles.css`: the base stylesheet (see [Styles](#styles))
- `ember-mobile-drawer/themes/ios.css`: the optional iOS theme (see [iOS theme](#ios-theme))
- `ember-mobile-drawer/test-support`: test helpers (see [Testing](#testing)) and their types `DrawerTarget` and `DragDrawerOptions`

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
| `--mobile-drawer-inset`            | `0px`          | Inset of a floating bottom sheet below its highest snap point (see [Floating sheet](#floating-sheet)) |

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
.mobile-drawer[data-placement="top"] > .mobile-drawer__sheet > .mobile-drawer__tray {
  display: block;
}
```

The safe-area insets are padding on the `.mobile-drawer__content` element inside the tray. The base styles set no padding on the tray itself, so padding you add to `.mobile-drawer__tray` adds to the insets instead of replacing them. Padding that you set on `.mobile-drawer__content` replaces the insets (the iOS theme does this for its side padding, see below), so add the insets back if you need them. Unlayered resets that set padding on `*` or `div` remove them too, because unlayered CSS always wins over the drawer's layer. In the same way, an unlayered `* { margin: 0 }` reset undoes the leading-edge alignment of top and left drawers. Put such resets in a layer before `ember-mobile-drawer`.

### State attributes

The drawer root (`.mobile-drawer`) carries state attributes you can style on:

- `data-placement`: `bottom`, `top`, `left` or `right`.
- `data-closed`: while the drawer is fully closed and at rest. The base styles hide the drawer then.
- `data-expanded`: while the drawer rests at its highest snap point, or is animating towards it. It doesn't change during a drag or while a touch holds the drawer, so small movements at the top don't flicker it: a drag that starts at the top keeps it until the finger lifts, and loses it only if the drawer is then released towards a lower snap point; a drag up from a lower snap point gets it on release, when the drawer heads for the top. It is never set when the highest snap point is closed (`0`). Use it for a look that only applies when the drawer is fully open, for example:

  ```css
  .mobile-drawer[data-expanded] > .mobile-drawer__sheet > .mobile-drawer__tray {
    --mobile-drawer-radius: 0;
  }
  ```

  The scroll lock (see [Scrolling content](#scrolling-content)) doesn't use it: that follows where the drawer is shown, frame by frame.
- `data-at-highest`: while the tray is shown at (or past) its highest snap point, where its content can scroll. Unlike `data-expanded` it follows where the drawer is shown, also during a drag or an animation: it comes when the expand progress (see [Floating sheet](#floating-sheet)) gets to 1, and goes when it leaves 1. The iOS theme makes the grabber strip opaque with it.
- `data-nested`: while a modal drawer in front of this drawer is open (the modal drawer that opened last), and this drawer shows and is not inside it (a drawer in the yielded `Nested` counts as inside). The iOS theme dims the sheet with it.
- `data-keyboard`: on a bottom drawer in iOS Safari, while the on-screen keyboard is open for a field in it (see [iOS Safari on-screen keyboard](#ios-safari-on-screen-keyboard)).
- `data-status-bar="transparent"`: while the drawer shows the page in the iOS status bar (see [Transparent status bar](#transparent-status-bar)).

### Floating sheet

The tray is in a `.mobile-drawer__sheet` element. The sheet clips the tray and takes no pointer events. Every frame, the component writes the **expand progress** on it, `--mobile-drawer-expand-progress`: `0` at and below the second-highest snap point, `1` at the highest snap point, and linear in the tray's position between them. For a drawer with one open snap point (such as `[0, 'content']`) it goes from `0` when closed to `1` when open. A theme uses it to change the look of the sheet with the finger, between the partial-height look and the full-height look. The property is registered (`@property`) as a number that is not inherited: only the sheet and the tray (which takes it with `inherit`) have it, so the content isn't styled again on every frame. Don't set it yourself.

With `--mobile-drawer-inset` (a length in `px` or `rem`, `0px` by default), a bottom sheet floats: at and below its second-highest snap point the sheet is inset by that length from the left, right and bottom edges, between the two highest snap points by less (the inset times 1 minus the expand progress), and at the highest snap point it is edge-to-edge, as an iOS 27 sheet. The tray keeps its length, its snap points and its closed position: at a snap point its top is where it is without the inset, and the sheet shows it from there to the inset above the bottom edge. When the drawer is closed, no part of the tray shows. The inset area takes no pointer events, so a tap there goes to the backdrop (or, without a backdrop, to the page). The tray stays as wide as the root: the sheet and the tray's own `clip-path` cut its sides at the inset. So the content keeps its width, it is not laid out again while the sheet expands, and a `content` snap point doesn't move. Below the highest snap point the clip hides the inset width of the content on each side: pad your content by the inset (the iOS theme does). While the sheet floats, the clips hide the tray's outer shadow (`--mobile-drawer-shadow` outside the tray) on every side, also above its top edge: the tray is wider than the sheet, so its own shadow there would be a flat band with hard ends at the sheet's sides. At the highest snap point, and without an inset, the tray's clip clips nothing, so the whole shadow shows. Use a `px` or `rem` value for the inset. An `em` value is resolved against the font size of each element that uses it (the sheet and the tray), so with a different font size on the tray the clips don't agree. A `%` value means a different length on the sheet's `inset` than in the tray's clip. Top, left and right drawers don't float. Round the sheet's bottom corners with `border-radius` on `.mobile-drawer__sheet` (the iOS theme does). For an outer shadow around the floating sheet, a theme can use the empty `.mobile-drawer__shadow` layer before the sheet (`display: none` in the base styles): the iOS theme draws its shadow there (see **Shadow** in [iOS theme](#ios-theme)). For a `backdrop-filter` on a floating sheet, use the empty `.mobile-drawer__glass` layer in the sheet, under the tray (`display: none` in the base styles), not the tray: Chrome doesn't clip a `backdrop-filter` with the tray's `clip-path`, so a blur on the tray shows outside the sheet's top corners. The glass layer has the sheet's width and the top radius, and the sheet clips its bottom, so its own box has the sheet's shape. The iOS theme puts its blur there.

```css
.my-app {
  --mobile-drawer-inset: 8px;
}

.my-app .mobile-drawer__sheet {
  border-radius: 0 0 24px 24px;
}
```

**Markup change:** the tray is now in the `.mobile-drawer__sheet` element, not a direct child of the root. Change app CSS and tests that select `.mobile-drawer > .mobile-drawer__tray` to `.mobile-drawer > .mobile-drawer__sheet > .mobile-drawer__tray`, and code that counts the root's children. A browser that scrolls a focused element into view now scrolls the sheet (the component scrolls it back at once), not the root.

Safe-area insets need `viewport-fit=cover` in your viewport meta tag (see [Installation](#installation)).

#### iOS Safari 26 bars

iOS 26 Safari doesn't let fixed elements paint under the status bar or the floating toolbar. It clips them to the area between the bars, also with `100lvh` heights or negative insets. Instead, it fills each bar with a colour that it takes from the fixed element at that edge of the screen. The base styles have an iOS-only rule (in `@supports (-webkit-touch-callout: none)`) that gives Safari the right colours:

- The bar at the sheet's edge gets the sheet colour, so the sheet seems to go on under the bar: the toolbar for a bottom drawer, the status bar for a top drawer. For this, the drawer renders an empty `.mobile-drawer__bar-tint` element after the sheet. On iOS it is a 16px fixed strip at that edge, in front of the tray. It paints nothing and takes no pointer events. Its background is `--mobile-drawer-background`, and Safari takes that colour for the bar from the first frame of an opening drawer. When the colour changes, Safari takes the new colour. Left and right drawers don't get the strip. On other browsers it is `display: none`.
- Set the sheet colour with `--mobile-drawer-background`. If your app sets a `background` on `.mobile-drawer__tray` directly, also set the same `background-color` on `.mobile-drawer__bar-tint`. A gradient or an image can't be a bar colour: use its main colour.
- A translucent sheet colour (for example the glass of the [iOS theme](#ios-theme)) is blended over the page background. Safari doesn't blur the page under the bar.
- The bar at the far edge shows the page with the backdrop over it, as on iOS: the status bar for a bottom drawer, the toolbar for a top drawer. It never shows the sheet colour, also not at full height, where the sheet touches that edge. For this, the drawer renders an empty `.mobile-drawer__backdrop-tint` element after the backdrop (only when it has a backdrop). On iOS it is the same kind of invisible 16px strip, at the far edge. Its colour is the backdrop as it shows: `--mobile-drawer-backdrop-color` with `--mobile-drawer-backdrop-opacity` times the drawer's progress as its alpha. The component writes `--mobile-drawer-progress` on it, as on the backdrop. Safari blends it over the page background, so the bar follows the dim of the page at every snap point, during a drag and during the close animation.
- The bars of left and right drawers (and the far bar of a drawer without a backdrop) dim with the backdrop in a different way. The backdrop fades with `filter: opacity()` over a background that has the max opacity as its alpha, instead of with `opacity`, so that Safari sees the dimmed colour from the first frame.
- Safari keeps that backdrop colour until the drawer is closed (`data-closed`), not only while it is open. So those bars show the backdrop at its max opacity also at a lower snap point, while a drawer with a backdrop rests at a peek, and during the close animation. When the drawer comes to rest closed, the bars change to the page colour in one step. Safari's hit test ignores `pointer-events`, so the backdrop's `pointer-events: none` at the smallest snap point doesn't change this.
- The tray is `position: fixed`, and the root and the sheet have `contain: layout`, so the tray still sits in the root, also in an embedded drawer, and the sheet clips it.
- **Markup change:** the root has two more children: `.mobile-drawer__backdrop-tint` after the backdrop (only with a backdrop) and `.mobile-drawer__bar-tint` after the sheet. Both are empty and `aria-hidden`. If your app CSS or tests select the root's children with `:last-child`, `> div`, `> *` or a child count, change them to use the class names, for example `.mobile-drawer > .mobile-drawer__backdrop`.

On iOS, set the backdrop's colour and max opacity only with `--mobile-drawer-backdrop-color` and `--mobile-drawer-backdrop-opacity` (a number from 0 to 1). If your app sets a `background` on `.mobile-drawer__backdrop` directly, set `--mobile-drawer-backdrop-color` instead: the backdrop tint reads only the custom properties, so with an own `background` the bar at the far edge shows the default dim (black at 0.4), not your colour. The base background holds the max opacity as its alpha and `opacity` is `1`, so an app's own `background` on the backdrop shows at full strength there, and an app's `opacity` on the backdrop multiplies with the fade.

Content stays between the bars, so the safe-area padding doesn't change. Other browsers don't get this rule.

#### iOS Safari on-screen keyboard

When a field gets focus, iOS Safari moves the visual viewport up in the page to show the field above the keyboard. The fixed drawer stays in the layout viewport, and Safari clips it there, so a bottom drawer ends at about the level of Safari's URL bar above the keyboard. Behind the translucent URL bar, the keyboard accessory bar and the keyboard, the page would show below the sheet. While that happens, the component fills the strip:

- It adds an empty, `aria-hidden` element `.mobile-drawer-keyboard-fill` to `<html>`, below the root of an open bottom drawer, from the bottom of the root to the bottom of the screen. It is not fixed, so Safari doesn't clip it. It has the tray's `background-color` and `backdrop-filter` (or the `backdrop-filter` of the `.mobile-drawer__glass` layer, when the tray has none and the layer shows) and the root's `z-index`, and takes no pointer events. It follows the `visualViewport` `resize` and `scroll` events. It goes when focus leaves the fields (for example with the keyboard's Done button), when the keyboard closes and when the drawer closes.
- The root gets `data-keyboard` for that time. The floating sheet (see [Floating sheet](#floating-sheet)) then goes to the edges and the bottom of the root, and the iOS theme gives it no bottom radius, so the sheet meets the fill, as a native sheet goes on behind the keyboard. The content and the field don't move.
- Only one drawer shows a fill at a time. With nested drawers (also those rendered with the yielded `Nested`), the innermost drawer that contains the focused field shows it. When focus leaves the fields, every fill goes at once.
- Only for a `position: fixed` root (not an embedded drawer), while the page isn't zoomed in. Other browsers keep fixed elements in the layout viewport's coordinates and don't get the fill.

#### Transparent status bar

By default, the status bar is one solid colour while a drawer is open in iOS Safari 26 and later (see above). With `@transparentStatusBar={{true}}` it shows the page under it, dimmed like the rest of the page and blurred by Safari, with no edge, as in native iOS apps:

```gts
<MobileDrawer @transparentStatusBar={{true}} @snapPoints={{array 0 "40%" "100%"}}>
  …
</MobileDrawer>
```

Safari paints the status bar in one colour when any fixed or sticky element is within 4px of the top of the area between the bars, or when `<body>` is `position: fixed`. So, while the drawer is open:

- **Scroll lock:** the page is locked with `overflow: hidden` and `overscroll-behavior: none` on `<html>` and `<body>`, and a `touchmove` filter, instead of a fixed `<body>`. A scroll of the page while it is locked is undone.
- **Text fields:** a drawer that contains a text field (`<input>` of a text type, `<textarea>` or `contenteditable`, not disabled or read-only) when it opens keeps the fixed `<body>`, and so the solid status bar. The on-screen keyboard needs it: without a fixed `<body>`, iOS scrolls the page and the drawer apart to show a focused field. The same applies when such a drawer opens in front of a drawer with a transparent status bar (for example a nested drawer): the lock changes to the fixed `<body>`, and the status bar is solid until all drawers are closed. A field that the drawer adds after it opened doesn't change the lock.
- **5px offset:** the root (with the backdrop and the sheet) starts 5px below the top. A full-height sheet stops 5px below the status bar. `env(safe-area-inset-top)` is 0 in Safari with the bars, so the offset is a fixed 5px.
- **Dim layer:** the dim is a separate element, `.mobile-drawer__dim`, inserted just before the root. It is `position: absolute` and as large as the document, so it is page content and Safari shows it in the status bar. It has the backdrop colour, max opacity and progress (`--mobile-drawer-backdrop-color`, `--mobile-drawer-backdrop-opacity`, `--mobile-drawer-progress`), and the dim of the [iOS theme](#ios-theme). The backdrop is transparent and only takes the pointer events. The `.mobile-drawer__backdrop-tint` strip isn't shown; the `.mobile-drawer__bar-tint` at the toolbar stays.
- **Keyboard:** a drawer with a text field has the fixed `<body>`, so the offset and the dim layer are off while it is open, and the [keyboard fill](#ios-safari-on-screen-keyboard) works as without `@transparentStatusBar`.
- The root has `data-status-bar="transparent"` while this is on. It starts when the drawer opens (and locks the page), and ends when the drawer is closed or rests at a peek.

It applies only to modal drawers, only while they are open, and only in iOS Safari (the `-webkit-touch-callout` rule). Top drawers don't change (the sheet is at the status bar there), and neither does an embedded drawer (a root that isn't `position: fixed`). A drawer nested in a drawer with a transparent status bar also gets the offset and its own dim layer.

Limits:

- A fixed or sticky element of your app near the top (for example a header) makes the status bar solid again.
- An ancestor of the drawer root that clips (`overflow`), that is scaled or transformed, or that is a stacking context below other page content can cut or hide the dim layer. If the drawer root is inside the page element of the iOS theme's [page scale](#page-scale), the dim layer scales with the page.
- An own `background` on `.mobile-drawer__backdrop` doesn't go to the dim layer. Use `--mobile-drawer-backdrop-color` and `--mobile-drawer-backdrop-opacity`.
- The scroll lock was tested in the iOS 27 simulator and on a current iPhone (#113). iOS 16 to 18 aren't tested: older iOS ignored `overflow: hidden` for touch scrolling.

### iOS theme

An optional theme gives the drawer the look of an iOS 27 sheet ("Liquid Glass"): a translucent, blurred sheet with a light rim and a darkened edge, large rounded corners on the page-facing side and a grabber bar. At partial heights a bottom sheet floats 8px from the left, right and bottom edges of the screen, with bottom corners that follow the display corners, and the page behind it doesn't dim. Towards the highest snap point the sheet becomes edge-to-edge and opaque and the page dims, with the finger, as an iOS sheet does at full height. Import it after the base styles; it does not import them itself:

```js
import 'ember-mobile-drawer/styles.css';
import 'ember-mobile-drawer/themes/ios.css';
```

The theme only applies under the `mobile-drawer-theme-ios` class. Put it on an ancestor of the drawer: `<body>` to theme every drawer, or a wrapper element for one drawer. Don't put it on `<MobileDrawer>` itself.

```hbs
<div class="mobile-drawer-theme-ios">
  <MobileDrawer as |drawer|>
    <div class="mobile-drawer-theme-ios__grabber" data-mobile-drawer-pinned></div>
    ...
  </MobileDrawer>
</div>
```

The grabber class also styles the yielded [`Grabber`](#grabber) button the same way, with a focus ring around the bar for keyboard focus: `<drawer.Grabber class="mobile-drawer-theme-ios__grabber" data-mobile-drawer-pinned />`.

`mobile-drawer-theme-ios__grabber` draws a 58×4px bar for bottom and top drawers, 5px below the sheet's edge, like the grabber of an iOS 27 sheet. Put it directly in the drawer: first in a bottom drawer and last in a top drawer. The element is a 14px strip (the 4px bar with 5px padding above and below) across the tray that stays at the tray's leading edge (see [Keep the grabber at the leading edge](#keep-the-grabber-at-the-leading-edge)): sticky at the top of a bottom drawer and at the bottom of a top drawer, so it stays in view while the content scrolls at the highest snap point. Don't wrap the grabber in another element: a sticky element only sticks inside its parent, so a wrapped grabber scrolls away with its wrapper. While the drawer is at its highest snap point (`data-at-highest`) the sheet is opaque (see **Full height** below) and the strip has the same colour, so the content scrolling under it doesn't show through and the strip doesn't show as a band (browsers that can't make the colour opaque, such as Safari before 18, keep the glass sheet and give the strip the translucent sheet colour). Below the highest snap point the strip is transparent, so it looks like the rest of the sheet. That works because no content is under the strip there: the component keeps the tray at its scroll start below the highest snap point (the start of the content at the top of a bottom drawer, the end of the content at the bottom of a top drawer; see [Scrolling content](#scrolling-content)). There is one short exception, a run down from a scrolled sheet. `data-at-highest` goes away on the first frame below the highest snap point, but the tray only gets back to its scroll start during the run, in step with the tray (or, for a close, once the drawer is closed). So for that moment the rows that were scrolled under the strip show under the bar. In the demo, when you close a fully open, scrolled sheet with "Done", a part of a row shows under the bar while the sheet slides away (about half a second). The strip's 5px padding above and below the bar doesn't collapse with a neighbour's margin, as the old 5px margins did. The bar is drawn by the strip's `::before`, so style the bar there, for example `.mobile-drawer-theme-ios__grabber::before { width: 48px; }`. To make the grabber always drag the sheet, also when the content is scrolled (and with `@handleOnly`), put the `handle` modifier on the grabber itself, not on a wrapper; the hit area of the grabber (the only part that drags with `@handleOnly`) is this 14px strip, so for a larger touch target give it more padding, for example `.mobile-drawer-theme-ios__grabber { padding-block: 12px; }`.

The glass rim (the light inner edge of the sheet, an inset shadow on the tray) is part of the tray's background, so the content paints over it. While the strip has the opaque colour, the strip's `::after` draws the rim again over the strip, along the leading edge and its rounded corners. The strip spans the full width of the tray, also over the side safe areas that the content pads (for example in iPhone landscape), so the rim follows the sheet edge. The theme doesn't set `--mobile-drawer-shadow` (it resets it to `initial`): without your value, the tray gets the theme's rim (and, on top, left and right drawers, an outer shadow). If you set `--mobile-drawer-shadow` on the element with the theme class or closer to the drawer, the tray uses your value as is, on every placement, so you can change or remove the rim there. The strip rim always uses the theme's rim colour, not the value in your `--mobile-drawer-shadow`. If you remove the rim with your `--mobile-drawer-shadow`, also remove it from the strip: `.mobile-drawer-theme-ios__grabber::after { box-shadow: none; }`. If you change only the rim colour, also give the strip rim your colour. Use the same selector and `@supports` condition as the theme, so the strip gets the rim only where it is opaque:

```css
@supports (color: color-mix(in srgb, rgb(from light-dark(red, red) r g b / 1), red)) {
  .mobile-drawer-theme-ios
    .mobile-drawer[data-at-highest]
    > .mobile-drawer__sheet
    > .mobile-drawer__tray
    > .mobile-drawer__content
    > .mobile-drawer-theme-ios__grabber::after {
    box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.5);
  }
}
```

- **Light and dark** follow the page's `color-scheme` (through `light-dark()`), like the base styles' `Canvas` default. Declare `color-scheme: light dark` (for example on `:root`) to get the dark sheet in dark mode. Browsers without `light-dark()` (Safari before 17.5, Chrome before 123) always get the light sheet.
- **Glass** needs `backdrop-filter`; without it the sheet is solid. With reduced transparency or increased contrast (`prefers-reduced-transparency: reduce`, `prefers-contrast: more`) the sheet is solid too.
- **Floating sheet**: the theme sets `--mobile-drawer-inset: 8px` (see [Floating sheet](#floating-sheet)), so a bottom sheet floats 8px from the left, right and bottom edges at and below its second-highest snap point, and is edge-to-edge at its highest, changing with the finger in between. The top corners have a 36px radius at every snap point. The bottom corners have the same radius as the top corners: `--mobile-drawer-ios-bottom-radius`, by default `--mobile-drawer-radius` (36px). They don't follow the display corners, because in iOS Safari the toolbar is between the sheet and the bottom of the screen. Near the highest snap point (the last tenth of the expand progress) the bottom corners go to square, so a full-height sheet has square bottom corners. A standalone web app (added to the home screen, without the Safari bars) has the sheet near the screen corners: there you can set `--mobile-drawer-ios-bottom-radius` to the display radius minus the inset, for example `calc(55px - 8px)` on current iPhones, for corners concentric with the display. CSS can't read the display radius. For an edge-to-edge sheet at every snap point, set `--mobile-drawer-inset: 0px`; then in iOS Safari 26 also give the toolbar area the sheet colour again, because below a floating sheet it shows the page:

  ```css
  .mobile-drawer-theme-ios {
    --mobile-drawer-inset: 0px;
  }

  .mobile-drawer-theme-ios .mobile-drawer > .mobile-drawer__bar-tint {
    background-color: var(--mobile-drawer-background);
  }
  ```

  The content keeps one width at every snap point, so it is not laid out again while the sheet expands. The theme pads the content of a bottom sheet by the inset on both sides (8px), so the clipped sides hide nothing. Thus at full height the content has 8px more side padding than in a native sheet. If your content has side padding of its own, you can take 8px off it.
- **Shadow**: a bottom sheet has a soft outer shadow at every snap point and while it moves, in the shape of the sheet (the inset, the top and bottom radius and the expand progress), as a native iOS 26/27 sheet: `--mobile-drawer-ios-shadow`. The default was measured on a native sheet in the iOS 27.2 simulator: a 0.5px edge line and `0 7px 32px` black at 12% (light) or 18% (dark). Set it on the element with the theme class, for example `.mobile-drawer-theme-ios { --mobile-drawer-ios-shadow: 0 4px 24px rgb(0 0 0 / 0.2); }`, or set `none` for no shadow. The sheet clips the tray, so the tray's own shadow can't show around a floating sheet (see [Floating sheet](#floating-sheet)). The theme draws the shadow on the `.mobile-drawer__shadow` layer before the sheet instead, and by default the tray of a bottom sheet has only the glass rim. Your `--mobile-drawer-shadow` still applies to the tray as is (see the glass rim above). For a bottom sheet, give it only inset shadows (such as the rim): an outer shadow in it is clipped while the sheet floats, and adds to the shadow of the layer at the highest snap point. The layer moves with transforms only, so the shadow is not painted again while the sheet moves between snap points below the highest; towards the highest snap point it is painted again on each frame, as the tray is. The layer leaves 120px of room around the sheet: a shadow with a blur, spread and offset of more than about 100px in all is cut. **Markup change:** the root has one more child, the empty, `aria-hidden` `.mobile-drawer__shadow` before the sheet (see [Markup](#markup)), in every drawer, with or without the theme.
- **Full height**: the sheet goes from glass to opaque with the expand progress, so it follows the finger and the spring: glass at and below the second-highest snap point, opaque at the highest, mixed in between. There is no timed fade any more. The opaque colour is the sheet colour (`--mobile-drawer-background`, the theme's or yours) without its transparency: white in light mode, `rgb(28 28 30)` in dark mode. At the highest snap point (`data-at-highest`) the sheet is not blurred, and the grabber strip has the opaque colour. This needs relative colours with a `light-dark()` origin and `color-mix()` (Safari 18, Chrome 123, Firefox 128 or later); other browsers keep the glass sheet at full height. In iOS Safari 26 the toolbar area under a bottom sheet gets the opaque colour at the highest snap point too (see **Dim** below and [iOS Safari 26 bars](#ios-safari-26-bars)).
  - It follows the highest snap point, not the height of the screen. A drawer with one open snap point, for example the default `[0, 'content']` or most left and right drawers, goes from glass to opaque as it opens. On iOS, a sheet with only a medium or a content-sized detent stays glass. To keep such a drawer glass, give it a lower snap point, or override the tray. A background alone is not sufficient: at the highest snap point the tray also has no `backdrop-filter`, so put the blur back too. A bottom sheet has the blur on the `.mobile-drawer__glass` layer under the tray, not on the tray (see **Blur cost** below). If you use the grabber, also make its strip transparent: the opaque strip shows as a band on the glass sheet. App CSS that is not in a layer wins over the theme:

    ```css
    .mobile-drawer-theme-ios .mobile-drawer__sheet > .mobile-drawer__tray {
      background: var(--mobile-drawer-background);
    }

    /* The tray of a top, left or right drawer, and the glass layer of a
       bottom sheet. */
    .mobile-drawer-theme-ios
      .mobile-drawer:not([data-placement="bottom"])
      > .mobile-drawer__sheet
      > .mobile-drawer__tray,
    .mobile-drawer-theme-ios
      .mobile-drawer[data-placement="bottom"]
      > .mobile-drawer__sheet
      > .mobile-drawer__glass {
      -webkit-backdrop-filter: blur(30px) saturate(1.8);
      backdrop-filter: blur(30px) saturate(1.8);
    }

    .mobile-drawer-theme-ios .mobile-drawer-theme-ios__grabber {
      background: transparent;
    }
    ```

    In the `ember-mobile-drawer` layer, these selectors also win, because they have more than one class (see the end of this section). The example also puts the blur back with reduced transparency or increased contrast. There the sheet is opaque, so you can't see the blur, but it still costs GPU time.
  - `--mobile-drawer-background` must be a colour with this theme. The theme can't mix a non-colour value, such as a gradient or an image: then the tray gets no background at all.
- **Dim**: the backdrop doesn't dim the page at and below the second-highest snap point, as on iOS 27, where a sheet at its medium detent leaves the page undimmed. The dim comes in with the expand progress, to `0.35` at the highest snap point. A modal drawer's backdrop still takes taps where it doesn't dim, so a tap outside the sheet closes it. To dim at every snap point, as before, set `--mobile-drawer-ios-partial-dim: 1` (for example on the element with the theme class). In iOS Safari 26 the status bar above a bottom sheet and the toolbar area below a floating sheet show the page with this dim.
- **Nested sheets**: while another modal drawer is open in front of a drawer (`data-nested`), its sheet dims (12% black, `--mobile-drawer-ios-nested-dim`), as on iOS 27. It doesn't scale or move. The dim is over the sheet's background, not over its content. It fades in 0.3s, not with reduced motion.
- **Blur cost**: the glass is a 30px `backdrop-filter` blur, and it moves with the tray every frame while the tray is dragged or animates, so the browser blurs the page behind it again on every frame. On a top, left or right drawer the blur is on the tray. On a bottom sheet it is on the `.mobile-drawer__glass` layer in the sheet, under the tray, with the tray's transform: Chrome doesn't clip a `backdrop-filter` with the tray's `clip-path`, so on the tray the blur showed outside the floating sheet's top corners. The tray has the tint over the blur, as before. It is one blur, as before, and the layer moves with a transform only. Between the two highest snap points the sheet's colour, size and width also change on every frame. On slower devices that can cost frames. At full height the sheet is opaque and not blurred, so the blur costs nothing there, also while the content scrolls. To turn the blur off, override it on the tray and on the glass layer, and give the sheet a solid background, so the page doesn't show through unblurred:

  ```css
  .mobile-drawer-theme-ios {
    --mobile-drawer-background: light-dark(rgb(255 255 255), rgb(28 28 30));
  }

  .mobile-drawer-theme-ios .mobile-drawer__tray,
  .mobile-drawer-theme-ios .mobile-drawer__glass {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  ```

- **Glass layer (upgrade note)**: on a bottom sheet the theme's blur is on the `.mobile-drawer__glass` layer under the tray, not on the tray (see **Blur cost** above). If your app sets or removes `backdrop-filter` on the tray of a bottom sheet, also set it on `.mobile-drawer__glass`. Otherwise the theme's blur on the glass layer stays, and your own blur on the tray shows outside the floating sheet's top corners in Chrome. For example, a stronger blur:

  ```css
  /* Before: on the tray only. Now on the glass layer of a bottom sheet. */
  .mobile-drawer-theme-ios
    .mobile-drawer[data-placement="bottom"]
    > .mobile-drawer__sheet
    > .mobile-drawer__glass {
    -webkit-backdrop-filter: blur(40px) saturate(2);
    backdrop-filter: blur(40px) saturate(2);
  }
  ```

  **Markup change:** the sheet has one more child, the empty, `aria-hidden` `.mobile-drawer__glass` before the tray (see [Markup](#markup)), in every drawer, with or without the theme. The tray is now the second child of the sheet. Change app CSS or tests that expect the tray as the first or only child of `.mobile-drawer__sheet`.
- **Spring**: the theme is CSS only, so it doesn't change how the drawer moves. For iOS-like motion, also pass `@spring={{springPresets.ios}}` (see [Spring](#spring)).
- **Differences from iOS 27**: Maps' smallest detent is a capsule with a larger inset; the theme has one inset for every snap point. At full height the content has 8px more side padding. Safari's toolbar stays visible over the page: a web page can't hide it.

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

Optional, and off by default: the iOS 17/18 look. While a modal bottom sheet is open, the page behind it scales down, moves down and gets rounded top corners, like the page behind an iOS 17 or 18 sheet. iOS 26 and 27 don't scale the page any more. It follows the sheet frame by frame, and the area around the page is black. To turn it on, put the `mobile-drawer-theme-ios__page` class and the `data-mobile-drawer-page` attribute on the element that holds your page, for example a wrapper around your application template:

```hbs
{{! app/templates/application.hbs }}
<div class="mobile-drawer-theme-ios__page" data-mobile-drawer-page>
  {{outlet}}
</div>
```

`data-mobile-drawer-page` tells the drawers to write their progress on the element (see "The page behind" in `styles.css`). The class makes the iOS theme use it. The element doesn't need to be inside the `mobile-drawer-theme-ios` class.

With the page class on a child of `<body>`, the theme also uses the rest of the iOS 17/18 look: it sets `--mobile-drawer-inset: 0px` and `--mobile-drawer-ios-partial-dim: 1`, so the sheet is edge-to-edge and dims at every snap point, and the toolbar area under it has the sheet colour. Not with `prefers-reduced-motion: reduce`, where the page doesn't scale either.

- **The drawer must not be inside the page element.** A drawer inside it doesn't scale the page (the page can't move without moving the drawer). Render the drawer outside it, for example at the end of `<body>` with `{{#in-element}}`, and put the `mobile-drawer-theme-ios` class around the drawer there. Drawers that stay inside the page still work; they just don't scale it.
- Only modal drawers (the default) with `@placement="bottom"` (the default) scale the page. As on iOS, top, left and right drawers never move the page. A non-modal drawer leaves the page usable, so the page stays as it is. With several open drawers it follows the one that is open furthest.
- The page follows the drawer linearly, from its smallest snap point (no scale) to its largest (full scale), so a sheet at `'40%'` of `[0, '40%', 'content']` scales the page part of the way. iOS scales the page only when a sheet is at its large detent. For that look, give the sheet only a closed and a full-height snap point.
- A page element that is rendered while a sheet is open (for example after a route change) follows the sheet at once, also while the sheet is at rest. A page element that is removed gets its properties removed.
- **`position: fixed`**: while the page is scaled it has a `transform`, so `position: fixed` content in it is positioned against the page element instead of the viewport. That is only right when the page element fills the viewport (for example an app shell whose content scrolls inside it); otherwise such content can move while a sheet is open. While no modal sheet is open the page has no `transform` at all, so fixed content works as usual.
- **Black around the page**: the theme makes `<body>` black while a drawer moves the page (the component then puts `data-mobile-drawer-page-active` on the page element). This only works when the page element is a direct child of `<body>`. A sheet that rests at a peek (its smallest snap point, with the page not scaled) doesn't make `<body>` black. An unlayered `background` on `<body>` wins over that: put the page colour on `<html>` and on the page element instead. The page element gets `Canvas` as its background (set `--mobile-drawer-ios-page-background`, or a `background` of your own). Give `<body>` no margin or padding, so the black only shows around the scaled page. In iOS Safari 26 the toolbar area under the sheet has the sheet colour, not black, and the status bar is black, the colour around the scaled page: the theme makes `.mobile-drawer__backdrop-tint` black while the page is `data-mobile-drawer-page-active` (see [iOS Safari 26 bars](#ios-safari-26-bars)).
- **Leave a gap at the top**: the theme doesn't add it, your app's CSS does. A sheet that covers the whole screen hides the scaled page. On iOS the full-height sheet stops a little below the top, so the page shows behind it as a card. Do the same with a `max-height` on the tray, for example `.my-sheet > .mobile-drawer__sheet > .mobile-drawer__tray { max-height: calc(100% - env(safe-area-inset-top, 0px) - 24px); }`, as the demo does.
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

The theme sets the custom properties from the table above on the element with the theme class, plus `backdrop-filter` and `transition` on the tray, `backdrop-filter` on the glass layer of a bottom sheet and `border-radius` on the sheet, in the same `ember-mobile-drawer` layer with zero-specificity selectors. The rules for properties that the base styles also set are an exception: the tray's `background`, the `box-shadow` of a bottom tray and of a nested tray, the backdrop's `opacity` and `filter`, and the tints' `background-color` have the specificity of one class, so they win over the base styles in either load order. Unlayered app CSS, and app CSS in a later layer, win over all of the theme. In the `ember-mobile-drawer` layer itself, app CSS needs more than one class (or must come later) to override those rules. To change a theme value, set the property on the element with the theme class or closer to the drawer, for example `.mobile-drawer-theme-ios { --mobile-drawer-radius: 16px; }`. A value on `:root` doesn't override the theme when the class is on a descendant of `:root`, such as `<body>`.

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
  - The finger first moves 11px to start the drag. These 11px count towards `distance`, because the drawer catches up with them. For a drag shorter than 11px, the finger then goes back to where it went down first. A moving drawer is stopped where it is. If no drag starts (for example, because the gesture scrolled the content, or `target` is not a handle of a `@handleOnly` drawer), `dragDrawer` throws.

## API reference

### `<MobileDrawer>` arguments

All arguments are optional.

| Argument                | Type                                          | Default            | Description |
| ----------------------- | --------------------------------------------- | ------------------ | ----------- |
| `@placement`            | `Placement`: `'bottom' \| 'top' \| 'left' \| 'right'` | `'bottom'` | The edge of the screen the drawer is attached to. `left` and `right` are physical. |
| `@snapPoints`           | `readonly SnapPoint[]`                        | `[0, 'content']`   | Where the drawer can rest: px, `'N%'` or `'content'`. See [Snap points](#snap-points). |
| `@activeSnapPoint`      | `number`                                      | not set (uncontrolled, starts at `0`) | Index into `@snapPoints` of the snap point the drawer should be at. Makes the drawer controlled. See [Controlled and uncontrolled](#controlled-and-uncontrolled). |
| `@onSnapPointChange`    | `(index: number) => void`                     | none               | Called with the new index when the drawer wants to move: `snapTo`, `open`, `close`, a drag, the backdrop, Escape or keyboard focus. Not called when you change `@activeSnapPoint`. |
| `@handleOnly`           | `boolean`                                     | `false`            | Only start a drag on elements with the yielded `handle` modifier. See [Dragging](#dragging). |
| `@modal`                | `boolean`                                     | `true`             | Whether the drawer is a modal dialog while it is open. See [Accessibility](#accessibility). |
| `@backdrop`             | `boolean`                                     | the value of `@modal` | Whether to render the backdrop behind the tray. See [Backdrop](#backdrop). |
| `@closeOnBackdropClick` | `boolean`                                     | `true`             | Whether a tap or click on the backdrop closes the drawer, like `close()`. |
| `@transparentStatusBar` | `boolean`                                     | `false`            | iOS Safari 26 and later: while this modal drawer is open, the status bar shows the dimmed page. See [Transparent status bar](#transparent-status-bar). |
| `@spring`               | `Partial<MobileDrawerSpring>`                 | `springPresets.default` | The spring that moves the drawer to a snap point. Keys you leave out keep the default. See [Spring](#spring). |
| `@onOpen`               | `(event: MobileDrawerToggleEvent) => void`    | none               | Called when the drawer opens. See [Events](#events). |
| `@onClose`              | `(event: MobileDrawerToggleEvent) => void`    | none               | Called when the drawer closes. |
| `@onDragStart`          | `(event: MobileDrawerDragStartEvent) => void` | none               | Called when a drag starts. |
| `@onDragEnd`            | `(event: MobileDrawerDragEndEvent) => void`   | none               | Called when a drag ends, before `@onSnapPointChange`. |

Attributes (`...attributes`) go on the root element, a `<div>`.

### Yielded values

The block gets one value, of type `MobileDrawerApi`:

| Name              | Type                                          | Description |
| ----------------- | --------------------------------------------- | ----------- |
| `snapTo`          | `(index: number) => void`                     | Moves to the snap point at `index`. Controlled, it only calls `@onSnapPointChange`. In development, an index outside `@snapPoints` fails an assertion. |
| `open`            | `() => void`                                  | Moves to the snap point with the largest offset. Does nothing before the drawer is measured. |
| `close`           | `() => void`                                  | Moves to the snap point with the smallest offset. Does nothing before the drawer is measured. |
| `activeSnapPoint` | `number`                                      | Index of the snap point the drawer rests at or is moving to. |
| `isDragging`      | `boolean`                                     | Whether the user is dragging the drawer. |
| `isAnimating`     | `boolean`                                     | Whether the drawer is animating towards a snap point. |
| `progress`        | `number`                                      | How far open the drawer is, from `0` (closed) to `1` (largest snap point), for the snap point it rests at or is moving to. Not updated every frame: for styles that follow the drawer frame by frame, use `--mobile-drawer-progress` on the backdrop. |
| `handle`          | modifier, `ModifierLike<{ Element: HTMLElement }>` | Makes an element a drag handle: a gesture on it always drags the drawer. See [Dragging](#dragging). |
| `Grabber`         | component, a `<button>`, with optional `@label` (`string`) and `@snapPointLabels` (`readonly (string \| undefined)[]`) arguments | An accessible grabber: a drag handle that moves the drawer to the next open snap point on a tap, Enter or Space, and announces it. See [Grabber](#grabber). |
| `Nested`          | component, with an optional `@destination` argument (`Element \| null`) | Renders a nested drawer outside this drawer's tray. See [Nested drawers](#nested-drawers). |

### Event objects

| Type                          | Used by                 | Properties |
| ----------------------------- | ----------------------- | ---------- |
| `MobileDrawerToggleEvent`     | `@onOpen`, `@onClose`   | `snapPoint`: index of the snap point the drawer moves to (for `@onClose` always the smallest one). |
| `MobileDrawerDragStartEvent`  | `@onDragStart`          | `snapPoint`: the active snap point when the drag started. `offset`: how far open the drawer was, in px. |
| `MobileDrawerDragEndEvent`    | `@onDragEnd`            | `snapPoint`: the snap point the release picked. `offset`: how far open the drawer was at the release, in px: where the finger put it (right after a drag starts, the tray can still be a few px behind it). `velocity`: the release velocity in px/s along the axis, positive opens. |

### Root element

The root element `.mobile-drawer` has these attributes:

| Attribute                       | When |
| ------------------------------- | ---- |
| `data-placement`                | Always: `bottom`, `top`, `left` or `right`. |
| `data-closed`                   | While the drawer is fully closed and at rest. The base styles hide the drawer. |
| `data-expanded`                 | While the drawer rests at its highest snap point or animates towards it (not during a drag), and that snap point is not `0`. |
| `data-at-highest`               | While the tray is shown at or past its highest snap point, frame by frame. |
| `data-nested`                   | While a modal drawer in front of this one is open. |
| `data-keyboard`                 | iOS Safari: while an on-screen keyboard is open for a field in this bottom drawer. See [iOS Safari on-screen keyboard](#ios-safari-on-screen-keyboard). |
| `data-status-bar="transparent"` | While the drawer shows the page in the iOS status bar. See [Transparent status bar](#transparent-status-bar). |
| `role="dialog"`                 | Modal drawers (`@modal`, the default). |
| `aria-modal="true"`             | While a modal drawer is open. Not when keyboard focus opened it from its peek. |

See [State attributes](#state-attributes) for details.

### Markup

```html
<div class="mobile-drawer" data-placement="bottom" data-closed role="dialog">
  <div class="mobile-drawer__backdrop"></div>                        <!-- with a backdrop -->
  <div class="mobile-drawer__backdrop-tint" aria-hidden="true"></div> <!-- with a backdrop -->
  <div class="mobile-drawer__shadow" aria-hidden="true">
    <div class="mobile-drawer__shadow-edge"></div>
    <div class="mobile-drawer__shadow-clip">
      <div class="mobile-drawer__shadow-body"></div>
    </div>
  </div>
  <div class="mobile-drawer__sheet">
    <div class="mobile-drawer__glass" aria-hidden="true"></div>
    <div class="mobile-drawer__tray" tabindex="-1">                   <!-- tabindex: modal drawers -->
      <div class="mobile-drawer__content">...your block...</div>
    </div>
  </div>
  <div class="mobile-drawer__bar-tint" aria-hidden="true"></div>
</div>
```

| Class                           | Description |
| ------------------------------- | ----------- |
| `.mobile-drawer`                | The root: a fixed overlay over the viewport that takes no pointer events itself. Set `position: absolute` on it to embed the drawer in a positioned container. |
| `.mobile-drawer__backdrop`      | Covers the page behind the tray. The component writes `--mobile-drawer-progress` on it. |
| `.mobile-drawer__backdrop-tint` | iOS Safari 26 only: colours the bar at the far edge. See [iOS Safari 26 bars](#ios-safari-26-bars). |
| `.mobile-drawer__shadow`        | A layer for a theme's outer shadow of a floating bottom sheet; `display: none` in the base styles. For bottom drawers the component writes the tray's length (`height`), the tray's `transform` and `--mobile-drawer-expand-progress` on it, and the opposite transform on `.mobile-drawer__shadow-body`. The [iOS theme](#ios-theme) draws its shadow there. |
| `.mobile-drawer__sheet`         | Clips the tray. Floats with `--mobile-drawer-inset`. The component writes `--mobile-drawer-expand-progress` on it. |
| `.mobile-drawer__glass`         | A layer in the sheet, under the tray, for a theme's `backdrop-filter` on a floating bottom sheet; `display: none` in the base styles. It has the sheet's width and the top radius (`--mobile-drawer-radius`), and the sheet clips its bottom, so a blur on it needs no `clip-path`. For bottom drawers the component writes the tray's length (`height`) and the tray's `transform` on it. The [iOS theme](#ios-theme) puts its blur there. |
| `.mobile-drawer__tray`          | The visible drawer and its scroll container. The component writes its `transform` and, below the highest snap point and during the bounce past fully open, `overflow`. It writes `touch-action` only when the tray is a drag source (not with `@handleOnly`). |
| `.mobile-drawer__content`       | Your block. Has the safe-area padding. If you set padding on it, you replace the insets (the iOS theme sets its own side padding here). |
| `.mobile-drawer__bar-tint`      | iOS Safari 26 only: colours the bar at the sheet's edge. |
| `.mobile-drawer__visually-hidden` | In your block, rendered by the yielded `Grabber`: text for screen readers only (its description and its status element). |
| `.mobile-drawer-nested`         | Not in the root: the `display: contents` element that the yielded `Nested` renders into. Gets `data-closed` with its drawer. |
| `.mobile-drawer__dim`           | Not in the root: the dim layer before the root, with `@transparentStatusBar` only. |
| `.mobile-drawer-keyboard-fill`  | Not in the root: a child of `<html>` below an open bottom drawer while the iOS Safari keyboard is open. |

Select the tray with `.mobile-drawer > .mobile-drawer__sheet > .mobile-drawer__tray`, so the selector doesn't match the tray of a drawer inside it.

### Data attributes for your elements

| Attribute                     | Put it on | Effect |
| ----------------------------- | --------- | ------ |
| `data-mobile-drawer-scroll`   | A scrolling element in the tray | It takes part in the scroll-or-drag decision. See [Scrolling content](#scrolling-content). |
| `data-mobile-drawer-pinned`   | An element in the content, such as a sticky grabber | It stays at the tray's edge while the content bounces past fully open. See [Dragging](#dragging). |
| `data-mobile-drawer-page`     | The element that holds your page, outside the drawers | Open modal bottom drawers write `--mobile-drawer-page-progress`, `--mobile-drawer-page-viewport-top` and `data-mobile-drawer-page-active` on it. Used by the iOS theme's [page scale](#page-scale). |

### CSS custom properties

Base styles (`ember-mobile-drawer/styles.css`). Set them on `:root`, an ancestor of the drawer or the drawer's root:

| Property                           | Default                     | Description |
| ---------------------------------- | --------------------------- | ----------- |
| `--mobile-drawer-background`       | `Canvas`                    | Tray background. Must be a colour for the iOS bar tints and the iOS theme. |
| `--mobile-drawer-color`            | `CanvasText`                | Tray text colour. |
| `--mobile-drawer-radius`           | `0`                         | Radius of the tray corners away from its edge. |
| `--mobile-drawer-shadow`           | `0 0 12px rgb(0 0 0 / 0.2)` | Tray `box-shadow`. |
| `--mobile-drawer-backdrop-color`   | `rgb(0 0 0)`                | Backdrop colour. |
| `--mobile-drawer-backdrop-opacity` | `0.4`                       | Backdrop opacity at the largest snap point, from `0` to `1`. |
| `--mobile-drawer-z-index`          | `1000`                      | `z-index` of the root. |
| `--mobile-drawer-inset`            | `0px`                       | Inset of a floating bottom sheet below its highest snap point, in `px` or `rem`. See [Floating sheet](#floating-sheet). |

Written by the component; read them, but don't set them:

| Property                             | On | Value |
| ------------------------------------ | -- | ----- |
| `--mobile-drawer-progress`           | `.mobile-drawer__backdrop`, the tints, `.mobile-drawer__dim` | `0` (closed) to `1` (largest snap point), every frame. |
| `--mobile-drawer-expand-progress`    | `.mobile-drawer__sheet` (the tray inherits it), `.mobile-drawer__backdrop`, the tints, `.mobile-drawer__dim`, `.mobile-drawer__shadow` | `0` at and below the second-highest snap point to `1` at the highest, every frame. Not inherited by the content. |
| `--mobile-drawer-page-progress`      | the `data-mobile-drawer-page` element | The progress of the open modal bottom drawers, while one is open. |
| `--mobile-drawer-page-viewport-top`  | the `data-mobile-drawer-page` element | The top of the viewport in that element, in px. |

iOS theme (`ember-mobile-drawer/themes/ios.css`), under the `mobile-drawer-theme-ios` class. The theme sets these base properties on the element with the class: `--mobile-drawer-background` (translucent glass, opaque at the highest snap point), `--mobile-drawer-color`, `--mobile-drawer-radius: 36px`, `--mobile-drawer-inset: 8px`, `--mobile-drawer-shadow: initial` (not set, so only an app value set on that element or closer applies; without one the tray gets the theme's rim, plus a soft outer shadow on top, left and right drawers; see the glass rim in [iOS theme](#ios-theme)), `--mobile-drawer-backdrop-color: rgb(0 0 0)` and `--mobile-drawer-backdrop-opacity: 0.35`. Override them on that element or closer to the drawer. Its own settings:

| Property                              | Default                                 | Description |
| ------------------------------------- | --------------------------------------- | ----------- |
| `--mobile-drawer-ios-bottom-radius`   | `--mobile-drawer-radius` (36px)         | Bottom corner radius of the floating sheet. |
| `--mobile-drawer-ios-shadow`          | `0 0 0 0.5px`, `0 7px 32px` black, 12% (light) or 18% (dark) | Outer shadow of a bottom sheet, at every snap point; `none` for no shadow. See **Shadow** in [iOS theme](#ios-theme). |
| `--mobile-drawer-ios-partial-dim`     | `0`                                     | `1` dims the page at every snap point; `0` dims only towards the highest. |
| `--mobile-drawer-ios-nested-dim`      | `rgb(0 0 0 / 0.12)`                     | Dim over a sheet while a modal drawer in front of it is open. |
| `--mobile-drawer-ios-page-scale`      | `0.92`                                  | [Page scale](#page-scale): scale of the page when fully open. |
| `--mobile-drawer-ios-page-offset`     | `calc(env(safe-area-inset-top) + 10px)` | Page scale: how far the page moves down. |
| `--mobile-drawer-ios-page-radius`     | `12px`                                  | Page scale: radius of the page's top corners. |
| `--mobile-drawer-ios-page-background` | `Canvas`                                | Page scale: background of the page element. |

Theme classes: `mobile-drawer-theme-ios` (on an ancestor of the drawers), `mobile-drawer-theme-ios__grabber` (the grabber, a `<div>` or the yielded `Grabber`, directly in the drawer's block) and `mobile-drawer-theme-ios__page` (with `data-mobile-drawer-page`, for the page scale). See [iOS theme](#ios-theme).

### JavaScript exports

From `ember-mobile-drawer`:

| Export                | Kind      | Description |
| --------------------- | --------- | ----------- |
| `MobileDrawer`        | component | The drawer. Also the default export of `ember-mobile-drawer/components/mobile-drawer`, and `<MobileDrawer>` in loose-mode templates. |
| `springPresets`       | object    | Frozen spring presets: `default`, `ios`, `iosSnappy`, `iosBouncy`. See [Spring](#spring). |
| `springFromDuration`  | function  | `({ duration, bounce? }: SpringDuration) => Readonly<MobileDrawerSpring>`. Throws a `RangeError` for a `duration` that isn't a finite number above `0`, or a `bounce` outside `0` (included) to `1` (not included). |
| `MobileDrawerSignature` | type    | The component's Glint signature. |
| `MobileDrawerApi`     | type      | The yielded value. |
| `MobileDrawerToggleEvent`, `MobileDrawerDragStartEvent`, `MobileDrawerDragEndEvent` | types | The event objects. |
| `MobileDrawerSpring`  | type      | `{ stiffness: number; damping: number; mass: number }`. |
| `SpringDuration`      | type      | `{ duration: number; bounce?: number }`. |
| `Placement`           | type      | `'bottom' \| 'top' \| 'left' \| 'right'`. |
| `SnapPoint`           | type      | `` number \| `${number}%` \| 'content' ``. |

### Test helpers

From `ember-mobile-drawer/test-support`. All of them return a `Promise<void>` that resolves after `settled()`. See [Testing](#testing).

| Export          | Signature | Description |
| --------------- | --------- | ----------- |
| `openDrawer`    | `(target?: DrawerTarget) => Promise<void>` | Like the yielded `open()`. `target` defaults to `'.mobile-drawer'`. |
| `closeDrawer`   | `(target?: DrawerTarget) => Promise<void>` | Like the yielded `close()`. `target` defaults to `'.mobile-drawer'`. |
| `dragDrawer`    | `(target: DrawerTarget, options: DragDrawerOptions) => Promise<void>` | Drags with one finger and lets go. `options` is `{ to, velocity? }` or `{ distance, velocity? }`. |
| `DrawerTarget`  | type | `string \| Element`: a selector inside the test's root element, or an element in the drawer. |
| `DragDrawerOptions` | type | The options of `dragDrawer`. |

## Development

The toolchain is managed with [proto](https://moonrepo.dev/proto). Run `proto install` in the repository to get the pinned node and pnpm versions from `.prototools`.

- `pnpm install` installs dependencies
- `pnpm start` runs the demo app (`demo-app/`) with the Vite dev server, at the URL it prints (http://localhost:5173 by default); the tests run in the browser at `/tests/`
- `pnpm test` builds and runs the test suite in headless Chrome
- `pnpm build:demo` builds the demo app (the [playground](https://nickschot.github.io/ember-mobile-drawer/)) into `dist-demo/`
- `pnpm lint` / `pnpm lint:fix` lint the project
- `pnpm build` builds the addon into `dist/`

Try scenarios for other Ember versions are defined in `.try.mjs` and run in CI via [`@embroider/try`](https://github.com/embroider-build/try).

See the [Contributing](CONTRIBUTING.md) guide and the [Release](RELEASE.md) guide for details.

## License

This project is licensed under the [MIT License](LICENSE.md).
