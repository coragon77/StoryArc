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
        const variables = buildKnowledgeExtractionVariables(makeLedger(), makeChat(), 2064, 'Ellie', [], [], [], false);

        assert.deepEqual(variables, {
            CHARACTERS_DETAILS_NOTE: '',
            DETAILS_TASK: '',
            DETAILS_SCHEMA: '',
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
            DEVELOPMENTS: '(none)',
            PLANS: '(none)',
            CONTEXT_MESSAGE: '[2063] Gabriel Marin: Lock it on with titanium latches.',
            MESSAGES: [
                '[2064] Ellie: I head to the workshop.',
                '[2066] Narrator: Noor looks up from the bench.',
            ].join('\n\n'),
        });
    });

    it('writes (none) for an empty ledger and (no persona) for a missing persona name', () => {
        const emptyLedger = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };

        const variables = buildKnowledgeExtractionVariables(emptyLedger, makeChat(), 2066, '', [], [], [], false);

        assert.deepEqual(variables, {
            CHARACTERS_DETAILS_NOTE: '',
            DETAILS_TASK: '',
            DETAILS_SCHEMA: '',
            PERSONA: '(no persona)',
            CHARACTERS: '(none)',
            FACTS: '(none)',
            SECRETS: '(none)',
            DEVELOPMENTS: '(none)',
            PLANS: '(none)',
            // 2065 is hidden: the context message is the one before it.
            CONTEXT_MESSAGE: '[2064] Ellie: I head to the workshop.',
            MESSAGES: '[2066] Narrator: Noor looks up from the bench.',
        });
    });
});

describe('extract-knowledge.txt', () => {
    it('holds a placeholder for every template variable', () => {
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        for (const placeholder of ['{{PERSONA}}', '{{CHARACTERS}}', '{{FACTS}}', '{{SECRETS}}', '{{PLANS}}', '{{CONTEXT_MESSAGE}}', '{{MESSAGES}}']) {
            assert.ok(template.includes(placeholder), `missing ${placeholder}`);
        }
    });

    it('makes the character who did, caused or planned a fact one of its holders, even when absent', () => {
        // Live: "Mara rewrote Amy's logs" was told to Amy; Mara, not in the scene, was left out.
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            'A character who did, caused or planned what a fact describes knows it, even when they are not in the scene: '
            + 'list them in "who" with "how": "witnessed", in an item of their own when the others were told.'), 'missing the actor rule');
        assert.ok(template.includes(
            'A character who is not in the scene learns nothing, even when it would be likely, '
            + 'unless they did, caused or planned what the fact describes.'), 'missing the exception to the absent rule');
    });

    it('limits the actor rule to the deed itself, not what others found out about the actor', () => {
        // Live (Paragon 2255): Vera learned that Diana's routing signature sat on
        // Lucas's underwriting file; Diana, absent, became a holder of that fact.
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            'This covers only the deed as the character did it. A routine act they would not remember '
            + '(one signature among thousands of files) does not count, and what others found out about them '
            + 'or their deed is a separate fact they do not hold. A fact is not a character\'s because it names them.'),
        'missing the limit of the actor rule');
    });

    it('asks for fact text that states the fact itself, not who else knows it', () => {
        // Live: "…, and nobody else knows except Ellie."
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            'The text states the fact itself, not who knows it or who does not ("and nobody else knows" belongs in no text): '
            + 'the holders record that.'), 'missing the fact text rule');
    });

    it('records only knowledge a character could act on or wrongly reveal, not sensory detail', () => {
        // Live: one reply gave 9 facts, mostly sensations ("Amy can feel the vibration of Steve's phone in her throat").
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            'Record only knowledge a character could act on or wrongly reveal: secrets, plans, identities, who did what, '
            + 'private information, things told in confidence.'), 'missing the actionable-knowledge rule');
        assert.ok(template.includes(
            'Do not record small talk, sensations, descriptions, moods or what anyone in the scene can plainly see.'),
            'missing the noise rule');
        assert.ok(!template.includes('skip small talk and scenery'), 'the old, weaker noise rule is still there');
    });

    it('prefers the id of a ledger fact over new text for the same knowledge', () => {
        // Live: one answer wrote "Mara from the night shift rewrote Amy's diagnostic logs." as two facts.
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            '- "factId" when the fact is already in the ledger, even when the new messages word it differently: '
            + 'when the same knowledge is meant, use its id, not new text.'), 'missing the prefer-the-id rule');
        assert.ok(template.includes(
            'Write each fact once: put everyone who learns it in the same way in one item.'), 'missing the write-once rule');
    });

    it('keeps one piece of knowledge per fact, so characters can learn the pieces at different times', () => {
        // Live: "Ellie is sitting on over a million dollars and intends to bring Vera Lin onto Lucky Strike's payroll";
        // Vera later learned only the second half, so the fact could not get her as a holder.
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            'One fact holds one piece of knowledge: knowledge that different characters can learn at different times '
            + 'goes into separate facts, not into one sentence joined by "and".'), 'missing the one-piece-per-fact rule');
    });

    it('records what a crowd watched, a broadcast or a report as a public fact', () => {
        // Live: a party scene printed no public fact, so bystanders had nothing they were allowed to talk about.
        const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

        assert.ok(template.includes(
            '- "public": true when the fact is public knowledge that bystanders may talk about: '
            + 'what a crowd watched happen, what was broadcast, what was reported in the news. '
            + 'false for knowledge only some characters hold.'), 'missing the public-knowledge rule');
        assert.ok(!template.includes('"public": true only when the fact is made known to everyone'),
            'the old, narrower public rule is still there');
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
            retracted: [],
            fulfilled: [],
            rulings: [],
            details: [],
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

        assert.deepEqual(answer, { present: [], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details: [] });
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
