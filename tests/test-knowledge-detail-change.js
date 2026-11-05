import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyExtractionAnswer, parseKnowledgeExtractionAnswer } from '../lib/knowledge/ledger.js';

/** Vera and Kendra in the Paragon chat; Vera's role and status known since message 5. */
function makeLedger() {
    return {
        characters: [
            {
                id: 'c1', name: 'Vera Lin', aliases: ['Vera'],
                details: {
                    role: [{ value: 'student, Westbrook High', at: 5, messageId: 'm5' }],
                    status: [{ value: 'alive', at: 5, messageId: 'm5' }],
                },
            },
            { id: 'c2', name: 'Kendra Osei', aliases: ['Kendra'] },
        ],
        facts: [],
        scene: { at: 10, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 10,
    };
}

/** An answer with nothing in it but the given details. */
function answerWithDetails(details) {
    return { present: ['Vera'], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details };
}

/** Messages 11 and 12, each already carrying its Story Arc message id. */
function makeChat() {
    const chatMessages = [];
    chatMessages[11] = { name: 'Ellie', is_user: true, mes: 'How is the new posting?', extra: { story_arc_message_id: 'm11' } };
    chatMessages[12] = { name: 'Narrator', is_user: false, mes: 'Vera signs the transfer papers to the Wards.', extra: { story_arc_message_id: 'm12' } };
    return chatMessages;
}

describe('applyExtractionAnswer — change versus restatement', () => {
    it('appends a different value that carries its on-screen change, the old entry kept in the history', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'role', value: 'Ward, Halstead Annex', change: 'She transfers to the Wards.', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[0].details.role, [
            { value: 'student, Westbrook High', at: 5, messageId: 'm5' },
            { value: 'Ward, Halstead Annex', at: 12, messageId: 'm12' },
        ]);
    });

    it('ignores a different value without a change as a restatement', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'role', value: 'night nurse, Highland Hospital', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[0].details.role, [{ value: 'student, Westbrook High', at: 5, messageId: 'm5' }]);
    });

    it('changes nothing for the same value again, even with a change and in other letter case', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'role', value: 'Student, Westbrook High', change: 'She goes back to school.', at: 12 },
            { character: 'Vera', kind: 'status', value: 'alive', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[0].details, {
            role: [{ value: 'student, Westbrook High', at: 5, messageId: 'm5' }],
            status: [{ value: 'alive', at: 5, messageId: 'm5' }],
        });
    });

    it('records a death only with the death shown on screen', () => {
        const restated = makeLedger();
        applyExtractionAnswer(restated, answerWithDetails([
            { character: 'Vera', kind: 'status', value: 'dead', at: 12 },
        ]), 11, 12, makeChat());
        assert.deepEqual(restated.characters[0].details.status, [{ value: 'alive', at: 5, messageId: 'm5' }]);

        const shown = makeLedger();
        applyExtractionAnswer(shown, answerWithDetails([
            { character: 'Vera', kind: 'status', value: 'dead', change: 'The bridge collapses under her.', at: 12 },
        ]), 11, 12, makeChat());
        assert.deepEqual(shown.characters[0].details.status, [
            { value: 'alive', at: 5, messageId: 'm5' },
            { value: 'dead', at: 12, messageId: 'm12' },
        ]);
    });

    it('brings a dead character back only when the story shows them alive again', () => {
        const deadVera = () => {
            const ledger = makeLedger();
            ledger.characters[0].details.status = [{ value: 'dead', at: 5, messageId: 'm5' }];
            return ledger;
        };

        const restated = deadVera();
        applyExtractionAnswer(restated, answerWithDetails([
            { character: 'Vera', kind: 'status', value: 'alive', at: 12 },
        ]), 11, 12, makeChat());
        assert.deepEqual(restated.characters[0].details.status, [{ value: 'dead', at: 5, messageId: 'm5' }]);

        const shown = deadVera();
        applyExtractionAnswer(shown, answerWithDetails([
            { character: 'Vera', kind: 'status', value: 'alive', change: 'Vera walks out of the rubble.', at: 12 },
        ]), 11, 12, makeChat());
        assert.deepEqual(shown.characters[0].details.status, [
            { value: 'dead', at: 5, messageId: 'm5' },
            { value: 'alive', at: 12, messageId: 'm12' },
        ]);
    });

    it('changes a relation only with a change, the same kinship to the same character being no change', () => {
        const ledger = makeLedger();
        ledger.characters[0].details.relation = [{ value: { kind: 'cousin', of: 'c2' }, at: 5, messageId: 'm5' }];

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Vera', kind: 'relation', value: 'Cousin', of: 'Kendra', change: 'They meet again.', at: 11 },
            { character: 'Vera', kind: 'relation', value: 'sister-in-law', of: 'Kendra', at: 12 },
            { character: 'Vera', kind: 'relation', value: 'stepsister', of: 'Kendra Osei', change: 'Her father marries Kendra\'s mother.', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[0].details.relation, [
            { value: { kind: 'cousin', of: 'c2' }, at: 5, messageId: 'm5' },
            { value: { kind: 'stepsister', of: 'c2' }, at: 12, messageId: 'm12' },
        ]);
    });
});

