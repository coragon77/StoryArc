import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';

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
