import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderProgressDisplay } from '../lib/ui/progress.js';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { chat, chat_metadata, extension_settings } from './mocks/st-mocks.js';

/** An act in normal focus with one open milestone. */
function act(overrides = {}) {
    return {
        id: 'siren001-full-id', title: 'Streets of the Jackpot Siren', tier: 'act', focus: 'normal', status: 'active',
        premise: 'Siren works the casino strip as a sidekick riding with Aegis, her defender.',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, tone: '', themes: [], directives: [], antiPatterns: [], secrets: [], foreshadowing: [], triggers: [],
        beats: [{ id: 'heist', intention: 'The Siren foils the casino heist', pressure: 'A crew is casing the Golden Reel', status: 'active', unlockAfter: [], optional: false }],
        ...overrides,
    };
}

// Episode of estimatedLength 20 with six beats: stalled at chat length 111.
function stalledEpisode(overrides = {}) {
    const beats = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, intention: `Beat ${i} happens`, status: i === 0 ? 'active' : 'pending', unlockAfter: [], optional: false }));
    return { id: 'ep', title: 'The Night Shift', tier: 'episode', focus: 'normal', status: 'active', messageStart: 100, lastFulfilledAt: 100, estimatedLength: 20, tone: '', themes: [], directives: [], antiPatterns: [], secrets: [], foreshadowing: [], triggers: [], beats, ...overrides };
}

describe('renderProgressDisplay — rulings', () => {
    beforeEach(() => {
        chat.length = 10;
    });

    it('shows an open ruling quoted, with the re-plan button of its arc', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }] })]);

        assert.ok(html.includes('<span class="story-arc-ruling-quote">“Aegis is NOT her defender.”</span>'), html);
        assert.match(html, /class="story-arc-stall-btn" data-arc-id="siren001-full-id"[^>]*>You overruled the plan — re-plan\?</);
    });

    it('shows no ruling line for an answered ruling', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, answeredAt: 8 }] })]);

        assert.equal(html.includes('story-arc-ruling'), false);
        assert.equal(html.includes('story-arc-stall-btn'), false);
    });

    it('escapes a quote with a less-than sign and a double quote, in the text and the tooltip', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'No <b>"police"</b> here', at: 3 }] })]);

        assert.ok(html.includes('“No &lt;b&gt;&quot;police&quot;&lt;/b&gt; here”'), html);
        assert.ok(html.includes('title="No &lt;b&gt;&quot;police&quot;&lt;/b&gt; here"'), html);
        assert.equal(html.includes('<b>'), false);
    });

    it('shows the newest of three open rulings and "and 2 earlier"', () => {
        const html = renderProgressDisplay([act({ rulings: [
            { id: 'r1', text: 'Comics, not police procedural.', at: 3 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 7 },
            { id: 'r3', text: 'Aegis is NOT her defender.', at: 5 },
            { id: 'r4', text: 'An answered one.', at: 9, answeredAt: 9 },
        ] })]);

        assert.ok(html.includes('“Sundown is a mentor, not a partner.”</span> and 2 earlier'), html);
        assert.equal(html.includes('Comics'), false);
        assert.equal(html.includes('An answered one'), false);
    });

    it('shows the ruling line instead of the stall line when both would show', () => {
        chat.length = 111;
        assert.ok(renderProgressDisplay([stalledEpisode()]).includes('May have drifted — re-plan?'));
        const html = renderProgressDisplay([stalledEpisode({ rulings: [{ id: 'r1', text: 'Comics, not police procedural.', at: 105 }] })]);

        assert.equal(html.includes('May have drifted'), false);
        assert.equal((html.match(/story-arc-stall-btn/g) || []).length, 1);
        assert.match(html, /data-arc-id="ep"[^>]*>You overruled the plan — re-plan\?</);
    });

    it('shows none of the plan\'s text', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3 }] })]);

        assert.equal(html.includes('casino strip'), false);
        assert.equal(html.includes('Golden Reel'), false);
    });
});

describe('the narration prompt with stored rulings', () => {
    it('the plan block and the signal directive are byte-identical with and without rulings', () => {
        extension_settings.story_arc = { enabled: true };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: { autoTrack: true } };
        chat.length = 10;
        const rulings = [
            { id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' },
            { id: 'r2', text: 'Comics, not police procedural.', at: 5, answeredAt: 8 },
        ];
        try {
            for (const arcOf of [act, stalledEpisode]) {
                const withoutRulings = arcOf();
                const withRulings = arcOf({ rulings });
                assert.equal(buildInjection([withRulings]), buildInjection([withoutRulings]));
                assert.equal(buildSignalInjection([withRulings]), buildSignalInjection([withoutRulings]));
                assert.notEqual(buildInjection([withoutRulings]), '');
            }
        } finally {
            delete extension_settings.story_arc;
            delete chat_metadata.story_arc;
        }
    });
});
