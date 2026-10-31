import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanItemLists, buildReportsWaitingLine } from '../lib/ui/arc-manager.js';

/** The <li> of the item with this id. */
function rowOf(html, itemId) {
    return html.split('<li ').find(chunk => chunk.includes(`data-item-id="${itemId}"`)) || '';
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function makeAct(overrides = {}) {
    return {
        id: 'act00001-full-id',
        title: 'The Long Winter',
        status: 'active',
        tier: 'act',
        focus: 'spotlight',
        messageStart: 0,
        beats: [],
        secrets: [
            { id: 'guild_theft', content: 'The guild emptied the granary.', revealPhase: 'escalation', disclosed: false },
            { id: 'quartermaster_sales', content: 'The quartermaster sells to the Syndicate.', revealPhase: 'development', disclosed: true },
        ],
        foreshadowing: [
            { id: 'covered_lamps', clue: 'Carts leave at night with covered lamps.', target: 'secret:guild_theft', planted: false },
            { id: 'torn_sack', clue: 'A torn sack by the gate.', target: 'secret:guild_theft', planted: true },
        ],
        triggers: [
            { id: 'debt_paid', condition: 'she pays the debt', action: 'the debt doubles', fired: true },
            { id: 'voss_accused', condition: 'the player accuses Voss', action: 'Voss answers with cold anger', fired: false },
            { id: 'sacks_counted', condition: 'anyone counts the sacks', action: 'the clerk goes pale', fired: false },
        ],
        ...overrides,
    };
}

const marks = [
    { arcId: 'act00001-full-id', list: 'triggers', flag: 'fired', id: 'sacks_counted', at: 2023 },
    { arcId: 'act00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'covered_lamps', at: 2019 },
    { arcId: 'other-arc-id', list: 'triggers', flag: 'fired', id: 'voss_accused', at: 2020 },
];

describe('buildPlanItemLists — three drawers', () => {
    it('gives secrets, clues and triggers a drawer each, with counts in the label', () => {
        const text = textOf(buildPlanItemLists(makeAct(), marks));

        assert.ok(text.includes('Secrets (2) 1 revealed'), text);
        assert.ok(text.includes('Clues (2) 1 waiting 1 planted'), text);
        assert.ok(text.includes('Triggers (3) 1 waiting 1 happened'), text);
    });

    it('lists the waiting item first, then the open one, then the done one under its own heading', () => {
        const text = textOf(buildPlanItemLists(makeAct(), marks));
        const triggers = text.slice(text.indexOf('Triggers (3)'));

        const waiting = triggers.indexOf('IF anyone counts the sacks → the clerk goes pale');
        const open = triggers.indexOf('IF the player accuses Voss → Voss answers with cold anger');
        const doneHeading = triggers.indexOf('happened (1)');
        const done = triggers.indexOf('IF she pays the debt → the debt doubles');
        assert.ok(waiting > -1 && waiting < open && open < doneHeading && doneHeading < done, triggers);
    });

    it('shows a waiting item with an hourglass, its message and a click that drops the report', () => {
        const html = buildPlanItemLists(makeAct(), marks);
        const row = rowOf(html, 'sacks_counted');

        assert.ok(row.includes('fa-hourglass-half'), row);
        assert.ok(row.includes('data-queued="true"'), row);
        assert.ok(textOf(row).includes('Reported in message #2023, waiting to be applied'), row);
    });

    it('ignores a queued mark of another arc', () => {
        const html = buildPlanItemLists(makeAct(), marks);
        const row = rowOf(html, 'voss_accused');

        assert.ok(row.includes('fa-circle'), row);

        assert.equal(row.includes('fa-hourglass-half'), false, row);
    });

    it('leaves out a drawer whose list is empty, and renders nothing for an arc without items', () => {
        const noClues = textOf(buildPlanItemLists(makeAct({ foreshadowing: [] }), []));
        const nothing = buildPlanItemLists(makeAct({ secrets: [], foreshadowing: [], triggers: [] }), []);

        assert.equal(noClues.includes('Clues'), false);
        assert.equal(nothing, '');
    });
});

describe('buildReportsWaitingLine', () => {
    it('counts the arc\'s waiting reports and says when they apply', () => {
        assert.equal(
            textOf(buildReportsWaitingLine(makeAct(), marks)),
            '2 reports waiting — applied with the next milestone or after 20 messages',
        );
    });

    it('skips a mark whose item is gone or already done — the drawers show no hourglass for those', () => {
        const staleMarks = [
            ...marks,
            { arcId: 'act00001-full-id', list: 'triggers', flag: 'fired', id: 'removed_by_replan', at: 2010 },
            { arcId: 'act00001-full-id', list: 'triggers', flag: 'fired', id: 'debt_paid', at: 2011 },
        ];

        assert.equal(
            textOf(buildReportsWaitingLine(makeAct(), staleMarks)),
            '2 reports waiting — applied with the next milestone or after 20 messages',
        );
    });

    it('is empty without waiting reports and for an arc that is not active', () => {
        assert.equal(buildReportsWaitingLine(makeAct(), []), '');
        assert.equal(buildReportsWaitingLine(makeAct({ status: 'completed' }), marks), '');
    });
});
