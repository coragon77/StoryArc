import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { parseKnowledgeExtractionAnswer, resolveRewrites, updateKnowledgeAfterReply } from '../lib/knowledge/ledger.js';
import { isMarkedOutOfCharacter } from '../lib/knowledge/message-ids.js';
import { clearTemplateCache } from '../lib/planning/generator.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/**
 * A correction shaped like Aegis 411–415: the rejected story reply, the
 * player's objection, the narrator's out-of-character report, the rewrite
 * request, and the new version.
 */
function correctionChat() {
    return [
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Miriam Koster peered down over the rims of her glasses. "Your file is mine now."', extra: { story_arc_message_id: 'm0' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: '[OOC: Of course? Why is it a threat? That does not make sense? Report back and stop the RP]', extra: { story_arc_message_id: 'm1' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: '[OOC: Stopping the RP and reporting back. You are right, the threat made no sense.]', extra: { story_arc_message_id: 'm2' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: '[OOC: Yes, rewrite it with a message that makes sense]' },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Miriam Koster peered down over her half-moon glasses and nodded once.' },
    ];
}

describe('parseKnowledgeExtractionAnswer: rewrites', () => {
    it('reads a missing rewrites list as empty', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({ present: [], newCharacters: [], learned: [] }));
        assert.deepEqual(answer.rewrites, []);
    });

    it('keeps a well-formed request and drops a broken one alone, the rest of the answer intact', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({
            present: ['Ellie'],
            newCharacters: [],
            learned: [{ text: 'Koster audits the file', public: false, who: ['Ellie'], how: 'witnessed', toldBy: null, at: 4 }],
            rewrites: [{ quote: 'rewrite it', at: '3' }, { quote: '', at: 3 }, { quote: 'Yes, rewrite it', at: 3 }],
        }));
        assert.deepEqual(answer.rewrites, [{ quote: 'Yes, rewrite it', at: 3 }]);
        assert.equal(answer.learned.length, 1);
    });

    it('reads a rewrites value that is not a list as empty', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({ present: [], newCharacters: [], learned: [], rewrites: 'yes' }));
        assert.deepEqual(answer.rewrites, []);
    });
});

describe('resolveRewrites', () => {
    it('keeps a request in the player\'s message, its quote as it stands, with the new version after it', () => {
        const checked = resolveRewrites([{ quote: 'yes, REWRITE it', at: 3 }], correctionChat(), 3, 4);
        assert.deepEqual(checked, [{ at: 3, quote: 'Yes, rewrite it', newVersionAt: 4 }]);
    });

    it('drops a request outside the messages the call read', () => {
        assert.deepEqual(resolveRewrites([{ quote: 'Report back', at: 1 }], correctionChat(), 3, 4), []);
    });

    it('drops a request in a narrator message', () => {
        assert.deepEqual(resolveRewrites([{ quote: 'Stopping the RP', at: 2 }], correctionChat(), 1, 4), []);
    });

    it('drops a request whose quote is not in the message', () => {
        assert.deepEqual(resolveRewrites([{ quote: 'please write it again', at: 3 }], correctionChat(), 3, 4), []);
    });

    it('drops a request in a hidden message', () => {
        const chatMessages = correctionChat();
        chatMessages[3].is_system = true;
        assert.deepEqual(resolveRewrites([{ quote: 'Yes, rewrite it', at: 3 }], chatMessages, 3, 4), []);
    });

    it('drops the objection read with the narrator\'s report: a report is not a new version', () => {
        assert.deepEqual(resolveRewrites([{ quote: 'Why is it a threat?', at: 1 }], correctionChat(), 1, 2), []);
    });

    it('drops a request with no narrator message after it in the messages read', () => {
        assert.deepEqual(resolveRewrites([{ quote: 'Yes, rewrite it', at: 3 }], correctionChat().slice(0, 4), 3, 3), []);
    });

    it('keeps only the first request that holds', () => {
        const checked = resolveRewrites([
            { quote: 'not in the text', at: 3 },
            { quote: 'rewrite it with a message', at: 3 },
            { quote: 'Yes', at: 3 },
        ], correctionChat(), 3, 4);
        assert.deepEqual(checked, [{ at: 3, quote: 'rewrite it with a message', newVersionAt: 4 }]);
    });
});

describe('isMarkedOutOfCharacter', () => {
    it('is true for a text that starts with an OOC marker, ignoring case and leading space', () => {
        assert.equal(isMarkedOutOfCharacter('[OOC: Stopping the RP]'), true);
        assert.equal(isMarkedOutOfCharacter('  (ooc) one more thing'), true);
        assert.equal(isMarkedOutOfCharacter('OOC: rewrite'), true);
        assert.equal(isMarkedOutOfCharacter('((please stop))'), true);
        assert.equal(isMarkedOutOfCharacter('[ OOC ] spaced'), true);
    });

    it('is false for story, and for an OOC marker later in the text', () => {
        assert.equal(isMarkedOutOfCharacter('Hale took the black receiver.'), false);
        assert.equal(isMarkedOutOfCharacter('"Yes, Dr. Hale." [OOC: keep going]'), false);
        assert.equal(isMarkedOutOfCharacter('[PLAN] - Now | Pier 40'), false);
        assert.equal(isMarkedOutOfCharacter(''), false);
        assert.equal(isMarkedOutOfCharacter(undefined), false);
    });
});

describe('updateKnowledgeAfterReply: the rewrite offer', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    /** The correction chat, the ledger read up to message 2, and one queued answer. */
    function prepare(answer) {
        chat.length = 0;
        chat.push(...correctionChat());
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 1 },
        };
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            settings: { autoTrack: true },
            pendingMarks: [],
            knowledge: {
                characters: [{ id: 'c1', name: 'Ellie', aliases: [] }, { id: 'c2', name: 'Miriam Koster', aliases: [] }],
                facts: [],
                scene: { at: 2, present: ['c1', 'c2'] },
                lastUpdatedAt: 2,
            },
        };
        clearTemplateCache();
        globalThis.fetch = async url => {
            if (String(url).endsWith('extract-knowledge.txt')) return new Response('{{MESSAGES}}');
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () { yield { text: JSON.stringify(answer) }; })();
    }

    const answerWithRewrite = { present: ['Ellie', 'Miriam Koster'], newCharacters: [], learned: [], rewrites: [{ quote: 'Yes, rewrite it', at: 3 }] };

    it('hands back the request and the new version by the message ids the update gave them', async () => {
        prepare(answerWithRewrite);
        const result = await updateKnowledgeAfterReply(4);

        assert.equal(typeof chat[3].extra.story_arc_message_id, 'string');
        assert.deepEqual(result.rewriteOffer, {
            requestMessageId: chat[3].extra.story_arc_message_id,
            newVersionMessageId: chat[4].extra.story_arc_message_id,
        });
        assert.equal(chat_metadata.story_arc.knowledge.updateLog.at(-1).answer.rewrites, 1);
    });

    it('offers nothing for a new version that was offered once already', async () => {
        prepare(answerWithRewrite);
        chat[4].extra = { story_arc_rewrite_offered: true };
        const result = await updateKnowledgeAfterReply(4);

        assert.equal(result.ledgerChanged, true);
        assert.equal(result.rewriteOffer, undefined);
    });

    it('offers nothing when the answer names no request', async () => {
        prepare({ present: ['Ellie'], newCharacters: [], learned: [] });
        const result = await updateKnowledgeAfterReply(4);

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
    });
});
