import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { harvestContext, fetchLorebookEntries } from '../lib/context/harvester.js';
import {
    chat, chat_metadata, characters, extension_settings, mockContextFields,
    mockMacros, mockSortedEntries, setMockThisChid,
} from './mocks/st-mocks.js';

/**
 * A small stand-in for ST's macro engine, enough to show what the harvest
 * does with macros: {{user}}, local and global setvar/getvar (which write
 * where ST's variables.js writes; a global one throws without the store, as
 * in ST), and {{boom}}, which throws like a macro that fails. Every text it
 * is called with is recorded.
 */
const seenTexts = [];
function fakeSubstitute(content) {
    seenTexts.push(content);
    if (content.includes('{{boom}}')) throw new Error('macro failed');
    return content
        .replace(/\{\{user\}\}/g, 'Ellie')
        .replace(/\{\{setvar::([^:}]+)::([^}]*)\}\}/g, (_, name, value) => {
            chat_metadata.variables ??= {};
            chat_metadata.variables[name] = value;
            return '';
        })
        .replace(/\{\{getvar::([^}]+)\}\}/g, (_, name) => chat_metadata.variables?.[name] ?? '')
        .replace(/\{\{setglobalvar::([^:}]+)::([^}]*)\}\}/g, (_, name, value) => {
            extension_settings.variables.global[name] = value;
            return '';
        });
}

function constantEntry(uid, content) {
    return { uid, comment: `Entry ${uid}`, content, key: [], constant: true, disable: false, order: uid, world: 'Book' };
}

function keywordEntry(uid, content) {
    return { ...constantEntry(uid, content), key: ['keyword'], constant: false };
}

