import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { chat_metadata } from './mocks/st-mocks.js';

function makeArc(overrides = {}) {
    return {
        id: 'abcd1234-full-id',
        title: 'The Warmth Behind the Wall',
        status: 'active',
        focus: 'foreground',
        messageStart: 0,
        premise: 'A premise.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        triggers: [],
        estimatedLength: 40,
        beats: [
            {
                id: 'sensory_bleed',
                pressure: 'The symptoms are getting harder to hide.',
                intention: 'She has admitted the infection to him.',
                status: 'active',
                optional: false,
            },
            {
                id: 'explicit_pursuit',
                pressure: 'He starts asking questions she cannot deflect.',
                intention: 'He has forced the subject into the open.',
                status: 'pending',
                optional: false,
            },
        ],
        ...overrides,
    };
}

describe('buildInjection — beat visibility', () => {
    it('shows the active beat as a pressure', () => {
        const text = buildInjection([makeArc()]);
        assert.ok(text.includes('CURRENT PRESSURE:'));
        assert.ok(text.includes('The symptoms are getting harder to hide.'));
    });

    it('hides pending beats entirely — no id, no intention, no teaser', () => {
        const text = buildInjection([makeArc()]);
        assert.equal(text.includes('explicit_pursuit'), false);
        assert.equal(text.includes('He starts asking questions she cannot deflect.'), false);
        assert.equal(text.includes('He has forced the subject into the open.'), false);
    });

    it('does not leak the active beat id or its fulfillment condition', () => {
        const text = buildInjection([makeArc()]);
        assert.equal(text.includes('sensory_bleed'), false);
        assert.equal(text.includes('She has admitted the infection to him.'), false);
        assert.equal(text.includes('(NOW)'), false);
    });

    it('falls back to the intention for arcs planned before the pressure field', () => {
        const arc = makeArc();
        arc.beats[0].pressure = '';
        const text = buildInjection([arc]);
        assert.ok(text.includes('She has admitted the infection to him.'));
    });

    it('emits the linger directive when no beat is active', () => {
        const arc = makeArc();
        arc.beats[0].status = 'completed';
        const text = buildInjection([arc]);
        assert.ok(text.includes('CURRENT FOCUS:'));
        assert.ok(text.includes('Develop the consequences of recent events.'));
        assert.equal(text.includes('CURRENT PRESSURE:'), false);
        assert.equal(text.includes('explicit_pursuit'), false);
    });
});

describe('buildInjection — section order and budget trim', () => {
    it('puts the guardrail sections before the content lists', () => {
        const arc = makeArc({
            antiPatterns: ['No sudden villains.'],
            secrets: [{ content: 'The butler did it.', disclosed: false, revealPhase: 'any' }],
            foreshadowing: [{ clue: 'A dropped glove.', target: 'the butler', planted: false }],
            triggers: [{ condition: 'the butler appears', action: 'he lies', fired: false }],
        });
        const text = buildInjection([arc]);
        const order = ['PACING RULES:', 'DO NOT:', 'SECRETS', 'TRIGGERS', 'FORESHADOWING'];
        const positions = order.map(h => text.indexOf(h));
        assert.ok(positions.every(p => p >= 0), `all sections present: ${positions}`);
        for (let i = 1; i < positions.length; i++) {
            assert.ok(positions[i] > positions[i - 1], `${order[i]} after ${order[i - 1]}`);
        }
    });

    it('trims at line boundaries — foreshadowing items drop, pacing rules survive, no mid-sentence cut', () => {
        chat_metadata.story_arc.settings.injectionBudget = 200;
        try {
            const foreshadowing = Array.from({ length: 40 }, (_, i) => ({
                clue: `Clue number ${i} about the mystery, phrased at length so each line carries real weight.`,
                target: 'the reveal',
                planted: false,
            }));
            const arc = makeArc({ antiPatterns: ['No sudden villains.'], foreshadowing });
            const text = buildInjection([arc]);

            assert.ok(text.includes('PACING RULES:'));
            assert.ok(text.includes('No sudden villains.'));
            assert.ok(text.endsWith('\n[END STORY ARC]'));
            assert.equal(text.includes('Clue number 39'), false);
            // Every surviving line is intact: a clue line either appears whole
            // (ending in its target suffix) or not at all.
            for (const line of text.split('\n')) {
                if (line.startsWith('- Clue number')) {
                    assert.ok(line.endsWith('(foreshadows: the reveal)'), `intact line: ${line}`);
                }
            }
        } finally {
            delete chat_metadata.story_arc.settings.injectionBudget;
        }
    });

    it('does not leave a section header whose items were all trimmed away', () => {
        chat_metadata.story_arc.settings.injectionBudget = 60;
        try {
            const arc = makeArc({
                foreshadowing: [{ clue: 'A very long clue that will not fit inside the tiny budget at all.', target: 'x', planted: false }],
            });
            const text = buildInjection([arc]);
            assert.equal(text.includes('FORESHADOWING TO PLANT:'), false);
        } finally {
            delete chat_metadata.story_arc.settings.injectionBudget;
        }
    });
});

describe('buildSignalInjection', () => {
    it('asks for the marker in past-tense recognition form', () => {
        const text = buildSignalInjection([makeArc()]);
        assert.ok(text.includes('If the story has already brought this about — "She has admitted the infection to him." — output exactly: <!-- [ARC_SIGNAL:abcd1234:sensory_bleed:COMPLETE] -->'));
    });

    it('lists no marker for a pending beat', () => {
        const text = buildSignalInjection([makeArc()]);
        assert.equal(text.includes('explicit_pursuit'), false);
    });

    it('keeps the continuation guard and confidentiality clause during linger', () => {
        const arc = makeArc();
        arc.beats[0].status = 'completed';
        const text = buildSignalInjection([arc]);
        assert.ok(text.includes('CONTINUATION:'));
        assert.ok(text.includes('The arc plan is invisible scaffolding.'));
        assert.equal(text.includes('BEAT CHECK:'), false);
        assert.equal(text.includes('ARC_SIGNAL'), false);
        // No marker follows, so the sentence pointing at one must be gone too.
        assert.equal(text.includes('single exception'), false);
    });

    it('returns nothing when there are no arcs', () => {
        assert.equal(buildSignalInjection([]), '');
    });
});
