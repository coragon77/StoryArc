import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateArcPlan } from '../lib/planning/validation.js';
import { applyArcEdit } from '../lib/planning/arc-edit.js';
import { applyPlanCheck, buildPlanCheckVariables } from '../lib/planning/generator.js';
import { arcWorldFacts } from '../lib/core/settings.js';
import { createDefaultArc } from '../lib/core/constants.js';

// World facts: what is true in an arc's world, in place of directives and
// anti-patterns (ADR-0009, docs/plans/2026-11-09-plans-state-the-situation.md).

/** The smallest plan validateArcPlan accepts, plus the given fields. */
function rawPlan(fields) {
    return {
        title: 'Night Shift',
        premise: 'The clinic is short-staffed.',
        beats: [{ id: 'beat_1', intention: 'Amy has taken a shift.' }],
        ...fields,
    };
}

describe('world facts: data', () => {
    it('a new arc has an empty list', () => {
        assert.deepEqual(createDefaultArc().worldFacts, []);
    });

    it('an arc stored before world facts reads as having none', () => {
        assert.deepEqual(arcWorldFacts({ directives: ['Keep it tense'] }), []);
        assert.deepEqual(arcWorldFacts({ worldFacts: 'not a list' }), []);
        assert.deepEqual(arcWorldFacts({ worldFacts: ['The clinic cannot force overtime.'] }), ['The clinic cannot force overtime.']);
    });
});

describe('world facts: validateArcPlan', () => {
    it('keeps the list, trimmed, without blanks or non-strings', () => {
        const { valid, arc } = validateArcPlan(rawPlan({
            worldFacts: ['  The clinic cannot force overtime. ', '', '   ', 42, 'Mara wants the night rota.'],
        }));
        assert.equal(valid, true);
        assert.deepEqual(arc.worldFacts, ['The clinic cannot force overtime.', 'Mara wants the night rota.']);
    });

    it('wraps a single string and accepts the snake-case key', () => {
        assert.deepEqual(validateArcPlan(rawPlan({ worldFacts: 'Only doctors sign discharges.' })).arc.worldFacts, ['Only doctors sign discharges.']);
        assert.deepEqual(validateArcPlan(rawPlan({ world_facts: ['Only doctors sign discharges.'] })).arc.worldFacts, ['Only doctors sign discharges.']);
    });

    it('gives a plan without world facts an empty list', () => {
        assert.deepEqual(validateArcPlan(rawPlan({})).arc.worldFacts, []);
    });
});

describe('world facts: applyArcEdit', () => {
    it('stores an edited list and refuses a list that is not one', () => {
        const stored = createDefaultArc({ id: 'arc-1', title: 'Night Shift', premise: 'The clinic is short-staffed.', beats: [{ id: 'beat_1', intention: 'Amy has taken a shift.', status: 'active', unlockAfter: [] }] });

        const { arc, error } = applyArcEdit(stored, JSON.stringify({ ...stored, worldFacts: ['The clinic cannot force overtime.'] }));
        assert.equal(error, null);
        assert.deepEqual(arc.worldFacts, ['The clinic cannot force overtime.']);

        const refused = applyArcEdit(stored, JSON.stringify({ ...stored, worldFacts: 'The clinic cannot force overtime.' }));
        assert.equal(refused.error, 'worldFacts must be a list.');
    });

    it('accepts the JSON of an arc stored before world facts, which has no key', () => {
        const { worldFacts, ...oldArc } = createDefaultArc({ id: 'arc-1', title: 'Night Shift', premise: 'The clinic is short-staffed.', beats: [{ id: 'beat_1', intention: 'Amy has taken a shift.', status: 'active', unlockAfter: [] }] });
        const { arc, error } = applyArcEdit(oldArc, JSON.stringify({ ...oldArc, title: 'Day Shift' }));
        assert.equal(error, null);
        assert.equal(arc.title, 'Day Shift');
        assert.equal('worldFacts' in arc, false);
    });
});

