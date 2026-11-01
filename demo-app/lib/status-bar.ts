import { tracked } from '@glimmer/tracking';

/**
 * Whether the demo drawers get `@transparentStatusBar` (iOS Safari 26+: the
 * status bar shows the dimmed page while a modal drawer is open). On with
 * `?statusBar=transparent` or with the checkbox in the playground, so the
 * two looks can be compared on the same page.
 */
class StatusBarSetting {
  @tracked transparent =
    new URLSearchParams(window.location.search).get('statusBar') ===
    'transparent';
}

export const statusBar = new StatusBarSetting();
