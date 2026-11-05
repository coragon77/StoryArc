import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, mockCalls } from '../tests/mocks/st-mocks.js';

/**
 * A stand-in for jQuery with what the knowledge tracker controls touch:
 * delegated handlers on `document`, `$(element)` reading and writing an
 * element's checked / value, `$('#id').text()` on a few known ids and
 * `$('#id').prop(name, value)` on the controls that follow the tracker
 * switch. Every other `$(...)` call returns an inert chain.
 */
function createFakeJquery() {
    const fakeDocument = {};
    const handlers = [];
    const textById = {};
    const propsById = {};
    const trackerDependentIds = ['#story-arc-knowledge-details', '#story-arc-knowledge-interval', '#story-arc-knowledge-btn'];

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
        if (trackerDependentIds.includes(target)) {
            return {
                prop(name, value) {
                    propsById[target] = { ...propsById[target], [name]: value };
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

    return { fakeJquery, fakeDocument, textById, propsById, trigger };
}

const fake = createFakeJquery();
let settingsPanel;
let loadSettings;
let updateKnowledgeStatus;

before(async () => {
    globalThis.$ = fake.fakeJquery;
    globalThis.document = fake.fakeDocument;
    settingsPanel = await import('../lib/ui/settings-panel.js');
    ({ loadSettings } = await import('../lib/core/settings.js'));
    ({ updateKnowledgeStatus } = await import('../lib/ui/knowledge-status.js'));
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

        assert.match(html, /<input type="checkbox" id="story-arc-knowledge-enabled" \/>/);
        assert.match(html, /id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="1" disabled \/>/);
    });

    it('stores the switch in extension_settings and saves it', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: true });

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 1, characterDetails: false });
        assert.equal(mockCalls.saveSettingsDebounced, 1);
    });

    it('stores a changed interval as a whole number and saves it', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-interval', { value: '4' });

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: false, updateInterval: 4, characterDetails: false });
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

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 2, characterDetails: false });
        assert.equal(mockCalls.saveSettingsDebounced, 0);
    });

    it('shows the character details switch off for a settings file from before it, on once stored', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        assert.match(settingsPanel.renderSettingsPanel(), /<input type="checkbox" id="story-arc-knowledge-details" \/>/);

        extension_settings.story_arc.knowledgeTracker.characterDetails = true;
        assert.match(settingsPanel.renderSettingsPanel(), /<input type="checkbox" id="story-arc-knowledge-details" checked \/>/);
        // The tracker on: nothing is disabled.
        assert.doesNotMatch(settingsPanel.renderSettingsPanel(), /disabled/);
    });

    it('stores the character details switch in extension_settings and saves it', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-details', { checked: true });

        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: false, updateInterval: 1, characterDetails: true });
        assert.equal(mockCalls.saveSettingsDebounced, 1);
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

describe('settings that depend on the knowledge tracker', () => {
    it('are rendered disabled while the tracker is off: character details, the interval and the Knowledge button', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: false, updateInterval: 2 } };
        loadSettings();

        const html = settingsPanel.renderSettingsPanel();

        assert.match(html, /<input type="checkbox" id="story-arc-knowledge-details" disabled \/>/);
        assert.match(html, /id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="2" disabled \/>/);
        assert.match(html, /<button type="button" id="story-arc-knowledge-btn" class="menu_button" disabled/);
    });

    it('turn on and off with the tracker switch', () => {
        loadSettings();
        settingsPanel.setupSettingsPanelEvents();

        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: true });
        assert.deepEqual(fake.propsById, {
            '#story-arc-knowledge-details': { disabled: false },
            '#story-arc-knowledge-interval': { disabled: false },
            '#story-arc-knowledge-btn': { disabled: false },
        });

        fake.trigger('change', '#story-arc-knowledge-enabled', { checked: false });
        assert.deepEqual(fake.propsById, {
            '#story-arc-knowledge-details': { disabled: true },
            '#story-arc-knowledge-interval': { disabled: true },
            '#story-arc-knowledge-btn': { disabled: true },
        });
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

        updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Knowledge tracker is off.');
    });

    it('names the message the current chat\'s ledger was last updated at', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 41 }) };

        updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Ledger last updated at message #41.');
    });

    it('says the ledger is empty for a chat it has never been updated in', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [] };

        updateKnowledgeStatus();

        assert.equal(fake.textById[statusId], 'Ledger is empty: not updated yet.');
    });

    it('shows the other chat\'s ledger after a chat change', () => {
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 41 }) };
        updateKnowledgeStatus();

        // ST replaces chat_metadata's contents when another chat loads.
        chat_metadata.story_arc = { arcs: [], knowledge: knowledgeLedger({ lastUpdatedAt: 7 }) };
        updateKnowledgeStatus();

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
