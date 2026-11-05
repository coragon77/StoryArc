import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeContent, saveCharacterDetails } from '../lib/ui/knowledge-popup.js';

/**
 * Kendra Osei and her mother Ama in the Paragon chat: the story stated Ama's
 * role at message 12 and her relation at message 14; the player set her age.
 */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            {
                id: 'c2',
                name: 'Ama Osei',
                aliases: ['Ama'],
                details: {
                    age: [{ value: '40s', at: null, by: 'user' }],
                    role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
                },
            },
        ],
        facts: [],
        scene: { at: 14, present: ['c1'] },
        lastUpdatedAt: 14,
    };
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The markup of the character row with this id, up to the next row. */
function characterRowOf(html, characterId) {
    return html.split('<li ').find(chunk => chunk.includes(`data-character-id="${characterId}"`)) || '';
}

describe('buildKnowledgeContent: character details', () => {
    it('shows each known detail of a character by its kind, and marks the ones the player set', () => {
        const rowText = textOf(characterRowOf(buildKnowledgeContent(makeLedger()), 'c2'));
        assert.ok(rowText.includes(
            'age: 40s (set by you); role: cleaner, double shifts, Oakland; relation: Kendra Osei&#39;s mother'), rowText);
    });

    it('shows no details line for a character with none known', () => {
        const rowHtml = characterRowOf(buildKnowledgeContent(makeLedger()), 'c1');
        assert.ok(!rowHtml.includes('story-arc-knowledge-details'));
    });
});

/** What the details editor of Ama's row shows before the player types anything. */
function amaAsShown() {
    return { gender: '', age: '40s', role: 'cleaner, double shifts, Oakland', relation: { kind: 'mother', of: 'c1' }, status: '' };
}

describe('saveCharacterDetails', () => {
    it('writes a detail the player sets as a player entry, which locks the kind', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), gender: ' female ' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details, {
            gender: [{ value: 'female', at: null, by: 'user' }],
            age: [{ value: '40s', at: null, by: 'user' }],
            role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('puts a corrected story detail after the story\'s entry, which stays in the history', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: 'night cleaner, Highland Hospital' });

        assert.deepEqual(ledger.characters[1].details.role, [
            { value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' },
            { value: 'night cleaner, Highland Hospital', at: null, by: 'user' },
        ]);
    });

    it('changes nothing for the fields left as shown, so saving locks no story detail', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', amaAsShown());

        assert.equal(error, null);
        assert.deepEqual(ledger, makeLedger());
    });

    it('replaces the player\'s own entry instead of adding a second one', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), age: '45' });

        assert.deepEqual(ledger.characters[1].details.age, [{ value: '45', at: null, by: 'user' }]);
    });

    it('clearing a player value removes the player entry; the story\'s entries count again', () => {
        const before = makeLedger();
        before.characters[1].details.role.push({ value: 'retired', at: null, by: 'user' });

        const { ledger } = saveCharacterDetails(before, 'c2', { ...amaAsShown(), age: ' ', role: '' });

        assert.deepEqual(ledger.characters[1].details, {
            role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('clearing the last player value leaves a record without details', () => {
        const before = makeLedger();
        before.characters[0].details = { status: [{ value: 'alive', at: null, by: 'user' }] };

        const { ledger } = saveCharacterDetails(before, 'c1', { gender: '', age: '', role: '', relation: { kind: '', of: '' }, status: '' });

        assert.deepEqual(ledger.characters[0], { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] });
    });

    it('leaves a story detail whose field the player emptied, since only a rollback takes it back', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: '', relation: { kind: '', of: '' } });

        assert.deepEqual(ledger, makeLedger());
    });

    it('sets a relation as a kinship word and the other character\'s id, and a status', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c1', {
            gender: '', age: '', role: '', relation: { kind: ' daughter ', of: 'c2' }, status: 'dead',
        });

        assert.deepEqual(ledger.characters[0].details, {
            relation: [{ value: { kind: 'daughter', of: 'c2' }, at: null, by: 'user' }],
            status: [{ value: 'dead', at: null, by: 'user' }],
        });
    });

    it('refuses a relation without a kinship word or without the other character', () => {
        assert.equal(
            saveCharacterDetails(makeLedger(), 'c1', { ...amaAsShown(), age: '', role: '', relation: { kind: 'daughter', of: '' } }).error,
            'A relation needs a kinship word and another character.');
        assert.equal(
            saveCharacterDetails(makeLedger(), 'c1', { ...amaAsShown(), age: '', role: '', relation: { kind: '', of: 'c2' } }).error,
            'A relation needs a kinship word and another character.');
    });

    it('refuses a relation to the character themselves or to someone not in the ledger', () => {
        const toSelf = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: 'sister', of: 'c1' }, status: '' });
        const toStranger = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: 'sister', of: 'c9' }, status: '' });

        assert.deepEqual(toSelf, { ledger: null, error: 'A relation needs another character.' });
        assert.deepEqual(toStranger, { ledger: null, error: 'A relation needs another character.' });
    });

    it('refuses a status other than alive or dead', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: '', of: '' }, status: 'missing' });

        assert.equal(ledger, null);
        assert.equal(error, 'A status is alive or dead.');
    });

    it('leaves the ledger it was given untouched', () => {
        const before = makeLedger();
        saveCharacterDetails(before, 'c2', { ...amaAsShown(), gender: 'female', age: '' });
        assert.deepEqual(before, makeLedger());
    });

    it('refuses an unknown character', () => {
        assert.equal(saveCharacterDetails(makeLedger(), 'c9', amaAsShown()).error, 'This character is no longer in the ledger.');
    });
});

describe('buildKnowledgeContent: the details editor', () => {
    it('fills each field with the current detail, and offers the other characters for the relation', () => {
        const rowHtml = characterRowOf(buildKnowledgeContent(makeLedger()), 'c2');

        assert.ok(rowHtml.includes('<input type="text" class="text_pole story-arc-detail-input" data-detail-kind="gender" value="">'));
        assert.ok(rowHtml.includes('<input type="text" class="text_pole story-arc-detail-input" data-detail-kind="age" value="40s">'));
        assert.ok(rowHtml.includes('data-detail-kind="role" value="cleaner, double shifts, Oakland">'));
        assert.ok(rowHtml.includes('<input type="text" class="text_pole story-arc-detail-relation-kind" value="mother">'));
        assert.ok(rowHtml.includes('<option value="c1" selected>Kendra Osei</option>'));
        assert.ok(!rowHtml.includes('<option value="c2"'), 'a character is no relative of themselves');
        assert.ok(rowHtml.includes('<option value="" selected>unknown</option><option value="alive">alive</option><option value="dead">dead</option>'));
        assert.ok(rowHtml.includes('story-arc-details-save-btn'));
    });
});
