import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { findAppearancePassages, searchAppearance, listOfferedFindings } from '../lib/knowledge/appearance-search.js';
import { giveMessageId, isIdFromSearch } from '../lib/knowledge/message-ids.js';

/** Chat messages from texts, each hidden (is_system), as a summary extension leaves a long chat. */
function hiddenChatOf(...texts) {
    return texts.map(mes => ({ name: 'Narrator', is_user: false, is_system: true, mes }));
}

describe('findAppearancePassages', () => {
    it('finds looks in hidden and shown messages alike, oldest first', () => {
        const chatMessages = [
            { name: 'Narrator', is_user: false, is_system: true, mes: 'Priya Sharma stepped in. Her dark glossy curls bounced at her shoulders. She waved.' },
            { name: 'Narrator', is_user: false, is_system: false, mes: 'Priya had always been shorter, five-two to Ellie\'s five-five.' },
            { name: 'Narrator', is_user: false, is_system: true, mes: 'Nothing about anyone here. Priya laughed.' },
        ];

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya Sharma', 'Priya'], ['Ellie'], 6000), [
            { at: 0, text: 'Priya Sharma stepped in. Her dark glossy curls bounced at her shoulders.' },
            { at: 1, text: 'Priya had always been shorter, five-two to Ellie\'s five-five.' },
        ]);
    });

    it('finds an ethnicity without a describing word', () => {
        const chatMessages = hiddenChatOf(
            'Priya was Indian-American, the first in her family born in Brockton Bay.',
            'Priya ordered Indian food for everyone.',
        );

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 6000), [
            { at: 0, text: 'Priya was Indian-American, the first in her family born in Brockton Bay.' },
            // A demonym in the naming sentence counts; the search does not judge the food
            { at: 1, text: 'Priya ordered Indian food for everyone.' },
        ]);
    });

    it('does not count a demonym in the pronoun sentence after the naming one', () => {
        const chatMessages = hiddenChatOf('Priya came home. She cooked Korean barbecue.');

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 6000), []);
    });

    it('leaves out features without a describing word and passing states', () => {
        const chatMessages = hiddenChatOf('Priya\'s eyes went wide.', 'Priya blinked. Her eyes went wide.', 'Priya ran a hand through her hair.');

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 6000), []);
    });

    it('leaves out features that belong to someone else', () => {
        const chatMessages = hiddenChatOf(
            'Priya stared at Ellie\'s blonde hair.',
            'Sofia lowered her hand from Priya\'s shoulder, her dark eyes narrowing.',
            'Her dark eyes found Priya across the room.',
            'Ellie hugged Priya, her short black hair still damp.',
        );

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], ['Ellie', 'Sofia Vega'], 6000), []);
    });

    it('cuts a list of people at ; and • so each person keeps their own feature', () => {
        const chatMessages = hiddenChatOf('Ellie: long blonde hair, blue eyes; Priya: dark curls • Marco: black beard');

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], ['Ellie', 'Marco'], 6000), [
            { at: 0, text: 'Priya: dark curls' },
        ]);
    });

    it('leaves out tagged elements such as a status block', () => {
        const chatMessages = hiddenChatOf(
            'Priya waited by the door.<trk><cs>Priya Sharma: dark curls, emerald dress</cs></trk>',
            '<details><summary>Plot Director</summary>Priya could dye her hair bright red.</details>',
        );

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya', 'Priya Sharma'], [], 6000), []);
    });

    it('keeps the newest three per feature, each passage once, and stays within the budget', () => {
        const chatMessages = hiddenChatOf(
            'Priya, petite at five-two, waved.',
            'Priya\'s dark eyes softened.',
            'Priya\'s dark eyes narrowed.',
            'Priya\'s dark eyes widened.',
            'Priya\'s dark eyes sparkled.',
            'Priya\'s dark eyes sparkled.',
        );

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 6000), [
            { at: 0, text: 'Priya, petite at five-two, waved.' },
            { at: 2, text: 'Priya\'s dark eyes narrowed.' },
            { at: 3, text: 'Priya\'s dark eyes widened.' },
            { at: 5, text: 'Priya\'s dark eyes sparkled.' },
        ]);
        // "[#5] Priya's dark eyes sparkled." is 32 characters, "[#3] Priya's dark eyes widened." 31
        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 63), [
            { at: 3, text: 'Priya\'s dark eyes widened.' },
            { at: 5, text: 'Priya\'s dark eyes sparkled.' },
        ]);
    });

    it('matches a straight and a curly apostrophe in a name alike', () => {
        const chatMessages = hiddenChatOf('D’Arcy has auburn curls.', 'Ellie stared at D’Arcy’s green eyes.');

        assert.deepEqual(findAppearancePassages(chatMessages, ['D\'Arcy'], ['Ellie'], 6000), [
            { at: 0, text: 'D’Arcy has auburn curls.' },
            { at: 1, text: 'Ellie stared at D’Arcy’s green eyes.' },
        ]);
    });

    it('sends a sentence once when the pronoun sentence after a naming one names the person too', () => {
        const chatMessages = hiddenChatOf('Priya looked up. Her brown eyes were tired, Priya\'s dark curls a mess.');

        assert.deepEqual(findAppearancePassages(chatMessages, ['Priya'], [], 6000), [
            { at: 0, text: 'Priya looked up. Her brown eyes were tired, Priya\'s dark curls a mess.' },
        ]);
    });

    it('finds nothing without a name of the person', () => {
        const chatMessages = hiddenChatOf('Priya\'s dark curls bounced.');

        assert.deepEqual(findAppearancePassages(chatMessages, [], ['Ellie'], 6000), []);
    });
});

