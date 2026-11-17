import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat_metadata } from '/script.js';
import {
    buildKnowledgeContent, createKnowledgeView, listChangeLines, lockCharacterDetail, lockCharacterStance, saveCharacterDetails,
    saveCharacterStance, saveLedgerEdit, startKnowledgeUndoSession, undoLedgerEdit,
} from '../lib/ui/knowledge-popup.js';

/**
 * Vera, Ellie, Gabriel and Jalen in the Paragon chat. The catch-up seeded
 * Vera's style and her stance toward Ellie; the story set her manner at
 * message 30 and her stance toward Gabriel at message 32, which the player
 * then locked at another text.
 */
function makeLedger() {
    return {
        characters: [
            {
                id: 'c1',
                name: 'Vera',
                aliases: [],
                details: {
                    style: [{ value: 'fitted and feminine', at: null, by: 'seed' }],
                    manner: [{ value: 'soft, eager to be of use', at: 30, messageId: 'm30' }],
                    stance: [
                        { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'seed' },
                        { value: { text: 'wary of him', of: 'c3' }, at: 32, messageId: 'm32' },
                        { value: { text: 'at ease with him', of: 'c3' }, at: null, by: 'user' },
                    ],
                },
            },
            { id: 'c2', name: 'Ellie', aliases: [] },
            { id: 'c3', name: 'Gabriel', aliases: [] },
            { id: 'c4', name: 'Jalen', aliases: [] },
        ],
        facts: [],
        scene: { at: 32, present: ['c1', 'c2'] },
        lastUpdatedAt: 32,
    };
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A view of Cast & facts with Vera's sheet open */
function veraSheetView() {
    const view = createKnowledgeView();
    view.tab = 'cast';
    view.sheet = { type: 'character', id: 'c1' };
    return view;
}

/** The markup of one detail row of the open sheet, up to the next row or the end of its list. */
function detailRowOf(html, rowKey) {
    const start = html.indexOf(`<div class="k-detail" data-detail="${rowKey}"`);
    if (start === -1) return '';
    const nextRow = html.indexOf('<div class="k-detail"', start + 1);
    const listEnd = html.indexOf('</dl>', start);
    return html.slice(start, nextRow === -1 || listEnd < nextRow ? listEnd : nextRow);
}

/** Vera's sheet, with appearance and standing state switched on */
function veraSheetHtml(ledger = makeLedger(), view = veraSheetView()) {
    return buildKnowledgeContent(ledger, [], true, view, true, true);
}

describe('Knowledge popup: the Standing state area', () => {
    it('is hidden while standing state is off, and the stored state stays', () => {
        const ledger = makeLedger();

        const html = buildKnowledgeContent(ledger, [], true, veraSheetView(), true, false);

        assert.ok(!html.includes('Standing state'));
        assert.ok(!html.includes('data-detail="style"'));
        assert.ok(!html.includes('data-detail="stance:c2"'));
        assert.deepEqual(ledger, makeLedger());
    });

    it('comes after appearance, with Style, Manner and a row per current stance in that order', () => {
        const html = veraSheetHtml();

        const appearanceAt = html.indexOf('id="sa-k-sh-appearance"');
        const stateAt = html.indexOf('id="sa-k-sh-state"');
        assert.ok(appearanceAt > -1 && stateAt > appearanceAt, 'the standing state follows appearance');
        const rowPositions = ['style', 'manner', 'stance:c2', 'stance:c3'].map(rowKey => html.indexOf(`data-detail="${rowKey}"`));
        assert.ok(rowPositions.every(position => position > stateAt), rowPositions.join(','));
        assert.deepEqual([...rowPositions].sort((first, second) => first - second), rowPositions);
        assert.ok(!html.includes('data-detail="stance:c4"'), 'Jalen has no stance from Vera');
    });

    it('labels a seed entry as from the catch-up and a story entry by its message', () => {
        const html = veraSheetHtml();

        assert.equal(textOf(detailRowOf(html, 'style')).startsWith('Style fitted and feminine From the catch-up'), true, textOf(detailRowOf(html, 'style')));
        assert.ok(textOf(detailRowOf(html, 'manner')).startsWith('Manner soft, eager to be of use From the story, message #30'));
        assert.ok(textOf(detailRowOf(html, 'stance:c2')).startsWith('Toward Ellie devoted to her From the catch-up'));
    });

    it('shows a locked stance with what the story said under it', () => {
        const rowText = textOf(detailRowOf(veraSheetHtml(), 'stance:c3'));

        assert.ok(rowText.startsWith('Toward Gabriel at ease with him Locked by you · the story said wary of him at message #32'), rowText);
        assert.ok(rowText.includes('Unlock'));
    });

    it('shows a value saved unlocked as set by you', () => {
        const ledger = makeLedger();
        ledger.characters[0].details.manner.push({ value: 'more at ease in her body', at: null, by: 'record', source: 'player' });

        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'manner')).startsWith('Manner more at ease in her body Set by you'));
    });

    it('shows an unknown style for a character without standing state', () => {
        const ledger = makeLedger();
        ledger.characters[0].details = {};

        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'style')).startsWith('Style unknown The story has not stated it.'));
    });

    it('opens the editor of one stance in its own row, filled with its text', () => {
        const view = veraSheetView();
        view.editors.set('sheet', { mode: 'detail', characterId: 'c1', kind: 'stance', of: 'c2' });

        const html = veraSheetHtml(makeLedger(), view);

        assert.ok(detailRowOf(html, 'stance:c2').includes('value="devoted to her"'));
        assert.ok(!detailRowOf(html, 'stance:c3').includes('class="k-editor"'));
        assert.ok(detailRowOf(html, 'stance:c2').includes('data-act="save-detail" data-area="sheet" data-cid="c1" data-kind="stance" data-of="c2"'));
    });

    it('offers a new stance only toward a named character Vera has none toward yet', () => {
        const view = veraSheetView();
        view.editors.set('sheet', { mode: 'detail', characterId: 'c1', kind: 'stance', of: '' });

        const html = veraSheetHtml(makeLedger(), view);

        assert.ok(html.includes('<option value="" selected>choose a character</option><option value="c4">Jalen</option></select>'), html);
    });
});

