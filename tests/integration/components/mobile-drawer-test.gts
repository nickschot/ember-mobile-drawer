import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { MobileDrawer } from '#src/index.ts';

module('Integration | Component | mobile-drawer', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders its block', async function (assert) {
    await render(
      <template>
        <MobileDrawer data-test-drawer>Drawer content</MobileDrawer>
      </template>,
    );

    assert.dom('[data-test-drawer]').exists();
    assert.dom('[data-test-drawer]').hasText('Drawer content');
  });
});
