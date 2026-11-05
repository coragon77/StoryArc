import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { removeRulingsFrom } from '../lib/planning/beat-completion.js';
import { updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';
import { renderProgressDisplay } from '../lib/ui/progress.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

let onMessageDeleted;
let onMessageSwiped;

before(async () => {
    // index.js registers its listeners in a jQuery ready callback and the
    // progress display looks for its container: neither exists here.
    globalThis.jQuery = () => {};
    globalThis.$ = () => ({ length: 0 });
    ({ onMessageDeleted, onMessageSwiped } = await import('../index.js'));
});

/** An act with one open milestone and the given rulings. */
function sirenAct(rulings) {
    return {
        id: 'siren001-full-id', title: 'Streets of the Jackpot Siren', status: 'active', tier: 'act', focus: 'normal',
        premise: 'Siren works the casino strip as a sidekick riding with Aegis, her defender.',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'heist', intention: 'The Siren foils the casino heist', pressure: 'A crew is casing the Golden Reel', status: 'active', unlockAfter: [], optional: false },
        ],
        rulings,
    };
}

/** The tracker on (unless `trackerOn` is false), interval 1; a ledger read up to `lastUpdatedAt`. */
function storeChat({ arcs, trackerOn = true, lastUpdatedAt = 6 }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: trackerOn, updateInterval: 1 },
    };
    chat_metadata.story_arc = {
        version: 1,
        arcs,
        settings: { autoTrack: true },
        pendingMarks: [],
        knowledge: {
            characters: [{ id: 'c1', name: 'Siren', aliases: [] }],
            facts: [],
            scene: { at: lastUpdatedAt, present: ['c1'] },
            lastUpdatedAt,
        },
    };
}

/** Seven messages, each with its Story Arc message id; the player speaks at 1, 3 and 5. */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The strip glows.', extra: { story_arc_message_id: 'm0' } },
        { is_user: true, is_system: false, name: 'Siren', mes: '[OOC: Comics, not police procedural.] I head out.', extra: { story_arc_message_id: 'm1' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Neon hums overhead.', extra: { story_arc_message_id: 'm2' } },
        { is_user: true, is_system: false, name: 'Siren', mes: '[OOC: Aegis is NOT her defender.] Siren walks alone.', extra: { story_arc_message_id: 'm3' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Aegis watches from a rooftop.', extra: { story_arc_message_id: 'm4' } },
        { is_user: true, is_system: false, name: 'Siren', mes: '[OOC: Sundown is a mentor, not a partner.] I call Sundown.', extra: { story_arc_message_id: 'm5' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Sundown picks up.', extra: { story_arc_message_id: 'm6' } },
    );
}

/** Replace the extraction template and the transport, answering with the queued answers. */
function installExtraction(answers) {
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('PLANS:\n{{PLANS}}\n{{MESSAGES}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async () => {
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
}

function answerWithRulings(rulings) {
    return JSON.stringify({ present: ['Siren'], newCharacters: [], learned: [], fulfilled: [], rulings });
}

function storedRulings() {
    return chat_metadata.story_arc.arcs[0].rulings;
}

/** ST's chat after the user deleted the message at `index`: the later ones move up. */
function deleteMessageAt(index) {
    chat.splice(index, 1);
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    ConnectionManagerRequestService.sendRequest = originalSendRequest;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
});

describe('onMessageDeleted — a ruling goes with its message', () => {
    beforeEach(() => fillChat());

    it('deleting the ruling\'s message, the last ones, removes it; an earlier ruling stays', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 5, messageId: 'm5' },
        ])] });
        chat.length = 5;

        await onMessageDeleted(5);

        assert.deepEqual(storedRulings(), [
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
        ]);
    });

    it('deleting a later message keeps the ruling', async () => {
        storeChat({ arcs: [sirenAct([{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }])] });
        chat.length = 6;

        await onMessageDeleted(6);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }]);
    });

    it('deleting a message in the middle of the chat removes its ruling by message id, and a later ruling moves up', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' },
            { id: 'r3', text: 'Sundown is a mentor, not a partner.', at: 5, messageId: 'm5' },
        ])] });
        deleteMessageAt(3);

        await onMessageDeleted(6);

        assert.deepEqual(storedRulings(), [
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r3', text: 'Sundown is a mentor, not a partner.', at: 4, messageId: 'm5' },
        ]);
    });

    it('an answered ruling goes by the same rules as an open one', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1', answeredAt: 2 },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
        ])] });
        deleteMessageAt(1);

        await onMessageDeleted(6);

        assert.deepEqual(storedRulings(), [
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 2, messageId: 'm3', answeredAt: 4 },
        ]);
    });

    it('a ruling without a message id goes by the index rule', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1 },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3 },
        ])] });
        chat.length = 3;

        await onMessageDeleted(3);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Comics, not police procedural.', at: 1 }]);
    });

    it('the card shows no ruling line after its ruling was removed', async () => {
        storeChat({ arcs: [sirenAct([{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }])] });
        assert.ok(renderProgressDisplay(chat_metadata.story_arc.arcs).includes('<q>Aegis is NOT her defender.</q>'));
        chat.length = 3;

        await onMessageDeleted(3);

        const html = renderProgressDisplay(chat_metadata.story_arc.arcs);
        assert.equal(html.includes('am-alert'), false, html);
        assert.equal(html.includes('Aegis is NOT her defender.'), false, html);
    });
});

