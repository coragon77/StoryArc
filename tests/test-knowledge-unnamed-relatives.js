import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillTemplate } from '../lib/planning/generator.js';
import { chat_metadata, extension_settings } from './mocks/st-mocks.js';
import {
    applyExtractionAnswer,
    buildKnowledgeBlock,
    buildKnowledgeExtractionVariables,
    characterName,
    currentDetailText,
    dropKnowledgeFrom,
    isDetailLocked,
    parseKnowledgeExtractionAnswer,
} from '../lib/knowledge/ledger.js';
import { printTakenNames } from '../lib/knowledge/names.js';
import { addUnnamedRelative, buildKnowledgeContent, createKnowledgeView, renameCharacter, saveCharacterDetails } from '../lib/ui/knowledge-popup.js';
import { harvestContext } from '../lib/context/harvester.js';

/**
 * Kendra Osei and her mother, whom the story has not named yet: the
 * extraction created the record with its relation (record identity: at null, by 'record')
 * and the story stated her role at message 12.
 */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            {
                id: 'c2',
                name: '',
                aliases: [],
                details: {
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }],
                    role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
                },
            },
        ],
        facts: [],
        scene: { at: 12, present: ['c1', 'c2'] },
        sceneHistory: [],
        lastUpdatedAt: 12,
    };
}

/** A ledger with only Kendra, updated through message 12. */
function ledgerWithKendra() {
    return {
        characters: [{ id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] }],
        facts: [],
        scene: { at: 12, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 12,
    };
}

/** Messages 13 and 14, each already carrying its Story Arc message id. */
function makeChat() {
    const chatMessages = [];
    chatMessages[13] = { name: 'Ellie', is_user: true, mes: 'Is your mom home?', extra: { story_arc_message_id: 'm13' } };
    chatMessages[14] = { name: 'Narrator', is_user: false, mes: 'Her mother waves from the kitchen.', extra: { story_arc_message_id: 'm14' } };
    return chatMessages;
}

function answerWith(parts) {
    return { present: [], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details: [], ...parts };
}

describe('unnamed relative: the display name', () => {
    it('is the other character\'s name and the kinship word', () => {
        assert.equal(characterName(makeLedger(), 'c2'), "Kendra Osei's mother");
    });

    it('falls back to "unnamed character" and the id when the record has no relation', () => {
        const ledger = makeLedger();
        ledger.characters.push({ id: 'c3', name: '', aliases: [] });

        assert.equal(characterName(ledger, 'c3'), 'unnamed character c3');
    });

    it('does not loop when two unnamed records are related to each other', () => {
        const ledger = {
            characters: [
                { id: 'c1', name: '', aliases: [], details: { relation: [{ value: { kind: 'sister', of: 'c2' }, at: null, by: 'record' }] } },
                { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'sister', of: 'c1' }, at: null, by: 'record' }] } },
            ],
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: null,
        };

        assert.equal(characterName(ledger, 'c1'), "unnamed character c2's sister");
    });

    it('is what the record\'s relation detail reads, so the two never differ', () => {
        const ledger = {
            characters: [
                { id: 'c1', name: '', aliases: [], details: { relation: [{ value: { kind: 'sister', of: 'c2' }, at: null, by: 'record' }] } },
                { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'sister', of: 'c1' }, at: null, by: 'record' }] } },
            ],
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: null,
        };

        assert.equal(currentDetailText(ledger, ledger.characters[0], 'relation'), "unnamed character c2's sister");
    });

    it('heads the character\'s section in the knowledge block', () => {
        const block = buildKnowledgeBlock(makeLedger(), [
            { is_user: true, mes: 'Hi.' },
            { is_user: false, mes: 'Hello.' },
        ]);

        assert.ok(block.includes("KENDRA OSEI'S MOTHER (present)\n- Details: cleaner, double shifts, Oakland; Kendra Osei's mother"), block);
    });

    it('lists the record in the extraction input, marked unnamed', () => {
        const variables = buildKnowledgeExtractionVariables(makeLedger(), makeChat(), 13, 'Ellie');

        assert.equal(variables.CHARACTERS, [
            '- Kendra Osei (also: Kendra)',
            "- Kendra Osei's mother (unnamed) — role: cleaner, double shifts, Oakland; relation: Kendra Osei's mother",
        ].join('\n'));
    });

    it('names a fact holder in the extraction input', () => {
        const ledger = makeLedger();
        ledger.facts.push({ id: 'f1', text: 'Kendra skipped school.', public: false, holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 12 }] });

        const variables = buildKnowledgeExtractionVariables(ledger, makeChat(), 13, 'Ellie');

        assert.equal(variables.FACTS, "- [f1] Kendra skipped school. (known to: Kendra Osei's mother)");
    });
});

