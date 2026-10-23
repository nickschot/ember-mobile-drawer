# ember-mobile-drawer

A gesture-enabled drawer component for Ember, built as a v2 addon.

- Drag to open, close, or snap to any point in between
- Spring physics animations
- Configurable snap points (px, %, or content height)
- Placements: bottom, top, left, right
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
import { MobileDrawer } from 'ember-mobile-drawer';

<template>
  <MobileDrawer>Drawer content</MobileDrawer>
</template>
```

`<MobileDrawer>` is currently a placeholder that renders its block. The API is documented here as it lands.

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
