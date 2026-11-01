'use strict';

if (typeof module !== 'undefined') {
  module.exports = {
    test_page: 'tests/index.html?hidepassed',
    cwd: 'dist-tests',
    disable_watching: true,
    launch_in_ci: ['Chrome'],
    launch_in_dev: ['Chrome'],
    browser_start_timeout: 120,
    browser_args: {
      Chrome: {
        ci: [
          // --no-sandbox is needed when running Chrome inside a container
          process.env.CI ? '--no-sandbox' : null,
          '--headless=new',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--mute-audio',
          '--remote-debugging-port=0',
          '--window-size=1440,900',
          // testem adds --disable-renderer-backgrounding and
          // --disable-background-timer-throttling. Also keep rendering when
          // Chrome counts the window as occluded: on macOS this occurs when
          // the display sleeps or the screen locks. Then no animation frames
          // come, but timers continue, so tests that wait for a frame hang.
          '--disable-backgrounding-occluded-windows',
        ].filter(Boolean),
      },
    },
  };
}
