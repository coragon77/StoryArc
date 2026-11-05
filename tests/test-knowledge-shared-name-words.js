import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyExtractionAnswer, buildKnowledgeBlock, buildKnowledgeExtractionVariables } from '../lib/knowledge/ledger.js';
import { fillTemplate } from '../lib/planning/generator.js';

/**
 * Paragon's ledger as of 2026-11-05, cut down to the records whose one-word
 * aliases another record shares, plus Kendra Osei and her unnamed mother.
 * Every record holds a fact, so a talked-about record gets a section.
 */
function makeParagonLedger() {
    const characters = [
        { id: 'c1', name: 'Arthur Sterling', aliases: ['Sterling'] },
        { id: 'c2', name: 'Julian Sterling', aliases: [] },
        { id: 'c3', name: 'Marcus Chen', aliases: ['Marcus'] },
        { id: 'c4', name: 'Marcus Bishop', aliases: [] },
        { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil', 'Osei'] },
        {
            id: 'c6', name: '', aliases: ['Mrs. Osei'],
            details: { relation: [{ value: { kind: 'mother', of: 'c5' }, at: null, by: 'record' }] },
        },
        { id: 'c7', name: 'Agent Cross', aliases: [] },
        { id: 'c8', name: 'Malcolm Cross', aliases: ['Cross'] },
    ];
    return {
        characters,
        facts: characters.map((character, index) => ({
            id: `f${index + 1}`, text: `secret ${index + 1}`, public: false,
            holders: [{ characterId: character.id, how: 'witnessed', toldBy: null, at: 5 }],
        })),
        scene: { at: 9, present: [] },
        lastUpdatedAt: 9,
    };
}

function message(isUser, text) {
    return { is_user: isUser, is_system: false, name: isUser ? 'Amy' : 'Narrator', mes: text };
}

/** The headings of the talked-about sections the block prints for one reply. */
function talkedAboutHeadings(ledger, replyText) {
    const block = buildKnowledgeBlock(ledger, [message(true, '...'), message(false, replyText)]);
    return block.split('\n').filter(line => line.endsWith('(talked about, not present)'));
}

function answerWith(fields) {
    return { present: [], newCharacters: [], learned: [], ...fields };
}

describe('a one-word name another record shares points at nobody in the knowledge block', () => {
    it('makes only Julian talked about for "Julian Sterling called"', () => {
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Julian Sterling called.'),
            ['JULIAN STERLING (talked about, not present)']);
    });

    it('makes nobody talked about for "Sterling called"', () => {
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Sterling called.'), []);
    });

    it('makes nobody talked about for "Marcus nodded", and Marcus Chen for "Marcus Chen nodded"', () => {
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Marcus nodded.'), []);
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Marcus Chen nodded.'),
            ['MARCUS CHEN (talked about, not present)']);
    });

    it('keeps "Anvil", "Osei" and "Mrs. Osei" working while no other named record carries Osei', () => {
        const ledger = makeParagonLedger();

        assert.deepEqual(talkedAboutHeadings(ledger, 'Anvil landed.'), ['KENDRA OSEI (talked about, not present)']);
        assert.deepEqual(talkedAboutHeadings(ledger, 'Osei landed.'), ['KENDRA OSEI (talked about, not present)']);
        // "Osei" is Kendra's alone, so "Mrs. Osei" names her too.
        assert.deepEqual(talkedAboutHeadings(ledger, 'Mrs. Osei waved.'),
            ['KENDRA OSEI (talked about, not present)', "KENDRA OSEI'S MOTHER (talked about, not present)"]);
    });

    it('stops matching "Osei" once another named record carries it', () => {
        const ledger = makeParagonLedger();
        ledger.characters.push({ id: 'c9', name: 'Kwame Osei', aliases: [] });

        assert.deepEqual(talkedAboutHeadings(ledger, 'Osei landed.'), []);
    });

    it('keeps the multi-word "Agent Cross" working next to the ambiguous "Cross"', () => {
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Agent Cross smiled.'),
            ['AGENT CROSS (talked about, not present)']);
        assert.deepEqual(talkedAboutHeadings(makeParagonLedger(), 'Cross smiled.'), []);
    });

    it('does not find a record whose own name is one shared word ("Vance" next to Brody Vance)', () => {
        const ledger = makeParagonLedger();
        ledger.characters.push({ id: 'c9', name: 'Vance', aliases: [] }, { id: 'c10', name: 'Brody Vance', aliases: [] });

        assert.deepEqual(talkedAboutHeadings(ledger, 'Vance left.'), []);
    });
});

