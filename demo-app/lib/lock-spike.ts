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
