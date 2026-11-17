import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteCharacter, mergeCharacters } from '../lib/ui/knowledge-popup.js';

/** Vera with stances toward Ellie and Dice, Dice (Ellie's codename record) with stances of its own, and Gabriel toward Dice. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Ellie Masters', aliases: [], details: { stance: [
                { value: { text: 'protective of her', of: 'c2' }, at: 3, messageId: 'm3' },
            ] } },
            { id: 'c2', name: 'Vera Lin', aliases: [], details: { stance: [
                { value: { text: 'devoted to her', of: 'c1' }, at: 4, messageId: 'm4' },
                { value: { text: 'in awe of her', of: 'c3' }, at: 5, messageId: 'm5' },
            ] } },
            { id: 'c3', name: 'Dice', aliases: [], details: { stance: [
                { value: { text: 'teasing him', of: 'c4' }, at: 6, messageId: 'm6' },
                { value: { text: 'fond of her', of: 'c2' }, at: 7, messageId: 'm7' },
                { value: { text: 'herself', of: 'c1' }, at: 8, messageId: 'm8' },
            ] } },
            { id: 'c4', name: 'Gabriel Marin', aliases: [], details: { stance: [
                { value: { text: 'smitten with her', of: 'c3' }, at: 9, messageId: 'm9' },
            ] } },
        ],
        facts: [],
        scene: { at: 10, present: ['c1'] },
    };
}

describe('mergeCharacters — stances', () => {
    it('keeps the main record\'s stance toward someone, adds the other\'s toward others, drops the one between them, and repoints stances toward the other record', () => {
        const { ledger, error } = mergeCharacters(makeLedger(), 'c1', 'c3');

        assert.equal(error, null);
        const ellie = ledger.characters.find(character => character.id === 'c1');
        assert.deepEqual(ellie.details.stance, [
            { value: { text: 'protective of her', of: 'c2' }, at: 3, messageId: 'm3' },
            { value: { text: 'teasing him', of: 'c4' }, at: 6, messageId: 'm6' },
        ]);
        const vera = ledger.characters.find(character => character.id === 'c2');
        assert.deepEqual(vera.details.stance, [
            { value: { text: 'devoted to her', of: 'c1' }, at: 4, messageId: 'm4' },
            { value: { text: 'in awe of her', of: 'c1' }, at: 5, messageId: 'm5' },
        ]);
        const gabriel = ledger.characters.find(character => character.id === 'c4');
        assert.deepEqual(gabriel.details.stance, [{ value: { text: 'smitten with her', of: 'c1' }, at: 9, messageId: 'm9' }]);
    });

    it('takes the other record\'s stance toward someone when only the other has the player\'s entry', () => {
        const startLedger = makeLedger();
        startLedger.characters[2].details.stance[1] = { value: { text: 'fond of her', of: 'c2' }, at: null, by: 'user' };

        const { ledger } = mergeCharacters(startLedger, 'c1', 'c3');

        const ellie = ledger.characters.find(character => character.id === 'c1');
        assert.deepEqual(ellie.details.stance, [
            { value: { text: 'fond of her', of: 'c2' }, at: null, by: 'user' },
            { value: { text: 'teasing him', of: 'c4' }, at: 6, messageId: 'm6' },
        ]);
    });
});

describe('deleteCharacter — stances', () => {
    it('removes the stances of other records toward the deleted character, and a kind left empty', () => {
        const { ledger, error } = deleteCharacter(makeLedger(), 'c3');

        assert.equal(error, null);
        const vera = ledger.characters.find(character => character.id === 'c2');
        assert.deepEqual(vera.details.stance, [{ value: { text: 'devoted to her', of: 'c1' }, at: 4, messageId: 'm4' }]);
        const gabriel = ledger.characters.find(character => character.id === 'c4');
        assert.equal(gabriel.details, undefined);
    });
});
