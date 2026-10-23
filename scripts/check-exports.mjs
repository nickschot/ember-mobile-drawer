// Checks the package's export surface after a build: documented entry points
// must resolve (to files that exist), internal `-private` modules must not.
// Resolution goes through Node's self-reference of `package.json#exports`,
// which matches what consumers get.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = 'ember-mobile-drawer';

const publicSpecifiers = [
  pkg,
  `${pkg}/template-registry`,
  `${pkg}/components/mobile-drawer`,
  `${pkg}/styles.css`,
  `${pkg}/addon-main.js`,
];

const privateSpecifiers = [
  `${pkg}/-private/spring/spring`,
  `${pkg}/-private/snap-points`,
  `${pkg}/-private/snap-points/index`,
  `${pkg}/-private/anything.css`,
];

const failures = [];

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

for (const specifier of privateSpecifiers) {
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

if (failures.length > 0) {
  console.error(`Export surface check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Export surface OK: ${publicSpecifiers.length} public specifiers resolve, ${privateSpecifiers.length} -private specifiers are blocked.`,
);