describe('unnamed relative: taken names', () => {
    it('adds no taken name, even through an alias', () => {
        const ledger = makeLedger();
        ledger.characters[1].aliases = ['Mrs. Abena'];

        assert.deepEqual(printTakenNames(ledger), ['Kendra', 'Osei']);
    });
});

describe('unnamed relative: the extraction prompt', () => {
    // The prompt as sent while character details are on.
    const emptyLedger = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };
    const template = fillTemplate(
        readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8'),
        buildKnowledgeExtractionVariables(emptyLedger, [], 0, 'Ellie', [], [], [], true));

    it('lets a new character be an unnamed relative and a later answer name one', () => {
        assert.ok(template.includes('leave "name" empty and give "relation", the kinship word'), 'missing the unnamed relative');
        assert.ok(template.includes('list them here with that name and "wasUnnamed"'), 'missing the naming');
        assert.ok(template.includes('"wasUnnamed": "the name the characters list shows for an unnamed relative"'), 'missing wasUnnamed in the answer shape');
    });
});

describe('unnamed relative: parsing the extraction answer', () => {
    it('reads a new character without a name but with a relation', () => {
        const parsed = parseKnowledgeExtractionAnswer(JSON.stringify(answerWith({
            newCharacters: [{ name: '', aliases: [], relation: 'mother', of: 'Kendra Osei' }],
        })));

        assert.deepEqual(parsed.newCharacters, [{ name: '', aliases: [], relation: { kind: 'mother', of: 'Kendra Osei' } }]);
    });

    it('reads a null or missing name the same way', () => {
        const parsed = parseKnowledgeExtractionAnswer(JSON.stringify(answerWith({
            newCharacters: [
                { name: null, aliases: [], relation: 'father', of: 'Kendra Osei' },
                { aliases: [], relation: 'brother', of: 'Kendra Osei' },
            ],
        })));

        assert.deepEqual(parsed.newCharacters, [
            { name: '', aliases: [], relation: { kind: 'father', of: 'Kendra Osei' } },
            { name: '', aliases: [], relation: { kind: 'brother', of: 'Kendra Osei' } },
        ]);
    });

    it('rejects a new character with neither a name nor a whole relation', () => {
        const noRelation = JSON.stringify(answerWith({ newCharacters: [{ name: '', aliases: [] }] }));
        const noOther = JSON.stringify(answerWith({ newCharacters: [{ name: '', aliases: [], relation: 'mother' }] }));

        assert.equal(parseKnowledgeExtractionAnswer(noRelation), null);
        assert.equal(parseKnowledgeExtractionAnswer(noOther), null);
    });

    it('reads the name a later answer gives an unnamed relative', () => {
        const parsed = parseKnowledgeExtractionAnswer(JSON.stringify(answerWith({
            newCharacters: [{ name: 'Abena Osei', aliases: ['Abena'], wasUnnamed: "Kendra Osei's mother" }],
        })));

        assert.deepEqual(parsed.newCharacters, [{ name: 'Abena Osei', aliases: ['Abena'], wasUnnamed: "Kendra Osei's mother" }]);
    });

    it('rejects a wasUnnamed that is not a string', () => {
        const answerText = JSON.stringify(answerWith({ newCharacters: [{ name: 'Abena Osei', aliases: [], wasUnnamed: 3 }] }));

        assert.equal(parseKnowledgeExtractionAnswer(answerText), null);
    });
});

