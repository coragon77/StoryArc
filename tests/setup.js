/**
 * Test setup — registers the custom ESM loader before tests run.
 * Invoked via: node --import ./tests/setup.js --test tests/test-*.js
 */

import { register } from 'node:module';
register('./loader.js', import.meta.url);
