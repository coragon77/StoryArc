import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import {
    applyExtractionAnswer, dropKnowledgeFrom, parseKnowledgeExtractionAnswer,
    updateKnowledgeAfterReply, updateKnowledgeAfterEdit,
} from '../lib/knowledge/ledger.js';

const cast = [
    { id: 'c1', name: 'Ellie', aliases: ['Dice'] },
    { id: 'c2', name: 'Gabriel', aliases: ['Aegis'] },
];

/** The stipend the narrator invented at 2121, held by Ellie and Gabriel. */
function stipendFact() {
    return {
        id: 'f2', text: 'Ellie is paid a yearly stipend by SWORD', public: false,
        holders: [
            { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2121 },
            { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2121 },
        ],
    };
}

function identityFact() {
    return {
        id: 'f1', text: 'Ellie is Dice', public: false,
        holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2050 }],
    };
}

/** The ledger after the update that read 2121. */
function ledgerWithStipend() {
    return {
        characters: cast,
        facts: [identityFact(), stipendFact()],
        scene: { at: 2121, present: ['c1', 'c2'] },
        sceneHistory: [],
        lastUpdatedAt: 2121,
    };
}

/** The answer for 2122–2123: the player's and the narrator's OOC lines. */
function correctionAnswer(retracted) {
    return { present: ['Ellie', 'Gabriel'], newCharacters: [], learned: [], revealedSecrets: [], retracted };
}

describe('applyExtractionAnswer — a retracted fact leaves the ledger', () => {
    it('removes the retracted fact with all its holders and keeps it for a rollback', () => {
        const ledger = ledgerWithStipend();

        applyExtractionAnswer(ledger, correctionAnswer([{ factId: 'f2', at: 2122 }]), 2122, 2123);

        assert.deepEqual(ledger, {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2050 }],
                },
            ],
            scene: { at: 2123, present: ['c1', 'c2'] },
            sceneHistory: [{ at: 2121, present: ['c1', 'c2'] }],
            lastUpdatedAt: 2123,
            retractedFacts: [
                {
                    at: 2122,
                    fact: {
                        id: 'f2', text: 'Ellie is paid a yearly stipend by SWORD', public: false,
                        holders: [
                            { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2121 },
                            { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2121 },
                        ],
                    },
                },
            ],
        });
    });
});

describe('applyExtractionAnswer — what a retraction leaves alone', () => {
    it('keeps a fact the user entered a holder for', () => {
        const ledger = ledgerWithStipend();
        ledger.facts[1].holders.push({ characterId: 'c1', how: 'user', toldBy: null, at: null });

        applyExtractionAnswer(ledger, correctionAnswer([{ factId: 'f2', at: 2122 }]), 2122, 2123);

        assert.deepEqual(ledger.facts, [
            {
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2050 }],
            },
            {
                id: 'f2', text: 'Ellie is paid a yearly stipend by SWORD', public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2121 },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2121 },
                    { characterId: 'c1', how: 'user', toldBy: null, at: null },
                ],
            },
        ]);
        assert.equal(ledger.retractedFacts, undefined);
    });

    it('changes no fact for an unknown fact id', () => {
        const ledger = ledgerWithStipend();

        applyExtractionAnswer(ledger, correctionAnswer([{ factId: 'f9', at: 2122 }]), 2122, 2123);

        assert.deepEqual(ledger.facts, [identityFact(), stipendFact()]);
        assert.equal(ledger.retractedFacts, undefined);
    });
});

/** The ledger after the correction at 2122 took the stipend back. */
function ledgerAfterCorrection() {
    return {
        characters: cast,
        facts: [identityFact()],
        scene: { at: 2123, present: ['c1', 'c2'] },
        sceneHistory: [{ at: 2121, present: ['c1', 'c2'] }],
        lastUpdatedAt: 2123,
        retractedFacts: [{ at: 2122, fact: stipendFact() }],
    };
}

describe('dropKnowledgeFrom — rolling back the correction brings the fact back', () => {
    it('restores the retracted fact with its holders when the correcting message goes', () => {
        const ledger = ledgerAfterCorrection();

        const changed = dropKnowledgeFrom(ledger, 2122);

        assert.equal(changed, true);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2050 }],
                },
                {
                    id: 'f2', text: 'Ellie is paid a yearly stipend by SWORD', public: false,
                    holders: [
                        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2121 },
                        { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2121 },
                    ],
                },
            ],
            scene: { at: 2121, present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 2121,
            retractedFacts: [],
            updateLog: [{ kind: 'rollback', from: 2122, factsDropped: [], holdersDropped: 0, factsRestored: ['f2'] }],
        });
    });

    it('keeps the fact retracted when only later messages go', () => {
        const ledger = ledgerAfterCorrection();

        dropKnowledgeFrom(ledger, 2123);

        assert.deepEqual(ledger.facts, [identityFact()]);
        assert.deepEqual(ledger.retractedFacts, [{ at: 2122, fact: stipendFact() }]);
    });

    it('does not bring back holders learned at or after the rollback point', () => {
        // Rolling back to 2121 takes back the message the stipend came from, too.
        const ledger = ledgerAfterCorrection();

        dropKnowledgeFrom(ledger, 2121);

        assert.deepEqual(ledger.facts, [identityFact()]);
        assert.deepEqual(ledger.retractedFacts, []);
    });

    it('gives a restored fact a free id when a hand-entered fact took its id meanwhile', () => {
        const ledger = ledgerAfterCorrection();
        ledger.facts.push({
            id: 'f2', text: 'Noor tunes Aegis\'s suit', public: false,
            holders: [{ characterId: 'c1', how: 'user', toldBy: null, at: null }],
        });

        dropKnowledgeFrom(ledger, 2122);

        assert.deepEqual(ledger.facts.map(fact => [fact.id, fact.text]), [
            ['f1', 'Ellie is Dice'],
            ['f2', 'Noor tunes Aegis\'s suit'],
            ['f3', 'Ellie is paid a yearly stipend by SWORD'],
        ]);
    });
});

