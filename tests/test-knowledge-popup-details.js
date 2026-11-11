import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeContent, createKnowledgeView, lockCharacterDetail, saveCharacterDetails } from '../lib/ui/knowledge-popup.js';
import { dropKnowledgeFrom, isDetailLocked } from '../lib/knowledge/ledger.js';

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

/** A view of Cast & facts with this character's sheet open */
function sheetViewOf(characterId) {
    const view = createKnowledgeView();
    view.tab = 'cast';
    view.sheet = { type: 'character', id: characterId };
    return view;
}

/** A view of Cast & facts with everyone A–Z unfolded */
function allCharactersView() {
    const view = createKnowledgeView();
    view.tab = 'cast';
    view.foldOpen.all = true;
    return view;
}

/** The markup of the character's result row, up to its end. */
function characterRowOf(html, characterId) {
    const rowChunk = html.split('<button type="button" class="k-row"').slice(1).find(chunk => chunk.includes(`data-character-id="${characterId}"`)) || '';
    return rowChunk.split('</button>')[0];
}

/** The markup of a detail row of the open sheet. */
function detailRowOf(html, kind) {
    const start = html.indexOf(`data-detail="${kind}"`);
    if (start === -1) return '';
    return html.slice(start, html.indexOf('<div class="k-detail"', start + 1) === -1 ? html.indexOf('</dl>', start) : html.indexOf('<div class="k-detail"', start + 1));
}

describe('buildKnowledgeContent: character details', () => {
    it('shows each detail of a character\'s sheet with where it came from, and marks the ones the player set', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c2'));

        assert.ok(textOf(detailRowOf(html, 'age')).includes('Age 40s Locked by you Edit Clear'), textOf(detailRowOf(html, 'age')));
        assert.ok(textOf(detailRowOf(html, 'role')).includes('Role cleaner, double shifts, Oakland From the story, message #12 Edit Lock'));
        assert.ok(textOf(detailRowOf(html, 'relation')).includes('Relation Kendra Osei&#39;s mother From the story, message #14'));
        assert.ok(textOf(detailRowOf(html, 'gender')).includes('Gender unknown The story has not stated it. Set'));
    });

    it('sums up the details in the character\'s row, and says when none is known', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, allCharactersView());

        assert.ok(textOf(characterRowOf(html, 'c2')).includes('40s · cleaner, double shifts, Oakland · Kendra Osei&#39;s mother'));
        assert.ok(textOf(characterRowOf(html, 'c1')).includes('No details known'));
    });

    it('hides the details and the unnamed relative form while character details are off', () => {
        const sheetHtml = buildKnowledgeContent(makeLedger(), [], false, sheetViewOf('c2'));
        const listHtml = buildKnowledgeContent(makeLedger(), [], false, allCharactersView());

        assert.ok(!sheetHtml.includes('cleaner'));
        assert.ok(!sheetHtml.includes('sa-k-sec-details'));
        assert.ok(sheetHtml.includes('Ama Osei'));
        assert.ok(!characterRowOf(listHtml, 'c2').includes('cleaner'));
        assert.ok(!textOf(listHtml).includes('Add unnamed relative'));
    });

    it('keeps an unnamed relative\'s display name while character details are off', () => {
        const ledger = makeLedger();
        ledger.characters.push({ id: 'c3', name: '', aliases: [], details: { relation: [{ value: { kind: 'father', of: 'c1' }, at: null, by: 'record' }] } });

        const rowText = textOf(characterRowOf(buildKnowledgeContent(ledger, [], false, allCharactersView()), 'c3'));

        assert.ok(rowText.includes('Kendra Osei&#39;s father'), rowText);
        assert.ok(rowText.includes('unnamed relative'));
    });

    it('shows the details and the unnamed relative form while character details are on', () => {
        assert.ok(buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c2')).includes('id="sa-k-sec-details"'));
        assert.ok(textOf(buildKnowledgeContent(makeLedger(), [], true, allCharactersView())).includes('Add unnamed relative'));
    });
});


/** What the details editor of Ama's row shows before the player types anything. */
function amaAsShown() {
    return { gender: '', age: '40s', role: 'cleaner, double shifts, Oakland', relation: { kind: 'mother', of: 'c1' }, status: '' };
}

