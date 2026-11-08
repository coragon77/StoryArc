import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chat_metadata } from '../tests/mocks/st-mocks.js';
import { applyExtractionAnswer, buildKnowledgeBlock, dropKnowledgeFrom } from '../lib/knowledge/ledger.js';
import { deleteCharacter, mergeCharacters, saveLedgerEdit } from '../lib/ui/knowledge-popup.js';

const HEADER_WITH_MEETINGS = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for. '
    + 'A character knows the face, looks and voice only of someone they have met: '
    + 'a name on their Has met line, or someone the story put in front of them on-screen. Hearing a name is not meeting.]';

/** The Pier 40 cast: Ellie, Levi, Vasquez and Sofia, who has never been at the pier. */
function makePierLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Ellie Masters', aliases: ['Dice'] },
            { id: 'c19', name: 'Levi', aliases: [] },
            { id: 'c86', name: 'Dr. Elena Vasquez', aliases: [] },
            { id: 'c12', name: 'Sofia Vega', aliases: ['Rampart', 'Sofia'] },
        ],
        facts: [],
        scene: { at: 3010, present: ['c1', 'c19'] },
        sceneHistory: [],
        meetings: [{ at: 3010, present: ['c1', 'c19'] }],
        lastUpdatedAt: 3010,
    };
}

/** An extraction answer that only says who is present. */
function presentOnly(present) {
    return { present, newCharacters: [], learned: [] };
}

describe('applyExtractionAnswer — the meetings', () => {
    it('records a scene with two or more present as a meeting, with its message id', () => {
        const ledger = makePierLedger();
        const chatMessages = Array.from({ length: 3020 }, () => ({ is_user: false, mes: '', extra: {} }));
        chatMessages[3019].extra.story_arc_message_id = 'm3019';

        applyExtractionAnswer(ledger, presentOnly(['Ellie Masters', 'Levi', 'Dr. Elena Vasquez']), 3019, 3019, chatMessages);

        assert.deepEqual(ledger.meetings, [
            { at: 3010, present: ['c1', 'c19'] },
            { at: 3019, messageId: 'm3019', present: ['c1', 'c19', 'c86'] },
        ]);
    });

    it('records no meeting for a scene with one character present', () => {
        const ledger = makePierLedger();

        applyExtractionAnswer(ledger, presentOnly(['Levi']), 3011, 3012);

        assert.deepEqual(ledger.meetings, [{ at: 3010, present: ['c1', 'c19'] }]);
    });

    it('replaces the meeting of the same message, as the re-extraction of an edit does', () => {
        const ledger = makePierLedger();
        ledger.meetings.push({ at: 3015, present: ['c1', 'c86'] });

        applyExtractionAnswer(ledger, presentOnly(['Levi', 'Dr. Elena Vasquez']), 3015, 3015);
        assert.deepEqual(ledger.meetings, [
            { at: 3010, present: ['c1', 'c19'] },
            { at: 3015, present: ['c19', 'c86'] },
        ]);

        // Edited again, the message has only Levi in it: its meeting goes.
        applyExtractionAnswer(ledger, presentOnly(['Levi']), 3015, 3015);
        assert.deepEqual(ledger.meetings, [{ at: 3010, present: ['c1', 'c19'] }]);
    });

    it('keeps the meetings in message order when an older message is re-extracted', () => {
        const ledger = makePierLedger();
        ledger.meetings.push({ at: 3020, present: ['c1', 'c86'] });

        applyExtractionAnswer(ledger, presentOnly(['Ellie Masters', 'Dr. Elena Vasquez']), 3014, 3014);

        assert.deepEqual(ledger.meetings.map(meeting => meeting.at), [3010, 3014, 3020]);
    });

    it('gives a ledger from before the meetings its scene history and scene as the first ones', () => {
        const ledger = makePierLedger();
        delete ledger.meetings;
        ledger.sceneHistory = [{ at: 3001, present: ['c1'] }, { at: 3005, messageId: 'm3005', present: ['c1', 'c12'] }];

        applyExtractionAnswer(ledger, presentOnly(['Levi']), 3011, 3012);

        // The scene at 3001 had Ellie alone, so it is no meeting; Levi alone at 3012 is none either.
        assert.deepEqual(ledger.meetings, [
            { at: 3005, messageId: 'm3005', present: ['c1', 'c12'] },
            { at: 3010, present: ['c1', 'c19'] },
        ]);
    });

    it('leaves a ledger from before the meetings without them while there is no meeting to record', () => {
        const ledger = makePierLedger();
        delete ledger.meetings;
        ledger.scene = { at: 3010, present: ['c19'] };

        applyExtractionAnswer(ledger, presentOnly(['Levi']), 3011, 3012);

        assert.equal('meetings' in ledger, false);
    });
});

