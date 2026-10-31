import { defineConfig } from 'vite';
import { extensions, ember, classicEmberSupport } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';

// For scenario testing
const isCompat = Boolean(process.env.ENABLE_COMPAT_BUILD);

export default defineConfig(({ mode }) => ({
  plugins: [
    ...(isCompat ? [classicEmberSupport()] : []),
    ember(),
    babel({
      babelHelpers: 'inline',
      extensions,
    }),
  ],
  build: {
    rollupOptions: {
      // A production build is the demo app (`pnpm build:demo`, deployed to
      // GitHub Pages with `--base=/ember-mobile-drawer/`). Other modes build
      // the test app (`pnpm test` uses `--mode=development`).
      input:
        mode === 'production'
          ? { main: 'index.html' }
          : { tests: 'tests/index.html' },
    },
  },
}));