describe('parseKnowledgeExtractionAnswer — the retracted list', () => {
    const answerWith = retractedJson => `{ "present": ["Ellie"], "newCharacters": [], "learned": []${retractedJson} }`;

    it('reads the retracted fact ids with the message of the correction', () => {
        const answer = parseKnowledgeExtractionAnswer(answerWith(', "retracted": [{ "factId": "f2", "at": 2122, "why": "invented" }]'));

        assert.deepEqual(answer.retracted, [{ factId: 'f2', at: 2122 }]);
    });

    it('reads a missing retracted list as empty', () => {
        const answer = parseKnowledgeExtractionAnswer(answerWith(''));

        assert.deepEqual(answer.retracted, []);
    });

    it('rejects the whole answer for a retracted list that is not a list, or an item without id or index', () => {
        assert.equal(parseKnowledgeExtractionAnswer(answerWith(', "retracted": "f2"')), null);
        assert.equal(parseKnowledgeExtractionAnswer(answerWith(', "retracted": ["f2"]')), null);
        assert.equal(parseKnowledgeExtractionAnswer(answerWith(', "retracted": [{ "factId": "f2" }]')), null);
        assert.equal(parseKnowledgeExtractionAnswer(answerWith(', "retracted": [{ "factId": "", "at": 2122 }]')), null);
    });
});

describe('extract-knowledge.txt — out-of-character corrections', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('states that out-of-character lines teach nothing and are corrections', () => {
        assert.ok(template.includes(
            'Out-of-character lines (marked OOC, in square brackets, or the narrator stepping out of the story to talk to the player) '
            + 'teach characters nothing: they are corrections, not story.'), 'missing the OOC rule');
        assert.ok(!template.includes('Text in square brackets or marked OOC is not the story.'), 'the old OOC line is still there');
    });

    it('asks to retract a fact an out-of-character line calls wrong, invented or not canon', () => {
        assert.ok(template.includes(
            '5. RETRACTED. When an out-of-character line says a fact in the ledger is wrong, invented or not canon, '
            + 'write one item with that fact\'s id:'), 'missing the retraction task');
        assert.ok(template.includes(
            'A correction that states the right version is not itself a fact: record the right version under LEARNED '
            + 'only when a later in-story message shows a character learning it.'), 'missing the right-version rule');
        assert.ok(template.includes(
            '"retracted": [\n    { "factId": "id of a fact in the ledger", "at": <index of the message with the correction> }\n  ]'),
            'missing the retracted field in the JSON shape');
    });
});

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/**
 * Replace the extraction template with one that only lists the messages,
 * and the connection profile's transport with one that records each prompt
 * and answers with the next queued answer text.
 */
function installExtraction(answers) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('MESSAGES:\n{{MESSAGES}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

function setSwitches({ tracker }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: 1 },
    };
}

/** The live case in four messages: the invented stipend, then both OOC lines. With the message ids m0 … m3 already. */
function fillChat() {
    chat.push(
        { is_user: true, is_system: false, name: 'Ellie', mes: 'So what does SWORD pay me?', extra: { story_arc_message_id: 'm0' } },
        { is_user: false, is_system: false, name: 'Gabriel', mes: 'Your yearly stipend, same as every cadet.', extra: { story_arc_message_id: 'm1' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: '(OOC: There was never anything on the page regarding financial compensation.)', extra: { story_arc_message_id: 'm2' } },
        { is_user: false, is_system: false, name: 'Gabriel', mes: '(OOC: You are right, I invented that detail on the spot in the previous turn.)', extra: { story_arc_message_id: 'm3' } },
    );
}

const STIPEND = {
    id: 'f2', text: 'Ellie is paid a yearly stipend by SWORD', public: false,
    holders: [
        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 1 },
        { characterId: 'c1', how: 'told', toldBy: 'c2', at: 1 },
    ],
};