describe('dropKnowledgeFrom — the meetings', () => {
    it('drops the meetings of the dropped messages and keeps the earlier ones', () => {
        const ledger = makePierLedger();
        ledger.meetings.push({ at: 3019, present: ['c1', 'c19', 'c86'] }, { at: 3021, present: ['c19', 'c86'] });

        const changed = dropKnowledgeFrom(ledger, 3019);

        assert.equal(changed, true);
        assert.deepEqual(ledger.meetings, [{ at: 3010, present: ['c1', 'c19'] }]);
    });
});

describe('buildKnowledgeBlock — the Has met line', () => {
    it('lists everyone a character met, present or talked about, and not someone only named to them', () => {
        // Levi met Ellie at the island and Vasquez at the pier; Ellie met
        // Sofia at the Annex. Ellie names Sofia; Levi has never seen her.
        const ledger = makePierLedger();
        ledger.meetings = [
            { at: 2900, present: ['c1', 'c12'] },
            { at: 3010, present: ['c1', 'c19'] },
            { at: 3019, present: ['c1', 'c19', 'c86'] },
        ];
        ledger.scene = { at: 3019, present: ['c1', 'c19', 'c86'] };
        const messages = [{ is_user: true, mes: 'I\'ll ask Gabriel or Sofia instead.' }];

        assert.equal(buildKnowledgeBlock(ledger, messages), [
            HEADER_WITH_MEETINGS,
            '',
            'ELLIE MASTERS (present)',
            '- Has met: Sofia Vega, Levi, Dr. Elena Vasquez',
            '',
            'LEVI (present)',
            '- Has met: Ellie Masters, Dr. Elena Vasquez',
            '',
            'DR. ELENA VASQUEZ (present)',
            '- Has met: Ellie Masters, Levi',
            '',
            'SOFIA VEGA (talked about, not present)',
            '- Has met: Ellie Masters',
        ].join('\n'));
    });

    it('prints the Has met line after the details and before the knowledge lines, also with details switched off', () => {
        const ledger = makePierLedger();
        ledger.scene = { at: 3010, present: ['c19'] };
        ledger.characters[1] = { ...ledger.characters[1], details: { gender: [{ value: 'male', at: null, by: 'user' }] } };
        ledger.facts = [{
            id: 'f1', text: 'Vasquez has the brass keycard', public: false,
            holders: [{ characterId: 'c19', how: 'witnessed', toldBy: null, at: 3010 }],
        }];

        const withDetails = buildKnowledgeBlock(ledger, []).split('\n\n').slice(1);
        const withoutDetails = buildKnowledgeBlock(ledger, [], false).split('\n\n').slice(1);

        assert.deepEqual(withDetails, [[
            'LEVI (present)',
            '- Details: male',
            '- Has met: Ellie Masters',
            '- Knows: Vasquez has the brass keycard (known only to them)',
        ].join('\n')]);
        assert.deepEqual(withoutDetails, [[
            'LEVI (present)',
            '- Has met: Ellie Masters',
            '- Knows: Vasquez has the brass keycard (known only to them)',
        ].join('\n')]);
    });
});

describe('merge and delete — the meetings', () => {
    it('a merge points the meetings at the main record, and one of only the two records goes', () => {
        // Sofia (c12) is in the ledger twice, as Rampart (c40) too.
        const ledger = makePierLedger();
        ledger.characters.push({ id: 'c40', name: 'Rampart Two', aliases: [] });
        ledger.meetings = [
            { at: 2900, present: ['c1', 'c40'] },
            { at: 2950, present: ['c12', 'c40'] },
            { at: 3010, present: ['c1', 'c19'] },
        ];

        const { ledger: mergedLedger, error } = mergeCharacters(ledger, 'c12', 'c40');

        assert.equal(error, null);
        assert.deepEqual(mergedLedger.meetings, [
            { at: 2900, present: ['c1', 'c12'] },
            { at: 3010, present: ['c1', 'c19'] },
        ]);
    });

    it('a deletion takes the character out of the meetings, and one left with a single character goes', () => {
        const ledger = makePierLedger();
        ledger.meetings = [
            { at: 3010, present: ['c1', 'c19'] },
            { at: 3019, present: ['c1', 'c19', 'c86'] },
        ];

        const { ledger: changedLedger, error } = deleteCharacter(ledger, 'c19');

        assert.equal(error, null);
        assert.deepEqual(changedLedger.meetings, [{ at: 3019, present: ['c1', 'c86'] }]);
    });

    it('the popup stores the changed meetings', async () => {
        const storedLedger = makePierLedger();
        const previousJquery = globalThis.$;
        globalThis.$ = () => ({ length: 0 });
        chat_metadata.story_arc = { knowledge: storedLedger };
        try {
            await saveLedgerEdit(deleteCharacter(storedLedger, 'c19'));
            assert.deepEqual(chat_metadata.story_arc.knowledge.meetings, []);
        } finally {
            globalThis.$ = previousJquery;
            delete chat_metadata.story_arc;
        }
    });
});