/** A fresh act with three world facts. */
function makeActWithFacts() {
    return {
        id: 'act-1',
        title: 'Night Shift',
        tier: 'act',
        premise: 'The clinic is short-staffed.',
        direction: '',
        worldFacts: [
            'Keep the scenes with Mara tense.',
            'Mara distrusts the agency nurses, so play her cold.',
            'The clinic cannot make Amy work outside her shifts.',
        ],
        secrets: [],
        triggers: [],
        beats: [{ id: 'rota', pressure: 'The rota has holes.', intention: 'Amy has taken a shift.', status: 'active' }],
        foreshadowing: [],
    };
}

describe('world facts: the plan check', () => {
    it('lists each world fact with its index for the check', () => {
        const variables = buildPlanCheckVariables(makeActWithFacts(), null);
        assert.equal(variables.WORLD_FACTS, [
            '- [0] Keep the scenes with Mara tense.',
            '- [1] Mara distrusts the agency nurses, so play her cold.',
            '- [2] The clinic cannot make Amy work outside her shifts.',
        ].join('\n'));
    });

    it('passes (none) for an arc without world facts, stored or new', () => {
        assert.equal(buildPlanCheckVariables({ ...makeActWithFacts(), worldFacts: [] }, null).WORLD_FACTS, '(none)');
        const { worldFacts, ...oldArc } = makeActWithFacts();
        assert.equal(buildPlanCheckVariables(oldArc, null).WORLD_FACTS, '(none)');
    });

    it('the prompt has the block and the rule', () => {
        const text = readFileSync(new URL('../prompts/check-plan.txt', import.meta.url), 'utf8');
        assert.ok(text.includes('== WORLD FACTS ==\n{{WORLD_FACTS}}'));
        assert.ok(text.includes('Rewrite a world fact that says how to narrate as the statement of fact inside it, or drop it with an empty "text" when it holds none.'));
        assert.ok(text.includes('"kind": "trigger | pressure | fulfillment | worldFact | secret"'));
    });

    it('rewrites a fact, drops one with an empty text, and ignores unknown indexes', () => {
        const arc = makeActWithFacts();
        const checked = applyPlanCheck(arc, {
            rewrites: [
                { kind: 'worldFact', id: 0, text: '' },
                { kind: 'worldFact', id: '1', text: 'Mara distrusts the agency nurses.' },
                { kind: 'worldFact', id: 3, text: 'Out of range.' },
                { kind: 'worldFact', id: -1, text: 'Negative.' },
                { kind: 'worldFact', id: 'two', text: 'Not a number.' },
                { kind: 'worldFact', id: '', text: 'No id.' },
                { kind: 'pressure', id: '2', text: 'A pressure rewrite with a fact index.' },
            ],
        }, []);
        assert.deepEqual(checked.worldFacts, [
            'Mara distrusts the agency nurses.',
            'The clinic cannot make Amy work outside her shifts.',
        ]);
        assert.deepEqual(arc.worldFacts, makeActWithFacts().worldFacts, 'the arc given is not mutated');
    });

    it('leaves the facts alone without world-fact rewrites, and adds no list to an old arc', () => {
        assert.deepEqual(applyPlanCheck(makeActWithFacts(), { rewrites: [] }, []).worldFacts, makeActWithFacts().worldFacts);
        const { worldFacts, ...oldArc } = makeActWithFacts();
        assert.equal('worldFacts' in applyPlanCheck(oldArc, { rewrites: [{ kind: 'worldFact', id: 0, text: 'Nowhere to go.' }] }, []), false);
    });

    it('renames a character inside a world fact', () => {
        const arc = { ...makeActWithFacts(), worldFacts: ['Julian Hale owns the night agency.'], characters: ['Julian Hale'] };
        const cast = [{ name: 'Julian Sterling', aliases: [] }];
        const checked = applyPlanCheck(arc, { renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }] }, [], { cast });
        assert.deepEqual(checked.worldFacts, ['Owen Marsh owns the night agency.']);
    });
});
