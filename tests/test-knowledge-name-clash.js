import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { applyExtractionAnswer, updateKnowledgeAfterReply, updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';
import { listCharactersWithNames } from '../lib/knowledge/names.js';
import { renameCharacter, setCharacterAliases } from '../lib/ui/knowledge-popup.js';

/** A ledger with the given characters, updated through message 9. */
function ledgerWith(characters) {
    return { characters, facts: [], scene: { at: 9, present: [] }, lastUpdatedAt: 9 };
}

/** Messages 0 to 11; 10 and 11 carry the message ids m10 and m11. */
function chatUpTo11() {
    const messages = [];
    for (let index = 0; index <= 11; index++) {
        messages.push({ is_user: index % 2 === 1, is_system: false, name: index % 2 === 1 ? 'Amy' : 'Narrator', mes: `Message ${index}.`, extra: { story_arc_message_id: `m${index}` } });
    }
    return messages;
}

function newCharactersAnswer(newCharacters) {
    return { present: [], newCharacters, learned: [] };
}

describe('applyExtractionAnswer flags a new character whose name is taken', () => {
    it('flags a surname another character has, at the last covered message and its message id', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Solomon Stern', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Julian Stern', aliases: [] }]), 10, 11, chatUpTo11());

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Solomon Stern', aliases: [] },
            { id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11, messageId: 'm11' } },
        ]);
    });

    it('flags each part of a hyphenated surname that another character has', () => {
        const ledger = ledgerWith([
            { id: 'c1', name: 'Vance', aliases: [] },
            { id: 'c2', name: 'Todd Miller', aliases: [] },
        ]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Toby Vance-Miller', aliases: [] }]), 10, 11);

        assert.deepEqual(ledger.characters[2], {
            id: 'c3', name: 'Toby Vance-Miller', aliases: [], nameClash: { names: ['Vance', 'Miller'], at: 11 },
        });
    });

    it('compares names without their titles', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Dr. Thorne', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Mr. Thorne', aliases: [] }]), 10, 11);

        assert.deepEqual(ledger.characters[1].nameClash, { names: ['Thorne'], at: 11 });
    });

    it('flags a name taken through an alias of the new character', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Marcus Chen', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Vera', aliases: ['Doctor Chen'] }]), 10, 11);

        assert.deepEqual(ledger.characters[1].nameClash, { names: ['Chen'], at: 11 });
    });

    it('flags a name another character has as an alias', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Ellie Ward', aliases: ['Sundown'] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Rafe Sundown', aliases: [] }]), 10, 11);

        assert.deepEqual(ledger.characters[1].nameClash, { names: ['Sundown'], at: 11 });
    });

    it('prints the shared name as the ledger spells it', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Matías Ortega', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'Matias Brandt', aliases: [] }]), 10, 11);

        assert.deepEqual(ledger.characters[1].nameClash, { names: ['Matías'], at: 11 });
    });

    it('does not flag two new characters of one answer against each other', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Solomon Stern', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([
            { name: 'Toby Marsh', aliases: [] },
            { name: 'Ada Marsh', aliases: [] },
        ]), 10, 11);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Solomon Stern', aliases: [] },
            { id: 'c2', name: 'Toby Marsh', aliases: [] },
            { id: 'c3', name: 'Ada Marsh', aliases: [] },
        ]);
    });

    it('neither adds nor flags a new character whose name the ledger already has', () => {
        const ledger = ledgerWith([{ id: 'c1', name: 'Solomon Stern', aliases: [] }]);

        applyExtractionAnswer(ledger, newCharactersAnswer([{ name: 'solomon stern', aliases: ['Sol'] }]), 10, 11);

        assert.deepEqual(ledger.characters, [{ id: 'c1', name: 'Solomon Stern', aliases: [] }]);
    });

    it('flags nothing when the answer adds nobody, even with clashes already in the ledger', () => {
        const ledger = ledgerWith([
            { id: 'c1', name: 'Marcus Chen', aliases: [] },
            { id: 'c2', name: 'Ava Chen', aliases: [] },
        ]);

        applyExtractionAnswer(ledger, newCharactersAnswer([]), 10, 11);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Marcus Chen', aliases: [] },
            { id: 'c2', name: 'Ava Chen', aliases: [] },
        ]);
    });
});

describe('listCharactersWithNames', () => {
    it('lists the other characters who have one of the names now, in ledger order', () => {
        const ledger = ledgerWith([
            { id: 'c1', name: 'Solomon Stern', aliases: [] },
            { id: 'c2', name: 'Vera', aliases: ['Doc Stern'] },
            { id: 'c3', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11 } },
            { id: 'c4', name: 'Toby Marsh', aliases: [] },
        ]);

        const characters = listCharactersWithNames(ledger, ['Stern'], 'c3');

        assert.deepEqual(characters.map(character => character.name), ['Solomon Stern', 'Vera']);
    });
});

