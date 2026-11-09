import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiseChoice, buildReviewStep, closeWizard, shortenAtWord } from '../lib/ui/wizard.js';
import {
    chat, chat_metadata, extension_settings, mockSortedEntries, mockPopups, mockPopupState,
    ConnectionManagerRequestService,
} from '../tests/mocks/st-mocks.js';

/**
 * A stand-in for jQuery with what the wizard touches: delegated handlers on
 * `document`; `$('#id')` writing and reading an element's html, text, value
 * and properties; `$(element)` for the element a handler runs on. An id
 * "exists" once some written html carries it. Everything else is inert.
 */
function createFakeJquery() {
    const fakeDocument = {};
    const handlers = [];
    const htmlById = {};
    const htmlWrites = [];
    const textById = {};
    const valueById = {};
    const propsById = {};
    const attrsById = {};

    const documentChain = {
        on(events, selector, handler) {
            for (const event of events.split(/\s+/).filter(Boolean)) {
                handlers.push({ type: event.split('.')[0], selector, handler });
            }
            return documentChain;
        },
        off() {
            handlers.length = 0;
            return documentChain;
        },
    };

    const inertChain = new Proxy({}, { get: (target, name) => (name === 'length' ? 0 : () => inertChain) });

    function idIsOnScreen(id) {
        return Object.values(htmlById).some(html => String(html).includes(`id="${id}"`));
    }

    function idChain(id) {
        return {
            get length() { return idIsOnScreen(id) || id in htmlById ? 1 : 0; },
            html(value) {
                if (value === undefined) return htmlById[id];
                htmlById[id] = value;
                htmlWrites.push(id);
                return this;
            },
            text(value) {
                if (value === undefined) return textById[id];
                textById[id] = value;
                return this;
            },
            val(value) {
                if (value === undefined) return valueById[id];
                valueById[id] = value;
                return this;
            },
            prop(name, value) {
                propsById[id] = { ...propsById[id], [name]: value };
                return this;
            },
            attr(name, value) {
                attrsById[id] = { ...attrsById[id], [name]: value };
                return this;
            },
            toggleClass() { return this; },
            trigger() { return this; },
        };
    }

    function elementChain(element) {
        return {
            data(key) { return element.data?.[key]; },
            val() { return element.value; },
            prop(name) { return element[name]; },
            closest(selector) { return { length: (element.inside || []).includes(selector) ? 1 : 0 }; },
        };
    }

    function fakeJquery(target) {
        if (target === fakeDocument) return documentChain;
        if (typeof target === 'object') return elementChain(target);
        if (typeof target === 'string' && /^#[\w-]+$/.test(target)) return idChain(target.slice(1));
        return inertChain;
    }

    /** Run the bound handler for a type and selector with `this` = element. */
    function trigger(type, selector, element = {}) {
        const bound = handlers.find(entry => entry.type === type && entry.selector === selector);
        assert.ok(bound, `no ${type} handler on ${selector}`);
        return bound.handler.call(element);
    }

    function reset() {
        for (const store of [htmlById, textById, valueById, propsById, attrsById]) {
            for (const key of Object.keys(store)) delete store[key];
        }
        htmlWrites.length = 0;
    }

    return { fakeJquery, fakeDocument, htmlById, htmlWrites, textById, valueById, propsById, attrsById, trigger, reset };
}

const fake = createFakeJquery();
const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;
let showWizard;
let loadSettings;

/** Let every pending promise and timer (the wizard's 50 ms render delay) run. */
async function settle() {
    await new Promise(resolve => setTimeout(resolve, 80));
}

/** The templates the generator fetches, each reduced to a marker. */
function installTemplates() {
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('analyze-context.txt')) return new Response('ANALYZE');
        if (String(url).endsWith('generate-arc.txt')) return new Response('OUTLINE');
        if (String(url).endsWith('check-plan.txt')) return new Response('CHECK');
        throw new Error(`unexpected fetch ${url}`);
    };
}

/**
 * The transport: each call answers with the next queued text. A call made
 * while `gate.promise` is set waits for it first, so a test can hold a
 * generation in flight.
 */
