import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillTemplate } from '../lib/planning/generator.js';
import {
    applyExtractionAnswer,
    buildKnowledgeBlock,
    buildKnowledgeExtractionVariables,
    listChangeItems,
    parseKnowledgeExtractionAnswer,
} from '../lib/knowledge/ledger.js';

/** Ellie and Vera, both in the scene, with no standing state yet. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Ellie Masters', aliases: ['Ellie'] },
            { id: 'c2', name: 'Vera Lin', aliases: ['Vera'] },
            { id: 'c3', name: 'Gabriel Marin', aliases: ['Gabriel'] },
        ],
        facts: [],
        scene: { at: 10, present: ['c1', 'c2'] },
        sceneHistory: [],
        lastUpdatedAt: 10,
    };
}

/** An answer with nothing in it but the given details. */
function answerWithDetails(details) {
    return { present: ['Ellie', 'Vera'], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details };
}

/** Message 11 from the player, message 12 from the narrator, each with its Story Arc message id. */
function makeChat() {
    const chatMessages = [];
    chatMessages[11] = { name: 'Ellie', is_user: true, mes: '"Keep the skirt." [OOC: Vera is still soft and eager to please.]', extra: { story_arc_message_id: 'm11' } };
    chatMessages[12] = { name: 'Narrator', is_user: false, mes: 'Vera folded the prefect blazer into the bin. "I\'m not going back to the uniform," she said.', extra: { story_arc_message_id: 'm12' } };
    return chatMessages;
}

describe('applyExtractionAnswer — standing state', () => {
    it('sets a style whose quote is in the message, anchored to that message', () => {
        const ledger = makeLedger();
        const counts = {};

        const changed = applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'style', value: 'fitted and feminine; no longer the uniform', quote: "I'm not going back to the uniform", at: 12 },
        ]), 11, 12, makeChat(), counts);

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters[1].details, {
            style: [{ value: 'fitted and feminine; no longer the uniform', at: 12, messageId: 'm12' }],
        });
        assert.equal(counts.detailsSet, 1);
    });

    it('drops a state item whose quote is in no covered message, and counts it', () => {
        const ledger = makeLedger();
        const counts = {};

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'manner', value: 'strict and prim', quote: 'she straightened her collar primly', at: 12 },
        ]), 11, 12, makeChat(), counts);

        assert.equal(ledger.characters[1].details, undefined);
        assert.equal(counts.stateUnquoted, 1);
    });

    it('takes the player\'s out-of-character line as the state, anchored to the player\'s message', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            // The extraction gave the wrong index; the quote is found in message 11.
            { character: 'Vera', kind: 'manner', value: 'soft, eager to please', quote: 'Vera is still soft and eager to please', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details.manner, [{ value: 'soft, eager to please', at: 11, messageId: 'm11' }]);
    });

    it('appends a changed value after the stored one and leaves the same value alone', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { style: [{ value: 'prefect uniform', at: 5, messageId: 'm5' }] };
        const counts = {};

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'style', value: 'Prefect Uniform', quote: 'folded the prefect blazer', at: 12 },
        ]), 11, 12, makeChat(), counts);
        assert.deepEqual(ledger.characters[1].details.style, [{ value: 'prefect uniform', at: 5, messageId: 'm5' }]);

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'style', value: 'fitted and feminine', quote: 'folded the prefect blazer into the bin', at: 12 },
        ]), 11, 12, makeChat(), counts);
        assert.deepEqual(ledger.characters[1].details.style, [
            { value: 'prefect uniform', at: 5, messageId: 'm5' },
            { value: 'fitted and feminine', at: 12, messageId: 'm12' },
        ]);
        assert.equal(counts.detailsChanged, 1);
    });

    it('keeps a stance per other character: a new one toward Ellie leaves the one toward Gabriel', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { stance: [
            { value: { text: 'wary of him', of: 'c3' }, at: 4, messageId: 'm4' },
            { value: { text: 'loyal to her', of: 'c1' }, at: 5, messageId: 'm5' },
        ] };

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'stance', of: 'Ellie', value: 'devoted to her', quote: "I'm not going back", at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details.stance, [
            { value: { text: 'wary of him', of: 'c3' }, at: 4, messageId: 'm4' },
            { value: { text: 'loyal to her', of: 'c1' }, at: 5, messageId: 'm5' },
            { value: { text: 'devoted to her', of: 'c1' }, at: 12, messageId: 'm12' },
        ]);
    });

    it('skips a stance the player locked toward that character, not one toward someone else', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { stance: [{ value: { text: 'devoted to her', of: 'c1' }, at: null, by: 'user' }] };
        const counts = {};

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'stance', of: 'Ellie', value: 'cold to her', quote: "I'm not going back", at: 12 },
            { character: 'Vera', kind: 'stance', of: 'Gabriel', value: 'at ease with him', quote: "I'm not going back", at: 12 },
        ]), 11, 12, makeChat(), counts);

        assert.deepEqual(ledger.characters[1].details.stance, [
            { value: { text: 'devoted to her', of: 'c1' }, at: null, by: 'user' },
            { value: { text: 'at ease with him', of: 'c3' }, at: 12, messageId: 'm12' },
        ]);
        assert.equal(counts.detailsLocked, 1);
    });
});