describe('unnamed relative: applying the extraction answer', () => {
    it('creates the nameless record with its relation, which the details of the same answer find by display name', () => {
        const ledger = ledgerWithKendra();

        const changed = applyExtractionAnswer(ledger, answerWith({
            present: ['Kendra Osei', "Kendra Osei's mother"],
            newCharacters: [{ name: '', aliases: [], relation: { kind: 'mother', of: 'Kendra Osei' } }],
            details: [{ character: "Kendra Osei's mother", kind: 'role', value: 'cleaner', at: 14 }],
        }), 13, 14, makeChat());

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters[1], {
            id: 'c2',
            name: '',
            aliases: [],
            details: {
                relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }],
                role: [{ value: 'cleaner', at: 14, messageId: 'm14' }],
            },
        });
        assert.deepEqual(ledger.scene.present, ['c1', 'c2']);
    });

    it('relates the nameless record to a named character the same answer adds after it', () => {
        const ledger = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [
                { name: '', aliases: [], relation: { kind: 'mother', of: 'Kendra Osei' } },
                { name: 'Kendra Osei', aliases: [] },
            ],
        }), 13, 14);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: [] },
            { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] } },
        ]);
    });

    it('creates nothing for a relation to someone outside the cast', () => {
        const ledger = ledgerWithKendra();

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: '', aliases: [], relation: { kind: 'mother', of: 'Vera Lin' } }],
        }), 13, 14);

        assert.equal(ledger.characters.length, 1);
    });

    it('creates no second record with the same display name', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: '', aliases: [], relation: { kind: 'Mother', of: 'Kendra' } }],
        }), 13, 14);

        assert.equal(ledger.characters.length, 2);
    });

    it('gives the nameless record no name clash', () => {
        const ledger = ledgerWithKendra();
        ledger.characters.push({ id: 'c2', name: 'Abena Mensah', aliases: [] });

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: '', aliases: [], relation: { kind: 'mother', of: 'Kendra Osei' } }],
        }), 13, 14);

        assert.equal(ledger.characters[2].nameClash, undefined);
    });

    it('finds the record by display name as a holder', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({
            learned: [{ text: 'Kendra skipped school.', public: false, who: ["kendra osei's mother"], how: 'witnessed', toldBy: null, at: 14 }],
        }), 13, 14);

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 14 }]);
    });

    it('names the record when an answer gives its name, keeping id, details and no name clash', () => {
        const ledger = makeLedger();

        const changed = applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: 'Abena Osei', aliases: ['Abena'], wasUnnamed: "Kendra Osei's mother" }],
            details: [{ character: 'Abena Osei', kind: 'age', value: '40s', at: 14 }],
        }), 13, 14);

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            {
                id: 'c2',
                name: 'Abena Osei',
                aliases: ['Abena'],
                details: {
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }],
                    role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
                    age: [{ value: '40s', at: 14 }],
                },
            },
        ]);
    });

    it('adds a new character when the record it names is not an unnamed one', () => {
        const ledger = ledgerWithKendra();

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: 'Abena Osei', aliases: [], wasUnnamed: "Kendra Osei's mother" }],
        }), 13, 14);

        assert.deepEqual(ledger.characters[1], { id: 'c2', name: 'Abena Osei', aliases: [], nameClash: { names: ['Osei'], at: 14 } });
    });

    it('keeps the record\'s relation through a rollback of every message', () => {
        const ledger = makeLedger();

        dropKnowledgeFrom(ledger, 0);

        assert.deepEqual(ledger.characters[1].details, { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] });
    });
});

describe('unnamed relative: the record\'s relation entry', () => {
    it('locks nothing: a later relation change from the story is recorded', () => {
        const ledger = makeLedger();
        const detailCounts = {};

        applyExtractionAnswer(ledger, answerWith({
            details: [{ character: "Kendra Osei's mother", kind: 'relation', value: 'stepmother', of: 'Kendra Osei', at: 14, change: 'the adoption papers are signed' }],
        }), 13, 14, makeChat(), detailCounts);

        assert.equal(isDetailLocked(ledger.characters[1], 'relation'), false);
        assert.equal(detailCounts.detailsLocked, 0);
        assert.deepEqual(ledger.characters[1].details.relation, [
            { value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' },
            { value: { kind: 'stepmother', of: 'c1' }, at: 14, messageId: 'm14' },
        ]);
    });

    it('survives a rollback that takes back the story\'s later relation entry', () => {
        const ledger = makeLedger();
        ledger.characters[1].details.relation.push({ value: { kind: 'stepmother', of: 'c1' }, at: 14, messageId: 'm14' });

        dropKnowledgeFrom(ledger, 13);

        assert.deepEqual(ledger.characters[1].details.relation, [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }]);
    });
});

describe('unnamed relative: talked about', () => {
    /** Kendra in the scene, her unnamed mother away, and a latest reply with this text. */
    function blockForReply(replyText) {
        const ledger = makeLedger();
        ledger.scene.present = ['c1'];
        return buildKnowledgeBlock(ledger, [
            { is_user: true, mes: 'Hi.' },
            { is_user: false, mes: replyText },
        ]);
    }
    const talkedAboutHeading = "KENDRA OSEI'S MOTHER (talked about, not present)";

    it('counts when the text names the relative through the other character\'s alias', () => {
        assert.ok(blockForReply("Kendra's mother is working a double shift.").includes(talkedAboutHeading));
    });

    it('counts when the text names the relative through the other character\'s full name', () => {
        assert.ok(blockForReply("Kendra Osei's mother is working a double shift.").includes(talkedAboutHeading));
    });

    it('counts with a curly apostrophe', () => {
        assert.ok(blockForReply('Kendra\u2019s mother is working a double shift.').includes(talkedAboutHeading));
        assert.ok(blockForReply('Kendra Osei\u2019s mother is working a double shift.').includes(talkedAboutHeading));
    });

    it('ignores letter case', () => {
        assert.ok(blockForReply("KENDRA'S MOTHER is working a double shift.").includes(talkedAboutHeading));
    });

    it('counts only a whole word', () => {
        assert.ok(!blockForReply("Kendra's motherboard is broken.").includes(talkedAboutHeading));
        assert.ok(!blockForReply("Akendra's mother is home.").includes(talkedAboutHeading));
    });
});

