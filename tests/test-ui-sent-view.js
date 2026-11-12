import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata } from '../tests/mocks/st-mocks.js';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { maskSpoilerLines, listSpoilers, describeHiddenRun, buildSentViewContent, partsInReadingOrder } from '../lib/ui/sent-view.js';

/**
 * An episode whose secrets, triggers, clues and beats are spoilers; one
 * secret has a line break inside and one trigger action a blank line, as a
 * hand edit in the Arc Manager can leave them.
 */
function spoilerArc() {
    return {
        id: 'harbour1-full-id', title: 'The Harbour Strike', status: 'active', tier: 'episode', focus: 'normal',
        premise: 'A crane crew on strike blocks the harbour.',
        worldFacts: ['The harbour master answers to the mayor.'],
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60,
        secrets: [
            { id: 's1', content: 'The foreman sold the strike fund to the mayor', revealPhase: 'setup', disclosed: false, holders: [] },
            { id: 's2', content: 'Noor forged the union ballots\nand burned the originals in the boiler room', revealPhase: 'setup', disclosed: false, holders: [] },
        ],
        triggers: [
            { id: 't1', condition: 'Ellie asks the foreman about the fund', action: 'The foreman changes the subject to the weather', fired: false },
            { id: 't2', condition: 'Someone opens the boiler room', action: 'A smell of burnt paper drifts out\n\nNoor blocks the door with her shoulder', fired: false },
        ],
        foreshadowing: [
            { id: 'f1', clue: 'Ash on the foreman\'s cuffs after his shift', target: 'secret:s2', planted: false },
        ],
        beats: [
            { id: 'b1', intention: 'The crew votes to end the strike at the gate', pressure: 'The crew is hungry and the fund is empty', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

/** Every line of every spoiler text of the arc, as the masked view must never show it. */
function spoilerLinesOf(arc) {
    return [
        ...arc.secrets.map(secret => secret.content),
        ...arc.triggers.flatMap(trigger => [trigger.condition, trigger.action]),
        ...arc.foreshadowing.map(foreshadowing => foreshadowing.clue),
        ...arc.beats.map(beat => beat.intention),
    ].flatMap(text => text.split('\n')).filter(line => line.trim());
}

/** The text as the view shows it: hidden runs as their placeholder words, or everything when revealed. */
function renderRuns(runs, revealed) {
    return runs.map(run => (run.hidden && !revealed ? `[${describeHiddenRun(run)}]` : run.lines.join('\n'))).join('\n');
}

describe('maskSpoilerLines — what the view hides until the plan is revealed', () => {
    beforeEach(() => {
        chat_metadata.story_arc = { version: 1, settings: { autoTrack: true, injectionBudget: 3000 }, arcs: [] };
    });

    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
    });

    it('shows no secret, trigger, clue or fulfillment of the plan block, and every one when revealed', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: false } };
        const arc = spoilerArc();
        const plan = buildInjection([arc]);
        const spoilers = listSpoilers([arc], null);

        const masked = renderRuns(maskSpoilerLines('story_arc_plan', plan, spoilers), false);
        const revealed = renderRuns(maskSpoilerLines('story_arc_plan', plan, spoilers), true);

        for (const line of spoilerLinesOf(arc)) {
            assert.ok(!masked.includes(line), `shown while hidden: ${line}\n${masked}`);
        }
        assert.equal(revealed, plan);
        assert.ok(masked.includes('PREMISE: A crane crew on strike blocks the harbour.'), masked);
        assert.ok(masked.includes('- The harbour master answers to the mayor.'), masked);
        assert.ok(masked.includes('CURRENT PRESSURE:\nThe crew is hungry and the fund is empty'), masked);
        assert.ok(masked.includes('SECRETS (guard these carefully — do not reveal directly):'), masked);
        assert.ok(masked.endsWith('[END STORY ARC]'), masked);
    });

    it('shows no beat check, clue or trigger line of the signals with the marker path on', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: false } };
        const arc = spoilerArc();
        const signals = buildSignalInjection([arc]);
        const spoilers = listSpoilers([arc], null);

        const masked = renderRuns(maskSpoilerLines('story_arc_signals', signals, spoilers), false);

        for (const line of spoilerLinesOf(arc)) {
            assert.ok(!masked.includes(line), `shown while hidden: ${line}\n${masked}`);
        }
        assert.ok(masked.includes('BEAT CHECK:'), masked);
        assert.ok(masked.includes('CONTINUATION: Continue the story from the end of the most recent'), masked);
    });

    it('names each hidden run by its items and tokens', () => {
        const run = { hidden: true, lines: ['- IF a → b', '- IF c → d', '- clue one'], items: ['trigger', 'trigger', 'clue'] };
        // 32 characters → 8 tokens (characters / 4, rounded up)
        assert.equal(describeHiddenRun(run), '2 triggers, 1 clue hidden · 8 tokens');
    });

    it('hides a knowledge line whose "shared only with" names a planned holder, and no other', () => {
        const ledger = {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }, { id: 'c2', name: 'Bram', aliases: [] }, { id: 'c3', name: 'Ellie', aliases: [] }],
            facts: [{ id: 'f1', text: 'The ballots are forged', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 2 },
                { characterId: 'c2', how: 'plan', toldBy: null, at: null },
            ] }],
        };
        const block = [
            'NOOR (present)',
            '- Knows: The ballots are forged (shared only with Bram)',
            '- Knows: The tide is late (shared only with Ellie)',
        ].join('\n');

        const masked = renderRuns(maskSpoilerLines('story_arc_knowledge', block, listSpoilers([], ledger)), false);

        assert.equal(masked, [
            'NOOR (present)',
            '[1 knowledge line hidden · 14 tokens]',
            '- Knows: The tide is late (shared only with Ellie)',
        ].join('\n'));
    });
});

