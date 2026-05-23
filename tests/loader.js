/**
 * Custom ESM loader that intercepts SillyTavern imports and redirects
 * them to our mock module. This lets us test source files that import
 * from '/script.js', '/scripts/extensions.js', etc.
 *
 * Usage: node --import ./tests/setup.js --test tests/test-*.js
 */

const ST_PATHS = [
    '/script.js',
    '/scripts/extensions.js',
    '/scripts/group-chats.js',
    '/scripts/popup.js',
    '/scripts/power-user.js',
    '/scripts/world-info.js',
    '/scripts/extensions/shared.js',
];

const MOCK_URL = new URL('./mocks/st-mocks.js', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
    if (ST_PATHS.includes(specifier) || specifier.startsWith('/scripts/')) {
        return { url: MOCK_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
