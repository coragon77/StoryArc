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
 * where ST's variables.js writes), and {{boom}}, which throws like a macro
 * that fails. Every text it is called with is recorded.
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
            extension_settings.variables ??= {};
            extension_settings.variables.global ??= {};
            extension_settings.variables.global[name] = value;
            return '';
        });
}

function entry(uid, content, extra = {}) {
    return { uid, comment: `Entry ${uid}`, content, key: [], constant: true, disable: false, order: uid, world: 'Book', ...extra };
}

describe('harvestContext — macros (issue #89)', () => {
    beforeEach(() => {
        seenTexts.length = 0;
        mockMacros.substitute = fakeSubstitute;
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
        characters.push({ name: 'Paragon', ...card });
        setMockThisChid(0);
    }

    it('resolves the card, the persona and the lorebook entries', async () => {
        setCard({ description: '{{user}} is the narrator\'s focus.', personality: 'Protective of {{user}}.', scenario: 'A city that knows {{user}}.' });
        mockContextFields.powerUserSettings = { persona_description: '{{user}} wears a black bob.' };
        mockSortedEntries.push(entry(1, '{{user}} lives in Bay City.'));

        const context = await harvestContext();

        assert.equal(context.character.description, 'Ellie is the narrator\'s focus.');
        assert.equal(context.character.personality, 'Protective of Ellie.');
        assert.equal(context.character.scenario, 'A city that knows Ellie.');
        assert.equal(context.persona.description, 'Ellie wears a black bob.');
        assert.equal(context.lorebook.constants[0].content, 'Ellie lives in Bay City.');
    });

    it('lets a setvar earlier in the harvest reach a getvar later in it', async () => {
        setCard({ description: '{{setvar::stage::teen}}A hero.', personality: '', scenario: '' });
        mockSortedEntries.push(entry(1, 'Life stage: {{getvar::stage}}.'));

        const context = await harvestContext();

        assert.equal(context.character.description, 'A hero.');
        assert.equal(context.lorebook.constants[0].content, 'Life stage: teen.');
    });

    it('leaves the chat\'s and the global variables as they were before the harvest', async () => {
        chat_metadata.variables = { mood: 'calm' };
        extension_settings.variables = { global: { season: 'winter' } };
        mockSortedEntries.push(entry(1, '{{setvar::mood::angry}}{{setvar::stage::teen}}{{setglobalvar::season::summer}}Text.'));

        await harvestContext();

        assert.deepEqual(chat_metadata.variables, { mood: 'calm' });
        assert.deepEqual(extension_settings.variables, { global: { season: 'winter' } });
    });

    it('adds no variable stores a chat did not have', async () => {
        mockSortedEntries.push(entry(1, '{{setvar::stage::teen}}{{setglobalvar::season::summer}}Text.'));

        await harvestContext();

        assert.equal('variables' in chat_metadata, false);
        assert.equal('variables' in extension_settings, false);
    });

    it('keeps a text whose macros fail as written, and still resolves the others and restores the variables', async () => {
        chat_metadata.variables = { mood: 'calm' };
        mockSortedEntries.push(
            entry(1, '{{setvar::mood::angry}}First.'),
            entry(2, 'Broken {{boom}} for {{user}}.'),
            entry(3, 'Third for {{user}}.'),
        );

        const context = await harvestContext();

        assert.deepEqual(context.lorebook.constants.map(e => e.content), ['First.', 'Broken {{boom}} for {{user}}.', 'Third for Ellie.']);
        assert.deepEqual(chat_metadata.variables, { mood: 'calm' });
    });

    it('never resolves the chat messages', async () => {
        chat.push({ is_user: true, name: 'Ellie', mes: 'I typed {{user}} by hand.' });

        const context = await harvestContext();

        assert.deepEqual(context.chatHistory.map(message => message.content), ['I typed {{user}} by hand.']);
        assert.equal(seenTexts.includes('I typed {{user}} by hand.'), false);
    });

    it('never evaluates an entry the player excluded', async () => {
        mockSortedEntries.push(entry(1, 'Kept for {{user}}.'), entry(2, 'Excluded {{setvar::x::1}}.'));

        const context = await harvestContext(50, new Set(['2']));

        assert.deepEqual(context.lorebook.constants.map(e => e.content), ['Kept for Ellie.']);
        assert.equal(seenTexts.includes('Excluded {{setvar::x::1}}.'), false);
    });

    it('does not change the entries ST hands out', async () => {
        const stEntry = entry(1, '{{user}} lives in Bay City.');
        mockSortedEntries.push(stEntry);

        await harvestContext();

        assert.equal(stEntry.content, '{{user}} lives in Bay City.');
    });
});

describe('fetchLorebookEntries — macros (issue #89)', () => {
    afterEach(() => {
        mockMacros.substitute = null;
        mockSortedEntries.length = 0;
        delete chat_metadata.variables;
    });

    it('gives the other readers (the state seed) resolved entries and restores the variables', async () => {
        mockMacros.substitute = fakeSubstitute;
        chat_metadata.variables = { stage: 'adult' };
        mockSortedEntries.push(entry(1, '{{setvar::stage::teen}}Stage {{getvar::stage}} for {{user}}.'));

        const entries = await fetchLorebookEntries();

        assert.equal(entries[0].content, 'Stage teen for Ellie.');
        assert.deepEqual(chat_metadata.variables, { stage: 'adult' });
    });
});
