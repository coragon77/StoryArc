import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyReplan, mergeReplan } from '../lib/planning/replan.js';
import { buildArcSoFar, buildPlanCheckVariables, formatExistingArcs } from '../lib/planning/generator.js';

// A re-plan follows the arc's stored rulings (ADR-0003): the block texts the
// three calls read, the merge and the apply step.

/** Two rulings, stored out of message order: an answered pick and an open quote. */
function storedRulings() {
    return [
        { id: 'r2', text: 'Comics, not police procedural.', at: 2408, messageId: 'm2408' },
        { id: 'r1', text: 'Option one', chose: 'Sundown trains her as a mentor, never as a partner.', at: 2406, answeredAt: 2500 },
    ];
}

/** A stored act being re-planned, carrying two rulings. */
function storedAct() {
    return {
        id: 'arc-street',
        title: 'Streets of the Jackpot Siren',
        status: 'active',
        tier: 'act',
        focus: 'normal',
        messageStart: 2118,
        lastFulfilledAt: 2300,
        direction: '',
        premise: 'The sidekick rides with Gabriel.',
        themes: [],
        tone: '',
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        beats: [{ id: 'patrol', intention: 'She has walked her first patrol.', status: 'completed', unlockAfter: [] }],
        escalation: '',
        triggers: [],
        characters: [],
        estimatedLength: 100,
        rulings: storedRulings(),
    };
}

describe('formatExistingArcs with rulings', () => {
    it('lists the rulings under the re-planned arc only, in message order', () => {
        const arcs = [
            { id: 'arc-street', focus: 'normal', title: 'Streets of the Jackpot Siren', premise: 'The sidekick rides with Gabriel.' },
            { id: 'arc-other', focus: 'normal', title: 'Other', premise: 'Something else.', rulings: [{ id: 'r1', text: 'Not this.', at: 10 }] },
        ];

        const text = formatExistingArcs(arcs, 'arc-street', storedRulings());

        assert.equal(text, [
            '[NORMAL] [BEING RE-PLANNED] "Streets of the Jackpot Siren" — The sidekick rides with Gabriel.',
            'Overruled by the player:',
            '- "Option one" (the option picked: "Sundown trains her as a mentor, never as a partner.")',
            '- "Comics, not police procedural."',
            '[NORMAL] "Other" — Something else.',
        ].join('\n'));
    });

    it('prints no overruled line without rulings', () => {
        const arcs = [{ id: 'arc-street', focus: 'normal', title: 'Two', premise: 'P.' }];
        assert.equal(formatExistingArcs(arcs, 'arc-street', []), '[NORMAL] [BEING RE-PLANNED] "Two" — P.');
        assert.equal(formatExistingArcs(arcs, 'arc-street'), '[NORMAL] [BEING RE-PLANNED] "Two" — P.');
    });
});

describe('buildArcSoFar with rulings', () => {
    it('prints the binding list and asks for a premise that follows every ruling', () => {
        const text = buildArcSoFar(storedAct());

        assert.ok(text.includes(
            'The player\'s rulings (binding: they override the premise and the earlier plan):\n'
            + '- "Option one" (the option picked: "Sundown trains her as a mentor, never as a partner.")\n'
            + '- "Comics, not police procedural."\n',
        ));
        assert.ok(text.includes(
            'Write a premise for the arc as it stands now that follows every one of the player\'s rulings below, '
            + 'keeping what the current premise says that no ruling touches and that is still true.',
        ));
        assert.ok(!text.includes('keeping what the current premise says that is still true.'));
    });

    it('leaves the list out and keeps the plain propose instruction without rulings', () => {
        const text = buildArcSoFar({ ...storedAct(), rulings: [] });

        assert.doesNotMatch(text, /ruling/i);
        assert.ok(text.includes('Write a premise for the arc as it stands now, keeping what the current premise says that is still true.'));
    });
});

describe('buildPlanCheckVariables with rulings', () => {
    it('passes the rulings as RULINGS, in message order', () => {
        const variables = buildPlanCheckVariables(storedAct(), { analysis: 'A.', chatHistory: [] });

        assert.equal(variables.RULINGS,
            '- "Option one" (the option picked: "Sundown trains her as a mentor, never as a partner.")\n'
            + '- "Comics, not police procedural."');
    });

    it('passes (none) for an arc without rulings', () => {
        const variables = buildPlanCheckVariables({ ...storedAct(), rulings: undefined }, null);
        assert.equal(variables.RULINGS, '(none)');
    });
});

describe('mergeReplan with rulings', () => {
    it('carries the rulings unchanged, with their answered state', () => {
        const generated = { ...storedAct(), title: 'Ignored', premise: 'Sundown mentors her.', rulings: undefined, beats: [] };

        const merged = mergeReplan(storedAct(), generated);

        assert.deepEqual(merged.rulings, [
            { id: 'r2', text: 'Comics, not police procedural.', at: 2408, messageId: 'm2408' },
            { id: 'r1', text: 'Option one', chose: 'Sundown trains her as a mentor, never as a partner.', at: 2406, answeredAt: 2500 },
        ]);
    });
});

describe('applyReplan: rulings the player removed', () => {
    it('removes the removed rulings, marks the open ones answered and keeps answered marks', () => {
        const merged = {
            ...storedAct(),
            rulings: [
                { id: 'r1', text: 'Aegis is not her defender.', at: 2406, answeredAt: 2500 },
                { id: 'r2', text: 'Comics, not police procedural.', at: 2408 },
                { id: 'r3', text: 'Gabriel saves her.', at: 2410 },
                { id: 'r4', text: 'Old answered mistake.', at: 2300, answeredAt: 2400 },
            ],
        };

        const { arc, error } = applyReplan(merged, 2664, { premise: 'Sundown mentors her.', removedRulingIds: ['r3', 'r4'] });

        assert.equal(error, null);
        assert.deepEqual(arc.rulings, [
            { id: 'r1', text: 'Aegis is not her defender.', at: 2406, answeredAt: 2500 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 2408, answeredAt: 2664 },
        ]);
    });
});
