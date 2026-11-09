import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPremiseChoice, buildReviewStep, buildSecretChoices, closeWizard, shortenAtWord } from '../lib/ui/wizard.js';
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
        if (String(url).endsWith('ask-questions.txt')) return new Response('ASK');
        if (String(url).endsWith('generate-arc.txt')) return new Response('OUTLINE\n{{AUTHOR_ANSWERS_BLOCK}}END');
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

/** The question call's answer when the direction leaves nothing open. */
const NO_QUESTIONS = '{ "questions": [] }';

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
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check'], gate);
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
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check'], gate);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.match(fake.htmlById['story-arc-wizard-content'], /<p class="visually-hidden" id="story-arc-wizard-status" role="status" aria-live="polite"><\/p>/);
        assert.equal(fake.textById['story-arc-wizard-status'], 'Reading the story context…');
        gate.release();
    });

    it('reviews the plan with its foreshadowing headed Clues, never Foreshadowing', async () => {
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check']);
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
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check']);
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
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, 'not json', 'still not json']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();
        assert.match(fake.htmlById['story-arc-wizard-generation-error'],
            /The model&#39;s answer was not a usable plan, twice\. Retry, or pick another generation profile in the drawer\./);
        // Finished steps say what came of them
        const logText = fake.htmlById['story-arc-step-log'];
        assert.match(logText, /Story context read/);
        assert.match(logText, /Direction checked for open questions/);
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

describe('wizard: the re-plan choice per proposed secret', () => {
    function makeMergedArc() {
        return {
            title: 'The Mill',
            tier: 'act',
            premise: 'The mill is haunted.',
            secrets: [
                { id: 'miller_deed', content: 'The deed orders the miller to grind for the baron.', proposedContent: 'The baron holds the miller\'s debts.', revealPhase: 'climax', disclosed: false },
                { id: 'flour_theft', content: 'The apprentice steals flour.', revealPhase: 'escalation', disclosed: false },
            ],
            foreshadowing: [
                { id: 'seal', clue: 'A wax seal on the mill door.', target: 'secret:miller_deed', planted: true },
                { id: 'ledger', clue: 'The baron\'s ledger lies open.', target: 'secret:miller_deed', planted: false },
            ],
            beats: [],
            triggers: [],
        };
    }

    it('shows the stored text, the proposal and the planted clue, with keep chosen', () => {
        const html = buildSecretChoices(makeMergedArc());

        assert.equal(html.match(/<fieldset/g).length, 1);
        assert.match(html, /<fieldset class="story-arc-wizard-secret-choice" data-secret-id="miller_deed">/);
        assert.match(html, /<input type="radio" name="story-arc-secret-choice-miller_deed" value="keep" checked> <b>Keep the stored wording<\/b>/);
        assert.match(html, /<input type="radio" name="story-arc-secret-choice-miller_deed" value="take" > <b>Take the new wording<\/b>/);
        assert.ok(html.includes('<p class="story-arc-premise-option-text">The deed orders the miller to grind for the baron.</p>'));
        assert.ok(html.includes('<p class="story-arc-premise-option-text">The baron holds the miller&#39;s debts.</p>'));
        assert.ok(html.includes('<ul><li>A wax seal on the mill door.</li></ul>'));
        assert.equal(html.includes('The baron&#39;s ledger lies open.'), false);
        assert.equal(html.includes('The apprentice steals flour.'), false);
    });

    it('renders nothing when no secret carries a proposal', () => {
        const arc = makeMergedArc();
        delete arc.secrets[0].proposedContent;

        assert.equal(buildSecretChoices(arc), '');
    });

    it('puts the choice behind the Reveal switch and counts it in the hidden note', () => {
        const arc = makeMergedArc();
        const html = buildReviewStep(arc, { id: 'arc-1' });

        const planBody = html.slice(html.indexOf('<div class="story-arc-wizard-plan-body">'));
        assert.ok(planBody.includes('data-secret-id="miller_deed"'));
        assert.equal(html.indexOf('data-secret-id="miller_deed"') > html.indexOf('<div class="story-arc-wizard-plan-body">'), true);
        assert.ok(html.includes('Hidden: 2 secrets and 2 clues. Revealing it may spoil the story for you as a player. 1 secret has new wording proposed; each keeps its wording unless you reveal the plan and take it.'));
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
        installAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check']);
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

describe('wizard: genre and themes on the Direction step', () => {
    function storedArc(overrides = {}) {
        return {
            id: 'arc00001-full-id', title: 'The Granary', status: 'active', tier: 'episode', focus: 'normal',
            messageStart: 0, lastFulfilledAt: 0, estimatedLength: 20, direction: 'Count the sacks.',
            premise: 'The valley is starving.', tone: '', themes: [], directives: [], antiPatterns: [], worldFacts: [],
            secrets: [], foreshadowing: [], triggers: [], characters: [], escalation: '',
            beats: [{ id: 'empty_carts', pressure: 'Carts leave at night.', intention: 'The tally was found short.', status: 'active' }],
            ...overrides,
        };
    }

    it('shows the two hints word for word', async () => {
        await openWizard();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('Binding for planning: the arc reads as this genre, even where the story\'s summaries lean elsewhere. Keep it short, e.g. "Superhero drama". The narrator never sees it. Leave blank for none.'));
        assert.ok(html.includes('Themes that may colour the arc where the premise and your direction leave room. None of them must appear. The planner grows the arc\'s themes from them, shown as "What\'s it about?" on the next step. The narrator never sees them. Leave blank for none.'));
    });

    it('hides the mixed-genre note for a genre without a comma', async () => {
        chat_metadata.story_arc.arcs = [storedArc({ genre: 'Superhero drama' })];

        await openWizard();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('<p class="story-arc-wizard-help" id="story-arc-genre-mixed" hidden>\n                        This genre lists several words. Keep the genre itself here and move the rest to Themes.\n                    </p>'));
    });

    it('shows the mixed-genre note for a prefilled genre with a comma, and keeps the genre as stored', async () => {
        chat_metadata.story_arc.arcs = [storedArc({ genre: 'Superhero drama, corruption, political thriller' })];

        await openWizard();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('<p class="story-arc-wizard-help" id="story-arc-genre-mixed">\n                        This genre lists several words.'));
        assert.ok(html.includes('>Superhero drama, corruption, political thriller</textarea>'));
        assert.equal(chat_metadata.story_arc.arcs[0].genre, 'Superhero drama, corruption, political thriller');
    });

    it('shows the mixed-genre note on a re-plan of an arc with a comma in its genre', async () => {
        chat_metadata.story_arc.arcs = [storedArc({ genre: 'Cozy mystery, found family' })];

        showWizard('arc00001-full-id');
        await settle();

        assert.ok(fake.htmlById['story-arc-wizard-content'].includes('<p class="story-arc-wizard-help" id="story-arc-genre-mixed">\n'));
    });

    it('shows the note when a comma is typed into the genre and hides it when it is gone', async () => {
        await openWizard();

        fake.trigger('input', '#story-arc-genre-input', { value: 'Superhero drama, corruption' });
        assert.equal(fake.propsById['story-arc-genre-mixed'].hidden, false);

        fake.trigger('input', '#story-arc-genre-input', { value: 'Superhero drama' });
        assert.equal(fake.propsById['story-arc-genre-mixed'].hidden, true);
    });

    it('a new arc starts from the newest arc\'s genre and the newest arc\'s themes', async () => {
        chat_metadata.story_arc.arcs = [
            storedArc({ id: 'arc00001-full-id', genre: 'Cozy mystery', themeSeeds: 'found family' }),
            storedArc({ id: 'arc00002-full-id', status: 'completed', genre: 'Superhero drama, corruption, sexual deviancy' }),
            storedArc({ id: 'arc00003-full-id', status: 'completed', themeSeeds: 'corruption, political intrigue' }),
        ];

        await openWizard();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('>Superhero drama, corruption, sexual deviancy</textarea>'));
        assert.ok(html.includes('placeholder="e.g. guild politics, banter around the campfire, the price of fame"\n                >corruption, political intrigue</textarea>'));
    });

    it('a re-plan starts from the arc\'s own genre and themes, not the newest arc\'s', async () => {
        chat_metadata.story_arc.arcs = [
            storedArc({ genre: 'Cozy mystery', themeSeeds: 'found family' }),
            storedArc({ id: 'arc00002-full-id', status: 'completed', genre: 'Space opera', themeSeeds: 'the price of fame' }),
        ];

        showWizard('arc00001-full-id');
        await settle();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('>Cozy mystery</textarea>'));
        assert.ok(html.includes('>found family</textarea>'));
        assert.equal(html.includes('the price of fame</textarea>'), false);
    });
});

describe('buildReviewStep — the planner\'s themes', () => {
    it('heads the planner\'s themes "What\'s it about?"', () => {
        const plan = {
            title: 'The Long Winter', tier: 'act', estimatedLength: 90, tone: 'Slow dread.',
            themes: ['the cost of loyalty', 'hunger as a weapon'],
            premise: 'The guild starves the city.', worldFacts: [],
            beats: [], secrets: [], foreshadowing: [], triggers: [], escalation: '',
        };
        const html = buildReviewStep(plan, null);
        assert.ok(html.includes('<span class="story-arc-wizard-muted">What\'s it about?</span> the cost of loyalty, hunger as a weapon</p>'));
        assert.equal(html.includes('Themes:'), false);
    });
});

describe('wizard: the Questions step', () => {
    const pressureQuestions = JSON.stringify({ questions: [
        { question: 'How does the pressure work?', suggestions: ['Open force', 'Deniable hints nobody admits'] },
        { question: 'Can an ally talk a dilemma away?', suggestions: ['Yes, sometimes', 'No, nobody rescues'] },
    ] });
    const answersBlockForPressure = `== AUTHOR'S ANSWERS (binding, like the direction) ==
Q: How does the pressure work?
A: Deniable hints nobody admits

These are the author's own words about this arc, and they bind like the direction: where an answer and the genre, the themes or your own preference disagree, the answer wins.

`;

    /** The transport, recording every prompt sent. */
    function installRecordedAnswers(answers) {
        const sentPrompts = [];
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
        return sentPrompts;
    }

    function storedArc(overrides = {}) {
        return {
            id: 'arc00001-full-id', title: 'The Granary', status: 'active', tier: 'episode', focus: 'normal',
            messageStart: 0, lastFulfilledAt: 0, estimatedLength: 20, direction: 'Count the sacks.',
            premise: 'The valley is starving.', tone: '', themes: [], directives: [], antiPatterns: [], worldFacts: [],
            secrets: [], foreshadowing: [], triggers: [], characters: [], escalation: '',
            beats: [{ id: 'empty_carts', pressure: 'Carts leave at night.', intention: 'The tally was found short.', status: 'active' }],
            ...overrides,
        };
    }

    it('without questions the flow is as before: two steps, straight on to Review, Phase 1 once', async () => {
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check']);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.deepEqual(sentPrompts, ['ANALYZE', 'ASK', 'OUTLINE\nEND', 'CHECK']);
        assert.match(fake.htmlById['story-arc-wizard-content'], /The Granary/);
        const steps = fake.htmlById['story-arc-wizard-steps'];
        assert.ok(steps.includes('<li id="story-arc-wizard-step-review" aria-current="step"><span class="story-arc-wizard-step-number">2</span>Review</li>'));
        assert.equal(steps.includes('Questions'), false);
        const logText = fake.htmlById['story-arc-step-log'];
        assert.match(logText, /Story context read/);
        assert.match(logText, /Direction checked for open questions/);
        assert.match(logText, /Outline written/);
    });

    it('a question call answering garbage goes straight on to planning', async () => {
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', 'I would ask about the tone.', granaryPlan, 'no check']);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.equal(sentPrompts.length, 4);
        assert.match(fake.htmlById['story-arc-wizard-content'], /The Granary/);
    });

    it('shows the questions with their suggestions as buttons, the help line, and three steps', async () => {
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', pressureQuestions]);
        await openWizard();

        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.deepEqual(sentPrompts, ['ANALYZE', 'ASK']);
        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('<p class="story-arc-wizard-help story-arc-wizard-lead">Your answers steer the plan as strongly as your direction. They are never shown to the narrator. Leave any blank.</p>'));
        assert.ok(html.includes('<label class="story-arc-wizard-label" for="story-arc-answer-0">How does the pressure work?</label>'));
        assert.ok(html.includes('<button type="button" class="menu_button story-arc-wizard-answer-chip" data-question-index="0" data-suggestion-index="1">Deniable hints nobody admits</button>'));
        assert.ok(html.includes('<button type="button" class="menu_button story-arc-wizard-answer-chip" data-question-index="1" data-suggestion-index="0">Yes, sometimes</button>'));
        assert.ok(html.includes('<textarea class="text_pole" id="story-arc-answer-1" rows="2"></textarea>'));
        assert.equal(html.includes('Your earlier answers'), false);

        const steps = fake.htmlById['story-arc-wizard-steps'];
        assert.ok(steps.includes('<li id="story-arc-wizard-step-questions" aria-current="step"><span class="story-arc-wizard-step-number">2</span>Questions</li>'));
        assert.ok(steps.includes('<li id="story-arc-wizard-step-review"><span class="story-arc-wizard-step-number">3</span>Review</li>'));

        const footer = fake.htmlById['story-arc-wizard-footer'];
        assert.match(footer, /id="story-arc-wizard-cancel"/);
        assert.match(footer, /id="story-arc-wizard-back"/);
        assert.match(footer, /id="story-arc-wizard-plan-arc"[^]*Plan the arc/);
    });

    it('a suggestion fills its question\'s answer box', async () => {
        installRecordedAnswers(['The story stands at a crossroads.', pressureQuestions]);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        fake.trigger('click', '.story-arc-wizard-answer-chip', { data: { 'question-index': 1, 'suggestion-index': 1 } });

        assert.equal(fake.valueById['story-arc-answer-1'], 'No, nobody rescues');
    });

    it('Plan the arc plans from the same analysis with the answers given, and Activate stores them; a blank one is left out', async () => {
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', pressureQuestions, granaryPlan, 'no check']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        fake.valueById['story-arc-answer-0'] = ' Deniable hints nobody admits ';
        fake.valueById['story-arc-answer-1'] = '   ';
        fake.trigger('click', '#story-arc-wizard-plan-arc');
        await settle();

        assert.deepEqual(sentPrompts, ['ANALYZE', 'ASK', `OUTLINE\n${answersBlockForPressure}END`, 'CHECK']);
        assert.match(fake.htmlById['story-arc-wizard-content'], /The Granary/);
        assert.ok(fake.htmlById['story-arc-wizard-steps'].includes('<li id="story-arc-wizard-step-review" aria-current="step"><span class="story-arc-wizard-step-number">3</span>Review</li>'));

        fake.trigger('click', '#story-arc-wizard-activate');
        await settle();

        assert.deepEqual(chat_metadata.story_arc.arcs[0].authorAnswers, [{ question: 'How does the pressure work?', answer: 'Deniable hints nobody admits' }]);
    });

    it('Regenerate plans again with the same analysis and answers; Back from Review returns to the Questions with the answers', async () => {
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', pressureQuestions, granaryPlan, 'no check', granaryPlan, 'no check']);
        await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();
        fake.valueById['story-arc-answer-0'] = 'Deniable hints nobody admits';
        fake.trigger('click', '#story-arc-wizard-plan-arc');
        await settle();

        fake.trigger('click', '#story-arc-wizard-regenerate');
        await settle();

        assert.deepEqual(sentPrompts.slice(4), [`OUTLINE\n${answersBlockForPressure}END`, 'CHECK']);

        fake.trigger('click', '#story-arc-wizard-back');
        fake.trigger('click', '#story-arc-wizard-discard-plan');

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('<textarea class="text_pole" id="story-arc-answer-0" rows="2">Deniable hints nobody admits</textarea>'));
        assert.match(fake.htmlById['story-arc-wizard-footer'], /id="story-arc-wizard-plan-arc"/);
    });

    it('Back from the Questions returns to Direction with the typed direction; Cancel there stores nothing', async () => {
        installRecordedAnswers(['The story stands at a crossroads.', pressureQuestions]);
        const popup = await openWizard();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        fake.trigger('click', '#story-arc-wizard-back');

        assert.match(fake.htmlById['story-arc-wizard-content'], /id="story-arc-direction-input"[^>]*>Count the sacks\.<\/textarea>/);
        assert.ok(fake.htmlById['story-arc-wizard-steps'].includes('<li id="story-arc-wizard-step-direction" aria-current="step"><span class="story-arc-wizard-step-number">1</span>Direction</li>'));

        fake.trigger('click', '#story-arc-wizard-cancel');
        await settle();

        assert.equal(popup.completedWith, 0);
        assert.deepEqual(chat_metadata.story_arc.arcs, []);
    });

    it('a re-plan shows the arc\'s earlier answers first, editable, and stores the answers as edited', async () => {
        chat_metadata.story_arc.arcs = [storedArc({ authorAnswers: [{ question: 'Who may rescue her?', answer: 'Nobody.' }] })];
        const oneQuestion = JSON.stringify({ questions: [{ question: 'How does the pressure work?', suggestions: ['Open force', 'Deniable hints nobody admits'] }] });
        installRecordedAnswers(['The story stands at a crossroads.', oneQuestion, granaryPlan, 'no check']);

        showWizard('arc00001-full-id');
        await settle();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        const html = fake.htmlById['story-arc-wizard-content'];
        assert.ok(html.includes('<h4 class="story-arc-wizard-questions-group">Your earlier answers</h4>'));
        assert.ok(html.includes('<label class="story-arc-wizard-label" for="story-arc-answer-0">Who may rescue her?</label>\n                <textarea class="text_pole" id="story-arc-answer-0" rows="2">Nobody.</textarea>'));
        assert.ok(html.indexOf('Your earlier answers') < html.indexOf('<h4 class="story-arc-wizard-questions-group">New questions</h4>'));
        assert.ok(html.indexOf('New questions') < html.indexOf('How does the pressure work?'));

        fake.valueById['story-arc-answer-0'] = 'Nobody, ever.';
        fake.valueById['story-arc-answer-1'] = 'Open force';
        fake.trigger('click', '#story-arc-wizard-plan-arc');
        await settle();
        fake.valueById['story-arc-premise-choice-text'] = 'The valley is starving.';
        fake.trigger('click', '#story-arc-wizard-activate');
        await settle();

        assert.deepEqual(chat_metadata.story_arc.arcs[0].authorAnswers, [
            { question: 'Who may rescue her?', answer: 'Nobody, ever.' },
            { question: 'How does the pressure work?', answer: 'Open force' },
        ]);
    });

    it('a re-plan without new questions plans with the arc\'s earlier answers and keeps them', async () => {
        chat_metadata.story_arc.arcs = [storedArc({ authorAnswers: [{ question: 'Who may rescue her?', answer: 'Nobody.' }] })];
        const sentPrompts = installRecordedAnswers(['The story stands at a crossroads.', NO_QUESTIONS, granaryPlan, 'no check']);

        showWizard('arc00001-full-id');
        await settle();
        typeDirectionAndGenerate('Count the sacks.');
        await settle();

        assert.ok(sentPrompts[2].startsWith('OUTLINE\n== AUTHOR\'S ANSWERS (binding, like the direction) ==\nQ: Who may rescue her?\nA: Nobody.\n\n'));
        fake.valueById['story-arc-premise-choice-text'] = 'The valley is starving.';
        fake.trigger('click', '#story-arc-wizard-activate');
        await settle();

        assert.deepEqual(chat_metadata.story_arc.arcs[0].authorAnswers, [{ question: 'Who may rescue her?', answer: 'Nobody.' }]);
    });
});