// ─── Through the update after a reply and after an edit ───

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

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

function answerAdding(name) {
    return JSON.stringify({ present: [name], newCharacters: [{ name, aliases: [] }], learned: [] });
}

describe('the update flags a new character whose name is taken', () => {
    beforeEach(() => {
        chat.length = 0;
        chat.push(...chatUpTo11());
        chat_metadata.story_arc = { knowledge: ledgerWith([{ id: 'c1', name: 'Solomon Stern', aliases: [] }]) };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('after a reply: stores the flag at the reply and names the character in the result, with one request', async () => {
        setSwitches({ tracker: true });
        const sentPrompts = installExtraction([answerAdding('Julian Stern')]);

        const updated = await updateKnowledgeAfterReply(11);

        assert.deepEqual(updated.flaggedCharacters, [{ id: 'c2', name: 'Julian Stern' }]);
        assert.equal(updated.ledgerChanged, true);
        assert.equal(sentPrompts.length, 1);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[1], {
            id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11, messageId: 'm11' },
        });
    });

    it('after a reply: a new character with a free name is not flagged', async () => {
        setSwitches({ tracker: true });
        const sentPrompts = installExtraction([answerAdding('Toby Marsh')]);

        const updated = await updateKnowledgeAfterReply(11);

        assert.equal(updated.flaggedCharacters, undefined);
        assert.equal(sentPrompts.length, 1);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[1], { id: 'c2', name: 'Toby Marsh', aliases: [] });
    });

    it('with the tracker off: no request and no flag', async () => {
        setSwitches({ tracker: false });
        const sentPrompts = installExtraction([answerAdding('Julian Stern')]);

        const updated = await updateKnowledgeAfterReply(11);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [{ id: 'c1', name: 'Solomon Stern', aliases: [] }]);
    });

    it('after an edit: the re-extraction flags the character it adds, at the edited message', async () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 11;
        const sentPrompts = installExtraction([answerAdding('Julian Stern')]);

        const updated = await updateKnowledgeAfterEdit(10);

        assert.deepEqual(updated.flaggedCharacters, [{ id: 'c2', name: 'Julian Stern' }]);
        assert.equal(sentPrompts.length, 1);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[1], {
            id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 10, messageId: 'm10' },
        });
    });
});

// ─── Clearing in the Knowledge popup ───

describe('saving a flagged character in the Knowledge popup clears its flag', () => {
    const flaggedLedger = () => ledgerWith([
        { id: 'c1', name: 'Solomon Stern', aliases: [] },
        { id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11, messageId: 'm11' } },
    ]);

    it('a rename removes the flag', () => {
        const renamed = renameCharacter(flaggedLedger(), 'c2', 'Julian Sterling');

        assert.deepEqual(renamed.ledger.characters[1], { id: 'c2', name: 'Julian Sterling', aliases: [] });
    });

    it('saving the aliases removes the flag', () => {
        const saved = setCharacterAliases(flaggedLedger(), 'c2', ['Jules']);

        assert.deepEqual(saved.ledger.characters[1], { id: 'c2', name: 'Julian Stern', aliases: ['Jules'] });
    });
});

// ─── The settings drawer's status line ───

describe('updateKnowledgeStatus counts the names to check', () => {
    let updateKnowledgeStatus;
    const status = { html: null, text: null };

    before(async () => {
        globalThis.$ = () => ({
            length: 1,
            text(value) { status.text = value; status.html = null; },
            html(value) { status.html = value; status.text = null; },
        });
        ({ updateKnowledgeStatus } = await import('../lib/ui/knowledge-status.js'));
    });

    after(() => {
        delete globalThis.$;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
    });

    it('appends the count and a button while records are flagged', () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc = { knowledge: ledgerWith([
            { id: 'c1', name: 'Solomon Stern', aliases: [] },
            { id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11 } },
            { id: 'c3', name: 'Ada Thorne', aliases: [], nameClash: { names: ['Thorne'], at: 13 } },
        ]) };

        updateKnowledgeStatus();

        assert.equal(status.html, 'Ledger last updated at message #9. 2 new names to check '
            + '<button type="button" class="menu_button story-arc-knowledge-names-btn">Open Knowledge</button>');
    });

    it('says one name in the singular', () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc = { knowledge: ledgerWith([
            { id: 'c2', name: 'Julian Stern', aliases: [], nameClash: { names: ['Stern'], at: 11 } },
        ]) };

        updateKnowledgeStatus();

        assert.equal(status.html, 'Ledger last updated at message #9. 1 new name to check '
            + '<button type="button" class="menu_button story-arc-knowledge-names-btn">Open Knowledge</button>');
    });

    it('keeps the plain line without flags', () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc = { knowledge: ledgerWith([{ id: 'c1', name: 'Solomon Stern', aliases: [] }]) };

        updateKnowledgeStatus();

        assert.equal(status.text, 'Ledger last updated at message #9.');
    });
});
