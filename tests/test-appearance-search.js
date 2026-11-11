import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, ConnectionManagerRequestService, mockContextFields, mockSortedEntries } from '../tests/mocks/st-mocks.js';
import { findAppearancePassages, findDefinitions, findNamingPassages, searchAppearance, listOfferedFindings } from '../lib/knowledge/appearance-search.js';
import { giveMessageId, isIdFromSearch } from '../lib/knowledge/message-ids.js';
import { clearTemplateCache } from '../lib/planning/generator.js';

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

describe('findNamingPassages', () => {
    it('takes the newest passages that name the person, with the pronoun sentence after, oldest first', () => {
        const chatMessages = hiddenChatOf(
            'Mateo Reyes was a Ward.',
            'Ellie laughed. Mateo shrugged. He was seventeen.',
            '<status>Mateo: hoodie</status>Noor waved at Mateo.',
        );

        assert.deepEqual(findNamingPassages(chatMessages, ['Mateo Reyes', 'Mateo'], [], 4000), [
            { at: 0, text: 'Mateo Reyes was a Ward.' },
            { at: 1, text: 'Mateo shrugged. He was seventeen.' },
            { at: 2, text: 'Noor waved at Mateo.' },
        ]);
    });

    it('leaves out a passage the call already gets and a second copy of one text in a message', () => {
        const chatMessages = hiddenChatOf('Mateo had short black hair.', 'Mateo nodded. Mateo nodded.');

        const passages = findNamingPassages(chatMessages, ['Mateo'], [{ at: 0, text: 'Mateo had short black hair.' }], 4000);

        assert.deepEqual(passages, [{ at: 1, text: 'Mateo nodded.' }]);
    });

    it('stops at the first passage, newest first, that would pass the budget', () => {
        // "[#2] Mateo ran." is 15 characters, "[#1] Mateo was a Ward of Sector 2." 34, "[#0] Mateo sat." 15
        const chatMessages = hiddenChatOf('Mateo sat.', 'Mateo was a Ward of Sector 2.', 'Mateo ran.');

        assert.deepEqual(findNamingPassages(chatMessages, ['Mateo'], [], 48), [{ at: 2, text: 'Mateo ran.' }]);
        assert.deepEqual(findNamingPassages(chatMessages, ['Mateo'], [], 49), [
            { at: 1, text: 'Mateo was a Ward of Sector 2.' },
            { at: 2, text: 'Mateo ran.' },
        ]);
    });

    it('skips one passage longer than the whole budget and goes on with the older ones', () => {
        const chatMessages = hiddenChatOf('Mateo was a Ward.', `Mateo ran ${'and ran '.repeat(10)}`);

        assert.deepEqual(findNamingPassages(chatMessages, ['Mateo'], [], 40), [{ at: 0, text: 'Mateo was a Ward.' }]);
    });

    it('finds nothing without a name of the person', () => {
        assert.deepEqual(findNamingPassages(hiddenChatOf('Mateo ran.'), [''], [], 4000), []);
    });
});

