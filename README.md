# ember-mobile-drawer

A gesture-enabled drawer component for Ember, built as a v2 addon.

- Drag to open, close, or snap to any point in between
- Spring physics animations
- Configurable snap points (px, %, or content height)
- Placements: bottom, top, left, right (`left` and `right` are physical and don't flip under `dir="rtl"`)
- Minimal base styles, with an optional iOS theme

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
      as |drawer|
    >
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

The block receives `snapTo(index)`, `open()` (largest snap point), `close()` (smallest snap point), the `handle` modifier, and the state `activeSnapPoint`, `isAnimating`, `isDragging` and `progress` (`0` closed to `1` at the largest snap point, for the snap point it is at or moving to). Snap points are recalculated when the viewport or the content changes size, and the drawer stays at the same snap point.

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

Without `@handleOnly` the `handle` modifier does nothing, so you can keep it on your grabber either way. The element that drags gets `touch-action: pan-x` (for `bottom` and `top`) or `pan-y` (for `left` and `right`). Scrolling content along the drawer's axis inside a draggable tray isn't supported yet.

### Public imports

These are the package's public API:

- `ember-mobile-drawer`: the components and types
- `ember-mobile-drawer/components/mobile-drawer`: the `<MobileDrawer>` component as a default export
- `ember-mobile-drawer/template-registry`: the Glint template registry, for apps that use loose-mode (`.hbs`) templates
- `ember-mobile-drawer/styles.css`: the base stylesheet (see [Styles](#styles))

Test helpers (`ember-mobile-drawer/test-support`) will be added later.

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
| `--mobile-drawer-backdrop-opacity` | `0.4`          | Backdrop opacity when the drawer is fully open  |
| `--mobile-drawer-z-index`          | `1000`         | Stacking order of the drawer overlay            |

The base styles are easy to override. Every selector is wrapped in `:where()` (zero specificity), and the whole file lives in the `ember-mobile-drawer` cascade layer.

- Unlayered app CSS always wins, whatever its specificity or import order. For example, `.mobile-drawer__tray { width: 20rem; }` gives a side drawer a width.
- If your app uses cascade layers (your own `@layer` rules or Tailwind v4), declare the drawer's layer after your resets and before your components and utilities. Put this line at the top of your main stylesheet:

  ```css
  @layer theme, base, ember-mobile-drawer, components, utilities;
  ```

  Placing the drawer's layer after `base` means a reset such as Tailwind's preflight (`* { padding: 0 }`) can't remove the safe-area padding on `.mobile-drawer__content`. Placing it before `components` and `utilities` means those still override the base styles. Without the declaration, the order in which the layers are first loaded decides, so the result can depend on import order.

Cascade layers need Safari/iOS 15.4+, Chrome 99+ or Firefox 97+.

When a snap point makes the tray larger than its content, the content sits against the tray's leading edge, the edge that comes into view first. A drawer that is partly open shows its content rather than empty space. Bottom and right drawers do this through normal block layout. For top and left drawers the tray is a flex container and `.mobile-drawer__content` gets an auto start margin (`margin-top: auto` for top, `margin-left: auto` for left). Content taller or wider than the tray still scrolls from its start. To align the content differently, override `display` on `.mobile-drawer__tray` or `margin` on `.mobile-drawer__content`, for example:

```css
.mobile-drawer[data-placement="top"] > .mobile-drawer__tray {
  display: block;
}
```

The safe-area insets are padding on the `.mobile-drawer__content` element inside the tray. The base styles set no padding on the tray itself, so padding you add to `.mobile-drawer__tray` adds to the insets instead of replacing them. Don't set padding on `.mobile-drawer__content`, because that would remove the insets. Unlayered resets that set padding on `*` or `div` remove them too, because unlayered CSS always wins over the drawer's layer. In the same way, an unlayered `* { margin: 0 }` reset undoes the leading-edge alignment of top and left drawers. Put such resets in a layer before `ember-mobile-drawer`.

Safe-area insets need `viewport-fit=cover` in your viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

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
