import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    applyExtractionAnswer,
    buildKnowledgeBlock,
    buildKnowledgeExtractionVariables,
    parseKnowledgeExtractionAnswer,
} from '../lib/knowledge/ledger.js';

/** Kendra and her mother in the Paragon chat, before the narrator stated anything about them. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c2', name: 'Ama Osei', aliases: ['Ama'] },
        ],
        facts: [],
        scene: { at: 10, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 10,
    };
}

/** An answer with nothing in it but the given details. */
function answerWithDetails(details, newCharacters = []) {
    return { present: ['Kendra'], newCharacters, learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details };
}

/** Messages 11 and 12, each already carrying its Story Arc message id. */
function makeChat() {
    const chatMessages = [];
    chatMessages[11] = { name: 'Ellie', is_user: true, mes: 'What does your mom do?', extra: { story_arc_message_id: 'm11' } };
    chatMessages[12] = { name: 'Narrator', is_user: false, mes: 'Kendra shrugs. "She cleans offices. Double shifts."', extra: { story_arc_message_id: 'm12' } };
    return chatMessages;
}

describe('applyExtractionAnswer — character details, first statements', () => {
    it('records a detail the story states for the first time, with its message and message id', () => {
        const ledger = makeLedger();

        const changed = applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Ama', kind: 'role', value: 'cleaner, double shifts, Oakland', at: 12 },
        ]), 11, 12, makeChat());

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters[1].details, {
            role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
        });
        assert.equal(ledger.characters[0].details, undefined);
    });

    it('stores a relation as the kinship word and the other cast member\'s id', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Ama Osei', kind: 'relation', value: 'mother', of: 'Kendra', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details, {
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 12, messageId: 'm12' }],
        });
    });

    it('records gender, age and status next to each other, one history list per kind', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Kendra', kind: 'gender', value: 'female', at: 11 },
            { character: 'Kendra', kind: 'age', value: '17', at: 12 },
            { character: 'Kendra', kind: 'status', value: 'alive', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[0].details, {
            gender: [{ value: 'female', at: 11, messageId: 'm11' }],
            age: [{ value: '17', at: 12, messageId: 'm12' }],
            status: [{ value: 'alive', at: 12, messageId: 'm12' }],
        });
    });

    it('leaves a known detail as it is when the answer states a different value', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { role: [{ value: 'cleaner, double shifts, Oakland', at: 5 }] };

        const changed = applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Ama', kind: 'role', value: 'night nurse, Highland Hospital', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details, {
            role: [{ value: 'cleaner, double shifts, Oakland', at: 5 }],
        });
        // Only the scene's and the coverage's message ids changed.
        assert.equal(changed, true);
    });

    it('keeps the first of two items for one kind in the same answer', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Ama', kind: 'age', value: '40s', at: 11 },
            { character: 'Ama', kind: 'age', value: '52', at: 12 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details, { age: [{ value: '40s', at: 11, messageId: 'm11' }] });
    });

    it('lets a new character of the same answer carry details', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails(
            [{ character: 'Kofi', kind: 'relation', value: 'brother', of: 'Kendra Osei', at: 12 }],
            [{ name: 'Kofi', aliases: [] }],
        ), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[2], {
            id: 'c3', name: 'Kofi', aliases: [],
            details: { relation: [{ value: { kind: 'brother', of: 'c1' }, at: 12, messageId: 'm12' }] },
        });
    });

    it('ignores an unknown character and a relation to someone outside the cast', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Mateo', kind: 'role', value: 'student, Westbrook', at: 12 },
            { character: 'Ama', kind: 'relation', value: 'sister', of: 'Priya', at: 12 },
            { character: 'Ama', kind: 'relation', value: 'mother', of: 'Ama Osei', at: 12 },
        ]), 11, 12, makeChat());

        assert.equal(ledger.characters[0].details, undefined);
        assert.equal(ledger.characters[1].details, undefined);
    });

    it('places a detail whose message lies outside the covered messages at the last covered one', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWithDetails([
            { character: 'Ama', kind: 'gender', value: 'female', at: 3 },
        ]), 11, 12, makeChat());

        assert.deepEqual(ledger.characters[1].details, { gender: [{ value: 'female', at: 12, messageId: 'm12' }] });
    });

    it('changes nothing for an answer without details, as from an older extraction', () => {
        const ledger = makeLedger();
        const answer = answerWithDetails([]);
        delete answer.details;

        applyExtractionAnswer(ledger, answer, 11, 12, makeChat());

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c2', name: 'Ama Osei', aliases: ['Ama'] },
        ]);
    });
});

