import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A stand-in for jQuery that keeps only what setupSettingsPanelEvents touches:
 * delegated handlers on `document`, with jQuery's on/off rules for
 * "type.namespace" strings and selectors. Every other `$(...)` call returns an
 * inert chain so populateProfileSelect runs without a DOM.
 */
function createFakeJquery() {
    const fakeDocument = {};
    const handlers = [];

    function parseEvents(events) {
        return events.split(/\s+/).filter(Boolean).map(event => {
            const [type, ...namespaces] = event.split('.');
            return { type, namespaces };
        });
    }

    const documentChain = {
        on(events, selector, handler) {
            for (const { type, namespaces } of parseEvents(events)) {
                handlers.push({ type, namespaces, selector, handler });
            }
            return documentChain;
        },
        off(events, selector) {
            for (const { type, namespaces } of parseEvents(events)) {
                for (let index = handlers.length - 1; index >= 0; index--) {
                    const bound = handlers[index];
                    const typeMatches = !type || bound.type === type;
                    const namespaceMatches = namespaces.every(name => bound.namespaces.includes(name));
                    const selectorMatches = selector === undefined || bound.selector === selector;
                    if (typeMatches && namespaceMatches && selectorMatches) handlers.splice(index, 1);
                }
            }
            return documentChain;
        },
    };

    const inertChain = new Proxy({}, { get: () => () => inertChain });

    function fakeJquery(target) {
        return target === fakeDocument ? documentChain : inertChain;
    }

    return { fakeJquery, fakeDocument, handlers };
}

describe('setupSettingsPanelEvents', () => {
    const fake = createFakeJquery();
    let setupSettingsPanelEvents;

    before(async () => {
        globalThis.$ = fake.fakeJquery;
        globalThis.document = fake.fakeDocument;
        ({ setupSettingsPanelEvents } = await import('../lib/ui/settings-panel.js'));
    });

    after(() => {
        delete globalThis.$;
        delete globalThis.document;
    });

    it('binds each control exactly once when called a second time', () => {
        setupSettingsPanelEvents();
        setupSettingsPanelEvents();

        const bindings = fake.handlers.map(bound => `${bound.type} ${bound.selector}`).sort();
        assert.deepEqual(bindings, [
            'change #story-arc-enabled',
            'change #story-arc-profile',
            'click #story-arc-create-preset-btn',
            'click #story-arc-manage-btn',
            'click #story-arc-plan-btn',
            'click .story-arc-stall-btn',
            'mousedown #story-arc-profile',
        ]);
    });
});