describe('saveCharacterStance and lockCharacterStance', () => {
    it('saves a stance toward one character and leaves the stances toward others as they were', () => {
        const { ledger, error } = saveCharacterStance(makeLedger(), 'c1', { text: 'her assistant, asks for tasks', of: 'c2' }, { text: 'devoted to her', of: 'c2' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.stance, [
            { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'seed' },
            { value: { text: 'wary of him', of: 'c3' }, at: 32, messageId: 'm32' },
            { value: { text: 'at ease with him', of: 'c3' }, at: null, by: 'user' },
            { value: { text: 'her assistant, asks for tasks', of: 'c2' }, at: null, by: 'user' },
        ]);
    });

    it('adds a stance toward a new character unlocked with Save', () => {
        const { ledger, error } = saveCharacterStance(makeLedger(), 'c1', { text: 'curious about him', of: 'c4' }, { text: '', of: '' }, { lock: false });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.stance.at(-1), { value: { text: 'curious about him', of: 'c4' }, at: null, by: 'record', source: 'player' });
        assert.equal(ledger.characters[0].details.stance.length, 4);
        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'stance:c4')).startsWith('Toward Jalen curious about him Set by you'));
    });

    it('changes nothing for a stance saved as shown, letter case aside', () => {
        const { ledger, error } = saveCharacterStance(makeLedger(), 'c1', { text: 'Devoted to her', of: 'c2' }, { text: 'devoted to her', of: 'c2' });

        assert.equal(error, null);
        assert.deepEqual(ledger, makeLedger());
    });

    it('refuses a stance without another character, toward the character themselves, or toward one not in the ledger', () => {
        assert.equal(saveCharacterStance(makeLedger(), 'c1', { text: 'proud', of: '' }, { text: '', of: '' }).error, 'A stance needs another character.');
        assert.equal(saveCharacterStance(makeLedger(), 'c1', { text: 'proud', of: 'c1' }, { text: '', of: '' }).error, 'A stance needs another character.');
        assert.equal(saveCharacterStance(makeLedger(), 'c1', { text: 'proud', of: 'c9' }, { text: '', of: '' }).error, 'A stance needs another character.');
    });

    it('clears the player\'s stance toward Gabriel, so the story\'s stance under it counts again', () => {
        const { ledger, error } = saveCharacterStance(makeLedger(), 'c1', { text: '', of: 'c3' }, { text: 'at ease with him', of: 'c3' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.stance, [
            { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'seed' },
            { value: { text: 'wary of him', of: 'c3' }, at: 32, messageId: 'm32' },
        ]);
        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'stance:c3')).startsWith('Toward Gabriel wary of him From the story, message #32'));
    });

    it('clears a locked stance toward a character no longer in the ledger', () => {
        const ledger = makeLedger();
        ledger.characters = ledger.characters.filter(character => character.id !== 'c3');

        const result = saveCharacterStance(ledger, 'c1', { text: '', of: 'c3' }, { text: 'at ease with him', of: 'c3' });

        assert.equal(result.error, null);
        assert.deepEqual(result.ledger.characters[0].details.stance, [
            { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'seed' },
            { value: { text: 'wary of him', of: 'c3' }, at: 32, messageId: 'm32' },
        ]);
    });

    it('does not empty a stance only the catch-up set', () => {
        const { ledger, error } = saveCharacterStance(makeLedger(), 'c1', { text: '', of: 'c2' }, { text: 'devoted to her', of: 'c2' });

        assert.equal(error, null);
        assert.deepEqual(ledger, makeLedger());
    });

    it('locks the stance toward Ellie only, at the catch-up\'s text', () => {
        const { ledger, error } = lockCharacterStance(makeLedger(), 'c1', 'c2');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.stance, [
            { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'seed' },
            { value: { text: 'wary of him', of: 'c3' }, at: 32, messageId: 'm32' },
            { value: { text: 'at ease with him', of: 'c3' }, at: null, by: 'user' },
            { value: { text: 'devoted to her', of: 'c2' }, at: null, by: 'user' },
        ]);
        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'stance:c2')).startsWith('Toward Ellie devoted to her Locked by you · the catch-up says the same'));
    });

    it('refuses to lock a stance already locked, or one that is not set', () => {
        assert.equal(lockCharacterStance(makeLedger(), 'c1', 'c3').error, 'Vera\'s stance toward Gabriel is already set by the player.');
        assert.equal(lockCharacterStance(makeLedger(), 'c1', 'c4').error, 'The story has not set Vera\'s stance toward Jalen.');
    });
});

