import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTakenNamesBlock, listTakenNames, foldName } from '../lib/knowledge/names.js';

const HEADER = '[NAMES ALREADY IN THIS STORY — first names, surnames and codenames of characters who have appeared. '
    + 'A new character gets none of these names, as a first name, as a surname or as part of a double or hyphenated surname: adding a second surname does not make a taken name new. '
    + 'Only a relative of the character who has a name may share it, and only when the story says how they are related. '
    + 'Characters already in the story keep their names.]';

/** A ledger holding only these characters, ids c1, c2, … in the given order. */
function ledgerOf(...characters) {
    return {
        characters: characters.map(([name, aliases = []], index) => ({ id: `c${index + 1}`, name, aliases })),
        facts: [],
        scene: { at: null, present: [] },
        lastUpdatedAt: null,
    };
}

/** The block the narrator sees for this list line. */
function blockListing(line) {
    return `${HEADER}\n${line}`;
}

describe('buildTakenNamesBlock — titles', () => {
    it('drops a title ending in a period: Dr. Thorne gives Thorne', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Dr. Thorne'])), blockListing('Thorne'));
    });

    it('drops titles without a period: Staff Sergeant Carver gives Carver', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Staff Sergeant Carver'])), blockListing('Carver'));
    });

    it('drops an office in front of a name: Judge Halpern gives Halpern', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Judge Halpern'])), blockListing('Halpern'));
    });

    it('drops kinship words and Spanish honorifics: Uncle Lau, Auntie May, Señora Delgado', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Uncle Lau'], ['Auntie May'], ['Señora Delgado'])),
            blockListing('Delgado, Lau, May'));
    });

    it('keeps a title that is the only word of the name', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Commissioner'])), blockListing('Commissioner'));
    });

    it('keeps a common given name that could stand in front of a name: Don Corrado gives Corrado, Don', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Don Corrado'])), blockListing('Corrado, Don'));
    });
});

describe('buildTakenNamesBlock — derivation', () => {
    it('prints the parts of a hyphenated surname: Capt. Marcus Vance-Sterling gives Marcus, Vance, Sterling', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Capt. Marcus Vance-Sterling'])),
            blockListing('Marcus, Sterling, Vance'));
    });

    it('counts aliases: Marcus Bishop with the alias Sundown gives Bishop, Marcus, Sundown', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Marcus Bishop', ['Sundown']])),
            blockListing('Bishop, Marcus, Sundown'));
    });

    it('prints a name repeated across records and casings once, in the first record\'s spelling', () => {
        const ledger = ledgerOf(['Marcus Chen'], ['MARCUS Park', ['marcus']], ['Ava chen']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Ava, Chen, Marcus, Park'));
    });

    it('treats Matías and Matias as one name, printed as the first record spells it', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Matías Ortega'], ['Matias'])),
            blockListing('Matías, Ortega'));
    });

    it('drops lowercase particles, digits, leading articles and enclosing punctuation', () => {
        const ledger = ledgerOf(['Ines de la Vega'], ['Unit 7'], ['The Architect'], ['"Lucky" (Rourke),'], ['Omar al-Rashid']);
        assert.equal(buildTakenNamesBlock(ledger),
            blockListing('Architect, Ines, Lucky, Omar, Rashid, Rourke, Unit, Vega'));
    });

    it('keeps a capitalised particle, which is a name: Noor Al-Jamil gives Al, Jamil, Noor', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Noor Al-Jamil'])), blockListing('Al, Jamil, Noor'));
    });

    it('skips an alias that is a lowercase description: "the night-shift tech" adds no name', () => {
        const ledger = ledgerOf(['Mara', ['the night-shift tech']], ['Unknown Caller', ['the intruder at the hallway junction box']]);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Caller, Mara, Unknown'));
    });

    it('keeps the capitalised words of a description that names someone: "the Brown-Haired Junior"', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Tessa', ['the Brown-Haired Junior']])),
            blockListing('Brown, Haired, Junior, Tessa'));
    });

    it('drops the pieces of a designation that are no name: HH-904 gives HH, ID #07-A gives ID', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Amy', ['HH-904', 'ID #07-A']])), blockListing('Amy, HH, ID'));
    });

    it('drops initials wherever they stand: Mara K., M. G., Julien M., W-04', () => {
        const ledger = ledgerOf(['Mara', ['Mara K.', 'M. G.']], ['Julien Morel', ['Julien M.']], ['Ellie Masters', ['W-04']]);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Ellie, Julien, Mara, Masters, Morel'));
    });

    it('drops a lowercase word inside a capitalised name: Woman with Umbrella gives Umbrella, Woman', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Woman with Umbrella'])), blockListing('Umbrella, Woman'));
    });

    it('keeps a name whose capital follows an apostrophe: Charles d\'Artagnan', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf(['Charles d\'Artagnan'])), blockListing('Charles, d\'Artagnan'));
    });

    it('drops the titles of Paragon\'s records: Nurse Cruz, Corporal Horton, Rear Admiral Keller, Principal Vance-Horton, Coach Harmon', () => {
        const ledger = ledgerOf(['Nurse Cruz'], ['Corporal Horton'], ['Rear Admiral Keller'], ['Principal Vance-Horton'], ['Coach Harmon']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Cruz, Harmon, Horton, Keller, Vance'));
    });

    it('sorts by the folded form, not by case or accent', () => {
        const ledger = ledgerOf(['zoe'], ['Émile'], ['Bram'], ['adler'], ['Ezra']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('adler, Bram, Émile, Ezra, zoe'));
    });

    it('is empty when the ledger has no character', () => {
        assert.equal(buildTakenNamesBlock(ledgerOf()), '');
    });
});