describe('removeRulingsFrom — a branch that ends before the ruling', () => {
    beforeEach(() => fillChat());

    it('a branch shorter than the ruling\'s message removes it and keeps the earlier one', () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
        ])] });
        chat.length = 3;

        assert.equal(removeRulingsFrom(chat.length), true);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' }]);
    });

    it('a branch as long as the chat changes nothing', () => {
        storeChat({ arcs: [sirenAct([{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }])] });

        assert.equal(removeRulingsFrom(chat.length), false);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }]);
    });

    it('an arc from before rulings is left as it is', () => {
        const arc = sirenAct(undefined);
        delete arc.rulings;
        storeChat({ arcs: [arc] });
        chat.length = 3;

        assert.equal(removeRulingsFrom(chat.length), false);

        assert.equal('rulings' in chat_metadata.story_arc.arcs[0], false);
    });
});

describe('onMessageSwiped — a swipe removes no ruling', () => {
    beforeEach(() => fillChat());

    it('swiping the narrator\'s reply after the player\'s ruling keeps the ruling, open or answered', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 5, messageId: 'm5' },
        ])], trackerOn: false });

        await onMessageSwiped(6);

        assert.deepEqual(storedRulings(), [
            { id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
            { id: 'r2', text: 'Sundown is a mentor, not a partner.', at: 5, messageId: 'm5' },
        ]);
    });
});

describe('updateKnowledgeAfterEdit — the edit removes the rulings whose quote is gone from the message', () => {
    beforeEach(() => fillChat());

    it('a re-extraction quoting the edited line stores it again; a ruling of another message stays', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' },
        ])] });
        chat[3].mes = '[OOC: Aegis is NOT her partner.] Siren walks alone.';
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her partner.', at: 3 }])]);

        const result = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), [
            { id: 'r1', text: 'Comics, not police procedural.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Aegis is NOT her partner.', at: 3, messageId: 'm3' },
        ]);
        assert.equal(result.beatsChanged, true);
    });

    it('a ruling the player edited out is gone, and the card refreshes', async () => {
        storeChat({ arcs: [sirenAct([{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3' }])] });
        chat[3].mes = 'Siren walks alone.';
        installExtraction([answerWithRulings([])]);

        const result = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), []);
        assert.equal(result.beatsChanged, true);
    });

    it('an answered ruling whose quote is still in the edited text stays answered, and the re-extraction does not store it again', async () => {
        storeChat({ arcs: [sirenAct([{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 }])] });
        chat[3].mes = '[OOC: Aegis is NOT her defender.] Siren walks the strip alone.';
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 }]);
    });

    it('a typo fix elsewhere in the message keeps an answered pick with its option, even when the re-extraction reports nothing', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Option one', chose: 'Sundown trains her.', at: 3, messageId: 'm3', answeredAt: 4 },
        ])] });
        chat[3].mes = 'Option one. Siren walks alone.';
        installExtraction([answerWithRulings([])]);

        const result = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), [
            { id: 'r1', text: 'Option one', chose: 'Sundown trains her.', at: 3, messageId: 'm3', answeredAt: 4 },
        ]);
        assert.equal(result.beatsChanged, false);
    });

    it('of two rulings in the edited message, only the one whose quote is gone is removed', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
            { id: 'r2', text: 'Siren walks alone.', at: 3, messageId: 'm3' },
        ])] });
        chat[3].mes = '[OOC: Aegis is NOT her defender.] Siren walks with Sundown.';
        installExtraction([answerWithRulings([])]);

        const result = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 }]);
        assert.equal(result.beatsChanged, true);
    });

    it('a ruling without a message id goes by the edited message\'s index', async () => {
        storeChat({ arcs: [sirenAct([
            { id: 'r1', text: 'Comics, not police procedural.', at: 1 },
            { id: 'r2', text: 'Aegis is NOT her defender.', at: 3 },
        ])] });
        chat[3].mes = 'Siren walks alone.';
        installExtraction([answerWithRulings([])]);

        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(storedRulings(), [{ id: 'r1', text: 'Comics, not police procedural.', at: 1 }]);
    });
});
