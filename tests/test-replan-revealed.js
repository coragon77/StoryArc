import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { generateArc, clearTemplateCache, markSecretsRevealedOnScreen, secretIdsRevealedOnScreen } from '../lib/planning/generator.js';
import { chat_metadata } from './mocks/st-mocks.js';

// On a re-plan a secret is revealed when it is disclosed or a knowledge
// ledger fact links to it: the extraction never sets the flag. A plan check
// that cannot say what came out keeps every earlier secret as stored.

const promptsDir = new URL('../prompts/', import.meta.url);
const read = name => readFileSync(new URL(name, promptsDir), 'utf8');

/** An episode with one secret the ledger saw come out and one still hidden. */
function storedEpisode() {
    return {
        id: 'arc-1', title: 'The Quiet Debt', status: 'active', tier: 'episode', focus: 'normal',
        messageStart: 100, lastFulfilledAt: 130, direction: '', premise: 'A debt comes due.',
        themes: [], tone: '', directives: [], antiPatterns: [], worldFacts: [],
        secrets: [
            { id: 'forged_ledger', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: ['Tomas'] },
            { id: 'brother_ill', content: 'The brother is ill.', revealPhase: 'climax', disclosed: false, holders: [] },
        ],
        foreshadowing: [], triggers: [], characters: [], estimatedLength: 14,
        beats: [{ id: 'summons', intention: 'She has received the summons.', status: 'active', unlockAfter: [] }],
    };
}

/** A ledger with a fact the forged_ledger secret became on screen, and one of another arc. */
function ledgerWithReveal() {
    return {
        characters: [],
        facts: [
            { id: 'f1', text: 'The ledger was forged.', public: false, secret: { arcId: 'arc-1', secretId: 'forged_ledger' }, holders: [] },
            { id: 'f2', text: 'The brother is ill.', public: false, secret: { arcId: 'arc-2', secretId: 'brother_ill' }, holders: [] },
            { id: 'f3', text: 'The mill is closed.', public: true, holders: [] },
        ],
    };
}

describe('secretIdsRevealedOnScreen and markSecretsRevealedOnScreen', () => {
    it('lists the arc\'s secrets a ledger fact links to, never another arc\'s', () => {
        assert.deepEqual(secretIdsRevealedOnScreen(storedEpisode(), ledgerWithReveal()), ['forged_ledger']);
    });

    it('lists none without a ledger or facts', () => {
        assert.deepEqual(secretIdsRevealedOnScreen(storedEpisode(), undefined), []);
        assert.deepEqual(secretIdsRevealedOnScreen(storedEpisode(), { facts: [] }), []);
    });

    it('marks those secrets disclosed on a copy', () => {
        const arc = storedEpisode();

        const marked = markSecretsRevealedOnScreen(arc, ['forged_ledger']);

        assert.deepEqual(marked.secrets.map(secret => [secret.id, secret.disclosed]), [['forged_ledger', true], ['brother_ill', false]]);
        assert.equal(arc.secrets[0].disclosed, false);
    });
});

