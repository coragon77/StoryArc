import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A stand-in for jQuery that keeps only what setupSettingsPanelEvents touches:
 * delegated handlers on `document`, with jQuery's on/off rules for
 * "type.namespace" strings and selectors. Every other `$(...)` call returns an
 * inert chain so populateProfileSelects runs without a DOM.
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
            'change #story-arc-knowledge-appearance',
            'change #story-arc-knowledge-details',
            'change #story-arc-knowledge-enabled',
            'change #story-arc-knowledge-interval',
            'change #story-arc-profile',
            'change #story-arc-tracker-profile',
            'click #story-arc-create-preset-btn',
            'click #story-arc-knowledge-btn',
            'click #story-arc-manage-btn',
            'click #story-arc-plan-btn',
            'click #story-arc-sent-btn',
            'click #story-arc-settings .story-arc-ignore-stall-btn',
            'click #story-arc-settings .story-arc-stall-btn',
            'click .story-arc-knowledge-names-btn',
            'mousedown #story-arc-profile, #story-arc-tracker-profile',
        ]);
    });
});

describe('the Knowledge popup and the settings panel import no cycle', () => {
    it('knowledge-popup.js imports nothing from settings-panel.js, which opens the popup', () => {
        const popupSource = readFileSync(new URL('../lib/ui/knowledge-popup.js', import.meta.url), 'utf8');
        assert.equal(popupSource.includes('from \'./settings-panel.js\''), false);
    });
});

describe('the profile dropdowns', () => {
    /**
     * A stand-in for jQuery that keeps the options each profile dropdown is
     * filled with: `$('<option ...>')` builds an option with val/text,
     * `$('#story-arc-profile')` and `$('#story-arc-tracker-profile')` collect
     * what is appended and the value set. Everything else is inert.
     */
    function createOptionRecordingJquery() {
        const fakeDocument = {};
        const dropdowns = {};
        const inertChain = new Proxy({}, { get: () => () => inertChain });

        function dropdown(selector) {
            dropdowns[selector] ??= { options: [], value: undefined };
            const state = dropdowns[selector];
            const chain = {
                empty() { state.options = []; return chain; },
                append(option) { state.options.push(option.read()); return chain; },
                val(value) { state.value = value; return chain; },
                prop() { return chain; },
            };
            return chain;
        }

        function option() {
            const built = { value: '', text: '' };
            const chain = {
                val(value) { built.value = value; return chain; },
                text(value) { built.text = value; return chain; },
                read: () => ({ ...built }),
            };
            return chain;
        }

        function fakeJquery(target) {
            if (target === fakeDocument) return { on: () => fakeJquery(fakeDocument), off: () => fakeJquery(fakeDocument) };
            if (typeof target === 'string' && target.startsWith('<option')) return option();
            if (target === '#story-arc-profile' || target === '#story-arc-tracker-profile') return dropdown(target);
            return inertChain;
        }

        return { fakeJquery, fakeDocument, dropdowns };
    }

    let extension_settings;
    let setupSettingsPanelEvents;
    const fake = createOptionRecordingJquery();

    before(async () => {
        globalThis.$ = fake.fakeJquery;
        globalThis.document = fake.fakeDocument;
        ({ extension_settings } = await import('../tests/mocks/st-mocks.js'));
        ({ setupSettingsPanelEvents } = await import('../lib/ui/settings-panel.js'));
    });

    after(() => {
        delete globalThis.$;
        delete globalThis.document;
        delete extension_settings.story_arc;
        delete extension_settings.connectionManager;
    });

    it('lists the profiles by name under the empty option, a deleted tracker profile marked as missing and selected', () => {
        extension_settings.connectionManager = { profiles: [{ id: 'p-zed', name: 'Zed' }, { id: 'p-argon', name: 'Argon' }] };
        extension_settings.story_arc = { defaultConnectionProfile: 'p-argon', knowledgeTracker: { connectionProfile: 'p-gone' } };

        setupSettingsPanelEvents();

        assert.deepEqual(fake.dropdowns['#story-arc-profile'], {
            options: [{ value: '', text: 'Current API (no profile)' }, { value: 'p-argon', text: 'Argon' }, { value: 'p-zed', text: 'Zed' }],
            value: 'p-argon',
        });
        assert.deepEqual(fake.dropdowns['#story-arc-tracker-profile'], {
            options: [
                { value: '', text: 'Same as generation profile' },
                { value: 'p-argon', text: 'Argon' },
                { value: 'p-zed', text: 'Zed' },
                { value: 'p-gone', text: 'Missing profile (deleted)' },
            ],
            value: 'p-gone',
        });
    });
});