describe('findDefinitions', () => {
    const ellieNames = ['Ellie Masters', 'Ellie'];

    it('takes the persona description when the persona is the character, with its name for {{user}}, on one line', () => {
        const definitionTexts = {
            persona: { name: 'Ellie Masters', description: '{{user}} is eighteen.\nShe has a black layered bob.' },
            cards: [{ name: 'Priya Sharma', description: '{{char}} has dark curls.' }],
        };

        assert.deepEqual(findDefinitions(definitionTexts, [], ellieNames, ['Priya Sharma']), [
            { label: 'persona', source: 'persona', text: 'Ellie Masters is eighteen. / She has a black layered bob.' },
        ]);
    });

    it('takes the card description of a card character, with the names for {{char}} and {{user}}', () => {
        const definitionTexts = {
            persona: { name: 'Ellie Masters', description: '{{user}} has a black bob.' },
            cards: [{ name: 'Priya Sharma', description: '{{char}} has dark curls; {{user}} likes her.' }],
        };

        assert.deepEqual(findDefinitions(definitionTexts, [], ['Priya Sharma', 'Priya'], ['Ellie Masters']), [
            { label: 'card', source: 'card', text: 'Priya Sharma has dark curls; Ellie Masters likes her.' },
        ]);
    });

    it('takes a short lorebook entry about the character whole, and only the describing sentences of the others that name them', () => {
        const definitionTexts = { persona: { name: 'Carrie', description: 'Carrie has long blonde hair.' }, cards: [] };
        const lorebookEntries = [
            { world: 'Paragon', comment: 'Ellie\'s sheet', key: ['Ellie'], content: 'Hair: black bob\nEyes: bright blue' },
            {
                world: 'Paragon', comment: 'Ellie\'s Power', key: [],
                content: `${'The power hums. '.repeat(100)}Ellie's chin-length black bob turns magenta when she uses the tabs.`,
            },
            { world: 'Paragon', comment: 'Dramatis Personae', key: ['cast'], content: 'Priya Sharma: dark glossy curls. Ellie: five-five, freckles across her nose.' },
            { world: 'Paragon', comment: 'Weather', key: ['rain'], content: 'It rained all week.' },
        ];

        assert.deepEqual(findDefinitions(definitionTexts, lorebookEntries, ellieNames, ['Priya Sharma', 'Carrie']), [
            { label: 'lore 1', source: 'lorebook: Paragon / Ellie\'s sheet', text: 'Hair: black bob / Eyes: bright blue' },
            { label: 'lore 2', source: 'lorebook: Paragon / Ellie\'s Power', text: 'Ellie\'s chin-length black bob turns magenta when she uses the tabs.' },
            { label: 'lore 3', source: 'lorebook: Paragon / Dramatis Personae', text: 'Ellie: five-five, freckles across her nose.' },
        ]);
    });

    it('takes a card named by the first name alone, and puts the card\'s name for {{char}} in lorebook text and keys', () => {
        const definitionTexts = { persona: { name: 'Steve', description: '' }, cards: [{ name: 'Amy', description: '{{char}} has fiery red hair.' }] };
        const lorebookEntries = [{ world: 'Book', comment: 'Looks', key: ['{{char}}'], content: '{{char}} is tall and slender.' }];

        assert.deepEqual(findDefinitions(definitionTexts, lorebookEntries, ['Amy Chen'], ['Steve']), [
            { label: 'card', source: 'card', text: 'Amy has fiery red hair.' },
            { label: 'lore 1', source: 'lorebook: Book / Looks', text: 'Amy is tall and slender.' },
        ]);
    });

    it('keeps the lorebook text within 3,000 characters, skipping an entry that does not fit for one that does', () => {
        const definitionTexts = { persona: { name: 'Carrie', description: '' }, cards: [] };
        const sheetOf = (comment, length) => ({ world: 'Book', comment, key: ['Ellie'], content: 'x'.repeat(length) });
        const lorebookEntries = [sheetOf('A', 1400), sheetOf('B', 1400), sheetOf('C', 1400), sheetOf('D', 100)];

        const definitions = findDefinitions(definitionTexts, lorebookEntries, ellieNames, []);

        assert.deepEqual(definitions.map(definition => [definition.label, definition.source]), [
            ['lore 1', 'lorebook: Book / A'],
            ['lore 2', 'lorebook: Book / B'],
            ['lore 3', 'lorebook: Book / D'],
        ]);
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

    it('offers an unknown age, but not a locked gender', () => {
        const ageFinding = { kind: 'age', value: '17', at: 50, passage: 'Mateo was seventeen.' };
        const genderFinding = { kind: 'gender', value: 'male', at: 50, passage: 'Mateo was seventeen.' };
        const character = { id: 'c1', name: 'Mateo', aliases: [], details: { gender: [{ value: 'male', at: null, by: 'user' }] } };

        assert.deepEqual(listOfferedFindings(character, [genderFinding, ageFinding]), [ageFinding]);
    });

    it('does not offer an older role that holds every word of the current one: only appearance refines', () => {
        const roleFinding = { kind: 'role', value: 'cleaner, double shifts, Oakland', at: 5, passage: 'She cleaned offices in Oakland, double shifts.' };
        const character = { id: 'c1', name: 'Rosa', aliases: [], details: { role: [{ value: 'cleaner', at: 10 }] } };

        assert.deepEqual(listOfferedFindings(character, [roleFinding]), []);
    });

    it('does not offer a message value over the player\'s value saved unlocked, which is newer than every message', () => {
        const roleFinding = { kind: 'role', value: 'Ward, Sector 2', at: 3000, passage: 'Mateo, a Ward of Sector 2.' };
        const character = { id: 'c1', name: 'Mateo', aliases: [], details: { role: [{ value: 'Ward (Switchback)', at: 10 }, { value: 'Ward (Switchback), Halstead Annex', at: null, by: 'record', source: 'player' }] } };

        assert.deepEqual(listOfferedFindings(character, [roleFinding]), []);
    });

    it('does not offer a newer finding with the same value, case aside', () => {
        const character = { id: 'c1', name: 'Priya', aliases: [], details: { hair: [{ value: 'Dark Glossy Curls', at: 100 }] } };

        assert.deepEqual(listOfferedFindings(character, [hairFinding]), []);
    });

    describe('a definition is older than every message', () => {
        const personaFinding = { kind: 'hair', value: 'black layered bob', at: null, sources: ['persona'], passages: [{ source: 'persona', text: 'Ellie has a black layered bob.' }] };

        it('offers a definition finding for a kind the ledger does not know', () => {
            const character = { id: 'c2', name: 'Ellie', aliases: [], details: {} };

            assert.deepEqual(listOfferedFindings(character, [personaFinding]), [personaFinding]);
        });

        it('does not offer a definition finding over a different value the story set', () => {
            const character = { id: 'c2', name: 'Ellie', aliases: [], details: { hair: [{ value: 'magenta streaks', at: 50 }] } };

            assert.deepEqual(listOfferedFindings(character, [personaFinding]), []);
        });

        it('offers a definition finding that refines the value the story set', () => {
            const character = { id: 'c2', name: 'Ellie', aliases: [], details: { hair: [{ value: 'black', at: 50 }] } };

            assert.deepEqual(listOfferedFindings(character, [personaFinding]), [personaFinding]);
        });

        it('does not offer back an older story value a definition was accepted over', () => {
            const olderFinding = { kind: 'hair', value: 'dark', at: 50, sources: [50], passages: [{ source: 50, text: 'Ellie\'s dark hair.' }] };
            const newerFinding = { kind: 'hair', value: 'short magenta', at: 60, sources: [60], passages: [{ source: 60, text: 'Ellie had dyed it magenta.' }] };
            const character = {
                id: 'c2', name: 'Ellie', aliases: [],
                details: { hair: [{ value: 'dark', at: 50 }, { value: 'dark glossy curls', at: null, by: 'record', source: 'card' }] },
            };

            assert.deepEqual(listOfferedFindings(character, [olderFinding]), []);
            assert.deepEqual(listOfferedFindings(character, [newerFinding]), [newerFinding]);
        });

        it('offers a finding from a message over a different value a definition set', () => {
            const chatFinding = { kind: 'hair', value: 'short magenta', at: 10, passage: 'Ellie had cut her hair short and dyed it magenta.' };
            const character = { id: 'c2', name: 'Ellie', aliases: [], details: { hair: [{ value: 'long black', at: null, by: 'record', source: 'card' }] } };

            assert.deepEqual(listOfferedFindings(character, [chatFinding]), [chatFinding]);
        });
    });
});

describe('searchAppearance', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;
    let sentPrompts;

    /** A search template that shows the placeholders, and an answer queue for the call. */
    function installSearch(answers, template = '{{CHARACTER}} | {{ALIASES}}\n{{KNOWN_DETAILS}}\n{{PASSAGES}}') {
        sentPrompts = [];
        // loadTemplate keeps a template once loaded: each test's template is fetched anew
        clearTemplateCache();
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('find-appearance.txt')) {
                return new Response(template);
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
        for (const field of Object.keys(mockContextFields)) delete mockContextFields[field];
        mockSortedEntries.length = 0;
    });

    it('sends the name, aliases, known appearance and passages, and keeps the good items of an answer with a single at', async () => {
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
                { kind: 'ethnicity', value: 'Indian-American', at: 0, sources: [0], passages: [{ source: 0, text: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' }] },
                { kind: 'hair', value: 'dark glossy curls', at: 0, sources: [0], passages: [{ source: 0, text: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' }] },
                { kind: 'build', value: 'five-two', at: 2, sources: [2], passages: [{ source: 2, text: 'Priya had always been shorter, five-two to Ellie\'s five-five.' }] },
            ],
            sourceCount: 2,
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
                { kind: 'hair', value: 'dark glossy curls', at: 0, sources: [0], passages: [{ source: 0, text: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' }] },
            ],
            sourceCount: 2,
        });
    });

    it('lists every source of a combined value, at the newest message it uses', async () => {
        installSearch([JSON.stringify({ appearance: [{ kind: 'hair', value: 'dark glossy curls', sources: ['card', '[#2]', '0', 'lore 9', 7] }] })]);
        mockContextFields.characterId = '0';
        mockContextFields.characters = [{ name: 'Priya Sharma', avatar: 'priya.png', description: '{{char}} has dark hair.' }];

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, {
            findings: [{
                kind: 'hair', value: 'dark glossy curls', at: 2, sources: ['card', 0, 2],
                passages: [
                    { source: 'card', text: 'Priya Sharma has dark hair.' },
                    { source: 0, text: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' },
                    { source: 2, text: 'Priya had always been shorter, five-two to Ellie\'s five-five.' },
                ],
            }],
            sourceCount: 3,
        });
    });

    it('shows both passages of one message in its finding', async () => {
        installSearch([JSON.stringify({ appearance: [{ kind: 'hair', value: 'dark curls, shoulder length', at: 0 }] })]);
        const chatMessages = hiddenChatOf('Priya\'s dark curls bounced. Ellie laughed. Priya wore her long hair loose.');

        const result = await searchAppearance(makeLedger(), 'c1', chatMessages, 'Ellie');

        assert.deepEqual(result, {
            findings: [{
                kind: 'hair', value: 'dark curls, shoulder length', at: 0, sources: [0],
                passages: [{ source: 0, text: 'Priya\'s dark curls bounced. … Priya wore her long hair loose.' }],
            }],
            sourceCount: 2,
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
            findings: [{ kind: 'hair', value: 'short grey', at: 0, sources: [0], passages: [{ source: 0, text: 'Kendra\'s mother had short grey hair.' }] }],
            sourceCount: 2,
        });
    });

    it('reads the persona and the lorebook without a chat passage, and takes a definition\'s label as the source', async () => {
        installSearch([JSON.stringify({
            appearance: [
                { kind: 'hair', value: 'black layered bob', sources: ['persona'] },
                { kind: 'eyes', value: 'bright blue', sources: ['[Persona]'] },
                { kind: 'build', value: 'five-five', sources: ['lore 1', 'lore 2'] },
                { kind: 'skin', value: 'pale', sources: ['lore 2'] },
                { kind: 'features', value: 'freckles', sources: [0] },
                { kind: 'ethnicity', value: 'Irish', sources: ['#0', '[#7]'] },
            ],
        })], '{{CHARACTER}} | {{ALIASES}}\n{{KNOWN_DETAILS}}\n{{DEFINITIONS}}\n{{PASSAGES}}');
        mockContextFields.powerUserSettings = { persona_description: '{{user}} has a black layered bob and bright blue eyes.' };
        mockSortedEntries.push({ world: 'Paragon', comment: 'Ellie\'s sheet', key: ['Ellie'], content: 'Height: five-five', disable: false, order: 100 });
        const ledger = { characters: [{ id: 'c2', name: 'Ellie Masters', aliases: ['Ellie'] }], facts: [] };

        const result = await searchAppearance(ledger, 'c2', hiddenChatOf('Noor laughed.'), 'Ellie Masters');

        assert.deepEqual(sentPrompts, [[
            'Ellie Masters | Ellie',
            '(none)',
            '[persona] Ellie Masters has a black layered bob and bright blue eyes.',
            '[lore 1] Height: five-five',
            '(none)',
        ].join('\n')]);
        assert.deepEqual(result, {
            findings: [
                { kind: 'hair', value: 'black layered bob', at: null, sources: ['persona'], passages: [{ source: 'persona', text: 'Ellie Masters has a black layered bob and bright blue eyes.' }] },
                { kind: 'eyes', value: 'bright blue', at: null, sources: ['persona'], passages: [{ source: 'persona', text: 'Ellie Masters has a black layered bob and bright blue eyes.' }] },
                { kind: 'build', value: 'five-five', at: null, sources: ['lorebook: Paragon / Ellie\'s sheet'], passages: [{ source: 'lorebook: Paragon / Ellie\'s sheet', text: 'Height: five-five' }] },
            ],
            sourceCount: 2,
        });
    });

    it('reads the card of a group member, not a card of the same name outside the group', async () => {
        installSearch([JSON.stringify({ appearance: [{ kind: 'eyes', value: 'warm brown', sources: ['card'] }] })],
            '{{DEFINITIONS}}');
        mockContextFields.groupId = 'g1';
        mockContextFields.groups = [{ id: 'g1', members: ['priya.png', 'ellie.png'] }];
        mockContextFields.characters = [
            { name: 'Priya Sharma', avatar: 'priya-other-story.png', description: '{{char}} has grey eyes.' },
            { name: 'Priya Sharma', avatar: 'priya.png', description: '{{char}} has warm brown eyes.' },
            { name: 'Ellie', avatar: 'ellie.png', description: 'Ellie has a black bob.' },
        ];

        const result = await searchAppearance(makeLedger(), 'c1', hiddenChatOf('Ellie laughed.'), 'Steve');

        assert.deepEqual(sentPrompts, ['[card] Priya Sharma has warm brown eyes.']);
        assert.deepEqual(result, {
            findings: [{ kind: 'eyes', value: 'warm brown', at: null, sources: ['card'], passages: [{ source: 'card', text: 'Priya Sharma has warm brown eyes.' }] }],
            sourceCount: 1,
        });
    });

    it('makes no call when nothing names the character', async () => {
        installSearch([]);
        const chatMessages = hiddenChatOf('Ellie laughed.');

        const result = await searchAppearance(makeLedger(), 'c1', chatMessages, 'Ellie');

        assert.deepEqual(result, { findings: [], sourceCount: 0 });
        assert.deepEqual(sentPrompts, []);
    });

    it('sends no passage that only names the character while gender, age and role are all locked', async () => {
        installSearch([]);
        const ledger = makeLedger();
        ledger.characters[0].details.gender = [{ value: 'female', at: null, by: 'user' }];
        ledger.characters[0].details.age = [{ value: '24', at: null, by: 'user' }];
        ledger.characters[0].details.role = [{ value: 'surgeon', at: null, by: 'user' }];

        const result = await searchAppearance(ledger, 'c1', hiddenChatOf('Priya laughed.'), 'Ellie');

        assert.deepEqual(result, { findings: [], sourceCount: 0 });
        assert.deepEqual(sentPrompts, []);
    });

    it('sends no appearance passage and offers only gender, age and role while appearance is off', async () => {
        installSearch([JSON.stringify({
            details: [
                { kind: 'hair', value: 'dark glossy curls', sources: [0] },
                { kind: 'age', value: '24', sources: [1] },
            ],
        })], '{{KNOWN_DETAILS}}\n{{PASSAGES}}');
        const chatMessages = hiddenChatOf('Priya Sharma had dark glossy curls.', 'Priya turned twenty-four that spring.');

        const result = await searchAppearance(makeLedger(), 'c1', chatMessages, 'Ellie', false);

        assert.deepEqual(sentPrompts, ['(none)\n[#0] Priya Sharma had dark glossy curls.\n[#1] Priya turned twenty-four that spring.']);
        assert.deepEqual(result, {
            findings: [{ kind: 'age', value: '24', at: 1, sources: [1], passages: [{ source: 1, text: 'Priya turned twenty-four that spring.' }] }],
            sourceCount: 2,
        });
    });

    it('makes no call while appearance is off and gender, age and role are all locked', async () => {
        installSearch([]);
        const ledger = makeLedger();
        for (const kind of ['gender', 'age', 'role']) ledger.characters[0].details[kind] = [{ value: 'x', at: null, by: 'user' }];

        const result = await searchAppearance(ledger, 'c1', makeChat(), 'Ellie', false);

        assert.deepEqual(result, { error: 'Everything the search finds is locked for Priya Sharma: unlock a detail to search for it.' });
        assert.deepEqual(sentPrompts, []);
    });

    it('makes no call while appearance is on and every searched kind is locked', async () => {
        installSearch([]);
        const ledger = makeLedger();
        for (const kind of ['gender', 'age', 'role', 'ethnicity', 'skin', 'hair', 'eyes', 'build', 'features']) {
            ledger.characters[0].details[kind] = [{ value: 'x', at: null, by: 'user' }];
        }

        const result = await searchAppearance(ledger, 'c1', makeChat(), 'Ellie', true);

        assert.deepEqual(result, { error: 'Everything the search finds is locked for Priya Sharma: unlock a detail to search for it.' });
        assert.deepEqual(sentPrompts, []);
    });

    it('asks only for the kinds it can offer: no locked kind, no look while appearance is off', async () => {
        installSearch([JSON.stringify({ details: [] }), JSON.stringify({ details: [] })], '{{KIND_NAMES}}\n{{KIND_LINES}}');
        const ledger = makeLedger();
        ledger.characters[0].details.gender = [{ value: 'female', at: null, by: 'user' }];

        await searchAppearance(ledger, 'c1', makeChat(), 'Ellie', false);
        await searchAppearance(ledger, 'c1', makeChat(), 'Ellie', true);

        assert.deepEqual(sentPrompts.map(prompt => prompt.split('\n')[0]), [
            '"age" | "role"',
            '"age" | "role" | "ethnicity" | "skin" | "hair" | "eyes" | "build" | "features"',
        ]);
        assert.equal(sentPrompts[0].split('\n')[1], '- "age": as exact or as vague as the text puts it: "18", "twenty-something"');
    });

    it('sends no appearance passage while every appearance kind is locked, only the newest passages that name the character', async () => {
        installSearch([JSON.stringify({ details: [] }), JSON.stringify({ details: [] })], '{{PASSAGES}}');
        // An old look, then more newer naming sentences than the 4,000-character naming budget holds
        const newerMessages = Array.from({ length: 200 }, (_, index) => `Priya nodded at the board, beat ${index}.`);
        const chatMessages = hiddenChatOf('Priya Sharma had dark glossy curls.', ...newerMessages);
        const unlockedLedger = makeLedger();
        const lockedLedger = makeLedger();
        for (const kind of ['ethnicity', 'skin', 'hair', 'eyes', 'build', 'features']) {
            lockedLedger.characters[0].details[kind] = [{ value: 'x', at: null, by: 'user' }];
        }

        await searchAppearance(unlockedLedger, 'c1', chatMessages, 'Ellie', true);
        await searchAppearance(lockedLedger, 'c1', chatMessages, 'Ellie', true);

        assert.ok(sentPrompts[0].startsWith('[#0] Priya Sharma had dark glossy curls.\n'), 'the look goes while hair is searched');
        assert.ok(!sentPrompts[1].includes('[#0]'), 'and not while every look is locked');
        assert.ok(sentPrompts[1].endsWith('[#200] Priya nodded at the board, beat 199.'));
    });

    it('sends the newest passages that name the character for gender, age and role, and reads those kinds first', async () => {
        installSearch([JSON.stringify({
            details: [
                { kind: 'hair', value: 'dark glossy curls', sources: [0] },
                { kind: 'role', value: 'junior surgeon, Mercy General', sources: [3] },
                { kind: 'age', value: 24, sources: [1] },
                { kind: 'gender', value: 'female', sources: [3] },
            ],
        })], '{{KNOWN_DETAILS}}\n{{PASSAGES}}');
        const ledger = makeLedger();
        ledger.characters[0].details.gender = [{ value: 'woman', at: 1 }];
        const chatMessages = [
            ...hiddenChatOf('Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.', 'Priya turned twenty-four that spring.'),
            { name: 'Narrator', is_user: false, is_system: false, mes: 'Ellie laughed.' },
            { name: 'Narrator', is_user: false, is_system: false, mes: 'Priya scrubbed in. She was the junior surgeon at Mercy General.' },
        ];

        const result = await searchAppearance(ledger, 'c1', chatMessages, 'Ellie');

        assert.deepEqual(sentPrompts, [[
            '- gender: woman',
            '- eyes: brown',
            '[#0] Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.',
            '[#1] Priya turned twenty-four that spring.',
            '[#3] Priya scrubbed in. She was the junior surgeon at Mercy General.',
        ].join('\n')]);
        assert.deepEqual(result, {
            findings: [
                { kind: 'gender', value: 'female', at: 3, sources: [3], passages: [{ source: 3, text: 'Priya scrubbed in. She was the junior surgeon at Mercy General.' }] },
                { kind: 'age', value: '24', at: 1, sources: [1], passages: [{ source: 1, text: 'Priya turned twenty-four that spring.' }] },
                { kind: 'role', value: 'junior surgeon, Mercy General', at: 3, sources: [3], passages: [{ source: 3, text: 'Priya scrubbed in. She was the junior surgeon at Mercy General.' }] },
                { kind: 'hair', value: 'dark glossy curls', at: 0, sources: [0], passages: [{ source: 0, text: 'Priya Sharma was Indian-American. Her dark glossy curls framed warm brown eyes.' }] },
            ],
            sourceCount: 3,
        });
    });

    it('gives an error for an unreadable answer', async () => {
        installSearch(['I cannot help with that.']);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, { error: 'The search gave an unreadable answer. Try again.' });
    });

    it('gives an error for a failed call', async () => {
        installSearch([new Error('401 Unauthorized')]);

        const result = await searchAppearance(makeLedger(), 'c1', makeChat(), 'Ellie');

        assert.deepEqual(result, { error: 'The search failed. Try again later.' });
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
