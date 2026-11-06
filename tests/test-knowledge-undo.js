import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat_metadata } from '/script.js';
import {
    addCharacter, addFact, addFactHolder, addUnnamedRelative, deleteCharacter, deleteFact, editFactText, endKnowledgeUndoSession, keepCharacterName,
    lockCharacterDetail, mergeCharacters, moveFactHolder, removeFactHolder, renameCharacter, restoreRetractedFact, retractFact,
    saveCharacterDetails, saveLedgerEdit, setCharacterAliases, setFactPublic, startKnowledgeUndoSession, undoLedgerEdit, unnameCharacter,
} from '../lib/ui/knowledge-popup.js';

const CHANGED_MESSAGE = 'The ledger changed since this edit (an update ran); undo is no longer possible.';

/** Noor (c1), Kendra (c5), Marcus (c7); one fact Noor holds, one retracted fact. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'], details: { status: [{ value: 'alive', by: 'extraction', at: 12 }] } },
            { id: 'c7', name: 'Marcus Vale', aliases: [], nameClash: ['c1'] },
        ],
        facts: [
            { id: 'f1', text: 'The vault code is 4471.', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 }] },
        ],
        scene: { at: 40, present: ['c1', 'c7'] },
        sceneHistory: [{ at: 30, present: ['c7'] }],
        retractedFacts: [{ at: 25, fact: { id: 'f2', text: 'Marcus owns the bar.', public: false, holders: [{ characterId: 'c7', how: 'witnessed', toldBy: null, at: 20 }] } }],
        lastUpdatedAt: 40,
    };
}

/** The toasts shown, by level */
let toasts;
let previousJquery;
let previousToastr;

beforeEach(() => {
    previousJquery = globalThis.$;
    previousToastr = globalThis.toastr;
    // No popup on the page: the redraw finds nothing to replace.
    globalThis.$ = () => ({ length: 0 });
    toasts = [];
    globalThis.toastr = {
        warning: message => toasts.push(['warning', message]),
        info: message => toasts.push(['info', message]),
    };
    chat_metadata.story_arc = { knowledge: makeLedger() };
    startKnowledgeUndoSession();
});

afterEach(() => {
    globalThis.$ = previousJquery;
    globalThis.toastr = previousToastr;
    delete chat_metadata.story_arc;
});

/** The stored ledger */
function stored() {
    return chat_metadata.story_arc.knowledge;
}

describe('undoLedgerEdit — undo for hand edits in the Knowledge popup', () => {
    it('restores the exact ledger from before the edit', async () => {
        await saveLedgerEdit(deleteCharacter(stored(), 'c7'));
        assert.equal(stored().characters.length, 2);

        const { error } = await undoLedgerEdit();

        assert.equal(error, null);
        assert.deepEqual(stored(), makeLedger());
    });

    it('keeps the stored ledger object, so an extraction holding it keeps writing into the stored one', async () => {
        const storedObject = stored();
        await saveLedgerEdit(deleteFact(stored(), 'f1'));

        await undoLedgerEdit();

        assert.equal(stored(), storedObject);
    });

    it('goes one edit further back with a second undo', async () => {
        await saveLedgerEdit(addFactHolder(stored(), 'f1', 'c5'));
        await saveLedgerEdit(setFactPublic(stored(), 'f1', true));

        await undoLedgerEdit();
        assert.deepEqual(stored().facts, [{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c5', how: 'user', toldBy: null, at: null },
        ] }]);

        const { error } = await undoLedgerEdit();
        assert.equal(error, null);
        assert.deepEqual(stored(), makeLedger());
    });

    it('says there is nothing to undo when no edit was made', async () => {
        const { error } = await undoLedgerEdit();

        assert.equal(error, 'Nothing to undo.');
        assert.deepEqual(stored(), makeLedger());
    });

    it('does not count a refused edit', async () => {
        await saveLedgerEdit(addFactHolder(stored(), 'f1', 'c5'));
        await saveLedgerEdit(renameCharacter(stored(), 'c5', 'Noor'));

        await undoLedgerEdit();

        assert.deepEqual(stored(), makeLedger());
    });

    it('does not count an edit that changed nothing', async () => {
        await saveLedgerEdit(addFactHolder(stored(), 'f1', 'c5'));
        await saveLedgerEdit({ ledger: stored(), error: null });

        await undoLedgerEdit();

        assert.deepEqual(stored(), makeLedger());
    });

    it('refuses and clears the stack when an update changed the stored ledger in place since the edit', async () => {
        await saveLedgerEdit(addFactHolder(stored(), 'f1', 'c5'));
        await saveLedgerEdit(setFactPublic(stored(), 'f1', true));
        // The extraction writes into the stored ledger object.
        stored().lastUpdatedAt = 44;

        const refused = await undoLedgerEdit();

        assert.equal(refused.error, CHANGED_MESSAGE);
        assert.deepEqual(toasts, [['warning', CHANGED_MESSAGE]]);
        assert.equal(stored().facts[0].public, true);
        assert.equal(stored().lastUpdatedAt, 44);
        const again = await undoLedgerEdit();
        assert.equal(again.error, 'Nothing to undo.');
        assert.equal(stored().facts[0].holders.length, 2);
    });

    it('refuses when the stored ledger was replaced since the edit, even by an equal-looking copy of the old one', async () => {
        await saveLedgerEdit(deleteFact(stored(), 'f1'));
        // Another chat loaded, or the ledger was created anew.
        chat_metadata.story_arc = { knowledge: makeLedger() };

        const refused = await undoLedgerEdit();

        assert.equal(refused.error, CHANGED_MESSAGE);
        assert.deepEqual(stored(), makeLedger());
    });

    it('starts empty in a new popup session', async () => {
        await saveLedgerEdit(deleteFact(stored(), 'f1'));

        startKnowledgeUndoSession();
        const { error } = await undoLedgerEdit();

        assert.equal(error, 'Nothing to undo.');
        assert.deepEqual(stored().facts, []);
    });

    it('records nothing while no popup session is open', async () => {
        // Closing the popup ends the session.
        endKnowledgeUndoSession();
        await saveLedgerEdit(deleteFact(stored(), 'f1'));

        const { error } = await undoLedgerEdit();

        assert.equal(error, 'Nothing to undo.');
        assert.deepEqual(stored().facts, []);
    });
});