describe('listOfferedFindings', () => {
    const hairFinding = { kind: 'hair', value: 'dark glossy curls', at: 140, passage: 'Priya: dark glossy curls' };

    it('offers a kind the ledger does not know yet', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: {} };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), [hairFinding]);
    });

    it('offers a newer finding with a different value', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'black', at: 100 }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), [hairFinding]);
    });

    it('offers an older finding that refines the current value', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'dark hair', at: 3295 }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), [hairFinding]);
    });

    it('does not offer an older finding that does not refine the current value', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'short black', at: 3295 }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), []);
    });

    it('does not offer a locked kind, even a refining finding', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'dark', at: null, by: 'user' }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), []);
    });

    it('does not offer a newer finding with the same value, case aside', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'Dark Glossy Curls', at: 100 }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), []);
    });
});

describe('searchAppearance', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;
    let sentPrompts;

    /** A search template that shows every placeholder, and an answer queue for the call. */
    function installSearch(answers) {
        sentPrompts = [];
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('find-appearance.txt')) {
                return new Response('{{CHARACTER}} | {{ALIASES}}\n{{KNOWN_APPEARANCE}}\n{{PASSAGES}}');
            }
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const answer = answers.shift();
            if (answer instanceof Error) throw answer;
            return () => (async function* () { yield { text: answer }; })();
        };
    }

    /** Priya with a known eye colour, Ellie, and Raj who shares Priya's surname. */
    function makeLedger() {
        return {
            characters: [
                { id: 'c1', name: 'Priya Sharma', aliases: ['Priya', 'Sharma'], details: { eyes: [{ value: 'brown', at: 1 }] } },
                { id: 'c2', name: 'Ellie', aliases: [] },
                { id: 'c3', name: 'Raj Sharma', aliases: [] },
            ],
            facts: [],
        };
    }

    function makeChat() {
        return [
            { name: 'Narrator', is_user: false, is_system: true, mes: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' },
            { name: 'Narrator', is_user: false, is_system: true, mes: 'Sharma\'s grey eyes narrowed.' },
            { name: 'Narrator', is_user: false, is_system: false, mes: 'Priya had always been shorter, five-two to Ellie\'s five-five.' },
        ];
    }

    beforeEach(() => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
    });

    it('sends the name, aliases, known appearance and passages, and keeps the good items of the answer', async () => {
        installSearch([JSON.stringify({
            appearance: [
                { kind: 'outfit', value: 'emerald dress', at: 0 },
                { kind: 'hair', value: 'dark glossy curls', at: 0 },
                { kind: 'hair', value: 'black', at: 2 },
                { kind: 'eyes', value: 'warm brown', at: 99 },
                { kind: 'skin', value: '  ', at: 0 },
                { kind: 'skin', value: 'warm brown', at: null },
                { kind: 'build', value: 'five-two', at: '2' },
                { kind: 'ethnicity', value: 'Indian-American', at: 0 },
            ],
        })]);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        // "Sharma" is Raj's too, so message 1 does not name Priya
        assert.deepEqual(sentPrompts, [[
            'Priya Sharma | Priya, Sharma',
            '- eyes: brown',
            '[#0] Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.',
            '[#2] Priya had always been shorter, five-two to Ellie\'s five-five.',
        ].join('\n')]);
        assert.deepEqual(result, {
            findings: [
                { kind: 'ethnicity', value: 'Indian-American', at: 0, passage: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' },
                { kind: 'hair', value: 'dark glossy curls', at: 0, passage: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' },
                { kind: 'build', value: 'five-two', at: 2, passage: 'Priya had always been shorter, five-two to Ellie\'s five-five.' },
            ],
            passageCount: 2,
        });
    });

    it('keeps only the findings the player is offered', async () => {
        installSearch([JSON.stringify({
            appearance: [
                { kind: 'eyes', value: 'Brown', at: 2 },
                { kind: 'hair', value: 'dark glossy curls', at: 0 },
            ],
        })]);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, {
            findings: [
                { kind: 'hair', value: 'dark glossy curls', at: 0, passage: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' },
            ],
            passageCount: 2,
        });
    });

    it('shows both passages of one message in its finding', async () => {
        installSearch([JSON.stringify({ appearance: [{ kind: 'hair', value: 'dark curls, shoulder length', at: 0 }] })]);
        const chatMessages = hiddenChatOf('Priya\'s dark curls bounced. Ellie laughed. Priya wore her long hair loose.');

        const result = await searchAppearance(makeLedger(), 'c1', chatMessages, 'Ellie');

        assert.deepEqual(result, {
            findings: [{
                kind: 'hair', value: 'dark curls, shoulder length', at: 0,
                passage: 'Priya\'s dark curls bounced. … Priya wore her long hair loose.',
            }],
            passageCount: 2,
        });
    });

    it('finds an unnamed relative by its display name and by any name of the other character', async () => {
        installSearch([JSON.stringify({ appearance: [{ kind: 'hair', value: 'short grey', at: 0 }] })]);
        const ledger = {
            characters: [
                { id: 'c4', name: 'Kendra Osei', aliases: ['Kendra'] },
                { id: 'c5', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c4' }, at: 3 }] } },
            ],
            facts: [],
        };
        const chatMessages = hiddenChatOf(
            'Kendra\'s mother had short grey hair.',
            'Kendra tied back her black braids.',
            'Kendra Osei\'s mother pushed her grey curls back.',
        );

        const result = await searchAppearance(ledger, 'c5', chatMessages, 'Ellie');

        assert.deepEqual(sentPrompts, [[
            'Kendra Osei\'s mother | (none)',
            '(none)',
            '[#0] Kendra\'s mother had short grey hair.',
            '[#2] Kendra Osei\'s mother pushed her grey curls back.',
        ].join('\n')]);
        assert.deepEqual(result, {
            findings: [{ kind: 'hair', value: 'short grey', at: 0, passage: 'Kendra\'s mother had short grey hair.' }],
            passageCount: 2,
        });
    });

    it('makes no call when no passage describes the character', async () => {
        installSearch([]);
        const chatMessages = hiddenChatOf('Priya laughed.');

        const result = await searchAppearance(makeLedger(), 'c1', chatMessages, 'Ellie');

        assert.deepEqual(result, { findings: [], passageCount: 0 });
        assert.deepEqual(sentPrompts, []);
    });

    it('gives an error for an unreadable answer', async () => {
        installSearch(['I cannot help with that.']);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, { error: 'The appearance search gave an unreadable answer. Try again.' });
    });

    it('gives an error for a failed call', async () => {
        installSearch([new Error('401 Unauthorized')]);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, { error: 'The appearance search failed. Try again later.' });
    });

    it('gives an error for a character not in the ledger', async () => {
        installSearch([]);

        const result = await searchAppearance(makeLedger(), 'c9', makeChat(), 'Ellie');

        assert.deepEqual(result, { error: 'This character is not in the ledger.' });
        assert.deepEqual(sentPrompts, []);
    });
});

describe('giveMessageId', () => {
    it('gives a hidden message an id', () => {
        const chatMessage = { name: 'Narrator', is_system: true, mes: 'Priya\'s dark curls.' };

        const messageId = giveMessageId(chatMessage);

        assert.equal(typeof messageId, 'string');
        assert.ok(messageId.length > 0);
        assert.equal(chatMessage.extra.story_arc_message_id, messageId);
        assert.equal(chatMessage.extra.story_arc_message_id_by_search, true);
        assert.equal(isIdFromSearch(chatMessage), true);
    });

    it('keeps an id the message has, without the search marker', () => {
        const chatMessage = { name: 'Narrator', is_system: true, mes: 'x', extra: { story_arc_message_id: 'm7', other: 1 } };

        assert.equal(giveMessageId(chatMessage), 'm7');
        assert.deepEqual(chatMessage.extra, { story_arc_message_id: 'm7', other: 1 });
        assert.equal(isIdFromSearch(chatMessage), false);
    });

    it('isIdFromSearch is false for a message without extra', () => {
        assert.equal(isIdFromSearch({ name: 'Narrator', mes: 'x' }), false);
    });
});