describe('parseKnowledgeExtractionAnswer — standing state items', () => {
    it('keeps the quote and the stance\'s other character, and drops a state item without a quote alone', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({
            present: ['Vera'], newCharacters: [], learned: [], revealedSecrets: [], retracted: [],
            details: [
                { character: 'Vera', kind: 'stance', of: 'Ellie', value: 'devoted to her', quote: ' I stay ', at: 12 },
                { character: 'Vera', kind: 'manner', value: 'soft', at: 12 },
                { character: 'Vera', kind: 'role', value: 'Ward recruit', at: 12 },
            ],
        }));

        assert.deepEqual(answer.details, [
            { character: 'Vera', kind: 'stance', value: 'devoted to her', of: 'Ellie', quote: 'I stay', at: 12 },
            { character: 'Vera', kind: 'role', value: 'Ward recruit', at: 12 },
        ]);
    });
});

describe('buildKnowledgeBlock — standing state lines', () => {
    function ledgerWithState() {
        const ledger = makeLedger();
        ledger.characters[1].details = {
            style: [{ value: 'fitted and feminine', at: 12 }],
            manner: [{ value: 'soft, eager to please', at: 11 }],
            stance: [
                { value: { text: 'devoted to her', of: 'c1' }, at: 12 },
                { value: { text: 'close through Ellie', of: 'c3' }, at: 9 },
            ],
        };
        return ledger;
    }

    it('prints style, manner and the stance toward a covered character for a present one, with the state sentence', () => {
        const block = buildKnowledgeBlock(ledgerWithState(), [], true, false, true);

        assert.ok(block.includes('VERA LIN (present)\n- Style: fitted and feminine\n- Manner: soft, eager to please\n- Toward Ellie Masters: devoted to her'));
        // Gabriel is neither present nor talked about.
        assert.ok(!block.includes('Toward Gabriel Marin'));
        assert.ok(block.includes('Style, Manner and Toward lines say how a character is now'));
    });

    it('prints a talked-about character\'s stances toward present characters only, no style or manner', () => {
        const ledger = ledgerWithState();
        ledger.scene.present = ['c1', 'c3'];
        const messages = [{ name: 'Ellie', is_user: true, mes: 'Where is Vera tonight?' }];

        const block = buildKnowledgeBlock(ledger, messages, true, false, true);

        assert.ok(block.includes('VERA LIN (talked about, not present)\n- Toward Ellie Masters: devoted to her\n- Toward Gabriel Marin: close through Ellie'));
        assert.ok(!block.includes('- Style:'));
    });

    it('prints no state while standing state is switched off', () => {
        const block = buildKnowledgeBlock(ledgerWithState(), [], true, false, false);

        assert.ok(!block.includes('- Style:'));
        assert.ok(!block.includes('Style, Manner and Toward lines'));
    });
});

describe('buildKnowledgeExtractionVariables — standing state', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('lists the known state of the characters the new messages name in its own section, and asks for the quote', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { manner: [{ value: 'soft', at: 5 }], stance: [{ value: { text: 'devoted to her', of: 'c1' }, at: 5 }] };
        ledger.characters[2].details = { manner: [{ value: 'warm', at: 5 }] };

        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(ledger, makeChat(), 11, 'Ellie', [], [], [], true, false, true));

        assert.ok(prompt.includes('== STANDING STATE OF THE CHARACTERS THE NEW MESSAGES NAME ==\nThe style, manner and stances the ledger knows about each of them.\n- Vera Lin — manner: soft; toward Ellie Masters: devoted to her\n'));
        // Gabriel is not named in messages 11–12.
        assert.ok(!prompt.includes('Gabriel Marin — manner'));
        assert.ok(prompt.includes('"quote": only for style, manner or stance, and required there'));
        assert.ok(prompt.includes('| style | manner | stance'));
    });

    it('leaves task 8 and the prompt without any state part while it is switched off', () => {
        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(makeLedger(), makeChat(), 11, 'Ellie', [], [], [], true, false, false));

        assert.ok(!prompt.includes('STANDING STATE'));
        assert.ok(!prompt.includes('only for style, manner or stance'));
        assert.ok(!prompt.includes('| style | manner | stance'));
        assert.ok(!prompt.includes('{{STATE'));
    });
});

describe('standing state — review fixes', () => {
    it('drops a state item whose quote has fewer than three words, even when the words are in the message', () => {
        const ledger = makeLedger();
        const counts = {};

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'manner', value: 'cold and distant', quote: 'Vera folded', at: 12 },
        ]), 11, 12, makeChat(), counts);

        assert.equal(ledger.characters[1].details, undefined);
        assert.equal(counts.stateUnquoted, 1);
    });

    it('lists one change item per character a new stance is toward, each keyed by that character', () => {
        const record = {
            kind: 'update', from: 11, to: 12, messageId: 'm12',
            items: { characters: [], holders: [], details: [
                { characterId: 'c2', kind: 'stance', of: 'c1', messageId: 'm12' },
                { characterId: 'c2', kind: 'stance', of: 'c3', messageId: 'm12' },
            ], names: [] },
        };

        assert.deepEqual(listChangeItems(record), [
            { key: 'm12:update:detail:c2:stance:c1', kind: 'detail', detailKind: 'stance', characterId: 'c2', of: 'c1', messageId: 'm12' },
            { key: 'm12:update:detail:c2:stance:c3', kind: 'detail', detailKind: 'stance', characterId: 'c2', of: 'c3', messageId: 'm12' },
        ]);
    });
});

describe('buildKnowledgeBlock — Has met keeps lowercase names that are names', () => {
    it('leaves out "the courier" and keeps "de la Cruz"', () => {
        const ledger = makeLedger();
        ledger.characters.push({ id: 'c4', name: 'de la Cruz', aliases: [] }, { id: 'c5', name: 'the courier', aliases: [] });
        ledger.meetings = [{ at: 9, present: ['c1', 'c4', 'c5'] }];

        const block = buildKnowledgeBlock(ledger, [], true, false, false);

        assert.ok(block.endsWith('ELLIE MASTERS (present)\n- Has met: de la Cruz'));
    });
});