describe('unnamed relative: the Knowledge popup', () => {
    it('adds an unnamed relative as a nameless record with the player\'s relation', () => {
        const { ledger, error } = addUnnamedRelative(ledgerWithKendra(), { id: 'c2', kind: ' mother ', of: 'c1' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1], {
            id: 'c2',
            name: '',
            aliases: [],
            details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'user' }] },
        });
    });

    it('refuses an unnamed relative without a kinship word or another character', () => {
        assert.equal(addUnnamedRelative(ledgerWithKendra(), { id: 'c2', kind: '', of: 'c1' }).error,
            'An unnamed relative needs a kinship word and another character.');
        assert.equal(addUnnamedRelative(ledgerWithKendra(), { id: 'c2', kind: 'mother', of: '' }).error,
            'An unnamed relative needs a kinship word and another character.');
    });

    it('refuses a second unnamed relative with the same display name', () => {
        const { error } = addUnnamedRelative(makeLedger(), { id: 'c3', kind: 'mother', of: 'c1' });

        assert.equal(error, "Kendra Osei's mother is already in the ledger.");
    });

    it('shows the display name in the character\'s row and as the fact\'s holder', () => {
        const ledger = makeLedger();
        ledger.facts.push({ id: 'f1', text: 'Kendra skipped school.', public: false, holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 12 }] });
        const view = createKnowledgeView();
        view.tab = 'cast';
        view.query = 'kendra';

        const text = buildKnowledgeContent(ledger, [], true, view).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

        assert.ok(text.includes('Kendra Osei&#39;s mother cleaner, double shifts, Oakland knows 1 in the scene unnamed relative'), text);
        assert.ok(text.includes('Kendra skipped school. Kendra Osei&#39;s mother (witnessed) #12'));
        assert.ok(!text.includes('unnamed character'));
    });

    it('offers a form to add an unnamed relative, whose picker offers every character to relate to', () => {
        const view = createKnowledgeView();
        view.tab = 'cast';
        view.sheet = { type: 'add', id: 'relative', prefill: {} };

        const html = buildKnowledgeContent(ledgerWithKendra(), [], true, view);

        assert.ok(html.includes('Add unnamed relative'));
        assert.ok(html.includes('id="sa-k-add-kin"'));
        assert.match(html, /data-pick="add" data-cid="c1" aria-selected="true"><span>Kendra Osei<\/span>/);
        assert.ok(html.includes('data-act="create-relative"'));
    });

    it('keeps an unnamed relative nameless when its aliases are saved with an empty name', () => {
        const { ledger, error } = renameCharacter(makeLedger(), 'c2', '  ');

        assert.equal(error, null);
        assert.equal(ledger.characters[1].name, '');
    });

    it('still refuses to empty the name of a named character', () => {
        assert.equal(renameCharacter(makeLedger(), 'c1', '').error, 'A character needs a name.');
    });

    it('names an unnamed relative, keeping its id and details', () => {
        const { ledger } = renameCharacter(makeLedger(), 'c2', 'Abena Osei');

        assert.equal(ledger.characters[1].id, 'c2');
        assert.equal(ledger.characters[1].name, 'Abena Osei');
        assert.deepEqual(ledger.characters[1].details, makeLedger().characters[1].details);
    });

    it('refuses to empty the only relation of an unnamed relative', () => {
        const { ledger } = addUnnamedRelative(ledgerWithKendra(), { id: 'c2', kind: 'mother', of: 'c1' });

        const result = saveCharacterDetails(ledger, 'c2', { relation: { kind: '', of: '' } }, { relation: { kind: 'mother', of: 'c1' } });

        assert.equal(result.error, 'An unnamed relative needs a relation. Give them a name first.');
    });
});

describe('unnamed relative: the planner\'s cast', () => {
    it('leaves out records without a name', async () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true } };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: {}, pendingMarks: [], knowledge: makeLedger() };
        try {
            const context = await harvestContext();
            assert.deepEqual(context.cast, [{ name: 'Kendra Osei', aliases: ['Kendra'] }]);
        } finally {
            delete chat_metadata.story_arc;
            delete extension_settings.story_arc;
        }
    });
});