describe('harvestContext — macros (issue #89)', () => {
    beforeEach(() => {
        seenTexts.length = 0;
        mockMacros.substitute = fakeSubstitute;
        extension_settings.variables = { global: {} };
    });

    afterEach(() => {
        mockMacros.substitute = null;
        mockSortedEntries.length = 0;
        characters.length = 0;
        setMockThisChid(null);
        chat.length = 0;
        delete chat_metadata.variables;
        delete extension_settings.variables;
        delete mockContextFields.powerUserSettings;
    });

    function setCard(card) {
        characters.push({ name: 'Paragon', description: '', personality: '', scenario: '', ...card });
        setMockThisChid(0);
    }

    it('resolves the card, the persona and the lorebook entries', async () => {
        setCard({ description: '{{user}} is the narrator\'s focus.', personality: 'Protective of {{user}}.', scenario: 'A city that knows {{user}}.' });
        mockContextFields.powerUserSettings = { persona_description: '{{user}} wears a black bob.' };
        mockSortedEntries.push(constantEntry(1, '{{user}} lives in Bay City.'), keywordEntry(2, '{{user}} owes Vance money.'));

        const context = await harvestContext();

        assert.equal(context.character.name, 'Paragon');
        assert.equal(context.character.description, 'Ellie is the narrator\'s focus.');
        assert.equal(context.character.personality, 'Protective of Ellie.');
        assert.equal(context.character.scenario, 'A city that knows Ellie.');
        assert.equal(context.persona.description, 'Ellie wears a black bob.');
        assert.equal(context.lorebook.constants[0].content, 'Ellie lives in Bay City.');
        assert.equal(context.lorebook.recent[0].content, 'Ellie owes Vance money.');
    });

    it('lets a setvar in the card, the persona or a constant entry reach the texts after it', async () => {
        setCard({ description: '{{setvar::stage::teen}}A hero.' });
        mockContextFields.powerUserSettings = { persona_description: '{{setvar::home::Bay City}}Ellie, stage {{getvar::stage}}.' };
        mockSortedEntries.push(
            constantEntry(1, '{{setvar::rival::Vance}}Lives in {{getvar::home}}.'),
            keywordEntry(2, 'Stage {{getvar::stage}}, rival {{getvar::rival}}.'),
        );

        const context = await harvestContext();

        assert.equal(context.character.description, 'A hero.');
        assert.equal(context.persona.description, 'Ellie, stage teen.');
        assert.equal(context.lorebook.constants[0].content, 'Lives in Bay City.');
        assert.equal(context.lorebook.recent[0].content, 'Stage teen, rival Vance.');
    });

    it('takes a keyword entry\'s setvar back after it, so it decides nothing in a later entry', async () => {
        chat_metadata.variables = { stage: 'adult' };
        mockSortedEntries.push(
            keywordEntry(1, '{{setvar::stage::teen}}Here the stage is {{getvar::stage}}.'),
            keywordEntry(2, 'Stage {{getvar::stage}}.'),
            constantEntry(3, 'Constant stage {{getvar::stage}}.'),
        );

        const context = await harvestContext();

        assert.deepEqual(context.lorebook.recent.map(entry => entry.content), ['Here the stage is teen.', 'Stage adult.']);
        assert.equal(context.lorebook.constants[0].content, 'Constant stage adult.');
    });

    it('leaves the chat\'s and the global variables as they were, on the same objects', async () => {
        const chatVariables = { mood: 'calm' };
        const globalVariables = { season: 'winter' };
        chat_metadata.variables = chatVariables;
        extension_settings.variables = { global: globalVariables };
        mockSortedEntries.push(constantEntry(1, '{{setvar::mood::angry}}{{setvar::stage::teen}}{{setglobalvar::season::summer}}{{setglobalvar::year::1999}}Text.'));

        await harvestContext();

        assert.equal(chat_metadata.variables, chatVariables);
        assert.deepEqual(chatVariables, { mood: 'calm' });
        assert.equal(extension_settings.variables.global, globalVariables);
        assert.deepEqual(globalVariables, { season: 'winter' });
    });

    it('adds no variable store the chat did not have', async () => {
        extension_settings.variables = {};
        mockSortedEntries.push(constantEntry(1, '{{setvar::stage::teen}}Text.'));

        await harvestContext();

        assert.equal('variables' in chat_metadata, false);
        assert.deepEqual(extension_settings.variables, {});
    });

    it('keeps a text whose macros fail as written, and still resolves the others and restores the variables', async () => {
        chat_metadata.variables = { mood: 'calm' };
        mockSortedEntries.push(
            constantEntry(1, '{{setvar::mood::angry}}First.'),
            constantEntry(2, 'Broken {{boom}} for {{user}}.'),
            constantEntry(3, 'Third for {{user}}.'),
        );

        const context = await harvestContext();

        assert.deepEqual(context.lorebook.constants.map(entry => entry.content), ['First.', 'Broken {{boom}} for {{user}}.', 'Third for Ellie.']);
        assert.deepEqual(chat_metadata.variables, { mood: 'calm' });
    });

    it('keeps a card field whose macros fail as written', async () => {
        setCard({ description: 'Broken {{boom}}.', personality: 'Kind to {{user}}.' });

        const context = await harvestContext();

        assert.equal(context.character.description, 'Broken {{boom}}.');
        assert.equal(context.character.personality, 'Kind to Ellie.');
    });

    it('never resolves the chat messages', async () => {
        chat.push({ is_user: true, name: 'Ellie', mes: 'I typed {{user}} by hand.' });

        const context = await harvestContext();

        assert.deepEqual(context.chatHistory.map(message => message.content), ['I typed {{user}} by hand.']);
        assert.equal(seenTexts.includes('I typed {{user}} by hand.'), false);
    });

    it('never evaluates an entry the player excluded', async () => {
        mockSortedEntries.push(constantEntry(1, 'Kept for {{user}}.'), constantEntry(2, 'Excluded {{setvar::x::1}}.'));

        const context = await harvestContext(50, new Set(['2']));

        assert.deepEqual(context.lorebook.constants.map(entry => entry.content), ['Kept for Ellie.']);
        assert.equal(seenTexts.includes('Excluded {{setvar::x::1}}.'), false);
    });

    it('does not change the entries ST hands out', async () => {
        const stEntry = constantEntry(1, '{{user}} lives in Bay City.');
        mockSortedEntries.push(stEntry);

        await harvestContext();

        assert.equal(stEntry.content, '{{user}} lives in Bay City.');
    });
});

describe('fetchLorebookEntries — macros (issue #89)', () => {
    afterEach(() => {
        mockMacros.substitute = null;
        mockSortedEntries.length = 0;
    });

    it('gives the other readers (state seed, appearance search) the entries as written, evaluating nothing', async () => {
        seenTexts.length = 0;
        mockMacros.substitute = fakeSubstitute;
        mockSortedEntries.push(constantEntry(1, '{{setvar::stage::teen}}For {{user}}.'));

        const entries = await fetchLorebookEntries();

        assert.equal(entries[0].content, '{{setvar::stage::teen}}For {{user}}.');
        assert.deepEqual(seenTexts, []);
    });
});
