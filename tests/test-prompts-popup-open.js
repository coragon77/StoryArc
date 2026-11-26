/**
 * Opening the Prompts popup (#92): the focus on open, and a failure while
 * the popup opens, which must leave the Prompts button working. Its own
 * file: it puts a stand-in jQuery, document and toastr on globalThis.
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, mockPopups, mockPopupState, Popup } from '../tests/mocks/st-mocks.js';
import { clearTemplateCache } from '../lib/planning/generator.js';

/**
 * A stand-in for jQuery and the document with what showPromptsPopup
 * touches: delegated handlers on `document`, and the popup's root, whose
 * querySelector hands out elements that record the focus.
 */
function createFakeDom() {
    const handlers = [];
    const focusedSelectors = [];
    const promptsRoot = {
        innerHTML: '',
        querySelector: selector => ({ scrollTop: 0, focus: () => focusedSelectors.push(selector) }),
    };
    const fakeDocument = {
        getElementById: id => (id === 'story-arc-prompts' ? promptsRoot : null),
    };

    const documentChain = {
        on(events, selector, handler) {
            for (const event of events.split(/\s+/).filter(Boolean)) {
                const [type, ...namespaces] = event.split('.');
                handlers.push({ type, namespaces, selector, handler });
            }
            return documentChain;
        },
        off(events) {
            for (const event of events.split(/\s+/).filter(Boolean)) {
                const [type, ...namespaces] = event.split('.');
                for (let index = handlers.length - 1; index >= 0; index--) {
                    const bound = handlers[index];
                    const matches = (!type || bound.type === type) && namespaces.every(name => bound.namespaces.includes(name));
                    if (matches) handlers.splice(index, 1);
                }
            }
            return documentChain;
        },
    };
    const inertChain = new Proxy({}, { get: (target, name) => (name === 'length' ? 0 : () => inertChain) });
    const fakeJquery = target => (target === fakeDocument ? documentChain : inertChain);

    return { fakeJquery, fakeDocument, handlers, focusedSelectors };
}

const BUILT_IN = {
    'analyze-context.txt': 'ANALYSE {{GENRE_BLOCK}}',
    'ask-questions.txt': 'ASK {{USER_DIRECTION}}',
    'generate-arc.txt': 'OUTLINE {{PHASE1_ANALYSIS}}',
    'check-plan.txt': 'CHECK {{SECRETS}}',
    'extract-knowledge.txt': 'EXTRACT {{MESSAGES}}',
    'find-appearance.txt': 'FIND {{CHARACTER}}',
    'seed-state.txt': 'SEED {{CHARACTER}}',
};

const fake = createFakeDom();
const originalFetch = globalThis.fetch;
const originalShow = Popup.prototype.show;
const toastrErrors = [];
let showPromptsPopup;

/** The handlers the Prompts popup has bound on the document. */
function promptsHandlers() {
    return fake.handlers.filter(bound => bound.namespaces.includes('storyArcPrompts'));
}

/** Long enough for showPromptsPopup's wait before it binds the controls. */
async function settle() {
    await new Promise(resolve => setTimeout(resolve, 80));
}

before(async () => {
    globalThis.$ = fake.fakeJquery;
    globalThis.document = fake.fakeDocument;
    globalThis.toastr = { error: text => toastrErrors.push(text), success() {}, info() {}, warning() {} };
    ({ showPromptsPopup } = await import('../lib/ui/prompts.js'));
});

after(() => {
    delete globalThis.$;
    delete globalThis.document;
    delete globalThis.toastr;
});

beforeEach(() => {
    extension_settings.story_arc = { enabled: true };
    globalThis.fetch = async (url) => new Response(BUILT_IN[String(url).split('/').pop()]);
    clearTemplateCache();
    mockPopups.length = 0;
    mockPopupState.holdOpen = true;
    toastrErrors.length = 0;
    fake.focusedSelectors.length = 0;
});

afterEach(async () => {
    Popup.prototype.show = originalShow;
    for (const popup of mockPopups) {
        if (popup.completedWith === undefined) popup.complete(0);
    }
    await settle();
    mockPopupState.holdOpen = false;
    globalThis.fetch = originalFetch;
    delete extension_settings.story_arc;
    clearTemplateCache();
});

describe('opening the Prompts popup', () => {
    it('puts the focus on the selected prompt row, not on the scrolling list', async () => {
        const opening = showPromptsPopup();
        await settle();

        assert.deepEqual(fake.focusedSelectors, ['.pp-row[aria-current="true"]']);

        mockPopups[0].complete(0);
        await opening;
    });

    it('a failure while the popup is open is reported, unbinds its controls, and the button opens it again', async () => {
        Popup.prototype.show = () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('the popup broke')), 100));

        await showPromptsPopup();

        assert.equal(promptsHandlers().length, 0);
        assert.equal(toastrErrors.length, 1);
        assert.match(toastrErrors[0], /the popup broke/);

        Popup.prototype.show = originalShow;
        const opening = showPromptsPopup();
        await settle();

        assert.equal(mockPopups.length, 2);
        assert.ok(promptsHandlers().length > 0);
        mockPopups[1].complete(0);
        await opening;
    });
});
