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

/** The plan block's first line; stamping.js only stamps prompts carrying it. */
const HEADER = '[STORY ARC - NARRATIVE DIRECTION]';
const END = '\n[END STORY ARC]';

/** The injection without its end marker: the part the budget is measured on. */
function bodyOf(text) {
    assert.ok(text.endsWith(END));
    return text.slice(0, -END.length);
}

describe('buildInjection — frame', () => {
    it('starts with the header line and the first section, and ends with the end marker', () => {
        const text = withChatLength(0, () => buildInjection([makeArc()]));
        assert.ok(text.startsWith(`${HEADER}\n\n=== FOREGROUNDED: "The Warmth Behind the Wall" ===\n[Phase: Setup | Pacing: Do not rush]\n\nPREMISE: A premise.\n`));
        assert.ok(text.includes('CURRENT PRESSURE:\nThe symptoms are getting harder to hide.\n\nPACING RULES:\n'));
        assert.ok(text.endsWith('- If tempted to resolve something — add a complication instead.\n\n[END STORY ARC]'));
    });

    it('separates sections by a line break', () => {
        const text = withChatLength(0, () => buildInjection([makeArc(), makeArc({ id: 'p1', title: 'Paused One', focus: 'paused' })]));
        assert.ok(text.includes('- If tempted to resolve something — add a complication instead.\n\n=== PAUSED: "Paused One" ===\n'));
    });

    it('returns nothing for an empty arc list', () => {
        assert.equal(buildInjection([]), '');
    });

    it('returns a body exactly at the budget untrimmed', () => {
        const arc = makeArc({ antiPatterns: ['No sudden villains.'] });
        const untrimmed = buildInjection([arc]);
        chat_metadata.story_arc.settings.injectionBudget = Math.ceil(bodyOf(untrimmed).length / 4);
        try {
            assert.equal(buildInjection([arc]), untrimmed);
        } finally {
            delete chat_metadata.story_arc.settings.injectionBudget;
        }
    });
});

