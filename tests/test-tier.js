import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTierBlock } from '../lib/planning/generator.js';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { renderProgressDisplay } from '../lib/ui/progress.js';
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

function makeAct(overrides = {}) {
    return {
        id: 'act00001-full-id',
        title: 'The Long Winter',
        status: 'active',
        tier: 'act',
        focus: 'normal',
        messageStart: 0,
        premise: 'The valley is starving and the guild is lying about it.',
        tone: 'Slow dread.',
        themes: [],
        directives: ['Write the cold as a character.'],
        antiPatterns: ['Do not resolve the shortage quickly.'],
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

describe('buildTierBlock', () => {
    it('episode: scene beats, 5-8 of them, 8-20 messages, unlockAfter allowed', () => {
        const text = buildTierBlock('episode');
        assert.ok(text.includes('EPISODE'));
        assert.ok(text.includes('5-8'));
        assert.ok(text.includes('8 and 20'));
        assert.ok(/scene beat/i.test(text));
        assert.equal(/milestone/i.test(text), false);
        assert.ok(text.includes('This arc is an EPISODE: one playable, resolvable unit of the story'));
        assert.ok(text.includes('- unlockAfter is allowed and welcome'));
    });

    it('act: milestones, 3-5 of them, 60-150 messages, no unlockAfter, no scene-bound fulfillment', () => {
        const text = buildTierBlock('act');
        assert.ok(text.includes('ACT'));
        assert.ok(text.includes('3-5'));
        assert.ok(text.includes('60 and 150'));
        assert.ok(/milestone/i.test(text));
        assert.ok(text.includes('unlockAfter'));
        assert.ok(text.includes('revealPhase'));
        assert.ok(text.includes('This arc is an ACT: one leg of the larger story'));
        assert.equal(text.includes('SAGA'), false);
        assert.equal(text.includes('whole roleplay'), false);
        assert.ok(text.includes('pressure is a standing force in the world'));
        assert.ok(text.includes('names a STATE the story has reached'));
    });

    it('saga: milestones, 2-4 of them, 400-1500 messages', () => {
        const text = buildTierBlock('saga');
        assert.ok(text.includes('SAGA'));
        assert.ok(text.includes('2-4'));
        assert.ok(text.includes('400 and 1500'));
        assert.ok(text.includes('This arc is a SAGA: the overarching storyline of this whole roleplay'));
        assert.equal(text.includes('an ACT'), false);
        assert.equal(text.includes('one leg of the larger story'), false);
    });

    it('starts with an upper-case tier header line', () => {
        assert.ok(buildTierBlock('episode').startsWith('== TIER: EPISODE ==\n'));
        assert.ok(buildTierBlock('act').startsWith('== TIER: ACT ==\n'));
        assert.ok(buildTierBlock('saga').startsWith('== TIER: SAGA ==\n'));
    });

    it('keeps one instruction per line, each "- " bullet after the header and the scale line, ending in a newline', () => {
        // episode: header, scale line, 4 bullets; act/saga: header, scale line, 7 bullets
        for (const [tier, bulletCount] of [['episode', 4], ['act', 7], ['saga', 7]]) {
            const text = buildTierBlock(tier);
            assert.ok(text.endsWith('.\n'), tier);
            const lines = text.slice(0, -1).split('\n');
            assert.equal(lines.length, 2 + bulletCount, tier);
            assert.ok(lines[1].startsWith('This arc is '), tier);
            assert.ok(lines.slice(2).every(line => line.startsWith('- ')), tier);
        }
    });

    it('asks the model to echo the tier into the JSON', () => {
        assert.ok(buildTierBlock('act').includes('"tier": "act"'));
        assert.ok(buildTierBlock('episode').includes('"tier": "episode"'));
    });

    it('unknown tier falls back to the episode block', () => {
        // The episode block's content is asserted independently above; this
        // only pins the fallback to that known-good reference.
        assert.equal(buildTierBlock('campaign'), buildTierBlock('episode'));
    });
});

describe('milestone section — act / saga in normal focus', () => {
    it('lists every unfulfilled milestone pressure and no completed one', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.ok(text.includes('=== ACT: "The Long Winter" ==='));
        assert.ok(text.includes('The valley is starving and the guild is lying about it.'));
        assert.ok(text.includes('- Rations shrink week by week.'));
        assert.ok(text.includes('- The guild ledgers do not add up.'));
        assert.equal(text.includes('Old grudges resurface.'), false);
    });

    it('puts the STANDING PRESSURES header above the pressures and ends the section after them', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.ok(text.startsWith('[STORY ARC - NARRATIVE DIRECTION]\n\n=== ACT: "The Long Winter" ===\nPREMISE: The valley is starving and the guild is lying about it.\n\nSTANDING PRESSURES (forces at work'));
        assert.ok(text.endsWith('do not resolve them):\n- Rations shrink week by week.\n- The guild ledgers do not add up.\n\n[END STORY ARC]'));
    });

    it('prints no PREMISE line for an act without a premise', () => {
        const text = withChatLength(10, () => buildInjection([makeAct({ premise: '' })]));
        assert.ok(text.includes('=== ACT: "The Long Winter" ===\n\nSTANDING PRESSURES'));
        assert.equal(text.includes('PREMISE'), false);
    });

    it('carries no scene-beat machinery: no CURRENT PRESSURE, no PACING RULES, no phase brake', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.equal(text.includes('CURRENT PRESSURE'), false);
        assert.equal(text.includes('CURRENT FOCUS'), false);
        assert.equal(text.includes('PACING RULES'), false);
        assert.equal(text.includes('Do not advance plot beats'), false);
        assert.equal(text.includes('BACKGROUNDED'), false);
        assert.equal(text.includes('FOREGROUNDED'), false);
    });

    it('never leaks milestone ids or fulfillment conditions', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.equal(text.includes('m_hunger'), false);
        assert.equal(text.includes('The valley knows it will not last the winter.'), false);
    });

    it('leaves out secrets, triggers and foreshadowing', () => {
        const text = withChatLength(10, () => buildInjection([makeAct()]));
        assert.equal(text.includes('SECRETS'), false);
        assert.equal(text.includes('The granary was emptied on purpose.'), false);
        assert.equal(text.includes('TRIGGERS'), false);
        assert.equal(text.includes('anyone counts the sacks'), false);
        assert.equal(text.includes('FORESHADOWING'), false);
        assert.equal(text.includes('Carts leave at night.'), false);
    });

    it('uses the saga header for a saga', () => {
        const text = withChatLength(10, () => buildInjection([makeAct({ tier: 'saga', estimatedLength: 800 })]));
        assert.ok(text.includes('=== SAGA: "The Long Winter" ==='));
    });

    it('skips a milestone without a pressure and never prints its intention (#13)', () => {
        const arc = makeAct();
        arc.beats[0].pressure = '';
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.equal(text.includes('The valley knows it will not last the winter.'), false);
        assert.equal(text.includes('- \n'), false);
        assert.ok(text.includes('- The guild ledgers do not add up.'));
    });

    it('omits the pressures block entirely when no unfulfilled milestone has a pressure', () => {
        const arc = makeAct();
        for (const beat of arc.beats) beat.pressure = '';
        const text = withChatLength(10, () => buildInjection([arc]));
        assert.equal(text.includes('STANDING PRESSURES'), false);
        assert.equal(text.includes('The valley knows it will not last the winter.'), false);
    });

    it('emits no ARC PACING block when only acts and sagas are active', () => {
        chat_metadata.story_arc = { settings: { autoTrack: false } };
        const text = withChatLength(10, () => buildSignalInjection([makeAct(), makeAct({ tier: 'saga' })]));
        assert.equal(text.includes('ARC PACING'), false);
        delete chat_metadata.story_arc;
    });

    it('is byte-identical as messages accumulate within a phase', () => {
        const a = withChatLength(5, () => buildInjection([makeAct()]));
        const b = withChatLength(15, () => buildInjection([makeAct()]));
        assert.equal(a, b);
    });
});

describe('progress widget label', () => {
    it('says milestones for acts and sagas, beats for episodes', () => {
        const act = withChatLength(10, () => renderProgressDisplay([makeAct()]));
        assert.ok(act.includes('1/3 milestones'));
        const saga = withChatLength(10, () => renderProgressDisplay([makeAct({ tier: 'saga' })]));
        assert.ok(saga.includes('1/3 milestones'));
        const episode = withChatLength(10, () => renderProgressDisplay([makeAct({ tier: 'episode' })]));
        assert.ok(episode.includes('1/3 beats'));
    });
});