/** What the details editor of Kendra's row shows: every field empty. */
function kendraAsShown() {
    return { gender: '', age: '', role: '', relation: { kind: '', of: '' }, status: '' };
}
describe('saveCharacterDetails', () => {
    it('writes a detail the player sets as a player entry, which locks the kind', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), gender: ' female ' }, amaAsShown());

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details, {
            gender: [{ value: 'female', at: null, by: 'user' }],
            age: [{ value: '40s', at: null, by: 'user' }],
            role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('puts a corrected story detail after the story\'s entry, which stays in the history', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: 'night cleaner, Highland Hospital' }, amaAsShown());

        assert.deepEqual(ledger.characters[1].details.role, [
            { value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' },
            { value: 'night cleaner, Highland Hospital', at: null, by: 'user' },
        ]);
    });

    it('changes nothing for the fields left as shown, so saving locks no story detail', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', amaAsShown(), amaAsShown());

        assert.equal(error, null);
        assert.deepEqual(ledger, makeLedger());
    });

    it('replaces the player\'s own entry instead of adding a second one', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), age: '45' }, amaAsShown());

        assert.deepEqual(ledger.characters[1].details.age, [{ value: '45', at: null, by: 'user' }]);
    });

    it('clearing a player value removes the player entry; the story\'s entries count again', () => {
        const before = makeLedger();
        before.characters[1].details.role.push({ value: 'retired', at: null, by: 'user' });

        const { ledger } = saveCharacterDetails(before, 'c2', { ...amaAsShown(), age: ' ', role: '' }, amaAsShown());

        assert.deepEqual(ledger.characters[1].details, {
            role: [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('clearing the last player value leaves a record without details', () => {
        const before = makeLedger();
        before.characters[0].details = { status: [{ value: 'alive', at: null, by: 'user' }] };

        const { ledger } = saveCharacterDetails(before, 'c1', { gender: '', age: '', role: '', relation: { kind: '', of: '' }, status: '' }, { ...kendraAsShown(), status: 'alive' });

        assert.deepEqual(ledger.characters[0], { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] });
    });

    it('leaves a story detail whose field the player emptied, since only a rollback takes it back', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: '', relation: { kind: '', of: '' } }, amaAsShown());

        assert.deepEqual(ledger, makeLedger());
    });

    it('sets a relation as a kinship word and the other character\'s id, and a status', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c1', {
            gender: '', age: '', role: '', relation: { kind: ' daughter ', of: 'c2' }, status: 'dead',
        }, kendraAsShown());

        assert.deepEqual(ledger.characters[0].details, {
            relation: [{ value: { kind: 'daughter', of: 'c2' }, at: null, by: 'user' }],
            status: [{ value: 'dead', at: null, by: 'user' }],
        });
    });

    it('refuses a relation without a kinship word or without the other character', () => {
        assert.equal(
            saveCharacterDetails(makeLedger(), 'c1', { ...amaAsShown(), age: '', role: '', relation: { kind: 'daughter', of: '' } }, kendraAsShown()).error,
            'A relation needs a kinship word and another character.');
        assert.equal(
            saveCharacterDetails(makeLedger(), 'c1', { ...amaAsShown(), age: '', role: '', relation: { kind: '', of: 'c2' } }, kendraAsShown()).error,
            'A relation needs a kinship word and another character.');
    });

    it('refuses a relation to the character themselves or to someone not in the ledger', () => {
        const toSelf = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: 'sister', of: 'c1' }, status: '' }, kendraAsShown());
        const toStranger = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: 'sister', of: 'c9' }, status: '' }, kendraAsShown());

        assert.deepEqual(toSelf, { ledger: null, error: 'A relation needs another character.' });
        assert.deepEqual(toStranger, { ledger: null, error: 'A relation needs another character.' });
    });

    it('refuses a status other than alive or dead', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c1', { gender: '', age: '', role: '', relation: { kind: '', of: '' }, status: 'missing' }, kendraAsShown());

        assert.equal(ledger, null);
        assert.equal(error, 'A status is alive or dead.');
    });

    it('leaves the ledger it was given untouched', () => {
        const before = makeLedger();
        saveCharacterDetails(before, 'c2', { ...amaAsShown(), gender: 'female', age: '' }, amaAsShown());
        assert.deepEqual(before, makeLedger());
    });

    it('refuses an unknown character', () => {
        assert.equal(saveCharacterDetails(makeLedger(), 'c9', amaAsShown(), amaAsShown()).error, 'This character is no longer in the ledger.');
    });
});

