import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillTemplate } from '../lib/planning/generator.js';
import { dropKnowledgeFrom } from '../lib/knowledge/ledger.js';
import {
    applySeededState,
    buildSeedVariables,
    listCharactersToSeed,
    parseSeedAnswer,
    STATE_SEED_MIN_FACTS,
} from '../lib/knowledge/state-seed.js';

/**
 * Vera holds `veraFactCount` facts, each shared with Ellie, the newest at
 * the highest index; Jalen holds 3, shared with Ellie. All three present.
 */
function makeLedger(veraFactCount) {
    const facts = [];
    for (let number = 1; number <= veraFactCount; number++) {
        facts.push({ id: `f${number}`, text: `Vera fact ${number}.`, public: false, holders: [
            { characterId: 'c2', how: 'witnessed', at: number },
            { characterId: 'c1', how: 'witnessed', at: number },
        ] });
    }
    for (let number = 1; number <= 3; number++) {
        facts.push({ id: `j${number}`, text: `Jalen fact ${number}.`, public: false, holders: [
            { characterId: 'c3', how: 'witnessed', at: 100 + number },
            { characterId: 'c1', how: 'witnessed', at: 100 + number },
        ] });
    }
    return {
        characters: [
            { id: 'c1', name: 'Ellie Masters', aliases: ['Ellie'] },
            { id: 'c2', name: 'Vera Lin', aliases: ['Vera'] },
            { id: 'c3', name: 'Jalen Briscoe', aliases: ['Jalen'] },
        ],
        facts,
        retractedFacts: [],
        scene: { at: 200, present: ['c1', 'c2', 'c3'] },
        sceneHistory: [],
        meetings: [],
        lastUpdatedAt: 200,
    };
}

describe('listCharactersToSeed', () => {
    it('picks a present character with at least the minimum of facts and no state, not one with fewer', () => {
        assert.equal(STATE_SEED_MIN_FACTS, 40);
        const ledger = makeLedger(40);

        // Ellie holds 43, Vera 40, Jalen 3.
        assert.deepEqual(listCharactersToSeed(ledger).map(character => character.id), ['c1', 'c2']);
    });

    it('skips a character with any state entry, and one who is not present', () => {
        const ledger = makeLedger(40);
        ledger.characters[1].details = { stance: [{ value: { text: 'devoted to her', of: 'c1' }, at: 5 }] };
        ledger.scene.present = ['c2', 'c3'];

        assert.deepEqual(listCharactersToSeed(ledger), []);
    });
});

describe('buildSeedVariables', () => {
    it('lists the facts newest first, the others by shared facts, and only always-on lorebook entries that name them', () => {
        const ledger = makeLedger(3);
        const lorebookEntries = [
            { comment: 'Dramatis Personae', content: 'Vera Lin is a Ward recruit.', constant: true },
            { comment: 'Docks', content: 'The harbor at night.', constant: true },
            { comment: 'Vera keyword entry', content: 'Vera Lin keyword text.', constant: false },
        ];

        const variables = buildSeedVariables(ledger, ledger.characters[1], lorebookEntries);

        assert.equal(variables.CHARACTER, 'Vera Lin (also: Vera)');
        assert.equal(variables.FACTS, '- Vera fact 3.\n- Vera fact 2.\n- Vera fact 1.');
        assert.equal(variables.OTHERS, '- Ellie Masters');
        assert.equal(variables.LOREBOOK, '[Dramatis Personae]\nVera Lin is a Ward recruit.');
    });

    it('stops the facts at the budget of 24,000 characters', () => {
        const ledger = makeLedger(0);
        // 300 facts of 99 characters: each line "- " + 99 + newline is 102,
        // so 235 lines (23,970) fit and the 236th would make 24,072.
        for (let number = 1; number <= 300; number++) {
            ledger.facts.push({ id: `v${number}`, text: `${String(number).padStart(3, '0')}${'x'.repeat(96)}`, public: false,
                holders: [{ characterId: 'c2', how: 'witnessed', at: number }] });
        }

        const factLines = buildSeedVariables(ledger, ledger.characters[1], []).FACTS.split('\n');

        assert.equal(factLines.length, 235);
        assert.ok(factLines[0].startsWith('- 300'));
        assert.ok(factLines[234].startsWith('- 066'));
    });
});

