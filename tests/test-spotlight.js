import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { chat } from './mocks/st-mocks.js';

function withChatLength(n, fn) {
    chat.length = 0;
    for (let i = 0; i < n; i++) chat.push({ mes: `message ${i}` });
    try {
        return fn();
    } finally {
        chat.length = 0;
    }
}

function makeAct(overrides = {}) {
    return {
        id: 'act00001-full-id',
        title: 'The Long Winter',
        status: 'active',
        tier: 'act',
        focus: 'spotlight',
        messageStart: 0,
        premise: 'The valley is starving and the guild is lying about it.',
        tone: 'Slow dread.',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [
            { id: 's_any', content: 'The granary was emptied on purpose.', revealPhase: 'any', disclosed: false },
            { id: 's_climax', content: 'The guildmaster sold the grain.', revealPhase: 'climax', disclosed: false },
        ],
        foreshadowing: [{ id: 'f1', clue: 'Carts leave at night.', target: 'secret:s_climax', planted: false }],
        triggers: [{ id: 't1', condition: 'anyone counts the sacks', action: 'the tally is short', fired: false }],
        estimatedLength: 100,
        beats: [
            { id: 'm_hunger', pressure: 'Rations shrink week by week.', intention: 'The valley knows it will not last the winter.', status: 'active', optional: false },
            { id: 'm_lies', pressure: 'The guild ledgers do not add up.', intention: 'Someone has caught the guild in a lie.', status: 'active', optional: false },
            { id: 'm_done', pressure: 'Old grudges resurface.', intention: 'A feud has turned violent.', status: 'completed', optional: false },
        ],
        ...overrides,
    };
}

function makeEpisode(overrides = {}) {
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
            { id: 'sensory_bleed', pressure: 'The symptoms are getting harder to hide.', intention: 'She has admitted the infection to him.', status: 'active', optional: false },
            { id: 'explicit_pursuit', pressure: 'He starts asking questions she cannot deflect.', intention: 'He has forced the subject into the open.', status: 'pending', optional: false },
        ],
        ...overrides,
    };
}

describe('spotlit act / saga — BRING TO A HEAD', () => {
    it('lists every unfulfilled milestone pressure under BRING TO A HEAD, not as standing pressures', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.ok(text.includes('=== ACT: "The Long Winter" ==='));
        assert.ok(text.includes('BRING TO A HEAD:'));
        assert.ok(text.includes('- Rations shrink week by week.'));
        assert.ok(text.includes('- The guild ledgers do not add up.'));
        assert.equal(text.includes('Old grudges resurface.'), false);
        assert.equal(text.includes('STANDING PRESSURES'), false);
        assert.equal(text.includes('PAUSED'), false);
    });

    it('asks the pressures to intensify without naming a milestone as the target (ADR-0002)', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.ok(text.includes('Let these pressures intensify over the coming scenes, and let the world act on its own interests.'));
        // Fulfillment conditions are the targets; none may appear.
        assert.equal(text.includes('The valley knows it will not last the winter.'), false);
        assert.equal(text.includes('Someone has caught the guild in a lie.'), false);
        assert.equal(text.includes('m_hunger'), false);
        assert.equal(/steer|choose one|pick one|resolve one|toward/i.test(text), false);
    });

    it('skips a milestone without a pressure under BRING TO A HEAD instead of printing its fulfillment (#13)', () => {
        const arc = makeAct();
        arc.beats[0].pressure = '';
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.ok(text.includes('BRING TO A HEAD:'));
        assert.equal(text.includes('The valley knows it will not last the winter.'), false);
        assert.equal(text.includes('- \n'), false);
        assert.ok(text.includes('- The guild ledgers do not add up.'));
    });

    it('adds the secrets, triggers and foreshadowing that normal focus leaves out', () => {
        const lit = withChatLength(10, () => buildInjection([makeAct()]));
        const normal = withChatLength(10, () => buildInjection([makeAct({ focus: 'normal' })]));
        assert.ok(lit.includes('SECRETS (guard these carefully — do not reveal directly):\n- The granary was emptied on purpose.'));
        assert.ok(lit.includes('TRIGGERS (check narrative conditions each message):\n- IF anyone counts the sacks → the tally is short'));
        assert.ok(lit.includes('FORESHADOWING TO PLANT:\n- Carts leave at night. (foreshadows: secret:s_climax)'));
        assert.equal(normal.includes('SECRETS'), false);
    });

    it('shows only unfired triggers and unplanted clues', () => {
        const arc = makeAct({
            triggers: [
                { id: 't1', condition: 'anyone counts the sacks', action: 'the tally is short', fired: false },
                { id: 't2', condition: 'the mill burns', action: 'flour rains on the square', fired: true },
            ],
            foreshadowing: [
                { id: 'f1', clue: 'Carts leave at night.', target: 'secret:s_climax', planted: false },
                { id: 'f2', clue: 'A torn sack by the gate.', target: 'secret:s_any', planted: true },
            ],
        });
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.ok(text.endsWith([
            'SECRETS (guard these carefully — do not reveal directly):',
            '- The granary was emptied on purpose.',
            '',
            'TRIGGERS (check narrative conditions each message):',
            '- IF anyone counts the sacks → the tally is short',
            '',
            'FORESHADOWING TO PLANT:',
            '- Carts leave at night. (foreshadows: secret:s_climax)',
            '',
            '[END STORY ARC]',
        ].join('\n')), text);
        assert.equal(text.includes('the mill burns'), false);
        assert.equal(text.includes('A torn sack by the gate.'), false);
    });

    it('leaves no list header behind when every secret is disclosed, every trigger fired and every clue planted', () => {
        const arc = makeAct();
        for (const secret of arc.secrets) secret.disclosed = true;
        for (const trigger of arc.triggers) trigger.fired = true;
        for (const clue of arc.foreshadowing) clue.planted = true;
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.equal(text.includes('SECRETS'), false);
        assert.equal(text.includes('TRIGGERS'), false);
        assert.equal(text.includes('FORESHADOWING'), false);
        assert.ok(text.endsWith('let the world act on its own interests.\n\n[END STORY ARC]'));
    });

    it('renders a spotlit arc without a tier (planned before tiers) as an episode', () => {
        const arc = makeAct();
        delete arc.tier;
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.ok(text.includes('=== FOREGROUNDED: "The Long Winter" ==='));
        assert.equal(text.includes('=== ACT'), false);
        assert.equal(text.includes('BRING TO A HEAD'), false);
    });

    it('applies phase gating to secrets: climax secret hidden early, shown at climax', () => {
        // Beat ratio 1/3 caps the phase at development regardless of messages.
        const early = withChatLength(10, () => buildInjection([makeAct()]));
        assert.ok(early.includes('The granary was emptied on purpose.'));
        assert.equal(early.includes('The guildmaster sold the grain.'), false);

        // Two of three done (0.67 → escalation) and 80/100 messages (climax) → escalation still.
        const arc = makeAct();
        arc.beats[1].status = 'completed';
        const mid = withChatLength(80, () => buildInjection([arc]));
        assert.equal(mid.includes('The guildmaster sold the grain.'), false);

        // All done + 80/100 messages → climax.
        arc.beats[0].status = 'completed';
        const climax = withChatLength(80, () => buildInjection([arc]));
        assert.ok(climax.includes('The guildmaster sold the grain.'));
    });

    it('uses the saga header for a spotlit saga', () => {
        const text = withChatLength(10, () => buildInjection([makeAct({ tier: 'saga' })]));
        assert.ok(text.includes('=== SAGA: "The Long Winter" ==='));
        assert.ok(text.includes('BRING TO A HEAD:'));
    });

    it('is placed before every episode section, even when stored last', () => {
        const text = withChatLength(10, () => buildInjection([
            makeEpisode({ id: 'ep1', title: 'Episode One' }),
            makeEpisode({ id: 'p1', title: 'Paused One', focus: 'paused' }),
            makeEpisode({ id: 'ep2', title: 'Episode Two' }),
            makeAct(),
        ]));
        const head = text.indexOf('BRING TO A HEAD:');
        assert.ok(head > 0);
        assert.ok(head < text.indexOf('"Episode One"'));
        assert.ok(head < text.indexOf('"Episode Two"'));
        assert.ok(head < text.indexOf('"Paused One"'));
    });

    it('is byte-identical as messages accumulate', () => {
        const arc = makeAct();
        const atTen = withChatLength(10, () => buildInjection([arc]));
        const atThirty = withChatLength(30, () => buildInjection([arc]));
        assert.equal(atThirty, atTen);
    });

    it('leaves the beat check unchanged: every unfulfilled milestone still has a recognition line', () => {
        const text = withChatLength(10, () => buildSignalInjection([makeAct()]));
        assert.ok(text.includes('[ARC_SIGNAL:act00001:m_hunger:COMPLETE]'));
        assert.ok(text.includes('[ARC_SIGNAL:act00001:m_lies:COMPLETE]'));
        assert.equal(text.includes('m_done'), false);
    });
});

