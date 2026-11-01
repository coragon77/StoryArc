import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, mockCalls } from '../tests/mocks/st-mocks.js';

/**
 * A stand-in for jQuery with what the knowledge tracker controls touch:
 * delegated handlers on `document`, `$(element)` reading and writing an
 * element's checked / value, and `$('#id').text()` on a few known ids.
 * Every other `$(...)` call returns an inert chain.
 */
function createFakeJquery() {
    const fakeDocument = {};
    const handlers = [];
    const textById = {};

    const documentChain = {
        on(events, selector, handler) {
            const type = events.split('.')[0];
            handlers.push({ type, selector, handler });
            return documentChain;
        },
        off() {
            handlers.length = 0;
            return documentChain;
        },
    };

    const inertChain = new Proxy({}, { get: () => () => inertChain });

    function elementChain(element) {
        return {
            prop(name, value) {
                if (value === undefined) return element[name];
                element[name] = value;
                return this;
            },
            val(value) {
                if (value === undefined) return element.value;
                element.value = String(value);
                return this;
            },
        };
    }

    function fakeJquery(target) {
        if (target === fakeDocument) return documentChain;
        if (typeof target === 'object') return elementChain(target);
        if (target === '#story-arc-knowledge-status') {
            return {
                length: 1,
                text(value) {
                    textById[target] = value;
                    return this;
                },
            };
        }
        return inertChain;
    }

    /** Run the bound handler for a type and selector with `this` = element. */
    function trigger(type, selector, element) {
        const bound = handlers.find(entry => entry.type === type && entry.selector === selector);
        assert.ok(bound, `no ${type} handler on ${selector}`);
        bound.handler.call(element);
    }

    return { fakeJquery, fakeDocument, textById, trigger };
}

const fake = createFakeJquery();
let settingsPanel;
let loadSettings;

before(async () => {
    globalThis.$ = fake.fakeJquery;
    globalThis.document = fake.fakeDocument;
    settingsPanel = await import('../lib/ui/settings-panel.js');
    ({ loadSettings } = await import('../lib/core/settings.js'));
});

after(() => {
    delete globalThis.$;
    delete globalThis.document;
});

beforeEach(() => {
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    mockCalls.saveSettingsDebounced = 0;
});

describe('knowledge tracker controls in the settings panel', () => {
    it('shows the stored switch and interval when the panel is rendered', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 3 } };
        loadSettings();

        const html = settingsPanel.renderSettingsPanel();

        assert.match(html, /<input type="checkbox" id="story-arc-knowledge-enabled" checked \/>/);
        assert.match(html, /<input type="number" id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="3" \/>/);
    });

    it('shows the switch off and interval 1 for a settings file from before the tracker', () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: null };
        loadSettings();

        const html = settingsPanel.renderSettingsPanel();

        assert.match(html, /<input type="checkbox" id="story-arc-knowledge-enabled"  \/>/);
        assert.match(html, /id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="1" \/>/);
    });

    it('stores the switch in extension_settings and saves it', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: true });

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 1 });
        assert.equal(mockCalls.saveSettingsDebounced, 1);
    });

    it('stores a changed interval as a whole number and saves it', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-interval', { value: '4' });

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: false, updateInterval: 4 });
        assert.equal(mockCalls.saveSettingsDebounced, 1);
    });

    it('keeps the stored interval and puts it back in the field when the input is not a whole number of at least 1', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 2 } };
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        for (const badInput of ['0', '-3', '', 'abc', '2.5']) {
            const intervalField = { value: badInput };
            fake.trigger('change', '#story-arc-knowledge-interval', intervalField);
            assert.equal(intervalField.value, '2', `input ${JSON.stringify(badInput)}`);
        }

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 2 });
        assert.equal(mockCalls.saveSettingsDebounced, 0);
    });

    it('shows a stored switch and interval again after a reload', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();
        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: true });
        fake.trigger('change', '#story-arc-knowledge-interval', { value: '5' });

        // A reload: ST reads the saved settings file back, Story Arc loads it.
        const savedFile = JSON.parse(JSON.stringify(extension_settings.story_arc));
        delete extension_settings.story_arc;
        extension_settings.story_arc = savedFile;
        loadSettings();
        const html = settingsPanel.renderSettingsPanel();

        assert.match(html, /id="story-arc-knowledge-enabled" checked \/>/);
        assert.match(html, /id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="5" \/>/);
    });
});

describe('knowledge tracker status line', () => {
    const statusId = '#story-arc-knowledge-status';

    function knowledgeLedger(overrides) {
        return { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null, ...overrides };
    }

    it('says the tracker is off while the switch is off, whatever the ledger holds', () => {
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 41 }) };

        settingsPanel.updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Knowledge tracker is off.');
    });

    it('names the message the current chat\'s ledger was last updated at', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 41 }) };

        settingsPanel.updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Ledger last updated at message #41.');
    });

    it('says the ledger is empty for a chat it has never been updated in', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [] };

        settingsPanel.updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Ledger is empty: not updated yet.');
    });

    it('shows the other chat\'s ledger after a chat change', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 41 }) };
        settingsPanel.updateKnowledgeStatus();

        // ST replaces chat_metadata's contents when another chat loads.
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 7 }) };
        settingsPanel.updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Ledger last updated at message #7.');
    });

    it('updates when the switch is turned on', () => {
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 12 }) };
        settingsPanel.setupSettingsPanelEvents();
        assert.equal(fake.textById[statusId], 'Knowledge tracker is off.');

        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: true });

        assert.equal(fake.textById[statusId], 'Ledger last updated at message #12.');
    });
});