describe('parseKnowledgeExtractionAnswer — detail values and changes', () => {
    const base = '"present": [], "newCharacters": [], "learned": []';

    it('reads a detail value given as a number as its string form', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "details": [
            { "character": "Kendra", "kind": "age", "value": 17, "at": 12 },
            { "character": "Ama", "kind": "age", "value": 41.5, "at": 12 }
        ] }`);

        assert.deepEqual(answer.details, [
            { character: 'Kendra', kind: 'age', value: '17', at: 12 },
            { character: 'Ama', kind: 'age', value: '41.5', at: 12 },
        ]);
    });

    it('reads the on-screen event of a change, trimmed, and drops a blank or null one', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "details": [
            { "character": "Vera", "kind": "role", "value": "Ward, Halstead Annex", "change": " She transfers to the Wards. ", "at": 12 },
            { "character": "Vera", "kind": "age", "value": "19", "change": " ", "at": 12 },
            { "character": "Vera", "kind": "gender", "value": "female", "change": null, "at": 12 }
        ] }`);

        assert.deepEqual(answer.details, [
            { character: 'Vera', kind: 'role', value: 'Ward, Halstead Annex', change: 'She transfers to the Wards.', at: 12 },
            { character: 'Vera', kind: 'age', value: '19', at: 12 },
            { character: 'Vera', kind: 'gender', value: 'female', at: 12 },
        ]);
    });

    it('rejects the answer for a value that is no finite number or a change that is no string', () => {
        const malformedItems = [
            '{ "character": "Ama", "kind": "age", "value": true, "at": 12 }',
            '{ "character": "Ama", "kind": "age", "value": ["40s"], "at": 12 }',
            '{ "character": "Ama", "kind": "status", "value": 1, "at": 12 }',
            '{ "character": "Ama", "kind": "role", "value": "nurse", "change": 3, "at": 12 }',
            '{ "character": "Ama", "kind": "role", "value": "nurse", "change": ["new job"], "at": 12 }',
        ];
        for (const item of malformedItems) {
            assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "details": [${item}] }`), null, item);
        }
    });
});

describe('extract-knowledge.txt — change versus restatement', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('asks for the on-screen event of a change on an item that replaces a known detail', () => {
        assert.ok(template.includes('or when the new messages show it changing on screen'), 'missing the change case');
        assert.ok(template.includes('- "change": only for a detail the ledger already knows, the on-screen event that changes it, in one short sentence'), 'missing the change key');
    });

    it('tells the extraction not to report a different value merely stated', () => {
        assert.ok(template.includes('A different value merely stated, with no such event, is not a change: do not report it.'));
    });

    it('carries the change in the answer shape', () => {
        assert.ok(template.includes('"of": "name, only for a relation", "change": "only for a changed detail: the on-screen event", "at": <index of the message> }'));
    });
});