describe('generateArc: a re-plan\'s revealed secrets', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        clearTemplateCache();
    });

    /** Serve the real prompt templates; answer each call with the next text. */
    function installBackend(answers) {
        const sentPrompts = [];
        globalThis.fetch = async (url) => new Response(read(String(url).split('/').pop()));
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
        return sentPrompts;
    }

    function context(storedArc) {
        return {
            character: null,
            persona: { name: '', description: '' },
            lorebook: { constants: [], arcSummaries: [], recent: [] },
            chatHistory: [],
            existingArcs: [storedArc],
        };
    }

    /** The planner rewrites both secrets under their ids and adds one. */
    const generatedPlan = JSON.stringify({
        title: 'Model title',
        premise: 'A debt comes due.',
        beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
        secrets: [
            { id: 'forged_ledger', content: 'The brother forged the ledger.' },
            { id: 'brother_ill', content: 'The brother is dying.' },
            { id: 'clerk_paid', content: 'The clerk is paid by the creditor.' },
        ],
        triggers: [],
        worldFacts: [],
    });

    it('keeps a secret the ledger saw come out as established, though it was never marked disclosed', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        const storedArc = storedEpisode();
        chat_metadata.story_arc = { version: 1, arcs: [storedArc], settings: {}, knowledge: ledgerWithReveal() };
        const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [{ kind: 'secret', id: 'forged_ledger', text: 'Somebody forged the ledger.' }], links: [] });
        // The planner never restates an established secret: it rewrites the
        // hidden one and adds one.
        const replan = JSON.stringify({
            ...JSON.parse(generatedPlan),
            secrets: [
                { id: 'brother_ill', content: 'The brother is dying.' },
                { id: 'clerk_paid', content: 'The clerk is paid by the creditor.' },
            ],
        });
        const sentPrompts = installBackend(['The ledger came out in the square.', replan, planCheckAnswer]);

        const result = await generateArc(context(storedArc), '', {}, { reviseArc: storedArc });

        assert.equal(result.error, null);
        assert.ok(sentPrompts[1].includes('Secrets already revealed (established, do not restate):\n- The ledger is forged.\n\n'), sentPrompts[1]);
        assert.ok(sentPrompts[1].includes('so it still explains them):\n- [brother_ill] The brother is ill.\n\n'), sentPrompts[1]);
        assert.deepEqual(result.arc.secrets, [
            { id: 'forged_ledger', content: 'The ledger is forged.', revealPhase: 'any', disclosed: true, holders: ['Tomas'] },
            { id: 'brother_ill', content: 'The brother is dying.', revealPhase: 'any', disclosed: false, holders: [] },
            { id: 'clerk_paid', content: 'The clerk is paid by the creditor.', revealPhase: 'any', disclosed: false, holders: [] },
        ]);
        // The stored arc is not touched before the player applies.
        assert.equal(storedArc.secrets[0].disclosed, false);
    });

    it('keeps every earlier secret as stored and adds the new one when the check answers no JSON', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        const storedArc = storedEpisode();
        chat_metadata.story_arc = { version: 1, arcs: [storedArc], settings: {} };
        installBackend(['The story stands still.', generatedPlan, 'I could not check this plan.']);
        const originalWarn = console.warn;
        const warnings = [];
        console.warn = message => warnings.push(message);
        let result;
        try {
            result = await generateArc(context(storedArc), '', {}, { reviseArc: storedArc });
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(result.error, null);
        assert.deepEqual(result.arc.secrets, [
            { id: 'forged_ledger', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: ['Tomas'] },
            { id: 'brother_ill', content: 'The brother is ill.', revealPhase: 'climax', disclosed: false, holders: [] },
            { id: 'clerk_paid', content: 'The clerk is paid by the creditor.', revealPhase: 'any', disclosed: false, holders: [] },
        ]);
        assert.ok(warnings.includes('[Story Arc] Re-plan keeps every earlier secret as stored: the plan check gave no revealed list'), warnings.join('\n'));
    });

    it('keeps every earlier secret as stored when the check call throws', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        const storedArc = storedEpisode();
        chat_metadata.story_arc = { version: 1, arcs: [storedArc], settings: {} };
        const answers = ['The story stands still.', generatedPlan];
        globalThis.fetch = async (url) => new Response(read(String(url).split('/').pop()));
        ConnectionManagerRequestService.sendRequest = async () => {
            if (!answers.length) throw new Error('backend down');
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
        const originalWarn = console.warn;
        console.warn = () => {};
        let result;
        try {
            result = await generateArc(context(storedArc), '', {}, { reviseArc: storedArc });
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(result.error, null);
        assert.deepEqual(result.arc.secrets.map(secret => [secret.id, secret.content]), [
            ['forged_ledger', 'The ledger is forged.'],
            ['brother_ill', 'The brother is ill.'],
            ['clerk_paid', 'The clerk is paid by the creditor.'],
        ]);
    });
});
