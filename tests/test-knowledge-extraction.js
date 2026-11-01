import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKnowledgeExtractionVariables, parseKnowledgeExtractionAnswer } from '../lib/knowledge/ledger.js';

/** The workshop chat after breakfast: three characters, one told fact, one public fact. */
function makeLedger() {
    return {
        characters: [
            { id: 'char-gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
            { id: 'char-ellie', name: 'Ellie', aliases: [] },
            { id: 'char-noor', name: 'Noor al-Jamil', aliases: ['Noor'] },
        ],
        facts: [
            {
                id: 'fact-latches',
                text: 'Noor should lock the gauntlet on with titanium latches',
                public: false,
                holders: [
                    { characterId: 'char-gabriel', how: 'witnessed', toldBy: null, at: 2063 },
                    { characterId: 'char-ellie', how: 'told', toldBy: 'char-gabriel', at: 2063 },
                ],
            },
            {
                id: 'fact-overdrive',
                text: 'Overdrive is Bellweather\'s ringer for Sunday',
                public: true,
                holders: [],
            },
        ],
        scene: { at: 2063, present: ['char-gabriel', 'char-ellie'] },
        lastUpdatedAt: 2063,
    };
}

/** ST chat messages as stored in `chat`: 2063 to 2066, one of them hidden. */
function makeChat() {
    const chatMessages = [];
    chatMessages[2063] = { name: 'Gabriel Marin', is_user: false, mes: 'Lock it on with titanium latches.' };
    chatMessages[2064] = { name: 'Ellie', is_user: true, mes: 'I head to the workshop.' };
    chatMessages[2065] = { name: 'Narrator', is_user: false, is_system: true, mes: 'A hidden note.' };
    chatMessages[2066] = { name: 'Narrator', is_user: false, mes: 'Noor looks up from the bench.' };
    return chatMessages;
}

describe('buildKnowledgeExtractionVariables', () => {
    it('lists the messages from the given index with their indices, the characters with aliases, the facts with holders and the persona', () => {
        const variables = buildKnowledgeExtractionVariables(makeLedger(), makeChat(), 2064, 'Ellie');

        assert.deepEqual(variables, {
            PERSONA: 'Ellie',
            CHARACTERS: [
                '- Gabriel Marin (also: Aegis, Mr. Marin)',
                '- Ellie',
                '- Noor al-Jamil (also: Noor)',
            ].join('\n'),
            FACTS: [
                '- [fact-latches] Noor should lock the gauntlet on with titanium latches (known to: Gabriel Marin, Ellie)',
                '- [fact-overdrive] Overdrive is Bellweather\'s ringer for Sunday (public)',
            ].join('\n'),
            SECRETS: '(none)',
            MESSAGES: [
                '[2064] Ellie: I head to the workshop.',
                '[2066] Narrator: Noor looks up from the bench.',
            ].join('\n\n'),
        });
    });

    it('writes (none) for an empty ledger and (no persona) for a missing persona name', () => {
        const emptyLedger = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };

        const variables = buildKnowledgeExtractionVariables(emptyLedger, makeChat(), 2066, '');

        assert.deepEqual(variables, {
            PERSONA: '(no persona)',
            CHARACTERS: '(none)',
            FACTS: '(none)',
            SECRETS: '(none)',
            MESSAGES: '[2066] Narrator: Noor looks up from the bench.',
        });
    });
});

describe('extract-knowledge.txt', () => {
    it('holds a placeholder for every template variable', () => {
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        for (const placeholder of ['{{PERSONA}}', '{{CHARACTERS}}', '{{FACTS}}', '{{SECRETS}}', '{{MESSAGES}}']) {
            assert.ok(template.includes(placeholder), `missing ${placeholder}`);
        }
    });
});

/** A well-formed answer for the workshop scene, as the LLM writes it: fenced, with a stray key. */
const WELL_FORMED_ANSWER = `\`\`\`json
{
  "present": ["Noor", "Ellie"],
  "newCharacters": [{ "name": "Dougal", "aliases": [] }],
  "learned": [
    { "factId": "fact-latches", "public": false, "who": ["Noor"], "how": "told", "toldBy": "Ellie", "at": 2079 },
    { "text": "The kiln router logged 42.08 kHz queries overnight", "public": false, "who": ["Dougal"], "how": "witnessed", "toldBy": null, "at": 2080 }
  ],
  "mood": "tense"
}
\`\`\``;