describe('saveCharacterDetails: the ledger changed while the popup was open', () => {
    it('writes no player entry for a field left as shown when an extraction changed its detail meanwhile', () => {
        const ledgerNow = makeLedger();
        ledgerNow.characters[1].details.role.push({ value: 'nurse, Highland Hospital', at: 20, messageId: 'm20' });

        const { ledger, error } = saveCharacterDetails(ledgerNow, 'c2', { ...amaAsShown(), age: '45' }, amaAsShown());

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details, {
            age: [{ value: '45', at: null, by: 'user' }],
            role: [
                { value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' },
                { value: 'nurse, Highland Hospital', at: 20, messageId: 'm20' },
            ],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('does not write back a detail a rollback removed meanwhile', () => {
        const ledgerNow = makeLedger();
        delete ledgerNow.characters[1].details.role;

        const { ledger } = saveCharacterDetails(ledgerNow, 'c2', { ...amaAsShown(), age: '45' }, amaAsShown());

        assert.deepEqual(ledger.characters[1].details, {
            age: [{ value: '45', at: null, by: 'user' }],
            relation: [{ value: { kind: 'mother', of: 'c1' }, at: 14, messageId: 'm14' }],
        });
    });

    it('does not lock a story detail the player retyped in other letter case', () => {
        const before = makeLedger();
        before.characters[1].details.gender = [{ value: 'female', at: 12, messageId: 'm12' }];

        const { ledger } = saveCharacterDetails(before, 'c2', { ...amaAsShown(), gender: 'Female' }, { ...amaAsShown(), gender: 'female' });

        assert.deepEqual(ledger.characters[1].details.gender, [{ value: 'female', at: 12, messageId: 'm12' }]);
    });

    it('does not count a relation retyped in other letter case as a change', () => {
        const { ledger } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), relation: { kind: 'Mother', of: 'c1' } }, amaAsShown());

        assert.deepEqual(ledger, makeLedger());
    });
});

describe('saveCharacterDetails: the display name of an unnamed relative', () => {
    it('refuses a relation that gives a nameless record the display name of another record', () => {
        const before = {
            characters: [
                { id: 'c1', name: 'Kendra Osei', aliases: [] },
                { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] } },
                { id: 'c3', name: '', aliases: [], details: { relation: [{ value: { kind: 'aunt', of: 'c1' }, at: null, by: 'record' }] } },
            ],
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: null,
        };
        const shown = { ...kendraAsShown(), relation: { kind: 'aunt', of: 'c1' } };

        const result = saveCharacterDetails(before, 'c3', { ...shown, relation: { kind: 'MOTHER', of: 'c1' } }, shown);

        assert.deepEqual(result, { ledger: null, error: "Kendra Osei's MOTHER is already in the ledger." });
    });
});

describe('buildKnowledgeContent: the detail editor', () => {
    /** Ama's sheet with the editor of one detail kind open */
    function editorHtmlOf(kind) {
        const view = sheetViewOf('c2');
        view.editors.set('sheet', { mode: 'detail', characterId: 'c2', kind });
        return detailRowOf(buildKnowledgeContent(makeLedger(), [], true, view), kind);
    }

    it('opens in the detail\'s row, filled with the current value', () => {
        const rowHtml = editorHtmlOf('role');

        assert.ok(rowHtml.includes('class="k-editor"'));
        assert.ok(rowHtml.includes('data-draft="sheet:v" data-fk="detail|sheet" value="cleaner, double shifts, Oakland"'), rowHtml);
        assert.ok(textOf(rowHtml).includes('Save and lock'));
    });

    it('offers alive and dead for the status', () => {
        assert.ok(editorHtmlOf('status').includes('<option value="" selected>unknown</option><option value="alive">alive</option><option value="dead">dead</option>'));
    });

    it('shows a relation\'s kinship word and the other character, whom the picker offers, not the character themselves', () => {
        const rowHtml = editorHtmlOf('relation');

        assert.ok(rowHtml.includes('value="mother" placeholder="e.g. mother"'));
        assert.ok(textOf(rowHtml).includes('Of Kendra Osei'));
        assert.ok(rowHtml.includes('data-pick="sheet" data-cid="c1"'));
        assert.ok(!rowHtml.includes('data-pick="sheet" data-cid="c2"'), 'a character is no relative of themselves');
    });
});

