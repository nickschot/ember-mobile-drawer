// Spike (a): .mobile-drawer__content is the scroll container; the grabber
// strip is moved out of it, to a tray child before it. Only the bottom iOS
// sheet of the demo.
const SEL =
  '.mobile-drawer-theme-ios .mobile-drawer[data-placement="bottom"] > .mobile-drawer__sheet > .mobile-drawer__tray';
function apply() {
  for (const tray of document.querySelectorAll(SEL)) {
    const content = tray.querySelector(':scope > .mobile-drawer__content');
    if (!content) continue;
    content.setAttribute('data-mobile-drawer-scroll', '');
    const grabber = content.querySelector(
      ':scope > .mobile-drawer-theme-ios__grabber',
    );
    if (grabber) tray.insertBefore(grabber, content);
  }
}
new MutationObserver(apply).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
apply();
