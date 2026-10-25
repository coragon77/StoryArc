import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { selectPacingClock, pauseArc, resumeArc } from '../lib/injection/clock.js';
import { migrateArc } from '../lib/core/settings.js';
import { mergeReplan } from '../lib/planning/replan.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

/** A saga in background focus with two standing milestones and plan lists. */
function makeSaga(overrides = {}) {
    return {
        id: 'nest0001-full-id',
        title: 'Nectar of the Nest-Mother',
        status: 'active',
        tier: 'saga',
        focus: 'background',
        messageStart: 0,
        lastFulfilledAt: 0,
        pausedAt: null,
        premise: 'An escaped construct has imprinted on her.',
        genre: 'Superhero teen drama',
        tone: '',
        themes: [],
        directives: ['Write the construct with sleek aesthetics.'],
        antiPatterns: [],
        secrets: [{ id: 'secret_1', content: 'The construct was bred for her.', revealPhase: 'any', disclosed: false }],
        foreshadowing: [{ id: 'foreshadow_1', clue: 'Copper dust under the radiator', target: 'secret_1', planted: false }],
        triggers: [{ id: 'trigger_1', condition: 'she is attacked', action: 'the grates strain', fired: false }],
        estimatedLength: 600,
        beats: [
            { id: 'm_stalk', pressure: 'It stalks her through the storm drains.', intention: 'It has cornered her somewhere secluded.', status: 'active', unlockAfter: [] },
            { id: 'm_guard', pressure: 'It strains against the grates when she is threatened.', intention: 'It has sabotaged an attack on her.', status: 'active', unlockAfter: [] },
        ],
        ...overrides,
    };
}

function makeEpisode(overrides = {}) {
    return {
        id: 'epis0001-full-id',
        title: 'First Day',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        messageStart: 0,
        premise: 'Her first day at school.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        triggers: [],
        estimatedLength: 20,
        beats: [{ id: 'b1', pressure: 'The bell is about to ring.', intention: 'She has found her class.', status: 'active', unlockAfter: [] }],
        ...overrides,
    };
}

describe('background section — act / saga kept off-screen', () => {
    it('prints the title and the off-screen sentence', () => {
        const text = buildInjection([makeSaga()]);
        assert.ok(text.includes('=== BACKGROUND: "Nectar of the Nest-Mother" ===\nRuns off-screen. Leave it out of scenes — no hints, sounds or clues — unless the user\'s character goes to it or brings it up.\n'));
    });

    it('prints no premise, genre, pressures, directives or plan lists', () => {
        const text = buildInjection([makeSaga()]);
        assert.equal(text.includes('An escaped construct has imprinted on her.'), false);
        assert.equal(text.includes('GENRE:'), false);
        assert.equal(text.includes('STANDING PRESSURES'), false);
        assert.equal(text.includes('storm drains'), false);
        assert.equal(text.includes('sleek aesthetics'), false);
        assert.equal(text.includes('The construct was bred for her.'), false);
        assert.equal(text.includes('Copper dust'), false);
        assert.equal(text.includes('the grates strain'), false);
    });

    it('renders an act the same way', () => {
        const text = buildInjection([makeSaga({ tier: 'act', title: 'Trade Dress' })]);
        assert.ok(text.includes('=== BACKGROUND: "Trade Dress" ==='));
        assert.equal(text.includes('=== ACT:'), false);
    });

    it('sits after normal episodes and spotlit arcs', () => {
        const text = buildInjection([
            makeSaga(),
            makeEpisode(),
            makeSaga({ id: 'lit00001-x', title: 'Centerfold', focus: 'spotlight' }),
        ]);
        const background = text.indexOf('"Nectar of the Nest-Mother"');
        assert.ok(text.indexOf('"Centerfold"') < background);
        assert.ok(text.indexOf('"First Day"') < background);
    });
});

describe('background — beat check kept, plant check dropped', () => {
    it('keeps every active milestone in the beat check', () => {
        const text = buildSignalInjection([makeSaga()]);
        assert.ok(text.includes('BEAT CHECK:'));
        assert.ok(text.includes('"It has cornered her somewhere secluded." — output exactly: <!-- [ARC_SIGNAL:nest0001:m_stalk:COMPLETE] -->'));
        assert.ok(text.includes('<!-- [ARC_SIGNAL:nest0001:m_guard:COMPLETE] -->'));
    });

    it('asks for no planted clue and no fired trigger', () => {
        const text = buildSignalInjection([makeSaga()]);
        assert.equal(text.includes('PLANTED'), false);
        assert.equal(text.includes('FIRED'), false);
        assert.equal(text.includes('Copper dust'), false);
    });
});

describe('background — pacing clock', () => {
    it('is never the pacing clock, even when nothing else qualifies', () => {
        assert.equal(selectPacingClock([makeSaga()]), undefined);
        assert.equal(selectPacingClock([makeSaga({ tier: 'episode' })]), undefined);
    });

    describe('resuming a paused arc into background', () => {
        beforeEach(() => {
            chat.length = 0;
            chat_metadata.story_arc = {
                version: 1,
                arcs: [makeSaga({ focus: 'normal', messageStart: 50, lastFulfilledAt: 60 })],
                settings: {},
            };
        });

        it('shifts messageStart and lastFulfilledAt by the paused span', async () => {
            chat.length = 100;
            await pauseArc('nest0001-full-id');
            chat.length = 140;
            await resumeArc('nest0001-full-id', 'background');
            const stored = chat_metadata.story_arc.arcs[0];
            assert.equal(stored.focus, 'background');
            assert.equal(stored.pausedAt, null);
            assert.equal(stored.messageStart, 90);
            assert.equal(stored.lastFulfilledAt, 100);
        });
    });
});

describe('background — the word retired by the tier migration', () => {
    it('still migrates an untiered background arc to a paused episode', () => {
        const arc = { id: 'old', title: 'Old', status: 'active', focus: 'background', messageStart: 0, beats: [] };
        migrateArc(arc, 77);
        assert.equal(arc.tier, 'episode');
        assert.equal(arc.focus, 'paused');
        assert.equal(arc.pausedAt, 77);
    });

    it('leaves a tiered background arc alone', () => {
        const arc = makeSaga();
        assert.equal(migrateArc(arc, 77), false);
        assert.equal(arc.focus, 'background');
        assert.equal(arc.pausedAt, null);
    });
});

describe('background — re-plan', () => {
    const generatedSaga = { tier: 'saga', estimatedLength: 500, beats: [], secrets: [], foreshadowing: [], triggers: [] };

    it('keeps background focus through a re-plan', () => {
        const merged = mergeReplan(makeSaga(), generatedSaga);
        assert.equal(merged.focus, 'background');
    });

    it('keeps background when an act grows into a saga', () => {
        const merged = mergeReplan(makeSaga({ tier: 'act' }), generatedSaga);
        assert.equal(merged.tier, 'saga');
        assert.equal(merged.focus, 'background');
    });
});
