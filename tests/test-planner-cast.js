import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { formatCastBlock, generateArc, clearTemplateCache } from '../lib/planning/generator.js';

// The planner sees the story's cast and the taken names (issue #44).

const CAST_OF_TWO = [
    { name: 'Julian Sterling', aliases: ['Jules'] },
    { name: 'Priya', aliases: [] },
];

describe('formatCastBlock', () => {
    it('lists the cast with aliases, the taken names and the two rules', () => {
        assert.equal(formatCastBlock(CAST_OF_TWO, 'outline'), `== CAST (characters already in the story) ==
These characters are already in the story. Each line gives the name, then the aliases:

- Julian Sterling (aliases: Jules)
- Priya

Names already taken: Jules, Julian, Priya, Sterling

Two rules for every name in the plan:
1. Name an existing character exactly as listed above, everywhere in the plan: secrets and their holders, pressures, fulfillments, triggers, foreshadowing, world facts and the characters list.
2. A new character gets none of the taken names as a first name or surname, unless the plan makes them related to the character who has it and says so.

`);
    });

    it('points the checklist line to the cast block', () => {
        assert.equal(formatCastBlock(CAST_OF_TWO, 'checklist'),
            ', spelled as the CAST block lists them; no new character has a taken name as a first name or surname unless the plan makes them related and says so');
    });

    it('is empty for an empty cast', () => {
        assert.equal(formatCastBlock([], 'outline'), '');
        assert.equal(formatCastBlock([], 'checklist'), '');
    });
});

describe('generate-arc.txt carries the cast slots', () => {
    const outlineTemplate = readFileSync(new URL('../prompts/generate-arc.txt', import.meta.url), 'utf8');

    it('puts the cast block after the genre block, before the creative direction', () => {
        assert.ok(outlineTemplate.includes('{{GENRE_BLOCK}}{{CAST_BLOCK}}== AUTHOR\'S CREATIVE DIRECTION =='));
    });

    it('ends the checklist line on existing characters\' names with the cast slot', () => {
        assert.ok(outlineTemplate.includes('- [ ] Existing characters are named exactly as the story names them{{CAST_CHECKLIST}}\n'));
    });
});