/** The ledger after the update that read message 1, the invented stipend. */
function storeLedgerWithStipend() {
    chat_metadata.story_arc = {
        knowledge: {
            characters: cast,
            facts: [structuredClone(STIPEND)],
            scene: { at: 1, present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 1,
        },
    };
}

const ANSWER_RETRACTING_STIPEND = JSON.stringify({
    present: ['Ellie', 'Gabriel'], newCharacters: [], learned: [], revealedSecrets: [],
    retracted: [{ factId: 'f2', at: 2 }],
});

describe('the retraction through an update', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('takes the invented fact out of the ledger after the correction', async () => {
        fillChat();
        setSwitches({ tracker: true });
        storeLedgerWithStipend();
        installExtraction([ANSWER_RETRACTING_STIPEND]);

        const updated = await updateKnowledgeAfterReply(3);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: cast,
            facts: [],
            scene: { at: 3, messageId: 'm3', present: ['c1', 'c2'] },
            sceneHistory: [{ at: 1, present: ['c1', 'c2'] }],
            lastUpdatedAt: 3,
            lastUpdatedMessageId: 'm3',
            retractedFacts: [{ at: 2, messageId: 'm2', fact: STIPEND }],
            updateLog: [{
                kind: 'update', from: 2, to: 3, messageId: 'm3',
                answer: { present: 2, newCharacters: 0, learned: 0, retracted: 1, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: [], holdersAdded: 0, factsRetracted: ['f2'], beatsCompleted: 0, rulingsStored: 0,
            }],
        });
    });

    it('changes nothing while the tracker is off', async () => {
        fillChat();
        setSwitches({ tracker: false });
        storeLedgerWithStipend();
        const sentPrompts = installExtraction([ANSWER_RETRACTING_STIPEND]);

        const updated = await updateKnowledgeAfterReply(3);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: cast,
            facts: [STIPEND],
            scene: { at: 1, present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 1,
        });
    });

    it('brings the fact back when the correcting message is edited into one that corrects nothing', async () => {
        fillChat();
        setSwitches({ tracker: true });
        chat_metadata.story_arc = {
            knowledge: {
                characters: cast,
                facts: [],
                scene: { at: 3, present: ['c1', 'c2'] },
                sceneHistory: [{ at: 1, present: ['c1', 'c2'] }],
                lastUpdatedAt: 3,
                retractedFacts: [{ at: 2, fact: structuredClone(STIPEND) }],
            },
        };
        chat[2].mes = 'And when is it paid?';
        installExtraction([JSON.stringify({ present: ['Ellie', 'Gabriel'], newCharacters: [], learned: [] })]);

        const updated = await updateKnowledgeAfterEdit(2);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: cast,
            facts: [STIPEND],
            scene: { at: 3, present: ['c1', 'c2'] },
            sceneHistory: [{ at: 1, present: ['c1', 'c2'] }],
            lastUpdatedAt: 3,
            retractedFacts: [],
            updateLog: [{
                kind: 'reextract', from: 2, to: 2, messageId: 'm2',
                answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            }],
        });
    });

    it('an edit of the retracted fact\'s message takes its holders out of the retraction too', async () => {
        fillChat();
        setSwitches({ tracker: true });
        chat_metadata.story_arc = {
            knowledge: {
                characters: cast,
                facts: [],
                scene: { at: 3, present: ['c1', 'c2'] },
                sceneHistory: [{ at: 1, present: ['c1', 'c2'] }],
                lastUpdatedAt: 3,
                retractedFacts: [{ at: 2, fact: structuredClone(STIPEND) }],
            },
        };
        // The player rewrites the stipend line, then the correction that no longer fits.
        chat[1].mes = 'SWORD pays you a monthly wage.';
        chat[2].mes = 'And when is it paid?';
        installExtraction([
            JSON.stringify({
                present: ['Ellie', 'Gabriel'], newCharacters: [],
                learned: [{ text: 'SWORD pays Ellie a monthly wage', public: false, who: ['Ellie'], how: 'told', toldBy: 'Gabriel', at: 1 }],
            }),
            JSON.stringify({ present: ['Ellie', 'Gabriel'], newCharacters: [], learned: [] }),
        ]);

        await updateKnowledgeAfterEdit(1);
        await updateKnowledgeAfterEdit(2);

        // The stipend came only from the old text of message 1: it does not come back.
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: cast,
            facts: [{
                id: 'f1', text: 'SWORD pays Ellie a monthly wage', public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 1, messageId: 'm1' },
                ],
            }],
            scene: { at: 3, present: ['c1', 'c2'] },
            sceneHistory: [{ at: 1, present: ['c1', 'c2'] }],
            lastUpdatedAt: 3,
            retractedFacts: [],
            updateLog: [
                {
                    kind: 'reextract', from: 1, to: 1, messageId: 'm1',
                    answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                    factsCreated: ['f1'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
                },
                {
                    kind: 'reextract', from: 2, to: 2, messageId: 'm2',
                    answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                    factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
                },
            ],
        });
    });
});
