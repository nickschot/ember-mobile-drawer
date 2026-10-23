// Checks the package's export surface after a build:
// - documented entry points resolve (to files that exist),
// - every `ember-addon.app-js` re-export resolves (Embroider needs this),
// - no export key is a wildcard pattern,
// - internal modules (`-private`, raw `dist/` paths) and known bypasses of the
//   `exports` map don't resolve,
// - the build emits no files beyond an allow-list of public files, the
//   app-js re-exports and hashed shared chunks, so widening
//   `publicEntrypoints` in rollup.config.mjs fails here.
// Resolution goes through Node's self-reference of `package.json#exports`,
// which matches what consumers get.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const pkg = 'ember-mobile-drawer';
const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'dist');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);

const publicSpecifiers = [
  pkg,
  `${pkg}/template-registry`,
  `${pkg}/components/mobile-drawer`,
  `${pkg}/styles.css`,
  `${pkg}/addon-main.js`,
  `${pkg}/package.json`,
];

const blockedSpecifiers = [
  `${pkg}/-private/spring/spring`,
  `${pkg}/-private/snap-points`,
  `${pkg}/-private/snap-points/index`,
  `${pkg}/-private/anything.css`,
  // Bypasses of a catch-all `"./*"` export: a double slash or a different
  // case reaches `dist/-private` on disk (the latter on case-insensitive
  // file systems). They must not match any export pattern at all.
  `${pkg}//-private/chunk`,
  `${pkg}/-PRIVATE/chunk`,
  `${pkg}/dist/index.js`,
  `${pkg}/declarations/index.d.ts`,
  `${pkg}/src/index.ts`,
];

// Files in dist/ outside `-private/` and `_app_/`. Every one of them is
// importable through `exports`, so adding one is a public API change: update
// this list, `publicSpecifiers`, `exports` in package.json and the README's
// list of public imports. For example, test-support adds 'test-support.js'
// here, `${pkg}/test-support` to `publicSpecifiers` and an exact
// "./test-support" key (types + default) to `exports`; a theme adds
// 'themes/ios.css', `${pkg}/themes/ios.css` and an exact "./themes/ios.css"
// key. Source maps of these files are allowed too.
const allowedDistFiles = [
  'index.js',
  'template-registry.js',
  'components/mobile-drawer.js',
  'styles.css',
];

const failures = [];

// Wildcard keys (`"./components/*"`) let Vite follow `..` in the substituted
// part, e.g. `${pkg}/components/../-private/<chunk>`. Node rejects such
// specifiers, so the resolution checks below can't see it. Only exact keys
// may map to files; wildcards are allowed only for null (blocking) entries.
// A new component needs two keys: "./components/<name>" (types + default) and
// "./_app_/components/<name>" for its app-js re-export.
for (const [key, target] of Object.entries(packageJson.exports ?? {})) {
  if (key.includes('*') && target !== null) {
    failures.push(
      `exports key "${key}" is a wildcard; export each public file with an exact key`,
    );
  }
}

for (const specifier of publicSpecifiers) {
  try {
    const path = fileURLToPath(import.meta.resolve(specifier));
    if (!existsSync(path)) {
      failures.push(`${specifier} resolves to missing file ${path}`);
    }
  } catch (error) {
    failures.push(`${specifier} should resolve but threw ${error.code}`);
  }
}

for (const specifier of blockedSpecifiers) {
  try {
    const url = import.meta.resolve(specifier);
    failures.push(`${specifier} should not resolve but resolved to ${url}`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      failures.push(
        `${specifier} threw ${error.code} instead of ERR_PACKAGE_PATH_NOT_EXPORTED`,
      );
    }
  }
}

// Embroider resolves every `ember-addon.app-js` target through
// `package.json#exports` (it maps the file back to a package specifier and
// fails the app build if there is none), so each one must resolve to itself.
const appJs = packageJson['ember-addon']?.['app-js'] ?? {};
const appJsPrefix = './dist/_app_/';
const appJsFiles = Object.values(appJs).map((file) =>
  file.slice('./dist/'.length),
);
for (const [appPath, file] of Object.entries(appJs)) {
  if (!file.startsWith(appJsPrefix) || !file.endsWith('.js')) {
    failures.push(`app-js ${appPath} points outside ${appJsPrefix}: ${file}`);
    continue;
  }
  const specifier = `${pkg}/_app_/${file.slice(appJsPrefix.length, -'.js'.length)}`;
  try {
    const path = fileURLToPath(import.meta.resolve(specifier));
    if (path !== join(root, file)) {
      failures.push(`${specifier} resolves to ${path} instead of ${file}`);
    } else if (!existsSync(path)) {
      failures.push(`app-js ${appPath} points to missing file ${file}`);
    }
  } catch (error) {
    failures.push(
      `${specifier} (app-js ${appPath}) should resolve but threw ${error.code}`,
    );
  }
}

// Every file in dist/ must be one of:
// - a public file on the allow-list (or its source map),
// - an app re-export listed in `ember-addon.app-js`,
// - a shared chunk, which rollup names `-private/[name]-[hash].js`.
// Anything else means `publicEntrypoints` (or `appReexports`) emits more than
// intended, e.g. `-private/spring/spring.js` when it is widened to `**/*.js`.
// CSS under `-private/` is not expected: stylesheets ship as standalone files
// (`standaloneStylesheets` in rollup.config.mjs), and importing CSS from a
// module currently fails the build. If that changes, allow `-private/**/*.css`
// here; `exports` blocks it like any other `-private` file.
const chunkPattern = /^-private\/[^/]+-[\w-]{8}\.js(\.map)?$/;
const distFiles = readdirSync(distDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    relative(distDir, join(entry.parentPath, entry.name)).split(sep).join('/'),
  );

for (const file of distFiles) {
  const source = file.endsWith('.map') ? file.slice(0, -'.map'.length) : file;
  if (file.startsWith('-private/')) {
    if (!chunkPattern.test(file)) {
      failures.push(
        `dist/${file} is not a hashed shared chunk (was publicEntrypoints widened?)`,
      );
    }
  } else if (file.startsWith('_app_/')) {
    if (!appJsFiles.includes(file)) {
      failures.push(`dist/${file} is not listed in ember-addon.app-js`);
    }
  } else if (!allowedDistFiles.includes(source)) {
    failures.push(
      `dist/${file} is not on the allow-list of public files (was publicEntrypoints widened?)`,
    );
  }
}

for (const file of allowedDistFiles) {
  if (!distFiles.includes(file)) {
    failures.push(`dist/${file} is on the allow-list but was not built`);
  }
}

if (failures.length > 0) {
  console.error(`Export surface check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Export surface OK: ${publicSpecifiers.length} public specifiers resolve, ${blockedSpecifiers.length} internal specifiers are blocked, ${Object.keys(appJs).length} app-js re-exports resolve, dist/ matches the allow-list of ${allowedDistFiles.length} public files.`,
);
