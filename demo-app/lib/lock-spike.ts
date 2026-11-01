/**
 * SPIKE (#113): demo switches to compare the iOS scroll locks on a phone.
 *
 * - `?lock=overflow`: the iOS lock that doesn't fix `<body>`. Without it,
 *   the default lock (fixed `<body>`, #71).
 * - `?debug=1`: a fixed label with the scroll position, a tall page and the
 *   "Scroll lock test" example (text field, nested drawer).
 * - `?modal=0`: the "Scroll lock test" drawer isn't modal.
 * - `?scroll=<id>` (with `debug=1`): scrolls to that element after load,
 *   e.g. `scroll=example-lock-spike`.
 * - `?log=<url>` (with `debug=1`): sends the measurements to that URL, see
 *   `logSample`.
 *
 * Read once, when this module loads (before the app renders).
 */
import { drawerEnvironment } from '#src/-private/environment.ts';

const params = new URLSearchParams(window.location.search);

export const lockSpike = {
  lock: params.get('lock') === 'overflow' ? 'overflow' : 'fixed',
  debug: params.get('debug') === '1',
  modal: params.get('modal') !== '0',
} as const;

drawerEnvironment.iosScrollLock = lockSpike.lock;

/**
 * The fixed debug label. `page` is the top of `.demo-page` in the viewport:
 * the page's real position for both locks (with a fixed `<body>`, `scrollY`
 * is 0 while locked).
 *
 * - `lock min/max`: the extremes of `page` since the lock state changed
 *   (includes the frames of the lock or unlock itself).
 * - `touch min/max`: the extremes of `page` since the first touch after the
 *   lock state changed, so over all gestures while the drawer is open. If
 *   the page never moved, min = max = `page`; else it shows `MOVED`.
 */
/**
 * `?log=<url>` (with `debug=1`): sends a line to that URL (GET, `?l=`) each
 * time the viewport, the page or the sheet moves, for measurements in the
 * iOS Simulator. Not for real use.
 */
const logUrl = params.get('log');
let lastSample = '';
let pending: string[] = [];
const start = performance.now();
function logSample(page: number, tag = 'raf'): void {
  const viewport = window.visualViewport;
  const tray = document
    .querySelector('#lock-spike-title')
    ?.closest('.mobile-drawer__tray');
  const field = document.querySelector('.lock-spike-fields input');
  const r = (n: number | undefined) => Math.round(n ?? NaN);
  const trayRect = tray?.getBoundingClientRect();
  const fieldRect = field?.getBoundingClientRect();
  const sample = [
    `vvTop=${r(viewport?.offsetTop)}`,
    `vvH=${r(viewport?.height)}`,
    `ih=${window.innerHeight}`,
    `sY=${r(window.scrollY)}`,
    `page=${page}`,
    `tray=${r(trayRect?.top)}..${r(trayRect?.bottom)}`,
    `field=${r(fieldRect?.top)}..${r(fieldRect?.bottom)}`,
    `focus=${document.activeElement?.tagName ?? '-'}`,
  ].join(' ');
  if (tag === 'raf') {
    if (sample === lastSample) return;
    lastSample = sample;
  }
  pending.push(`${Math.round(performance.now() - start)} ${tag} ${sample}`);
  if (pending.length === 1) {
    setTimeout(() => {
      const lines = pending.join('\n');
      pending = [];
      void fetch(`${logUrl}?l=${encodeURIComponent(lines)}`, {
        mode: 'no-cors',
      }).catch(() => {});
    }, 100);
  }
}

if (logUrl) {
  const pageTop = () =>
    Math.round(
      document.querySelector('.demo-page')?.getBoundingClientRect().top ?? NaN,
    );
  window.addEventListener('scroll', () => logSample(pageTop(), 'ev:scroll'));
  window.visualViewport?.addEventListener('scroll', () =>
    logSample(pageTop(), 'ev:vvscroll'),
  );
  window.visualViewport?.addEventListener('resize', () =>
    logSample(pageTop(), 'ev:vvresize'),
  );
}

function startDebugLabel(): void {
  const label = document.createElement('div');
  label.className = 'demo-lock-debug';
  label.setAttribute('aria-hidden', 'true');
  document.body.append(label);
  let wasLocked: boolean | undefined;
  let min = Infinity;
  let max = -Infinity;
  let touchMin = Infinity;
  let touchMax = -Infinity;
  let armed = true;
  const show = (a: number, b: number) =>
    a === Infinity ? '-' : `${a}/${b}${a === b ? '' : ' MOVED'}`;
  const tick = () => {
    const html = document.documentElement;
    const page = document.querySelector('.demo-page');
    const top = Math.round(page?.getBoundingClientRect().top ?? NaN);
    const locked = html.style.overflow === 'hidden';
    if (locked !== wasLocked) {
      wasLocked = locked;
      min = Infinity;
      max = -Infinity;
      touchMin = Infinity;
      touchMax = -Infinity;
      armed = true;
    }
    min = Math.min(min, top);
    max = Math.max(max, top);
    if (!armed) {
      touchMin = Math.min(touchMin, top);
      touchMax = Math.max(touchMax, top);
    }
    const viewport = window.visualViewport;
    if (logUrl) logSample(top);
    label.textContent = [
      `lock=${lockSpike.lock} ${locked ? 'LOCKED' : 'free'}`,
      `scrollY=${Math.round(window.scrollY)} page=${top}`,
      `lock min/max=${show(min, max)}`,
      `touch min/max=${show(touchMin, touchMax)}`,
      `vv top=${Math.round(viewport?.offsetTop ?? 0)} h=${Math.round(viewport?.height ?? 0)} ih=${window.innerHeight}`,
      `body=${document.body.style.position || 'static'}`,
    ].join('\n');
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.addEventListener(
    'touchstart',
    () => {
      armed = false;
    },
    { capture: true, passive: true },
  );
}

if (lockSpike.debug) {
  if (document.body) startDebugLabel();
  else window.addEventListener('DOMContentLoaded', startDebugLabel);
  // `?scroll=<id>`: scroll that element to the top once the app rendered.
  const scrollTo = params.get('scroll');
  if (scrollTo) {
    setTimeout(() => {
      const target = document.getElementById(scrollTo);
      if (target) window.scrollTo({ top: target.offsetTop - 120 });
    }, 800);
  }
}