describe('a one-word name another record shares resolves to nobody in an extraction answer', () => {
    it('adds no holder for "Sterling", and Julian for "Julian Sterling"', () => {
        const ledger = makeParagonLedger();

        applyExtractionAnswer(ledger, answerWith({
            learned: [
                { text: 'the vault code is 4471', who: ['Sterling'], how: 'witnessed', toldBy: null, public: false, at: 10 },
                { text: 'the gala is a trap', who: ['Julian Sterling'], how: 'witnessed', toldBy: null, public: false, at: 10 },
            ],
        }), 10, 10);

        assert.deepEqual(ledger.facts.slice(8).map(fact => [fact.text, fact.holders.map(holder => holder.characterId)]),
            [['the gala is a trap', ['c2']]]);
    });

    it('resolves "Mrs. Osei" and "Anvil", and "Osei" only while no other named record carries it', () => {
        const ledger = makeParagonLedger();
        const learnedBy = who => ({ text: `fact for ${who}`, who: [who], how: 'witnessed', toldBy: null, public: false, at: 10 });

        applyExtractionAnswer(ledger, answerWith({ learned: [learnedBy('Mrs. Osei'), learnedBy('Anvil'), learnedBy('Osei')] }), 10, 10);
        assert.deepEqual(ledger.facts.slice(8).map(fact => fact.holders[0].characterId), ['c6', 'c5', 'c5']);

        ledger.characters.push({ id: 'c9', name: 'Kwame Osei', aliases: [] });
        applyExtractionAnswer(ledger, answerWith({
            learned: [{ text: 'the roof is wired', who: ['Osei'], how: 'witnessed', toldBy: null, public: false, at: 11 }],
        }), 11, 11);
        assert.equal(ledger.facts.length, 11);
    });
});

describe('the extraction does not record a one-word name another record carries', () => {
    it('refuses the new name "Sterling" for Arthur Sterling while Julian Sterling exists, and counts it', () => {
        const ledger = makeParagonLedger();
        ledger.characters[0].aliases = [];
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Arthur Sterling', name: 'Sterling' }] }), 10, 10, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters[0].aliases, []);
        assert.deepEqual(newNameCounts, { newNamesAdded: 0, newNamesRefused: 1, newNamesUnknown: 0 });
    });

    it('adds the new name "Mr. Sterling" for Arthur Sterling', () => {
        const ledger = makeParagonLedger();
        ledger.characters[0].aliases = [];
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Arthur Sterling', name: 'Mr. Sterling' }] }), 10, 10, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters[0].aliases, ['Mr. Sterling']);
        assert.deepEqual(newNameCounts, { newNamesAdded: 1, newNamesRefused: 0, newNamesUnknown: 0 });
    });

    it('changes nothing for a shared one-word name the record already has', () => {
        const ledger = makeParagonLedger();
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Marcus Chen', name: 'marcus' }] }), 10, 10, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters[2].aliases, ['Marcus']);
        assert.deepEqual(newNameCounts, { newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0 });
    });

    it('drops a new character\'s alias "Marcus" while another Marcus exists, keeping its name and other aliases', () => {
        const ledger = makeParagonLedger();

        applyExtractionAnswer(ledger, answerWith({ newCharacters: [{ name: 'Marcus Geller', aliases: ['Marcus', 'Geller', 'Doc'] }] }), 10, 10);

        assert.deepEqual(ledger.characters[8], {
            id: 'c9', name: 'Marcus Geller', aliases: ['Geller', 'Doc'], nameClash: { names: ['Marcus'], at: 10 },
        });
    });
});

describe('the extraction prompt says a shared bare name is not a new name', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('carries the sentence in the NEW NAMES task', () => {
        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(makeParagonLedger(), [], 0, 'Amy', [], [], [], true));
        const newNamesTask = prompt.slice(prompt.indexOf('NEW NAMES.'), prompt.indexOf('3. LEARNED.'));

        assert.ok(newNamesTask.includes('A bare first name or surname that another character in the ledger shares is not a new name; a title with the surname ("Mrs. Osei") is, when the text makes plain who is meant.'));
    });
});
