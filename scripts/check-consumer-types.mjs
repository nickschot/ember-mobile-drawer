// Type-checks the packed package from a TypeScript consumer's point of view:
// - packs the package (without running `prepack`, so run `pnpm build` first),
// - unpacks it into `node_modules/ember-mobile-drawer` of a temporary consumer,
// - links the consumer's other dependencies (typescript, ember-source,
//   @glimmer/component and @glint/template, the optional peer dependency) from
//   this repository's node_modules, so no network access is needed,
// - runs `tsc` with `skipLibCheck: false` on a file that imports the root
//   exports (including the spring presets), the component, the template
//   registry and the test-support helpers.
// It runs under `moduleResolution: bundler`, the resolution the package
// supports (see "TypeScript" in README.md).
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = 'ember-mobile-drawer';
const root = fileURLToPath(new URL('..', import.meta.url));
const linkedDependencies = [
  'typescript',
  'ember-source',
  '@glimmer/component',
  '@glint/template',
];

const consumerSource = `
import {
  MobileDrawer,
  type MobileDrawerApi,
  type MobileDrawerDragEndEvent,
  type MobileDrawerDragStartEvent,
  type MobileDrawerSignature,
  type MobileDrawerSpring,
  type MobileDrawerToggleEvent,
  type Placement,
  type SnapPoint,
  type SpringDuration,
  springFromDuration,
  springPresets,
} from '${pkg}';
import MobileDrawerComponent from '${pkg}/components/mobile-drawer';
import type Registry from '${pkg}/template-registry';
import {
  closeDrawer,
  dragDrawer,
  openDrawer,
  type DragDrawerOptions,
  type DrawerTarget,
} from '${pkg}/test-support';

export const sameComponent: typeof MobileDrawer = MobileDrawerComponent;
export const registered: Registry['MobileDrawer'] = MobileDrawerComponent;

const placement: Placement = 'bottom';
const snapPoints: SnapPoint[] = [0, 240, '50%', 'content'];
export const args: MobileDrawerSignature['Args'] = {
  placement,
  snapPoints,
  activeSnapPoint: 1,
  onSnapPointChange: (index: number) => void index,
  onOpen: ({ snapPoint }: MobileDrawerToggleEvent) => void snapPoint,
  onClose: ({ snapPoint }: MobileDrawerToggleEvent) => void snapPoint,
  onDragStart: ({ snapPoint, offset }: MobileDrawerDragStartEvent) =>
    void (snapPoint + offset),
  onDragEnd: ({ snapPoint, offset, velocity }: MobileDrawerDragEndEvent) =>
    void (snapPoint + offset + velocity),
  spring: springPresets.ios,
};

const duration: SpringDuration = { duration: 0.5, bounce: 0.15 };
export const snappy: MobileDrawerSpring = springFromDuration(duration);
export const stiffer: MobileDrawerSignature['Args'] = {
  spring: { stiffness: 600 },
};
// @ts-expect-error not a preset
export const badPreset: MobileDrawerSpring = springPresets.android;
// @ts-expect-error the presets are read-only
springPresets.ios = snappy;
// @ts-expect-error not a spring parameter
export const badSpring: MobileDrawerSignature['Args'] = { spring: { tension: 1 } };

export async function useTestSupport(element: Element): Promise<void> {
  const target: DrawerTarget = element;
  const options: DragDrawerOptions = { to: 1, velocity: 500 };
  await openDrawer();
  await closeDrawer(target);
  await dragDrawer('.mobile-drawer', options);
  await dragDrawer(target, { distance: -40 });
  // @ts-expect-error either \`to\` or \`distance\`, not both
  await dragDrawer(target, { to: 1, distance: 40 });
}

export function useApi(api: MobileDrawerApi): number {
  api.open();
  return api.progress;
}

// @ts-expect-error not a placement
export const badPlacement: Placement = 'middle';
// @ts-expect-error not a snap point
export const badSnapPoint: SnapPoint = true;
`;

const tsconfig = {
  compilerOptions: {
    target: 'es2022',
    lib: ['es2022', 'dom'],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['ember-source/types'],
  },
  files: ['index.ts'],
};

// realpath: on macOS the temp dir is behind a symlink (`/var` ->
// `/private/var`), which would make tsc report the consumer's own files with
// `../` paths.
const tmp = realpathSync(mkdtempSync(join(tmpdir(), `${pkg}-consumer-`)));
// Third-party declarations, linked from this repo's pnpm store.
const pnpmStore = realpathSync(join(root, 'node_modules', '.pnpm')) + sep;
let failed = false;
let ignored = 0;

try {
  const packDir = join(tmp, 'pack');
  mkdirSync(packDir);
  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
  const [tarball] = readdirSync(packDir);

  const consumer = join(tmp, 'consumer');
  const installed = join(consumer, 'node_modules', pkg);
  mkdirSync(installed, { recursive: true });
  execFileSync('tar', [
    'xzf',
    join(packDir, tarball),
    '-C',
    installed,
    '--strip-components=1',
  ]);

  for (const dependency of linkedDependencies) {
    const target = join(consumer, 'node_modules', dependency);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(
      realpathSync(join(root, 'node_modules', dependency)),
      target,
      'junction',
    );
  }

  writeFileSync(join(consumer, 'index.ts'), consumerSource);
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  );

  let output = '';
  try {
    execFileSync(
      process.execPath,
      [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '-p',
        consumer,
        '--pretty',
        'false',
      ],
      { cwd: consumer, encoding: 'utf8' },
    );
  } catch (error) {
    output = `${error.stdout}${error.stderr}`;
  }

  // ember-source's own declarations don't pass `skipLibCheck: false` (they
  // report errors in its bundled @glimmer/interfaces types), so errors in
  // files inside this repo's pnpm store (third-party packages) are ignored.
  // Everything else fails the check: errors in the consumer's file, in this
  // package's declarations, and any error whose file can't be attributed.
  // Each error starts on an unindented line; continuation lines are indented.
  const errors = output
    .split(/\n(?=\S)/)
    .map((error) => error.trim())
    .filter(Boolean);
  const isThirdParty = (error) => {
    const file = /^(.+?)\(\d+,\d+\): error /.exec(error)?.[1];
    if (!file) {
      return false;
    }
    try {
      return realpathSync(resolve(consumer, file)).startsWith(pnpmStore);
    } catch {
      return false;
    }
  };
  const ours = errors.filter((error) => !isThirdParty(error));
  ignored = errors.length - ours.length;
  if (ours.length > 0) {
    failed = true;
    console.error(
      `Consumer type check failed (moduleResolution: bundler, skipLibCheck: false):\n${ours.join('\n')}`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  process.exit(1);
}

console.log(
  `Consumer types OK: the packed package type-checks under moduleResolution bundler with skipLibCheck false (root exports, components/mobile-drawer, template-registry, test-support; ignored ${ignored} errors in other packages' declarations).`,
);
