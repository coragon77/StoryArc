import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chat_metadata, extension_settings, mockPopups, mockPopupState } from '../tests/mocks/st-mocks.js';

/**
 * A stand-in for jQuery with what the wand entry and its popup touch:
 * delegated handlers on `document`, the extensions menu as present, and
 * `$(element)` reading a handler element's data. Everything else is inert.
 */
function createFakeJquery() {
    const fakeDocument = {};
    const handlers = [];

    const documentChain = {
        on(events, selector, handler) {
            for (const event of events.split(/\s+/).filter(Boolean)) {
                const [type, ...namespaces] = event.split('.');
                handlers.push({ type, namespaces, selector, handler });
            }
            return documentChain;
        },
        off(events, selector) {
            for (const event of events.split(/\s+/).filter(Boolean)) {
                const [type, ...namespaces] = event.split('.');
                for (let index = handlers.length - 1; index >= 0; index--) {
                    const bound = handlers[index];
                    const matches = (!type || bound.type === type)
                        && namespaces.every(name => bound.namespaces.includes(name))
                        && (selector === undefined || bound.selector === selector);
                    if (matches) handlers.splice(index, 1);
                }
            }
            return documentChain;
        },
    };

    const inertChain = new Proxy({}, { get: (target, name) => (name === 'length' ? 0 : () => inertChain) });
    const menuChain = { length: 1, append() { return menuChain; } };

    function fakeJquery(target) {
        if (target === fakeDocument) return documentChain;
        if (target === '#extensionsMenu') return menuChain;
        if (typeof target === 'object') return { data: key => target.data?.[key] };
        return inertChain;
    }

    function trigger(type, selector, element = {}) {
        const bound = handlers.find(entry => entry.type === type && entry.selector === selector);
        assert.ok(bound, `no ${type} handler on ${selector}`);
        return bound.handler.call(element);
    }

    return { fakeJquery, fakeDocument, handlers, trigger };
}

const fake = createFakeJquery();
let registerWandMenuEntry;
let buildWandContent;
let loadSettings;

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 80));
}

function millArc() {
    return {
        id: 'mill01',
        title: 'The Old Mill',
        premise: 'Something haunts the mill.',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        estimatedLength: 12,
        messageStart: 0,
        lastFulfilledAt: 0,
        beats: [{ id: 'noises', status: 'active', pressure: 'Noises at night.', intention: 'The noises were heard.', unlockAfter: [] }],
        secrets: [],
        foreshadowing: [],
        triggers: [],
    };
}

before(async () => {
    globalThis.$ = fake.fakeJquery;
    globalThis.document = fake.fakeDocument;
    globalThis.toastr = { error() {}, success() {}, info() {}, warning() {} };
    ({ registerWandMenuEntry, buildWandContent } = await import('../lib/ui/wand-menu.js'));
    ({ loadSettings } = await import('../lib/core/settings.js'));
});

after(() => {
    delete globalThis.$;
    delete globalThis.document;
    delete globalThis.toastr;
});

beforeEach(() => {
    mockPopups.length = 0;
    mockPopupState.holdOpen = true;
    extension_settings.story_arc = { enabled: true };
    loadSettings();
    chat_metadata.story_arc = { version: 1, arcs: [millArc()] };
    chat.length = 0;
});

afterEach(async () => {
    // Close every popup still open, until the wand stops coming back.
    for (let round = 0; round < 5; round++) {
        for (const popup of mockPopups) {
            if (popup.completedWith === undefined) popup.complete(0);
        }
        await settle();
    }
    mockPopupState.holdOpen = false;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
});

describe('wand popup: the stall nudge', () => {
    it('closes the wand popup first and only then opens the re-plan wizard for that arc', async () => {
        registerWandMenuEntry();
        fake.trigger('click', '#story_arc_wand_button');
        await settle();
        const wandPopup = mockPopups[0];
        assert.match(wandPopup.content, /id="story-arc-wand"/);

        fake.trigger('click', '#story-arc-wand .story-arc-stall-btn', { data: { 'arc-id': 'mill01' } });
        await settle();

        assert.equal(wandPopup.completedWith, 0);
        assert.equal(mockPopups.length, 2);
        assert.match(mockPopups[1].content, /Re-plan <span class="story-arc-wizard-heading-arc">The Old Mill<\/span>/);
    });
});

describe('wand popup content', () => {
    it('offers Plan, Manage and, with the tracker on, Knowledge as real buttons', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1 } };
        loadSettings();

        const html = buildWandContent();

        assert.match(html, /<button type="button" id="story-arc-wand-plan" class="menu_button[^"]*"/);
        assert.match(html, /<button type="button" id="story-arc-wand-manage" class="menu_button"/);
        assert.match(html, /<button type="button" id="story-arc-wand-knowledge" class="menu_button"/);
        assert.doesNotMatch(html, /story-arc-btn/);
    });

    it('says how to turn Story Arc on instead of offering dead buttons while it is disabled', () => {
        extension_settings.story_arc = { enabled: false };
        loadSettings();

        const html = buildWandContent();

        assert.match(html, /Story Arc is off\. Turn it on in the Story Arc section of the extensions panel\./);
        assert.doesNotMatch(html, /id="story-arc-wand-plan"/);
    });
});
