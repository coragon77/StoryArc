import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

function withChatLength(n, fn) {
    chat.length = 0;
    for (let i = 0; i < n; i++) chat.push({ mes: `message ${i}` });
    try {
        return fn();
    } finally {
        chat.length = 0;
    }
}

function makeArc(overrides = {}) {
    return {
        id: 'abcd1234-full-id',
        title: 'The Warmth Behind the Wall',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
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

describe('buildInjection — dispatch by tier and focus', () => {
    it('renders a normal episode as the full section', () => {
        const text = buildInjection([makeArc()]);
        assert.ok(text.includes('=== FOREGROUNDED: "The Warmth Behind the Wall" ==='));
        assert.ok(text.includes('CURRENT PRESSURE:'));
    });

    it('renders a paused arc as the one-line summary only', () => {
        const text = buildInjection([makeArc({ focus: 'paused' })]);
        assert.ok(text.includes('=== PAUSED: "The Warmth Behind the Wall" ===\nA premise. — pending, not being pursued right now.\n'));
        assert.equal(text.includes('BACKGROUNDED'), false);
        assert.equal(text.includes('distant tension'), false);
        assert.equal(text.includes('CURRENT PRESSURE:'), false);
        assert.equal(text.includes('PACING RULES:'), false);
    });

    it('falls back to the title when a paused arc has no premise', () => {
        const text = buildInjection([makeArc({ focus: 'paused', premise: '' })]);
        assert.ok(text.includes('The Warmth Behind the Wall — pending, not being pursued right now.'));
    });

    it('renders a spotlit episode as the full section (spotlight behaves as normal for now)', () => {
        const text = buildInjection([makeArc({ focus: 'spotlight' })]);
        assert.ok(text.includes('CURRENT PRESSURE:'));
        assert.equal(text.includes('PAUSED'), false);
    });

    it('renders acts and sagas as the milestone section (details in test-tier.js)', () => {
        for (const tier of ['act', 'saga']) {
            const text = buildInjection([makeArc({ tier })]);
            assert.ok(text.includes(`=== ${tier.toUpperCase()}: "The Warmth Behind the Wall" ===`), tier);
            assert.equal(text.includes('CURRENT PRESSURE:'), false, tier);
        }
    });

    it('treats a missing tier as episode', () => {
        const arc = makeArc();
        delete arc.tier;
        assert.ok(buildInjection([arc]).includes('CURRENT PRESSURE:'));
    });

    it('puts full sections before one-liners, storage order within each group', () => {
        const text = buildInjection([
            makeArc({ id: 'p1', title: 'Paused One', focus: 'paused' }),
            makeArc({ id: 'n1', title: 'Normal One' }),
            makeArc({ id: 'p2', title: 'Paused Two', focus: 'paused' }),
            makeArc({ id: 'n2', title: 'Normal Two' }),
        ]);
        const order = ['"Normal One"', '"Normal Two"', '"Paused One"', '"Paused Two"'];
        const positions = order.map(t => text.indexOf(t));
        for (let i = 1; i < positions.length; i++) {
            assert.ok(positions[i] > positions[i - 1], `${order[i]} after ${order[i - 1]}`);
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

    it('lists no recognition line for a paused arc of any tier, but keeps the guard and clause', () => {
        for (const tier of ['episode', 'act', 'saga']) {
            const text = buildSignalInjection([makeArc({ tier, focus: 'paused' })]);
            assert.ok(text.includes('CONTINUATION:'), tier);
            assert.ok(text.includes('The arc plan is invisible scaffolding.'), tier);
            assert.equal(text.includes('BEAT CHECK:'), false, tier);
            assert.equal(text.includes('sensory_bleed'), false, tier);
        }
    });

    it('still lists the active arc\'s beat next to a paused one', () => {
        const text = buildSignalInjection([makeArc({ id: 'paused00-x', title: 'P', focus: 'paused' }), makeArc()]);
        assert.ok(text.includes('[ARC_SIGNAL:abcd1234:sensory_bleed:COMPLETE]'));
        assert.equal(text.includes('paused00'), false);
    });

    it('returns nothing when there are no arcs', () => {
        assert.equal(buildSignalInjection([]), '');
    });
});

describe('prefix-cache stability', () => {
    // The IN_PROMPT block sits before the cache breakpoint. One changed byte
    // there invalidates the whole cached prefix, so nothing in it may depend
    // on the message count.
    it('IN_PROMPT injection is byte-identical as messages accumulate', () => {
        const arc = makeArc();
        const atZero = withChatLength(0, () => buildInjection([arc]));
        const atSix = withChatLength(6, () => buildInjection([arc]));
        assert.equal(atSix, atZero);
    });

    it('states the phase brake as a fixed boundary, not a countdown', () => {
        // estimatedLength 40, messageStart 0, 6 messages: setup phase
        // (6/40 = 0.15 < 0.20), boundary at floor(0.20 * 40) = arc message 8.
        const text = withChatLength(6, () => buildSignalInjection([makeArc()]));
        assert.ok(text.includes('- "The Warmth Behind the Wall": do not advance to the next phase before arc message 8.'));
    });

    // The in-chat block sits at the very end of the prompt. Anything in it that
    // moves from message to message costs the whole cached prefix, so the
    // per-message counters live on the messages themselves instead.
    it('in-chat injection is byte-identical as messages accumulate within a phase', () => {
        const arc = makeArc();
        // 2 and 7 of 40 are both setup (< 0.20 * 40 = 8).
        const atTwo = withChatLength(2, () => buildSignalInjection([arc]));
        const atSeven = withChatLength(7, () => buildSignalInjection([arc]));
        assert.ok(atTwo.includes('ARC PACING:'));
        assert.equal(atSeven, atTwo);
    });

    it('carries no digit that tracks the current message count', () => {
        const text = withChatLength(6, () => buildSignalInjection([makeArc()]));
        assert.equal(/\b6 messages\b/.test(text), false);
        assert.equal(/\b2 more messages\b/.test(text), false);
    });

    it('brakes every episode that is not paused, as before tiers', () => {
        const text = withChatLength(6, () => buildSignalInjection([
            makeArc({ title: 'First' }),
            makeArc({ id: 'second', title: 'Second Episode' }),
            makeArc({ id: 'lit', title: 'Spotlit', focus: 'spotlight' }),
            makeArc({ id: 'paused', title: 'Paused', focus: 'paused' }),
            makeArc({ id: 'act', title: 'An Act', tier: 'act' }),
        ]));
        assert.ok(text.includes('- "First": do not advance to the next phase before arc message 8.'));
        assert.ok(text.includes('- "Second Episode": do not advance'));
        assert.ok(text.includes('- "Spotlit": do not advance'));
        assert.equal(text.includes('"Paused"'), false);
        assert.equal(text.includes('"An Act"'), false);
    });

    it('emits no pacing block when every episode is paused', () => {
        const text = withChatLength(6, () => buildSignalInjection([makeArc({ focus: 'paused' })]));
        assert.equal(text.includes('ARC PACING:'), false);
        assert.ok(text.includes('CONTINUATION:'));
    });

    it('emits the pacing block even when beat tracking is off', () => {
        chat_metadata.story_arc.settings.autoTrack = false;
        try {
            const text = withChatLength(6, () => buildSignalInjection([makeArc()]));
            assert.ok(text.includes('ARC PACING:'));
            assert.equal(text.includes('ARC_SIGNAL'), false);
        } finally {
            delete chat_metadata.story_arc.settings.autoTrack;
        }
    });
});