describe('parseKnowledgeExtractionAnswer', () => {
    it('parses a well-formed answer into the shape the ledger applies', () => {
        const answer = parseKnowledgeExtractionAnswer(WELL_FORMED_ANSWER);

        assert.deepEqual(answer, {
            present: ['Noor', 'Ellie'],
            newCharacters: [{ name: 'Dougal', aliases: [] }],
            learned: [
                { factId: 'fact-latches', public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 2079 },
                { text: 'The kiln router logged 42.08 kHz queries overnight', public: false, who: ['Dougal'], how: 'witnessed', toldBy: null, at: 2080 },
            ],
            revealedSecrets: [],
        });
    });

    it('reads a null on the key not used as absent', () => {
        const answer = parseKnowledgeExtractionAnswer(`{"present": [], "newCharacters": [], "learned": [
            { "factId": null, "text": "Vera's flash drive is locked in Gabriel's loft", "public": false, "who": ["Ellie"], "how": "told", "toldBy": "Gabriel Marin", "at": 2081 },
            { "factId": "fact-latches", "text": null, "public": false, "who": ["Dougal"], "how": "witnessed", "toldBy": null, "at": 2082 }
        ]}`);

        assert.deepEqual(answer.learned, [
            { text: 'Vera\'s flash drive is locked in Gabriel\'s loft', public: false, who: ['Ellie'], how: 'told', toldBy: 'Gabriel Marin', at: 2081 },
            { factId: 'fact-latches', public: false, who: ['Dougal'], how: 'witnessed', toldBy: null, at: 2082 },
        ]);
    });

    it('accepts empty lists', () => {
        const answer = parseKnowledgeExtractionAnswer('{"present": [], "newCharacters": [], "learned": []}');

        assert.deepEqual(answer, { present: [], newCharacters: [], learned: [], revealedSecrets: [] });
    });

    it('gives nothing for malformed JSON, an empty answer or a non-object', () => {
        assert.equal(parseKnowledgeExtractionAnswer('{"present": ["Noor"], "learned": ['), null);
        assert.equal(parseKnowledgeExtractionAnswer(''), null);
        assert.equal(parseKnowledgeExtractionAnswer('["Noor"]'), null);
    });

    it('gives nothing when a top-level key is missing', () => {
        assert.equal(parseKnowledgeExtractionAnswer('{"present": ["Noor"], "newCharacters": []}'), null);
        assert.equal(parseKnowledgeExtractionAnswer('{"newCharacters": [], "learned": []}'), null);
        assert.equal(parseKnowledgeExtractionAnswer('{"present": [], "learned": []}'), null);
    });

    it('gives nothing when a learned item or a new character misses a key', () => {
        const withoutAt = '{"present": [], "newCharacters": [], "learned": [{ "factId": "fact-latches", "public": false, "who": ["Noor"], "how": "told", "toldBy": "Ellie" }]}';
        const withoutFact = '{"present": [], "newCharacters": [], "learned": [{ "public": false, "who": ["Noor"], "how": "told", "toldBy": "Ellie", "at": 2079 }]}';
        const withoutAliases = '{"present": [], "newCharacters": [{ "name": "Dougal" }], "learned": []}';

        assert.equal(parseKnowledgeExtractionAnswer(withoutAt), null);
        assert.equal(parseKnowledgeExtractionAnswer(withoutFact), null);
        assert.equal(parseKnowledgeExtractionAnswer(withoutAliases), null);
    });

    it('gives nothing when a value has the wrong type', () => {
        // A repeated key overrides the first one in JSON.parse.
        const learnedItemWith = (field) => `{"present": [], "newCharacters": [], "learned": [{ "factId": "fact-latches", "public": false, "who": ["Noor"], "how": "told", "toldBy": "Ellie", "at": 2079, ${field} }]}`;

        assert.equal(parseKnowledgeExtractionAnswer('{"present": "Noor", "newCharacters": [], "learned": []}'), null);
        assert.equal(parseKnowledgeExtractionAnswer('{"present": [3], "newCharacters": [], "learned": []}'), null);
        assert.equal(parseKnowledgeExtractionAnswer('{"present": [], "newCharacters": [{ "name": "Dougal", "aliases": "Doug" }], "learned": []}'), null);
        assert.equal(parseKnowledgeExtractionAnswer('{"present": [], "newCharacters": [], "learned": {}}'), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"public": "no"')), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"who": "Noor"')), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"how": "overheard"')), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"toldBy": 7')), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"at": "2079"')), null);
        assert.equal(parseKnowledgeExtractionAnswer(learnedItemWith('"factId": 12')), null);
    });
});