describe('buildInjection — episode section content', () => {
    function makeFullArc() {
        return makeArc({
            tone: 'Slow dread.',
            antiPatterns: ['No sudden villains.'],
            directives: ['Keep it intimate.', 'Show, do not tell.'],
            secrets: [
                { content: 'Shown from the start.', revealPhase: 'any', disclosed: false },
                { content: 'Already out in the open.', revealPhase: 'any', disclosed: true },
                { content: 'Saved for the climax.', revealPhase: 'climax', disclosed: false },
                { content: 'Known since setup.', revealPhase: 'setup', disclosed: false },
            ],
            triggers: [
                { condition: 'the door opens', action: 'the cold rushes in', fired: false },
                { condition: 'she screams', action: 'the neighbours call', fired: true },
            ],
            foreshadowing: [
                { clue: 'A scratch on the lock.', target: 'the intruder', planted: false },
                { clue: 'Wet footprints.', target: 'the intruder', planted: true },
            ],
        });
    }

    it('prints TONE after the premise when the arc has one', () => {
        const text = withChatLength(0, () => buildInjection([makeFullArc()]));
        assert.ok(text.includes('PREMISE: A premise.\n\nTONE: Slow dread.\n\nCURRENT PRESSURE:\n'));
    });

    it('prints the PACING RULES line with the upper-case phase label and that phase\'s directive', () => {
        const setup = withChatLength(0, () => buildInjection([makeFullArc()]));
        assert.ok(setup.includes('PACING RULES:\n- You are in SETUP phase. Plant seeds. Build atmosphere. No revelations. No confrontations.\n- If tempted to resolve something — add a complication instead.\n'));

        // One of two beats done (0.5) and 20 of 40 messages (0.5): escalation.
        const arc = makeFullArc();
        arc.beats[0].status = 'completed';
        arc.beats[1].status = 'active';
        const escalation = withChatLength(20, () => buildInjection([arc]));
        assert.ok(escalation.includes('- You are in ESCALATION phase. Stakes rise sharply. Confrontations can begin. Secrets start surfacing.\n'));
    });

    it('lists directives, then only open secrets, unfired triggers and unplanted clues, in that order', () => {
        const text = withChatLength(0, () => buildInjection([makeFullArc()]));
        const lists = [
            'DO NOT:',
            '- No sudden villains.',
            '',
            'DIRECTIVES:',
            '- Keep it intimate.',
            '- Show, do not tell.',
            '',
            'SECRETS (guard these carefully — do not reveal directly):',
            '- Shown from the start.',
            '- Known since setup.',
            '',
            'TRIGGERS (check narrative conditions each message — a trigger changes how characters act, it never discloses a SECRET):',
            '- IF the door opens → the cold rushes in',
            '',
            'FORESHADOWING TO PLANT:',
            '- A scratch on the lock. (foreshadows: the intruder)',
            '',
        ].join('\n');
        assert.ok(text.endsWith(`${lists}\n[END STORY ARC]`), text);
    });

    it('never shows a disclosed secret, a secret before its phase, a fired trigger or a planted clue', () => {
        const text = withChatLength(0, () => buildInjection([makeFullArc()]));
        assert.equal(text.includes('Already out in the open.'), false);
        assert.equal(text.includes('Saved for the climax.'), false);
        assert.equal(text.includes('she screams'), false);
        assert.equal(text.includes('the neighbours call'), false);
        assert.equal(text.includes('Wet footprints.'), false);
    });

    it('leaves no header behind for an empty or fully filtered list', () => {
        const empty = withChatLength(0, () => buildInjection([makeArc({ premise: '' })]));
        const filtered = withChatLength(0, () => buildInjection([makeArc({
            secrets: [{ content: 'Out already.', revealPhase: 'any', disclosed: true }],
            triggers: [{ condition: 'x', action: 'y', fired: true }],
            foreshadowing: [{ clue: 'z', target: 'w', planted: true }],
        })]));
        for (const text of [empty, filtered]) {
            for (const header of ['TONE:', 'DO NOT:', 'DIRECTIVES:', 'SECRETS', 'TRIGGERS', 'FORESHADOWING']) {
                assert.equal(text.includes(header), false, header);
            }
        }
        assert.equal(empty.includes('PREMISE:'), false);
    });
});

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
        assert.ok(text.includes('CURRENT FOCUS:\nDevelop the consequences of recent events.'));
        assert.ok(text.includes('this scene.\n\nPACING RULES:\n'));
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

            assert.ok(text.includes('PACING RULES:\n- You are in SETUP phase.'));
            assert.ok(text.includes('DO NOT:\n- No sudden villains.\n'));
            assert.ok(text.endsWith('\n[END STORY ARC]'));
            assert.ok(Math.ceil(bodyOf(text).length / 4) <= 200, 'trimmed to the budget');
            assert.ok(text.includes('FORESHADOWING TO PLANT:\n- Clue number 0 '));
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

    it('drops a spotlit act\'s list items before a later episode\'s guardrails', () => {
        chat_metadata.story_arc.settings.injectionBudget = 300;
        try {
            const foreshadowing = Array.from({ length: 40 }, (_, index) => ({
                clue: `Clue number ${index} about the mystery, phrased at length so each line carries real weight.`,
                target: 'the reveal',
                planted: false,
            }));
            const act = makeArc({
                id: 'act00001-full-id',
                title: 'The Long Winter',
                tier: 'act',
                focus: 'spotlight',
                foreshadowing,
                beats: [{ id: 'cold', pressure: 'The cold keeps coming.', intention: 'x', status: 'pending', optional: false }],
            });
            const episode = makeArc({ antiPatterns: ['No sudden villains.'] });
            const text = withChatLength(0, () => buildInjection([episode, act]));

            assert.ok(text.startsWith(`${HEADER}\n\n=== ACT: "The Long Winter" ===\n`), 'spotlit act first');
            assert.ok(text.includes('BRING TO A HEAD:\n- The cold keeps coming.\n'));
            assert.ok(text.includes('FORESHADOWING TO PLANT:\n- Clue number 0 '));
            assert.equal(text.includes('Clue number 39'), false);
            assert.ok(text.includes('PACING RULES:\n- You are in SETUP phase.'));
            assert.ok(text.includes('DO NOT:\n- No sudden villains.'));
            assert.ok(text.endsWith('DO NOT:\n- No sudden villains.\n[END STORY ARC]'), text);
            assert.ok(Math.ceil(bodyOf(text).length / 4) <= 300, 'trimmed to the budget');
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
            // The guardrails alone exceed 60 tokens: they stay, over budget.
            assert.ok(text.includes('PACING RULES:\n- You are in SETUP phase.'));
            assert.ok(text.endsWith('- If tempted to resolve something — add a complication instead.\n[END STORY ARC]'), text);
        } finally {
            delete chat_metadata.story_arc.settings.injectionBudget;
        }
    });

    // The two tests below size the budget from the untrimmed output: trimming
    // keeps a prefix of whole lines, so the expected result is that prefix.
    function shortClueArc() {
        const foreshadowing = Array.from({ length: 12 }, (_, i) => ({ clue: `c${i}`, target: 't', planted: false }));
        return makeArc({ antiPatterns: ['No sudden villains.'], foreshadowing });
    }

    it('keeps every whole line that fits the budget, counting the line breaks', () => {
        const arc = shortClueArc();
        const lines = bodyOf(withChatLength(0, () => buildInjection([arc]))).split('\n');
        const kept = lines.slice(0, lines.indexOf('- c5 (foreshadows: t)') + 1).join('\n');
        chat_metadata.story_arc.settings.injectionBudget = Math.ceil(kept.length / 4);
        try {
            const text = withChatLength(0, () => buildInjection([arc]));
            assert.equal(text, `${kept}\n[END STORY ARC]`);
            assert.ok(text.endsWith('- c4 (foreshadows: t)\n- c5 (foreshadows: t)\n[END STORY ARC]'));
        } finally {
            delete chat_metadata.story_arc.settings.injectionBudget;
        }
    });

    it('does not end on a section header or a blank line when the cut falls right after one', () => {
        const arc = shortClueArc();
        const lines = bodyOf(withChatLength(0, () => buildInjection([arc]))).split('\n');
        const upToHeader = lines.slice(0, lines.indexOf('FORESHADOWING TO PLANT:') + 1).join('\n');
        chat_metadata.story_arc.settings.injectionBudget = Math.ceil(upToHeader.length / 4);
        try {
            const text = withChatLength(0, () => buildInjection([arc]));
            assert.ok(text.endsWith('DO NOT:\n- No sudden villains.\n[END STORY ARC]'), text);
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

    it('renders a spotlit episode as the full section (details in test-spotlight.js)', () => {
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

    it('puts a normal act and a background saga after a normal episode stored after them', () => {
        const text = buildInjection([
            makeArc({ id: 'a1', title: 'Normal Act', tier: 'act' }),
            makeArc({ id: 's1', title: 'Background Saga', tier: 'saga', focus: 'background' }),
            makeArc({ id: 'e1', title: 'Normal Episode' }),
        ]);
        const episode = text.indexOf('=== FOREGROUNDED: "Normal Episode"');
        assert.ok(episode >= 0);
        assert.ok(text.indexOf('=== ACT: "Normal Act"') > episode, 'act after episode');
        assert.ok(text.indexOf('=== BACKGROUND: "Background Saga"') > episode, 'background after episode');
    });

    it('ranks a normal arc without a tier (planned before tiers) as an episode', () => {
        const untiered = makeArc({ id: 'u1', title: 'Untiered Episode' });
        delete untiered.tier;
        const text = buildInjection([makeArc({ id: 'a1', title: 'Normal Act', tier: 'act' }), untiered]);
        assert.ok(text.indexOf('"Normal Act"') > text.indexOf('"Untiered Episode"'));
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
        assert.ok(text.includes('\nCONTINUATION: Continue the story from the end of the most recent\n'));
        assert.ok(text.includes('Never restart the scene or re-narrate earlier turns'));
        assert.ok(text.includes('the last message was not written by the user.\n'));
        assert.ok(text.includes('\nThe arc plan is invisible scaffolding. Never quote or reference its\n'));
        assert.ok(text.includes('beat ids, beat intentions, phase names, secrets, or upcoming beats'));
        assert.ok(text.includes('not in prose, and not in any journal'));
        assert.ok(text.includes('state-tracking block another prompt asks you'));
        assert.ok(text.includes('describe only events that already happened on screen.\n'));
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

    it('puts the single-exception sentence between the clause and the beat check when only a beat is checked', () => {
        const text = buildSignalInjection([makeArc()]);
        assert.ok(text.includes('already happened on screen.\n\nThe markers below are the single exception to that rule.\n\nBEAT CHECK:\n'));
        assert.ok(text.includes('They are not instructions — do not steer the scene toward them.'));
        assert.equal(text.includes('PLANT CHECK'), false);
    });

    it('keeps the single-exception sentence when only a clue is checked (linger turn)', () => {
        const arc = makeArc({ foreshadowing: [{ id: 'cold_draft', clue: 'A cold draft.', target: 'x', planted: false }] });
        arc.beats[0].status = 'completed';
        const text = buildSignalInjection([arc]);
        assert.ok(text.includes('already happened on screen.\n\nThe markers below are the single exception to that rule.\n\nPLANT CHECK:\n'));
        assert.ok(text.includes('already planted this clue'));
        assert.equal(text.includes('BEAT CHECK'), false);
    });

    it('states the single-exception sentence once when a beat and a clue are checked', () => {
        const text = buildSignalInjection([makeArc({ foreshadowing: [{ id: 'cold_draft', clue: 'A cold draft.', target: 'x', planted: false }] })]);
        assert.equal(text.split('single exception').length - 1, 1);
        assert.ok(text.includes('BEAT CHECK:'));
        assert.ok(text.includes('PLANT CHECK:'));
        // Blank lines separate the guard, the clause, each check's prose and its marker lines.
        assert.ok(text.includes('not written by the user.\n\nThe arc plan is invisible scaffolding.'));
        assert.ok(text.includes('omit the marker.\n\nIf the story has already brought this about'));
        assert.ok(text.includes('sensory_bleed:COMPLETE] -->\n\nPLANT CHECK:\n'));
        assert.ok(text.includes('omit the marker.\n\nIf the story has already planted this clue'));
        assert.ok(text.endsWith('cold_draft:PLANTED] -->\n'));
    });

    it('does not throw for an untiered arc without foreshadowing or triggers arrays, and lists no plant check', () => {
        const arc = makeArc();
        delete arc.foreshadowing;
        delete arc.triggers;
        const text = buildSignalInjection([arc]);
        assert.ok(text.includes('[ARC_SIGNAL:abcd1234:sensory_bleed:COMPLETE]'));
        assert.equal(text.includes('PLANT CHECK'), false);
    });

    it('lists the clues of an untiered (pre-tier) episode in the plant check', () => {
        const arc = makeArc({ foreshadowing: [{ id: 'cold_draft', clue: 'A cold draft.', target: 'x', planted: false }] });
        delete arc.tier;
        assert.ok(buildSignalInjection([arc]).includes('<!-- [ARC_SIGNAL:abcd1234:cold_draft:PLANTED] -->'));
    });

    it('returns the pacing block, then the directive on its own lines, as one string', () => {
        const text = withChatLength(6, () => buildSignalInjection([makeArc()]));
        assert.equal(typeof text, 'string');
        assert.ok(text.startsWith('ARC PACING:\n- "The Warmth Behind the Wall": do not advance to the next phase before arc message 8.\n\nCONTINUATION: Continue the story'));
    });

    it('brakes an arc without an estimated length with the "early" line', () => {
        const arc = makeArc();
        delete arc.estimatedLength;
        const text = withChatLength(6, () => buildSignalInjection([arc]));
        assert.ok(text.startsWith('ARC PACING:\n- "The Warmth Behind the Wall": do not advance to the next phase early.\n\nCONTINUATION:'));
    });

    it('returns an empty string with no pacing clock and beat tracking off', () => {
        chat_metadata.story_arc.settings.autoTrack = false;
        try {
            assert.equal(withChatLength(6, () => buildSignalInjection([makeArc({ focus: 'paused' })])), '');
            assert.equal(withChatLength(6, () => buildSignalInjection([makeArc({ tier: 'act' })])), '');
        } finally {
            delete chat_metadata.story_arc.settings.autoTrack;
        }
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

    it('brakes the pacing clock only — never a paused episode or an act', () => {
        const text = withChatLength(6, () => buildSignalInjection([
            makeArc({ title: 'First' }),
            makeArc({ id: 'second', title: 'Second Episode' }),
            makeArc({ id: 'paused', title: 'Paused', focus: 'paused' }),
            makeArc({ id: 'act', title: 'An Act', tier: 'act' }),
        ]));
        assert.ok(text.includes('- "First": do not advance to the next phase before arc message 8.'));
        assert.equal(text.includes('"Second Episode"'), false);
        assert.equal(text.includes('"Paused"'), false);
        assert.equal(text.includes('"An Act"'), false);
    });

    it('emits no pacing block when every episode is paused', () => {
        const text = withChatLength(6, () => buildSignalInjection([makeArc({ focus: 'paused' })]));
        assert.equal(text.includes('ARC PACING:'), false);
        assert.ok(text.startsWith('CONTINUATION:'), 'no blank line left where the pacing block would be');
    });

    it('emits the pacing block even when beat tracking is off', () => {
        chat_metadata.story_arc.settings.autoTrack = false;
        try {
            const text = withChatLength(6, () => buildSignalInjection([makeArc()]));
            assert.equal(text, 'ARC PACING:\n- "The Warmth Behind the Wall": do not advance to the next phase before arc message 8.\n');
        } finally {
            delete chat_metadata.story_arc.settings.autoTrack;
        }
    });
});
