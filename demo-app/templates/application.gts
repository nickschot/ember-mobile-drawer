import { pageTitle } from 'ember-page-title';
import DrawerDemo from '../components/drawer-demo.gts';
import BottomSheetExample from '../components/bottom-sheet-example.gts';
import SideDrawerExample from '../components/side-drawer-example.gts';
import IosSheetExample from '../components/ios-sheet-example.gts';
import { pageScale } from '../lib/page-scale.ts';

<template>
  {{pageTitle "ember-mobile-drawer"}}

  {{! The page for the iOS theme's page scale effect: the iOS example's
    drawer renders outside it, at the end of <body>. }}
  <div
    class="demo-page {{if pageScale.enabled 'mobile-drawer-theme-ios__page'}}"
    data-mobile-drawer-page={{if pageScale.enabled ""}}
  >
    <header class="demo-header">
      <h1>ember-mobile-drawer</h1>
      <p>
        A gesture-enabled drawer component for Ember.
        <a href="https://github.com/nickschot/ember-mobile-drawer">GitHub</a>
      </p>
      <p class="demo-hint">
        Drag with touch or a pen. On a desktop, turn on device emulation in the
        browser's developer tools.
      </p>
    </header>

    <main>
      <section aria-labelledby="playground">
        <h2 id="playground">Playground</h2>
        <DrawerDemo />
      </section>

      <section aria-labelledby="examples">
        <h2 id="examples">Examples</h2>

        <article class="demo-example" aria-labelledby="example-bottom-sheet">
          <h3 id="example-bottom-sheet">Bottom sheet with scrollable content</h3>
          <p class="demo-hint">
            Snap points [0, '50%', 'content']. Drag anywhere: the list scrolls
            once the sheet is fully open, and dragging down at its top closes
            it.
          </p>
          <div class="demo-buttons"><BottomSheetExample /></div>
        </article>

        <article class="demo-example" aria-labelledby="example-side-drawer">
          <h3 id="example-side-drawer">Side drawer</h3>
          <p class="demo-hint">
            Placement left, snap points [0, 'content'].
          </p>
          <div class="demo-buttons"><SideDrawerExample /></div>
        </article>

        <article class="demo-example" aria-labelledby="example-ios">
          <h3 id="example-ios">iOS theme</h3>
          <p class="demo-hint">
            The optional theme from ember-mobile-drawer/themes/ios.css, opted in
            with the mobile-drawer-theme-ios class on an ancestor. Snap points
            [0, '40%', 'content'] and the iOS spring (springPresets.ios). Fully
            open, the list scrolls under the grabber, which stays at the sheet's
            page-facing edge. With "Scale the page", the page behind scales down
            and gets rounded corners as the sheet opens. Tap a place for a
            nested sheet: it renders outside the sheet's tray with the yielded
            Nested component, so it shows also while the sheet is at 40%.
          </p>
          <div class="demo-buttons"><IosSheetExample /></div>
        </article>
      </section>
    </main>
  </div>
</template>
