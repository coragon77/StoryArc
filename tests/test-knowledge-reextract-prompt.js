/**
 * What the re-extraction of an edited message shows the model as the ledger.
 * Its own file: loadTemplate caches the extraction template per process, and
 * this test needs one that prints the facts.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

describe('the re-extraction of an edited message', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('reads the ledger without what that message taught, which stays until an answer replaces it', async () => {
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 1 },
        };
        chat.length = 0;
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'I am Dice.', extra: { story_arc_message_id: 'm0' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Gabriel wants steel latches.', extra: { story_arc_message_id: 'm1' } },
        );
        chat_metadata.story_arc = {
            knowledge: {
                characters: [{ id: 'c1', name: 'Noor', aliases: [] }, { id: 'c2', name: 'Ellie', aliases: [] }],
                facts: [
                    { id: 'f1', text: 'Ellie is Dice', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 0 }] },
                    { id: 'f2', text: 'Gabriel wants titanium latches', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }] },
                ],
                scene: { at: 1, present: ['c1', 'c2'] },
                lastUpdatedAt: 1,
            },
        };
        const sentPrompts = [];
        let factsDuringCall = null;
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('extract-knowledge.txt')) return new Response('FACTS:\n{{FACTS}}');
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            factsDuringCall = chat_metadata.story_arc.knowledge.facts.map(fact => fact.id);
            const text = JSON.stringify({ present: ['Noor'], newCharacters: [], learned: [] });
            return () => (async function* () { yield { text }; })();
        };

        await updateKnowledgeAfterEdit(1);

        assert.equal(sentPrompts.length, 1);
        assert.ok(sentPrompts[0].includes('Ellie is Dice'), sentPrompts[0]);
        assert.ok(!sentPrompts[0].includes('titanium'), sentPrompts[0]);
        // The stored ledger kept f2 during the call; the applied answer replaced it.
        assert.deepEqual(factsDuringCall, ['f1', 'f2']);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts.map(fact => fact.id), ['f1']);
    });
});