describe('saveCharacterDetails and lockCharacterDetail: Save without the lock', () => {
    it('writes a value saved unlocked as a player record entry, which locks nothing, a rollback keeps and the sheet shows as set by you', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), gender: 'female' }, amaAsShown(), { lock: false });
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details.gender, [{ value: 'female', at: null, by: 'record', source: 'player' }]);
        assert.equal(isDetailLocked(ledger.characters[1], 'gender'), false);

        dropKnowledgeFrom(ledger, 0);
        assert.deepEqual(ledger.characters[1].details.gender, [{ value: 'female', at: null, by: 'record', source: 'player' }]);
        const html = buildKnowledgeContent(ledger, [], true, sheetViewOf('c2'));
        assert.ok(textOf(detailRowOf(html, 'gender')).endsWith('Gender female Set by you Edit Lock'), detailRowOf(html, 'gender'));
        assert.ok(!detailRowOf(html, 'gender').includes('Locked by you'));
    });

    it('puts a value saved unlocked after the story\'s entry, and a second one in place of the first', () => {
        const once = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: 'night cleaner' }, amaAsShown(), { lock: false }).ledger;
        const twice = saveCharacterDetails(once, 'c2', { ...amaAsShown(), role: 'night cleaner, Highland Hospital' }, { ...amaAsShown(), role: 'night cleaner' }, { lock: false }).ledger;

        assert.deepEqual(twice.characters[1].details.role, [
            { value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' },
            { value: 'night cleaner, Highland Hospital', at: null, by: 'record', source: 'player' },
        ]);
    });

    it('unlocks a locked kind when saved unlocked, even with the value left as shown', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', { age: '40s' }, { age: '40s' }, { lock: false });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details.age, [{ value: '40s', at: null, by: 'record', source: 'player' }]);
    });

    it('keeps a story value saved unlocked as it is as the player\'s own, past the rollback of its message', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c2', amaAsShown(), amaAsShown(), { lock: false });
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details.role, [
            { value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' },
            { value: 'cleaner, double shifts, Oakland', at: null, by: 'record', source: 'player' },
        ]);

        dropKnowledgeFrom(ledger, 12);
        assert.deepEqual(ledger.characters[1].details.role, [{ value: 'cleaner, double shifts, Oakland', at: null, by: 'record', source: 'player' }]);
    });

    it('replaces a value saved unlocked when it is saved and locked, or locked as it is', () => {
        const unlocked = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), gender: 'female' }, amaAsShown(), { lock: false }).ledger;

        const savedAndLocked = saveCharacterDetails(unlocked, 'c2', { ...amaAsShown(), gender: 'woman' }, { ...amaAsShown(), gender: 'female' }).ledger;
        assert.deepEqual(savedAndLocked.characters[1].details.gender, [{ value: 'woman', at: null, by: 'user' }]);

        const locked = lockCharacterDetail(unlocked, 'c2', 'gender').ledger;
        assert.deepEqual(locked.characters[1].details.gender, [{ value: 'female', at: null, by: 'user' }]);
    });

    it('removes a value saved unlocked when its field is emptied', () => {
        const unlocked = saveCharacterDetails(makeLedger(), 'c2', { ...amaAsShown(), role: 'night cleaner' }, amaAsShown(), { lock: false }).ledger;

        const { ledger } = saveCharacterDetails(unlocked, 'c2', { ...amaAsShown(), role: '' }, { ...amaAsShown(), role: 'night cleaner' });

        assert.deepEqual(ledger.characters[1].details.role, [{ value: 'cleaner, double shifts, Oakland', at: 12, messageId: 'm12' }]);
    });

    it('offers Save next to Save and lock, but only Save and lock for an unnamed relative\'s relation', () => {
        const ledger = makeLedger();
        ledger.characters.push({ id: 'c3', name: '', aliases: [], details: { relation: [{ value: { kind: 'father', of: 'c1' }, at: null, by: 'record' }] } });
        const editorRowOf = (characterId, kind) => {
            const view = sheetViewOf(characterId);
            view.editors.set('sheet', { mode: 'detail', characterId, kind });
            return detailRowOf(buildKnowledgeContent(ledger, [], true, view), kind);
        };

        const genderRow = editorRowOf('c2', 'gender');
        assert.ok(genderRow.includes('data-act="save-detail" data-area="sheet" data-cid="c2" data-kind="gender" data-lock="off"'), genderRow);
        assert.ok(genderRow.indexOf('Save and lock') < genderRow.indexOf('data-lock="off"'), 'Enter keeps Save and lock');
        const relativeRow = editorRowOf('c3', 'relation');
        assert.ok(textOf(relativeRow).includes('Save and lock'));
        assert.ok(!relativeRow.includes('data-lock="off"'));
    });
});