function installAnswers(answers, gate = {}) {
    ConnectionManagerRequestService.sendRequest = async () => {
        if (gate.promise) await gate.promise;
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
}

const granaryPlan = JSON.stringify({
    title: 'The Granary',
    premise: 'The valley is starving.',
    beats: [{ id: 'empty_carts', pressure: 'Carts leave at night.', intention: 'The tally was found short.' }],
    secrets: [{ id: 'guild_theft', content: 'The guild emptied the granary.', revealPhase: 'climax' }],
    foreshadowing: [{ id: 'torn_sack', clue: 'A torn sack behind the guild hall', target: 'guild_theft' }],
    triggers: [{ id: 'sacks_counted', condition: 'anyone counts the sacks', action: 'the clerk goes pale' }],
});

/** Open the wizard and let the context harvest finish; returns its popup. */
async function openWizard() {
    showWizard();
    await settle();
    return mockPopups[mockPopups.length - 1];
}

/** Type a direction and press Generate; the generation runs on. */
function typeDirectionAndGenerate(direction) {
    fake.valueById['story-arc-direction-input'] = direction;
    fake.valueById['story-arc-tier-select'] = 'episode';
    fake.valueById['story-arc-genre-input'] = '';
    fake.trigger('click', '#story-arc-wizard-generate');
}

before(async () => {
    globalThis.$ = fake.fakeJquery;
    globalThis.document = fake.fakeDocument;
    globalThis.toastr = { error() {}, success() {}, info() {}, warning() {} };
    ({ showWizard } = await import('../lib/ui/wizard.js'));
    ({ loadSettings } = await import('../lib/core/settings.js'));
});

after(() => {
    delete globalThis.$;
    delete globalThis.document;
    delete globalThis.toastr;
});

beforeEach(() => {
    fake.reset();
    mockPopups.length = 0;
    mockPopupState.holdOpen = true;
    extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
    loadSettings();
    chat_metadata.story_arc = { version: 1, arcs: [] };
    chat.length = 0;
    chat.push(
        { is_user: true, name: 'Ellie', mes: 'We count the sacks tonight.' },
        { is_user: false, name: 'Noor', mes: 'The clerk will not like it.' },
    );
    mockSortedEntries.length = 0;
    mockSortedEntries.push(
        { uid: 1, comment: 'The valley', content: 'A farming valley.', constant: true },
        { uid: 2, comment: 'The guild', content: 'Merchants who run the granary.', constant: false },
    );
    installTemplates();
});

afterEach(async () => {
    // Close whatever wizard is still open, so the next test starts clean.
    for (const popup of mockPopups) {
        if (popup.completedWith === undefined) popup.complete(0);
    }
    await settle();
    mockPopupState.holdOpen = false;
    globalThis.fetch = originalFetch;
    ConnectionManagerRequestService.sendRequest = originalSendRequest;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
    mockSortedEntries.length = 0;
});

describe('wizard: Direction is the first step and carries the context summary', () => {
    it('opens on Direction with the harvested context as a summary strip and Generate enabled once it is in', async () => {
        await openWizard();

        assert.match(fake.htmlById['story-arc-wizard-content'], /id="story-arc-direction-input"/);
        const strip = fake.htmlById['story-arc-wizard-context'];
        assert.match(strip, /<b>TestUser<\/b>/);
        assert.match(strip, /2 lorebook entries/);
        assert.match(strip, /2 recent messages/);
        assert.match(strip, /0 active arcs/);
        assert.equal(fake.propsById['story-arc-wizard-generate'].disabled, false);
    });

    it('has two steps, Direction and Review, and no context step', async () => {
        await openWizard();

        const shell = mockPopups[0].content;
        assert.match(shell, />Direction</);
        assert.match(shell, />Review</);
        assert.doesNotMatch(shell, />Context</);
    });
});

describe('wizard: a failed context harvest offers Retry', () => {
    it('shows the error with a Retry button, keeps Generate off, and Retry fills the strip without touching the typed fields', async () => {
        // A chat message the harvest cannot read
        chat.push(null);
        await openWizard();

        const failedStrip = fake.htmlById['story-arc-wizard-context'];
        assert.match(failedStrip, /The chat could not be read\. Retry; if it fails again, reopen the wizard\./);
        assert.doesNotMatch(failedStrip, /is_user/);
        assert.match(failedStrip, /<button type="button" class="menu_button" id="story-arc-wizard-retry-context"/);
        assert.equal(fake.propsById['story-arc-wizard-generate'].disabled, true);

        chat.pop();
        const contentWritesBefore = fake.htmlWrites.filter(id => id === 'story-arc-wizard-content').length;
        fake.trigger('click', '#story-arc-wizard-retry-context');
        await settle();

        assert.match(fake.htmlById['story-arc-wizard-context'], /2 lorebook entries/);
        assert.equal(fake.propsById['story-arc-wizard-generate'].disabled, false);
        const contentWritesAfter = fake.htmlWrites.filter(id => id === 'story-arc-wizard-content').length;
        assert.equal(contentWritesAfter, contentWritesBefore);
    });
});

describe('wizard: generation', () => {
    it('shows a Cancel during generation that closes the wizard; the result is never shown', async () => {
        const gate = {};
        gate.promise = new Promise(resolve => { gate.release = resolve; });
        installAnswers(['The story stands at a crossroads.', granaryPlan, 'no check'], gate);
        const popup = await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();
        assert.match(fake.htmlById['story-arc-wizard-footer'], /id="story-arc-wizard-cancel"/);

        fake.trigger('click', '#story-arc-wizard-cancel');
        gate.release();
        await settle();

        assert.equal(popup.completedWith, 0);
        assert.doesNotMatch(fake.htmlById['story-arc-wizard-content'], /The Granary/);
    });

    it('announces each step in a polite live region, not the whole log', async () => {
        const gate = {};
        gate.promise = new Promise(resolve => { gate.release = resolve; });
        installAnswers(['The story stands at a crossroads.', granaryPlan, 'no check'], gate);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.match(fake.htmlById['story-arc-wizard-content'], /<p class="visually-hidden" id="story-arc-wizard-status" role="status" aria-live="polite"><\/p>/);
        assert.equal(fake.textById['story-arc-wizard-status'], 'Reading the story context…');
        gate.release();
    });

    it('reviews the plan with its foreshadowing headed Clues, never Foreshadowing', async () => {
        installAnswers(['The story stands at a crossroads.', granaryPlan, 'no check']);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        const review = fake.htmlById['story-arc-wizard-content'];
        assert.match(review, /The Granary/);
        assert.match(review, /<h4>Clues<\/h4>/);
        assert.match(review, /A torn sack behind the guild hall/);
        assert.doesNotMatch(review, /Foreshadowing/i);
    });
});

describe('wizard: Back from Review', () => {
    it('warns before discarding a generated plan: Keep stays in Review, Discard goes to Direction with the typed direction', async () => {
        installAnswers(['The story stands at a crossroads.', granaryPlan, 'no check']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        fake.trigger('click', '#story-arc-wizard-back');
        assert.match(fake.htmlById['story-arc-wizard-footer'], /Going back discards this plan\./);
        assert.match(fake.htmlById['story-arc-wizard-content'], /The Granary/);

        fake.trigger('click', '#story-arc-wizard-keep-plan');
        assert.match(fake.htmlById['story-arc-wizard-footer'], /id="story-arc-wizard-activate"/);
        assert.match(fake.htmlById['story-arc-wizard-content'], /The Granary/);

        fake.trigger('click', '#story-arc-wizard-back');
        fake.trigger('click', '#story-arc-wizard-discard-plan');
        const direction = fake.htmlById['story-arc-wizard-content'];
        assert.match(direction, /id="story-arc-direction-input"[^>]*>Count the sacks\.<\/textarea>/);
        assert.doesNotMatch(direction, /The Granary/);
    });

    it('goes straight back to Direction from a failed generation: there is no plan to lose', async () => {
        installAnswers(['The story stands at a crossroads.', 'not json', 'still not json']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();
        assert.match(fake.htmlById['story-arc-wizard-generation-error'],
            /The model&#39;s answer was not a usable plan, twice\. Retry, or pick another generation profile in the drawer\./);
        // Finished steps say what came of them
        const logText = fake.htmlById['story-arc-step-log'];
        assert.match(logText, /Story context read/);
        assert.match(logText, /Outline failed/);
        assert.match(logText, /Outline retry failed/);
        assert.equal(fake.textById['story-arc-wizard-status'], 'Writing the outline again…');
        assert.doesNotMatch(logText, /\.\.\./);

        fake.trigger('click', '#story-arc-wizard-back');

        assert.match(fake.htmlById['story-arc-wizard-content'], /id="story-arc-direction-input"/);
    });
});

describe('wizard: the re-plan premise choice', () => {
    const arc = { premise: 'The mill is haunted.', proposedPremise: 'The miller fakes the haunting.', rulings: [{ id: 'r1', text: 'No ghosts.' }] };

    it('shows each premise once: the chosen one (the proposal, since rulings were passed) in the text area, the other as text', () => {
        const html = buildPremiseChoice(arc);

        assert.equal(html.split('The mill is haunted.').length - 1, 1);
        assert.equal(html.split('The miller fakes the haunting.').length - 1, 1);
        assert.match(html, /<textarea[^>]*id="story-arc-premise-choice-text"[^>]*>The miller fakes the haunting\.<\/textarea>/);
    });

    it('moves the text area to the current premise when chosen, keeping an edited proposal as text', () => {
        const html = buildPremiseChoice(arc, 'current', { proposed: 'The miller fakes it, badly.' });

        assert.match(html, /<textarea[^>]*>The mill is haunted\.<\/textarea>/);
        assert.match(html, /<p class="story-arc-premise-option-text">The miller fakes it, badly\.<\/p>/);
    });
});

describe('wizard: harvested entry previews', () => {
    it('cut at the last whole word with an ellipsis', () => {
        assert.equal(shortenAtWord('Vera Lin agrees to the contract terms', 20), 'Vera Lin agrees to…');
        assert.equal(shortenAtWord('Short enough.', 20), 'Short enough.');
    });

    it('break at any whitespace, a line break or a tab too', () => {
        assert.equal(shortenAtWord('Vera Lin\nagrees\tto the contract', 17), 'Vera Lin\nagrees…');
    });

    it('cut text without whitespace hard, with an ellipsis', () => {
        assert.equal(shortenAtWord('https://example.com/a/very/long/path', 12), 'https://exam…');
        assert.equal(shortenAtWord('東京の夜は長くて静かだった', 5), '東京の夜は…');
    });
});

describe('wizard: failures that are not Error objects', () => {
    it('shows the failure and its controls when the transport throws a bare string', async () => {
        ConnectionManagerRequestService.sendRequest = async () => {
            throw 'connection reset';
        };
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.match(fake.htmlById['story-arc-wizard-generation-error'], /The generation profile did not answer\./);
        assert.match(fake.htmlById['story-arc-wizard-footer'], /id="story-arc-wizard-regenerate"/);
    });
});

describe('wizard: Activate', () => {
    it('stores the arc once when Activate is clicked twice before the save finished', async () => {
        installAnswers(['The story stands at a crossroads.', granaryPlan, 'no check']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        fake.trigger('click', '#story-arc-wizard-activate');
        fake.trigger('click', '#story-arc-wizard-activate');
        await settle();

        assert.deepEqual(chat_metadata.story_arc.arcs.map(arc => arc.title), ['The Granary']);
    });
});

describe('wizard: closeWizard', () => {
    it('closes an open wizard (a chat change), so it never plans from the old chat', async () => {
        const popup = await openWizard();

        closeWizard();
        await settle();

        assert.equal(popup.completedWith, 0);
    });

    it('does nothing while no wizard is open', () => {
        assert.doesNotThrow(() => closeWizard());
    });
});

describe('buildReviewStep — world facts', () => {
    function makePlan(overrides = {}) {
        return {
            title: 'The Long Winter', tier: 'act', estimatedLength: 90, tone: 'Slow dread.', themes: [],
            premise: 'The guild starves the city.',
            worldFacts: ['The guild cannot compel a volunteer.', 'The river freezes every winter.'],
            beats: [], secrets: [], foreshadowing: [], triggers: [], escalation: '',
            ...overrides,
        };
    }

    it('lists the world facts behind the Reveal switch and counts them in the hidden note', () => {
        const html = buildReviewStep(makePlan(), null);
        const planBody = html.split('class="story-arc-wizard-plan-body">')[1];
        assert.ok(planBody.startsWith('<section><h4>Premise</h4><p>The guild starves the city.</p></section>'
            + '<section><h4>World facts</h4><ul><li>The guild cannot compel a volunteer.</li><li>The river freezes every winter.</li></ul></section>'), planBody);
        assert.ok(html.includes('Hidden: the premise and 2 world facts. Revealing it may spoil the story for you as a player.'));
        assert.equal(html.split('class="story-arc-wizard-plan-body">')[0].includes('The river freezes every winter.'), false);
    });

    it('shows no world-facts section for a plan without any', () => {
        const html = buildReviewStep(makePlan({ worldFacts: [] }), null);
        assert.equal(html.includes('World facts'), false);
        assert.ok(html.includes('Hidden: the premise. Revealing it'));
    });
});