describe('undoLedgerEdit — every edit function of the Knowledge popup', () => {
    const edits = {
        addCharacter: ledger => addCharacter(ledger, { id: 'c8', name: 'Ada Brandt', aliases: ['Ada'] }),
        addUnnamedRelative: ledger => addUnnamedRelative(ledger, { id: 'c8', kind: 'mother', of: 'c1' }),
        renameCharacter: ledger => renameCharacter(ledger, 'c5', 'Kendra Vale'),
        setCharacterAliases: ledger => setCharacterAliases(ledger, 'c5', ['Ken', 'Kendra']),
        saveCharacterDetails: ledger => saveCharacterDetails(ledger, 'c5', { status: 'dead' }, { status: 'alive' }),
        keepCharacterName: ledger => keepCharacterName(ledger, 'c7'),
        mergeCharacters: ledger => mergeCharacters(ledger, 'c1', 'c7'),
        deleteCharacter: ledger => deleteCharacter(ledger, 'c1'),
        lockCharacterDetail: ledger => lockCharacterDetail(ledger, 'c5', 'status'),
        addFact: ledger => addFact(ledger, { id: 'f3', text: 'Kendra lied about the gun.', holderIds: ['c5'] }),
        editFactText: ledger => editFactText(ledger, 'f1', 'The vault code is 4472.'),
        deleteFact: ledger => deleteFact(ledger, 'f1'),
        restoreRetractedFact: ledger => restoreRetractedFact(ledger, 'f2'),
        retractFact: ledger => retractFact(ledger, 'f1'),
        setFactPublic: ledger => setFactPublic(ledger, 'f1', true),
        addFactHolder: ledger => addFactHolder(ledger, 'f1', 'c5'),
        removeFactHolder: ledger => removeFactHolder(ledger, 'f1', 'c1'),
        moveFactHolder: ledger => moveFactHolder(ledger, 'f1', 'c1', 'c5'),
    };

    for (const [name, edit] of Object.entries(edits)) {
        it(`undoes ${name}`, async () => {
            const result = edit(stored());
            assert.equal(result.error, null, `${name} was refused: ${result.error}`);
            await saveLedgerEdit(result);
            assert.notDeepEqual(stored(), makeLedger(), `${name} changed nothing`);

            const { error } = await undoLedgerEdit();

            assert.equal(error, null);
            assert.deepEqual(stored(), makeLedger());
        });
    }
});

describe('undoLedgerEdit — a relative made unnamed again', () => {
    it('gives the relative its name back', async () => {
        stored().characters.push({ id: 'c9', name: 'Ama Osei', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c5' }, at: null, by: 'record' }] } });
        const before = structuredClone(stored());
        await saveLedgerEdit(unnameCharacter(stored(), 'c9'));
        assert.equal(stored().characters[3].name, '');

        const { error } = await undoLedgerEdit();

        assert.equal(error, null);
        assert.deepEqual(stored(), before);
    });
});
