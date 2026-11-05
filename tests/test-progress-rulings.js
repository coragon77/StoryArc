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

        assert.ok(html.includes('<p>You overruled the plan: <q>Aegis is NOT her defender.</q>.</p>'), html);
        assert.match(html, /<button type="button" class="menu_button story-arc-stall-btn" data-arc-id="siren001-full-id"[^>]*><i[^>]*><\/i> Re-plan<\/button>/);
    });

    it('shows no ruling line for an answered ruling', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, answeredAt: 8 }] })]);

        assert.equal(html.includes('am-alert'), false);
        assert.equal(html.includes('story-arc-stall-btn'), false);
    });

    it('escapes a quote with a less-than sign and a double quote', () => {
        const html = renderProgressDisplay([act({ rulings: [{ id: 'r1', text: 'No <b>"police"</b> here', at: 3 }] })]);

        assert.ok(html.includes('<q>No &lt;b&gt;&quot;police&quot;&lt;/b&gt; here</q>'), html);
        assert.equal(html.includes('<b>"police"'), false);
    });

    it('shows a bare pick with the option it picked, both escaped', () => {
        const html = renderProgressDisplay([act({ rulings: [
            { id: 'r1', text: 'Option <1>', chose: 'Siren works the strip "alone" & free.', at: 3, messageId: 'm3' },
        ] })]);

        assert.ok(html.includes(
            '<p>You overruled the plan: <q>Option &lt;1&gt;</q>, picking <q>Siren works the strip &quot;alone&quot; &amp; free.</q>.</p>'), html);
        assert.equal(html.includes('<1>'), false);
    });

    it('shows the newest of three open rulings and "and 2 earlier"', () => {
        const html = renderProgressDisplay([act({ rulings: [
            { id: 'r1', text: 'Comics, not police procedural.', at: 3 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 7 },
            { id: 'r3', text: 'Aegis is NOT her defender.', at: 5 },
            { id: 'r4', text: 'An answered one.', at: 9, answeredAt: 9 },
        ] })]);

        assert.ok(html.includes('<q>Sundown is a mentor, not a partner.</q>, and 2 earlier.'), html);
        assert.equal(html.includes('Comics'), false);
        assert.equal(html.includes('An answered one'), false);
    });

    it('shows the ruling warning instead of the stall warning when both would show', () => {
        chat.length = 111;
        assert.ok(renderProgressDisplay([stalledEpisode()]).includes('No beat in 10 messages — about one is due every 3.'));
        const html = renderProgressDisplay([stalledEpisode({ rulings: [{ id: 'r1', text: 'Comics, not police procedural.', at: 105 }] })]);

        assert.equal(html.includes('No beat in'), false);
        assert.equal((html.match(/story-arc-stall-btn/g) || []).length, 1);
        assert.ok(html.includes('You overruled the plan: <q>Comics, not police procedural.</q>.'), html);
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
