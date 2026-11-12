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

describe('buildArcSoFar: reached milestones count toward the tier\'s milestone count', () => {
    const countSentence = 'On a re-plan the TIER block\'s count covers the whole arc: your milestones and the milestones below under Already happened and Passed over count together toward its minimum and its usual ceiling. Write only the steps that remain, and always at least one, even when that leaves fewer new milestones than the minimum.';

    it('tells an act and a saga re-plan, right after "what comes NEXT", that it overrides the TIER block\'s minimum', () => {
        for (const tier of ['act', 'saga']) {
            const text = buildArcSoFar({ ...storedAct(), tier });
            assert.ok(text.includes(`your beats are what comes NEXT. ${countSentence} The current premise`), tier);
        }
    });

    it('leaves it out for an episode, whose scene beats are no milestones', () => {
        assert.equal(buildArcSoFar({ ...storedAct(), tier: 'episode' }).includes('count together'), false);
    });

    it('marks the scene beats an episode carried into an act and excludes them from the count', () => {
        const act = storedAct();
        const sceneBeat = { id: 'old_scene', status: 'completed', intention: 'Ellie has met Sundown on the roof.', sceneBeat: true };
        const text = buildArcSoFar({ ...act, beats: [sceneBeat, ...act.beats] });

        assert.ok(text.includes('- Ellie has met Sundown on the roof. (a scene beat from its episode days)'));
        assert.ok(text.includes('under Already happened and Passed over (the scene beats from its episode days do not count) count together'));
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

describe('applyReplan: the rulings come from the stored arc at apply', () => {
    /** The merged arc with the rulings the generation saw. */
    function mergedWithRulings(rulings) {
        return { ...storedAct(), rulings };
    }

    it('drops the rulings removed in step 2, marks the ones the generation saw answered and keeps an earlier answeredAt', () => {
        const seenRulings = [
            { id: 'r1', text: 'Aegis is not her defender.', at: 2406, answeredAt: 2500 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 2408 },
        ];
        const storedRulingsAtApply = [
            { id: 'r1', text: 'Aegis is not her defender.', at: 2406, answeredAt: 2500 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 2408 },
            { id: 'r3', text: 'Gabriel saves her.', at: 2410 },
            { id: 'r4', text: 'Old answered mistake.', at: 2300, answeredAt: 2400 },
        ];

        const { arc, error } = applyReplan(mergedWithRulings(seenRulings), 2664, {
            premise: 'Sundown mentors her.', removedRulingIds: ['r3', 'r4'], storedRulings: storedRulingsAtApply,
        });

        assert.equal(error, null);
        assert.deepEqual(arc.rulings, [
            { id: 'r1', text: 'Aegis is not her defender.', at: 2406, answeredAt: 2500 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 2408, answeredAt: 2664 },
        ]);
    });

    it('keeps a ruling stored after Generate open: the planner never saw it', () => {
        const seenRulings = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }];
        const storedRulingsAtApply = [
            { id: 'r1', text: 'Comics, not police procedural.', at: 2408 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 2660, messageId: 'm2660' },
        ];

        const { arc } = applyReplan(mergedWithRulings(seenRulings), 2664, {
            premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: storedRulingsAtApply,
        });

        assert.deepEqual(arc.rulings, [
            { id: 'r1', text: 'Comics, not police procedural.', at: 2408, answeredAt: 2664 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 2660, messageId: 'm2660' },
        ]);
    });

    it('keeps a ruling gone from the stored arc gone, though the generation saw it', () => {
        const seenRulings = [
            { id: 'r1', text: 'Comics, not police procedural.', at: 2408 },
            { id: 'r2', text: 'Aegis is not her defender.', at: 2410, messageId: 'm2410' },
        ];
        const storedRulingsAtApply = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }];

        const { arc } = applyReplan(mergedWithRulings(seenRulings), 2664, {
            premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: storedRulingsAtApply,
        });

        assert.deepEqual(arc.rulings, [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408, answeredAt: 2664 }]);
    });

    it('a new ruling that took a deleted ruling\'s id stays open', () => {
        const seenRulings = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }];
        const storedRulingsAtApply = [{ id: 'r1', text: 'Gabriel never saves her.', at: 2662 }];

        const { arc } = applyReplan(mergedWithRulings(seenRulings), 2664, {
            premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: storedRulingsAtApply,
        });

        assert.deepEqual(arc.rulings, [{ id: 'r1', text: 'Gabriel never saves her.', at: 2662 }]);
    });

    it('takes a ruling\'s message index from the stored arc: a deletion during the wizard moved it', () => {
        const seenRulings = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408, messageId: 'm2408' }];
        const storedRulingsAtApply = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2407, messageId: 'm2408' }];

        const { arc } = applyReplan(mergedWithRulings(seenRulings), 2663, {
            premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: storedRulingsAtApply,
        });

        assert.deepEqual(arc.rulings, [{ id: 'r1', text: 'Comics, not police procedural.', at: 2407, messageId: 'm2408', answeredAt: 2663 }]);
    });

    it('an arc from before rulings stays without them', () => {
        const merged = storedAct();
        delete merged.rulings;

        const { arc } = applyReplan(merged, 2664, { premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: undefined });

        assert.equal('rulings' in arc, false);
    });

    it('does not mutate the stored rulings it was given', () => {
        const storedRulingsAtApply = [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }];

        applyReplan(mergedWithRulings([{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }]), 2664, {
            premise: 'Sundown mentors her.', removedRulingIds: [], storedRulings: storedRulingsAtApply,
        });

        assert.deepEqual(storedRulingsAtApply, [{ id: 'r1', text: 'Comics, not police procedural.', at: 2408 }]);
    });
});