describe('seed-state.txt', () => {
    it('leaves no placeholder unfilled with the seed\'s variables', () => {
        const template = readFileSync(new URL('../prompts/seed-state.txt', import.meta.url), 'utf8');
        const ledger = makeLedger(3);

        const prompt = fillTemplate(template, buildSeedVariables(ledger, ledger.characters[1], []));

        assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
        assert.ok(prompt.includes('== FACTS THEY HOLD, NEWEST FIRST ==\n- Vera fact 3.'));
    });
});

describe('parseSeedAnswer', () => {
    it('trims the fields and leaves out stances without a name or a text', () => {
        const answer = parseSeedAnswer('{"style": " fitted ", "manner": "", "stances": [{"toward": "Ellie", "text": " devoted "}, {"toward": "", "text": "x"}, {"toward": "Jalen"}]}');

        assert.deepEqual(answer, { style: 'fitted', manner: '', stances: [{ toward: 'Ellie', text: 'devoted' }] });
    });

    it('reads no answer from prose', () => {
        assert.equal(parseSeedAnswer('I cannot tell.'), null);
    });
});

describe('applySeededState', () => {
    it('stores seed entries that survive a rollback and lock nothing', () => {
        const ledger = makeLedger(3);
        const vera = ledger.characters[1];

        const stored = applySeededState(ledger, vera, {
            style: 'fitted and feminine',
            manner: 'soft, eager to be of use',
            stances: [{ toward: 'Ellie', text: 'devoted to her' }, { toward: 'Nobody Known', text: 'x' }, { toward: 'Vera', text: 'self' }],
        });

        assert.equal(stored, true);
        assert.deepEqual(vera.details, {
            style: [{ value: 'fitted and feminine', at: null, by: 'seed' }],
            manner: [{ value: 'soft, eager to be of use', at: null, by: 'seed' }],
            stance: [{ value: { text: 'devoted to her', of: 'c1' }, at: null, by: 'seed' }],
        });

        dropKnowledgeFrom(ledger, 0);
        assert.deepEqual(vera.details.style, [{ value: 'fitted and feminine', at: null, by: 'seed' }]);
        assert.deepEqual(vera.details.stance, [{ value: { text: 'devoted to her', of: 'c1' }, at: null, by: 'seed' }]);
    });

    it('stores nothing for an empty answer', () => {
        const ledger = makeLedger(3);

        assert.equal(applySeededState(ledger, ledger.characters[1], { style: '', manner: '', stances: [] }), false);
        assert.equal(ledger.characters[1].details, undefined);
    });
});

describe('buildSeedVariables — lorebook entries', () => {
    it('takes an entry that names them as a whole word, skips a too long one and still takes the next', () => {
        const ledger = makeLedger(3);
        ledger.characters.push({ id: 'c5', name: 'Al', aliases: [] });
        const lorebookEntries = [
            { comment: 'World', content: `Vera Lin ${'x'.repeat(7000)}`, constant: true },
            { comment: 'Also', content: 'Also note the harbor.', constant: true },
            { comment: 'Cast', content: 'Al runs the bakery.', constant: true },
        ];

        const variables = buildSeedVariables(ledger, ledger.characters[3], lorebookEntries);

        assert.equal(variables.LOREBOOK, '[Cast]\nAl runs the bakery.');
        const veraVariables = buildSeedVariables(ledger, ledger.characters[1], lorebookEntries);
        assert.equal(veraVariables.LOREBOOK, '(none)');
    });
});

describe('buildSeedVariables — lorebook ranking', () => {
    it('puts an entry named after them first, then their own cast line, then paragraphs that only mention them', () => {
        const ledger = makeLedger(3);
        const lorebookEntries = [
            { comment: 'Arc notes', content: 'The gala runs late.\n\nEllie and Vera Lin arrive together.', constant: true },
            { comment: 'Dramatis Personae', content: '* **Ellie Masters:** Bratty.\n* **Vera Lin (Fletchette):** Guarded since six.', constant: true },
            { comment: "Vera's Wardrobe", content: 'Fitted and feminine.', constant: true },
        ];

        const variables = buildSeedVariables(ledger, ledger.characters[1], lorebookEntries);

        assert.equal(variables.LOREBOOK, [
            "[Vera's Wardrobe]\nFitted and feminine.",
            '[Dramatis Personae]\n* **Vera Lin (Fletchette):** Guarded since six.',
            '[Arc notes]\nEllie and Vera Lin arrive together.',
        ].join('\n\n'));
    });
});