describe('maskSpoilerLines — an unnamed relative as planned holder', () => {
    it('hides the line that names them by their display name', () => {
        const ledger = {
            characters: [
                { id: 'c1', name: 'Kendra Osei', aliases: [] },
                { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: 3 }] } },
            ],
            facts: [{ id: 'f1', text: 'The deed is forged', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 3 },
                { characterId: 'c2', how: 'plan', toldBy: null, at: null },
            ] }],
        };
        const block = 'KENDRA OSEI (present)\n- Knows: The deed is forged (shared only with Kendra Osei\'s mother)';

        const runs = maskSpoilerLines('story_arc_knowledge', block, listSpoilers([], ledger));

        assert.deepEqual(runs.map(run => run.hidden), [false, true]);
    });
});

describe('buildSentViewContent — the strip, the reader and their states', () => {
    const noSpoilers = { spoilerLines: [], plannedHolderNames: [] };

    function requestOf(texts, stamp = '[Arc: message 3 of ~60]') {
        const prompts = [
            { key: 'story_arc_plan', text: texts.plan ?? '' },
            { key: 'story_arc_knowledge', text: texts.knowledge ?? '' },
            { key: 'story_arc_names', text: texts.names ?? '' },
            { key: 'story_arc_signals', text: texts.signals ?? '' },
        ];
        return { parts: partsInReadingOrder(prompts, stamp), newestMessageIndex: 4, stampMessageIndex: 3, replyIndex: 5, savedAt: '2026-11-12T10:00:00.000Z' };
    }

    function viewOf(overrides) {
        return {
            enabled: true, mode: 'next', revealed: false, selectedKey: 'story_arc_plan',
            sent: null, next: requestOf({ plan: 'PREMISE: A strike.', knowledge: 'NOOR (present)', names: 'Noor', signals: 'CONTINUATION: Go on.' }),
            budget: 3000, spoilers: noSpoilers, ...overrides,
        };
    }

    it('draws the five parts in the order the narrator reads them, with their tokens', () => {
        const html = buildSentViewContent(viewOf({}));

        const blocks = [...html.matchAll(/data-sv-part="([^"]+)"[^>]*>\s*<b>([^<]+)<\/b><span class="sv-block-tokens">([^<]+)</g)]
            .map(match => [match[1], match[2], match[3]]);
        assert.deepEqual(blocks, [
            ['story_arc_plan', 'Arc plan', '5'],
            ['story_arc_knowledge', 'Who knows what', '4'],
            ['story_arc_names', 'Names already in this story', '1'],
            ['stamp', 'Message stamp', '6'],
            ['story_arc_signals', 'Pacing and checks', '5'],
        ]);
        assert.ok(html.includes('5 tokens of a 3,000 budget'), html);
        assert.ok(html.includes('<span class="sv-block-where">On message #3</span>'), html);
        assert.ok(html.includes('Story Arc would add <b>21 tokens</b> to the next request'), html);
    });

    it('says so when Story Arc is off, and when it sends nothing', () => {
        assert.ok(buildSentViewContent(viewOf({ enabled: false })).includes('Story Arc is off: it sends nothing.'));
        assert.ok(buildSentViewContent(viewOf({ next: requestOf({}, '') })).includes('Story Arc sends nothing to this chat right now.'));
    });

    it('disables Last sent while the chat has no record of a send', () => {
        const html = buildSentViewContent(viewOf({}));
        assert.match(html, /<input type="radio" name="sv-mode" value="sent"\s+disabled>/);
    });

    it('shows the last sent request for its reply, and marks in Next request the lines it did not have', () => {
        const sent = requestOf({ plan: 'BRING TO A HEAD:\nThe crew is hungry', signals: 'CONTINUATION: Go on.' });
        const next = requestOf({ plan: 'STANDING PRESSURE:\nThe crew is hungry', signals: 'CONTINUATION: Go on.' });

        const sentHtml = buildSentViewContent(viewOf({ mode: 'sent', sent, next }));
        assert.ok(sentHtml.includes('to the request for reply #5'), sentHtml);
        assert.ok(!sentHtml.includes('sv-changed'), sentHtml);

        const nextHtml = buildSentViewContent(viewOf({ mode: 'next', sent, next }));
        assert.ok(nextHtml.includes('<span class="sv-changed"><span class="sv-head">STANDING PRESSURE:</span></span>'), nextHtml);
        assert.ok(!nextHtml.includes('<span class="sv-changed">The crew is hungry</span>'), nextHtml);
    });
});