describe('spotlit episode', () => {
    it('changes nothing in the section itself', () => {
        const lit = withChatLength(6, () => buildInjection([makeEpisode({ focus: 'spotlight' })]));
        const normal = withChatLength(6, () => buildInjection([makeEpisode()]));
        assert.equal(lit, normal);
        assert.ok(lit.includes('CURRENT PRESSURE:'));
    });

    it('moves its section before an earlier normal episode', () => {
        const text = withChatLength(6, () => buildInjection([
            makeEpisode({ id: 'first', title: 'First Episode' }),
            makeEpisode({ id: 'second', title: 'Second Episode', focus: 'spotlight' }),
        ]));
        assert.ok(text.indexOf('"Second Episode"') < text.indexOf('"First Episode"'));
    });
});

describe('pacing clock — brake follows the clock', () => {
    // estimatedLength 40, messageStart 0, 6 messages → setup, boundary at arc message 8.
    it('brakes only the first normal episode when nothing is spotlit', () => {
        const text = withChatLength(6, () => buildSignalInjection([
            makeEpisode({ id: 'first', title: 'First Episode' }),
            makeEpisode({ id: 'second', title: 'Second Episode' }),
        ]));
        assert.ok(text.includes('- "First Episode": do not advance to the next phase before arc message 8.'));
        assert.equal(text.includes('"Second Episode"'), false);
    });

    it('brakes the spotlit episode instead, once one is spotlit', () => {
        const text = withChatLength(6, () => buildSignalInjection([
            makeEpisode({ id: 'first', title: 'First Episode' }),
            makeEpisode({ id: 'second', title: 'Second Episode', focus: 'spotlight', estimatedLength: 20 }),
        ]));
        // 0.20 * 20 = arc message 4.
        assert.ok(text.includes('- "Second Episode": do not advance to the next phase before arc message 4.'));
        assert.equal(text.includes('"First Episode"'), false);
    });

    it('emits no brake when only a spotlit act is active', () => {
        const text = withChatLength(10, () => buildSignalInjection([makeAct()]));
        assert.equal(text.includes('ARC PACING:'), false);
    });
});