describe('parseKnowledgeExtractionAnswer — details', () => {
    const base = '"present": [], "newCharacters": [], "learned": []';

    it('reads a missing details list as empty', () => {
        assert.deepEqual(parseKnowledgeExtractionAnswer(`{ ${base} }`).details, []);
    });

    it('reads the items of every kind, the relation with the character it relates to', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "details": [
            { "character": "Ama", "kind": "role", "value": " cleaner, double shifts ", "at": 12 },
            { "character": "Ama", "kind": "relation", "value": "mother", "of": "Kendra", "at": 12 },
            { "character": "Ama", "kind": "status", "value": "Dead", "at": 12, "extra": 1 }
        ] }`);

        assert.deepEqual(answer.details, [
            { character: 'Ama', kind: 'role', value: 'cleaner, double shifts', at: 12 },
            { character: 'Ama', kind: 'relation', value: 'mother', of: 'Kendra', at: 12 },
            { character: 'Ama', kind: 'status', value: 'dead', at: 12 },
        ]);
    });

    it('rejects the answer for a details value that is not a list', () => {
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "details": {} }`), null);
    });

    it('rejects the answer for a malformed details item', () => {
        const malformedItems = [
            '"no object"',
            '{ "kind": "age", "value": "17", "at": 12 }',
            '{ "character": "Ama", "kind": "job", "value": "cleaner", "at": 12 }',
            '{ "character": "Ama", "kind": "age", "value": " ", "at": 12 }',
            '{ "character": "Ama", "kind": "age", "value": "17", "at": "12" }',
            '{ "character": "Ama", "kind": "relation", "value": "mother", "at": 12 }',
            '{ "character": "Ama", "kind": "status", "value": "missing", "at": 12 }',
        ];
        for (const item of malformedItems) {
            assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "details": [${item}] }`), null, item);
        }
    });
});

describe('buildKnowledgeExtractionVariables — details', () => {
    it('lists each character\'s known details next to its names, labelled by kind', () => {
        const ledger = makeLedger();
        ledger.characters[0].details = { age: [{ value: '17', at: 4 }] };
        ledger.characters[1].details = {
            gender: [{ value: 'female', at: 5 }],
            role: [{ value: 'cleaner, double shifts, Oakland', at: 5 }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 5 }],
            status: [{ value: 'alive', at: 5 }],
        };

        const variables = buildKnowledgeExtractionVariables(ledger, makeChat(), 11, 'Ellie');

        assert.equal(variables.CHARACTERS, [
            '- Kendra Osei (also: Kendra) — age: 17',
            '- Ama Osei (also: Ama) — gender: female; role: cleaner, double shifts, Oakland; relation: Kendra Osei\'s mother; status: alive',
        ].join('\n'));
    });

    it('uses the latest entry of a kind as its current value', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { role: [{ value: 'cleaner', at: 5 }, { value: 'office manager', at: 9 }] };

        const variables = buildKnowledgeExtractionVariables(ledger, makeChat(), 11, 'Ellie');

        assert.equal(variables.CHARACTERS, '- Kendra Osei (also: Kendra)\n- Ama Osei (also: Ama) — role: office manager');
    });
});

describe('extract-knowledge.txt — details', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('has a DETAILS task that records only what the text states, never a guess', () => {
        assert.ok(template.includes('8. DETAILS.'), 'missing the DETAILS task');
        assert.ok(template.includes('Record only what the text states. Never guess'), 'missing the stated-only rule');
        assert.ok(template.includes('Out-of-character lines set no detail.'), 'missing the out-of-character rule');
        assert.ok(template.includes('only when the ledger does not know that kind of detail for the character yet'), 'missing the unknown-only rule');
    });

    it('asks for a details list in the answer, with the value always a string', () => {
        assert.ok(template.includes('"details": ['), 'missing the details list in the answer');
        assert.ok(template.includes('{ "character": "name", "kind": "gender | age | role | relation | status", "value": "the detail as a string", "of": "name, only for a relation", "change": "only for a changed detail: the on-screen event", "at": <index of the message> }'));
    });

    it('lets a new character from task 2 carry details', () => {
        assert.ok(template.includes('A new character from task 2 may carry details too.'));
    });
});

const HEADER_WITH_DETAILS = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for. '
    + 'A character keeps the details listed for them; a detail changes only when the story shows it changing.]';

function message(isUser, text) {
    return { is_user: isUser, is_system: false, name: isUser ? 'Ellie' : 'Narrator', mes: text };
}

describe('buildKnowledgeBlock — details', () => {
    it('prints a details line for a talked-about character with no knowledge lines, unknown kinds left out', () => {
        const ledger = makeLedger();
        ledger.scene.present = [];
        ledger.characters[1].details = {
            gender: [{ value: 'female', at: 5 }],
            age: [{ value: '40s', at: 5 }],
            role: [{ value: 'cleaner, double shifts, Oakland', at: 5 }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 5 }],
            status: [{ value: 'alive', at: 5 }],
        };

        const block = buildKnowledgeBlock(ledger, [message(true, 'Is Ama working tonight?')]);

        assert.equal(block, [
            HEADER_WITH_DETAILS,
            '',
            'AMA OSEI (talked about, not present)',
            '- Details: female; 40s; cleaner, double shifts, Oakland; Kendra Osei\'s mother',
        ].join('\n'));
    });

    it('puts the details line before the knowledge lines and marks a dead character in the heading', () => {
        const ledger = makeLedger();
        ledger.facts = [{
            id: 'f1', text: 'Kendra skipped school on Friday', public: false,
            holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 8 }],
        }];
        ledger.characters[0].details = { age: [{ value: '17', at: 4 }] };
        ledger.characters[1].details = { role: [{ value: 'cleaner', at: 5 }], status: [{ value: 'alive', at: 5 }, { value: 'dead', at: 9 }] };

        const block = buildKnowledgeBlock(ledger, [message(true, 'Kendra talks about Ama.')]);

        assert.equal(block, [
            HEADER_WITH_DETAILS,
            '',
            'KENDRA OSEI (present)',
            '- Details: 17',
            '- Knows: Kendra skipped school on Friday (known only to them)',
            '',
            'AMA OSEI (dead, talked about, not present)',
            '- Details: cleaner',
        ].join('\n'));
    });

    it('gives a dead character with no other detail a section of its heading only', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { status: [{ value: 'dead', at: 5 }] };

        const block = buildKnowledgeBlock(ledger, [message(true, 'I think of Ama.')]);

        assert.equal(block, [HEADER_WITH_DETAILS, '', 'AMA OSEI (dead, talked about, not present)'].join('\n'));
    });

    it('prints nothing for a character known only to be alive', () => {
        const ledger = makeLedger();
        ledger.characters[1].details = { status: [{ value: 'alive', at: 5 }] };

        assert.equal(buildKnowledgeBlock(ledger, [message(true, 'I think of Ama.')]), '');
    });

    it('leaves details of characters neither present nor talked about out, header sentence included', () => {
        const ledger = makeLedger();
        ledger.facts = [{
            id: 'f1', text: 'Kendra skipped school on Friday', public: false,
            holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 8 }],
        }];
        ledger.characters[1].details = { role: [{ value: 'cleaner', at: 5 }] };

        const block = buildKnowledgeBlock(ledger, [message(true, 'Hello.')]);

        assert.equal(block, [
            '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
                + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
                + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
                + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]',
            '',
            'KENDRA OSEI (present)',
            '- Knows: Kendra skipped school on Friday (known only to them)',
        ].join('\n'));
    });
});