describe('buildTakenNamesBlock — byte stability', () => {
    const expected = blockListing('Bishop, Marcus, Noor, Sundown, Vance');

    it('gives the same text for the same characters in another order', () => {
        const first = ledgerOf(['Marcus Bishop', ['Sundown']], ['Noor'], ['Vance']);
        const second = ledgerOf(['Vance'], ['Noor'], ['Marcus Bishop', ['Sundown']]);
        assert.equal(buildTakenNamesBlock(first), expected);
        assert.equal(buildTakenNamesBlock(second), expected);
    });

    it('stays identical when a fact is added and the scene and a holder change', () => {
        const ledger = ledgerOf(['Marcus Bishop', ['Sundown']], ['Noor'], ['Vance']);
        ledger.facts.push({
            id: 'f1', text: 'Vance has the plate', public: false,
            holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 4 }],
        });
        ledger.scene = { at: 4, present: ['c2', 'c3'] };
        ledger.facts[0].holders.push({ characterId: 'c2', how: 'told', toldBy: 'c3', at: 5 });
        assert.equal(buildTakenNamesBlock(ledger), expected);
    });

    it('changes when a character is added', () => {
        const ledger = ledgerOf(['Marcus Bishop', ['Sundown']], ['Noor'], ['Vance'], ['Priya']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Bishop, Marcus, Noor, Priya, Sundown, Vance'));
    });

    it('changes when a character is renamed', () => {
        const ledger = ledgerOf(['Marcus Bishop', ['Sundown']], ['Noor'], ['Julian Vance']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Bishop, Julian, Marcus, Noor, Sundown, Vance'));
    });

    it('changes when an alias with a new word is added', () => {
        const ledger = ledgerOf(['Marcus Bishop', ['Sundown', 'Overdrive']], ['Noor'], ['Vance']);
        assert.equal(buildTakenNamesBlock(ledger), blockListing('Bishop, Marcus, Noor, Overdrive, Sundown, Vance'));
    });

    it('stays identical when an alias adds only words already taken', () => {
        const ledger = ledgerOf(['Marcus Bishop', ['Sundown', 'Mr. Bishop']], ['Noor', ['noor']], ['Vance']);
        assert.equal(buildTakenNamesBlock(ledger), expected);
    });
});

describe('listTakenNames — the comparison form the reused-name flag uses', () => {
    it('holds a hyphenated surname whole as well as by its parts, keyed by the folded form', () => {
        const takenNames = listTakenNames(ledgerOf(['Marissa Vance-Chén']));
        assert.deepEqual([...takenNames.keys()].sort(), ['chen', 'marissa', 'vance', 'vance-chen']);
        assert.equal(takenNames.get('vance-chen'), 'Vance-Chén');
    });

    it('folds case and diacritics: foldName("Matías") is "matias"', () => {
        assert.equal(foldName('Matías'), 'matias');
        assert.equal(foldName('SEÑORA'), 'senora');
    });
});
