import { pageTitle } from 'ember-page-title';
import DrawerDemo from '../components/drawer-demo.gts';
import BottomSheetExample from '../components/bottom-sheet-example.gts';
import SideDrawerExample from '../components/side-drawer-example.gts';

<template>
  {{pageTitle "ember-mobile-drawer"}}

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
          once the sheet is fully open, and dragging down at its top closes it.
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
        {{! The iOS theme example goes here once #29 lands. }}
        <p class="demo-placeholder">
          Coming with the optional iOS theme (<a
            href="https://github.com/nickschot/ember-mobile-drawer/issues/29"
          >#29</a>).
        </p>
      </article>
    </section>
  </main>
</template>