describe('style and manner through the detail editor', () => {
    it('saves a style and locks it, keeping the catch-up\'s entry under it', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c1', { style: 'no longer the prefect uniform' }, { style: 'fitted and feminine' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.style, [
            { value: 'fitted and feminine', at: null, by: 'seed' },
            { value: 'no longer the prefect uniform', at: null, by: 'user' },
        ]);
        assert.ok(textOf(detailRowOf(veraSheetHtml(ledger), 'style')).startsWith('Style no longer the prefect uniform Locked by you · the catch-up said fitted and feminine'));
    });

    it('locks a manner as the story set it', () => {
        const { ledger, error } = lockCharacterDetail(makeLedger(), 'c1', 'manner');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.manner, [
            { value: 'soft, eager to be of use', at: 30, messageId: 'm30' },
            { value: 'soft, eager to be of use', at: null, by: 'user' },
        ]);
    });
});

describe('What changed: standing state lines', () => {
    /** Vera's ledger with one update that set her stance toward Ellie at message 32 */
    function ledgerWithStanceUpdate() {
        const ledger = makeLedger();
        ledger.characters[0].details.stance.push({ value: { text: 'stays close as her assistant', of: 'c2' }, at: 32, messageId: 'm32' });
        ledger.updateLog = [{
            kind: 'update', from: 31, to: 32, messageId: 'm32', answer: { newCharacters: 0 }, factsCreated: [], holdersAdded: 0, factsRetracted: [], detailsChanged: 1,
            items: { characters: [], holders: [], details: [{ characterId: 'c1', kind: 'stance', messageId: 'm32' }], names: [] },
        }];
        return ledger;
    }

    it('leaves a state line out while standing state is off', () => {
        assert.equal(listChangeLines(ledgerWithStanceUpdate(), true, true, false).groups[0].lines.length, 0);
        assert.equal(listChangeLines(ledgerWithStanceUpdate(), true, true, true).groups[0].lines.length, 1);
    });

    it('names the stance by the other character and its text', () => {
        const html = buildKnowledgeContent(ledgerWithStanceUpdate(), [], true, createKnowledgeView(), true, true);

        assert.ok(textOf(html).includes('Vera \'s stance toward Ellie set to stays close as her assistant · at message #32'), textOf(html));
    });
});

describe('undo of standing state edits', () => {
    let previousJquery;
    let previousToastr;

    beforeEach(() => {
        previousJquery = globalThis.$;
        previousToastr = globalThis.toastr;
        // No popup on the page: the redraw finds nothing to replace.
        globalThis.$ = () => ({ length: 0 });
        globalThis.toastr = { warning: () => {}, info: () => {} };
        chat_metadata.story_arc = { knowledge: makeLedger() };
        startKnowledgeUndoSession();
    });

    afterEach(() => {
        globalThis.$ = previousJquery;
        globalThis.toastr = previousToastr;
        delete chat_metadata.story_arc;
    });

    it('takes back a saved stance and a locked style, newest first', async () => {
        await saveLedgerEdit(saveCharacterStance(chat_metadata.story_arc.knowledge, 'c1', { text: 'curious about him', of: 'c4' }, { text: '', of: '' }));
        await saveLedgerEdit(lockCharacterDetail(chat_metadata.story_arc.knowledge, 'c1', 'style'));
        assert.equal(chat_metadata.story_arc.knowledge.characters[0].details.stance.length, 4);

        const first = await undoLedgerEdit();
        assert.equal(first.error, null);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[0].details.style, [{ value: 'fitted and feminine', at: null, by: 'seed' }]);
        assert.equal(chat_metadata.story_arc.knowledge.characters[0].details.stance.length, 4);

        const second = await undoLedgerEdit();
        assert.equal(second.error, null);
        assert.deepEqual(chat_metadata.story_arc.knowledge, makeLedger());
    });
});