describe('generateArc: the outline prompt carries the cast', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;

    // Minimal templates: the outline keeps only the placeholders around the
    // cast, so the whole prompt can be compared with a literal.
    const MINIMAL_TEMPLATES = {
        'analyze-context.txt': 'ANALYSE',
        'generate-arc.txt': 'ANALYSIS: {{PHASE1_ANALYSIS}}\n{{GENRE_BLOCK}}{{CAST_BLOCK}}== DIRECTION ==\n{{USER_DIRECTION}}\n- [ ] Existing characters are named exactly as the story names them{{CAST_CHECKLIST}}\n',
        'check-plan.txt': 'CHECK\nSECRETS:\n{{SECRETS}}\n\n{{NAMES_BLOCK}}ANSWER',
    };

    const generatedPlan = JSON.stringify({
        title: 'The Quiet Debt',
        premise: 'A debt comes due.',
        beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
        secrets: [],
        triggers: [],
    });
    const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [] });

    function harvestedContext(cast) {
        return {
            character: null,
            persona: { name: '', description: '' },
            lorebook: { constants: [], arcSummaries: [], recent: [] },
            chatHistory: [],
            existingArcs: [],
            cast,
        };
    }

    /** Serve the minimal templates, answer each call with the next text, record the prompts. */
    function installBackend(answers) {
        const sentPrompts = [];
        globalThis.fetch = async (url) => new Response(MINIMAL_TEMPLATES[String(url).split('/').pop()]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
        return sentPrompts;
    }

    beforeEach(() => {
        clearTemplateCache();
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    it('with a cast, the outline prompt carries the cast block and the checklist points to it; three calls', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext(CAST_OF_TWO), 'She pays.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        assert.equal(sentPrompts[1], `ANALYSIS: The story stands still.
== CAST (characters already in the story) ==
These characters are already in the story. Each line gives the name, then the aliases:

- Julian Sterling (aliases: Jules)
- Priya

Names already taken: Jules, Julian, Priya, Sterling

Two rules for every name in the plan:
1. Name an existing character exactly as listed above, everywhere in the plan: secrets and their holders, pressures, fulfillments, triggers, foreshadowing, world facts and the characters list.
2. A new character gets none of the taken names as a first name or surname, unless the plan makes them related to the character who has it and says so.

== DIRECTION ==
She pays.
- [ ] Existing characters are named exactly as the story names them, spelled as the CAST block lists them; no new character has a taken name as a first name or surname unless the plan makes them related and says so
`);
    });

    it('the plan check renames a new character with a taken name everywhere; the check prompt carries the names block; three calls', async () => {
        const planWithCollision = JSON.stringify({
            title: 'The Quiet Debt',
            premise: 'A debt comes due.',
            beats: [{ id: 'ledger', pressure: 'Julian Hale wants the ledger by dawn.', intention: 'She has read the ledger.' }],
            secrets: [{ id: 'forged', content: 'Julian Hale forged the ledger.', revealPhase: 'climax', holders: ['Julian Hale'] }],
            triggers: [],
            characters: ['Julian Hale', 'Priya'],
        });
        const renamingAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [], renames: [{ from: 'Julian Hale', to: 'Owen Hale' }] });
        const sentPrompts = installBackend(['The story stands still.', planWithCollision, renamingAnswer]);

        const result = await generateArc(harvestedContext(CAST_OF_TWO), 'She pays.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        assert.equal(result.arc.secrets[0].content, 'Owen Hale forged the ledger.');
        assert.deepEqual(result.arc.secrets[0].holders, ['Owen Hale']);
        assert.equal(result.arc.beats[0].pressure, 'Owen Hale wants the ledger by dawn.');
        assert.deepEqual(result.arc.characters, ['Owen Hale', 'Priya']);
        assert.equal(sentPrompts[2], `CHECK
SECRETS:
- [forged] (climax) Julian Hale forged the ledger.

== NAMES ==
The cast, the characters already in the story. Each line gives the name, then the aliases:

- Julian Sterling (aliases: Jules)
- Priya

Names already taken: Jules, Julian, Priya, Sterling

The plan's own list of characters. It can be incomplete: the secrets, triggers, pressures and fulfillments above name characters too.

- Julian Hale
- Priya

RENAMES. For each character the plan names, decide whether it is a cast member or a new character.
- A cast member named differently from the cast (a changed surname, another spelling) is renamed to the cast's name.
- A new character whose first name or surname is a taken name, and whom the plan does not make related to the character who has it, is renamed to a full name that uses no taken name.
- A name that extends a cast name by one more name ("Julian Vance" for the cast's "Vance") may be that cast member. Leave it unless the plan makes clear it is someone else.
- Never rename a character the author's direction names.
- Give one pair for each form the plan uses for the character: the full name, and any short form that means that character alone in this plan.
Answer the renames as one more key of the JSON object below: "renames": [{ "from": "the name as the plan writes it", "to": "the new name" }]. An empty list is fine.

ANSWER`);
    });

    it('a re-plan never renames the player\'s title: a rename of a name in it is dropped everywhere', async () => {
        const planWithCollision = JSON.stringify({
            title: 'Generated Title',
            premise: 'Julian Hale wants the ledger.',
            beats: [{ id: 'ledger', pressure: 'Julian Hale wants the ledger by dawn.', intention: 'She has read the ledger.' }],
            secrets: [],
            triggers: [],
        });
        const renamingAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [], renames: [{ from: 'Julian Hale', to: 'Owen Hale' }] });
        installBackend(['The story stands still.', planWithCollision, renamingAnswer]);
        const reviseArc = {
            id: 'arc-debt', title: 'The Julian Hale Affair', premise: 'A debt comes due.', direction: '',
            status: 'active', tier: 'episode', focus: 'normal', messageStart: 0, lastFulfilledAt: 0, estimatedLength: 20,
            secrets: [], foreshadowing: [], triggers: [], beats: [], rulings: [],
        };

        const result = await generateArc(harvestedContext(CAST_OF_TWO), '', {}, { reviseArc });

        assert.equal(result.error, null);
        assert.equal(result.arc.title, 'The Julian Hale Affair');
        assert.equal(result.arc.beats[0].pressure, 'Julian Hale wants the ledger by dawn.');
    });

    it('with an empty cast, the check prompt is today\'s', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        await generateArc(harvestedContext([]), 'She pays.');

        assert.equal(sentPrompts[2], 'CHECK\nSECRETS:\n(none)\n\nANSWER');
    });

    it('with an empty cast, the outline prompt is today\'s; three calls', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext([]), 'She pays.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        assert.equal(sentPrompts[1], `ANALYSIS: The story stands still.
== DIRECTION ==
She pays.
- [ ] Existing characters are named exactly as the story names them
`);
    });
});
