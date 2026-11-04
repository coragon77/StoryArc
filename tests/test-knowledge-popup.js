import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    addCharacter,
    addFact,
    addFactHolder,
    buildKnowledgeContent,
    deleteFact,
    editFactText,
    keepCharacterName,
    removeFactHolder,
    renameCharacter,
    setCharacterAliases,
    setFactPublic,
} from '../lib/ui/knowledge-popup.js';

/** Noor and Gabriel, one fact Gabriel witnessed at message 2063. */
function makeLedger() {
    return {
        characters: [
            { id: 'noor', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
        ],
        facts: [
            {
                id: 'titanium',
                text: 'Noor should lock the gauntlet on with titanium latches',
                public: false,
                holders: [{ characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 }],
            },
        ],
        scene: { at: 2063, present: ['gabriel'] },
        lastUpdatedAt: 2063,
    };
}

describe('addFact', () => {
    it('stores a fact whose holders are user-entered', () => {
        const { ledger, error } = addFact(makeLedger(), {
            id: 'suit',
            text: '  Noor tunes Aegis\'s suit ',
            holderIds: ['noor', 'gabriel'],
        });

        assert.equal(error, null);
        assert.deepEqual(ledger.facts[1], {
            id: 'suit',
            text: 'Noor tunes Aegis\'s suit',
            public: false,
            holders: [
                { characterId: 'noor', how: 'user', toldBy: null, at: null },
                { characterId: 'gabriel', how: 'user', toldBy: null, at: null },
            ],
        });
        assert.equal(ledger.facts.length, 2);
    });

    it('leaves the ledger it was given untouched', () => {
        const before = makeLedger();
        addFact(before, { id: 'suit', text: 'Noor tunes Aegis\'s suit', holderIds: ['noor'] });
        assert.deepEqual(before, makeLedger());
    });

    it('refuses a blank text', () => {
        const { ledger, error } = addFact(makeLedger(), { id: 'blank', text: '   ', holderIds: ['noor'] });
        assert.equal(ledger, null);
        assert.equal(error, 'A fact needs a text.');
    });

    it('ignores holder ids that name no character, and duplicates', () => {
        const { ledger } = addFact(makeLedger(), { id: 'suit', text: 'Noor tunes Aegis\'s suit', holderIds: ['noor', 'dougal', 'noor'] });
        assert.deepEqual(ledger.facts[1].holders, [{ characterId: 'noor', how: 'user', toldBy: null, at: null }]);
    });
});

describe('addFactHolder', () => {
    it('adds the character as a user-entered holder', () => {
        const { ledger, error } = addFactHolder(makeLedger(), 'titanium', 'noor');
        assert.equal(error, null);
        assert.deepEqual(ledger.facts[0].holders, [
            { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
            { characterId: 'noor', how: 'user', toldBy: null, at: null },
        ]);
    });

    it('keeps the entry of a character who already holds the fact', () => {
        const { ledger } = addFactHolder(makeLedger(), 'titanium', 'gabriel');
        assert.deepEqual(ledger.facts[0].holders, [
            { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
        ]);
    });

    it('refuses an unknown fact or character', () => {
        assert.equal(addFactHolder(makeLedger(), 'missing', 'noor').error, 'This fact is no longer in the ledger.');
        assert.equal(addFactHolder(makeLedger(), 'titanium', 'dougal').error, 'This character is no longer in the ledger.');
    });
});

describe('removeFactHolder', () => {
    it('removes every entry of the character and keeps the fact', () => {
        const before = makeLedger();
        before.facts[0].holders.push(
            { characterId: 'noor', how: 'told', toldBy: 'gabriel', at: 2070 },
            { characterId: 'noor', how: 'user', toldBy: null, at: null },
        );
        const { ledger, error } = removeFactHolder(before, 'titanium', 'noor');
        assert.equal(error, null);
        assert.deepEqual(ledger.facts[0], {
            id: 'titanium',
            text: 'Noor should lock the gauntlet on with titanium latches',
            public: false,
            holders: [{ characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 }],
        });
    });

    it('leaves a fact without holders in the ledger', () => {
        const { ledger } = removeFactHolder(makeLedger(), 'titanium', 'gabriel');
        assert.deepEqual(ledger.facts[0].holders, []);
        assert.equal(ledger.facts.length, 1);
    });
});

describe('editFactText', () => {
    it('replaces the text and keeps the holders as they are', () => {
        const { ledger, error } = editFactText(makeLedger(), 'titanium', ' Noor should use titanium shear-pins ');
        assert.equal(error, null);
        assert.deepEqual(ledger.facts[0], {
            id: 'titanium',
            text: 'Noor should use titanium shear-pins',
            public: false,
            holders: [{ characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 }],
        });
    });

    it('refuses a blank text', () => {
        const { ledger, error } = editFactText(makeLedger(), 'titanium', '  ');
        assert.equal(ledger, null);
        assert.equal(error, 'A fact needs a text.');
    });
});

describe('deleteFact', () => {
    it('removes the fact with its holders', () => {
        const { ledger, error } = deleteFact(makeLedger(), 'titanium');
        assert.equal(error, null);
        assert.deepEqual(ledger.facts, []);
        assert.deepEqual(ledger.characters, makeLedger().characters);
    });
});

describe('setFactPublic', () => {
    it('marks a fact public and back', () => {
        const { ledger } = setFactPublic(makeLedger(), 'titanium', true);
        assert.deepEqual(ledger.facts[0], {
            id: 'titanium',
            text: 'Noor should lock the gauntlet on with titanium latches',
            public: true,
            holders: [{ characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 }],
        });
        assert.equal(setFactPublic(ledger, 'titanium', false).ledger.facts[0].public, false);
    });
});

describe('addCharacter', () => {
    it('adds a character with trimmed name and aliases', () => {
        const { ledger, error } = addCharacter(makeLedger(), { id: 'dougal', name: ' Dougal ', aliases: [' Dougal MacRae', '', 'Dougal MacRae'] });
        assert.equal(error, null);
        assert.deepEqual(ledger.characters, [
            { id: 'noor', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
            { id: 'dougal', name: 'Dougal', aliases: ['Dougal MacRae'] },
        ]);
    });

    it('refuses a blank name', () => {
        assert.equal(addCharacter(makeLedger(), { id: 'blank', name: ' ', aliases: [] }).error, 'A character needs a name.');
    });

    it('refuses a name another character already goes by', () => {
        const { ledger, error } = addCharacter(makeLedger(), { id: 'other', name: 'aegis', aliases: [] });
        assert.equal(ledger, null);
        assert.equal(error, '"aegis" is already a name of Gabriel Marin.');
    });
});

describe('renameCharacter', () => {
    it('changes the name and keeps id and aliases', () => {
        const { ledger, error } = renameCharacter(makeLedger(), 'noor', 'Noor Al-Jamil');
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0], { id: 'noor', name: 'Noor Al-Jamil', aliases: ['Noor'] });
    });

    it('refuses a blank name or one of another character', () => {
        assert.equal(renameCharacter(makeLedger(), 'noor', '').error, 'A character needs a name.');
        assert.equal(renameCharacter(makeLedger(), 'noor', 'Mr. Marin').error, '"Mr. Marin" is already a name of Gabriel Marin.');
    });

    it('refuses an unknown character', () => {
        assert.equal(renameCharacter(makeLedger(), 'dougal', 'Dougal').error, 'This character is no longer in the ledger.');
    });
});

describe('setCharacterAliases', () => {
    it('replaces the aliases, trimmed, without blanks or repeats', () => {
        const { ledger, error } = setCharacterAliases(makeLedger(), 'gabriel', [' Aegis', 'Gabe ', '', 'gabe']);
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1], { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Gabe'] });
    });

    it('refuses an alias another character goes by', () => {
        const { ledger, error } = setCharacterAliases(makeLedger(), 'gabriel', ['Aegis', 'noor']);
        assert.equal(ledger, null);
        assert.equal(error, '"noor" is already a name of Noor al-Jamil.');
    });
});

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The markup of the fact row with this id. */
function factRowOf(html, factId) {
    return html.split('<li ').find(chunk => chunk.includes(`data-fact-id="${factId}"`)) || '';
}

describe('buildKnowledgeContent', () => {
    it('starts with both spoiler toggles closed', () => {
        const html = buildKnowledgeContent(makeLedger());
        const contentTags = html.match(/<div class="story-arc-spoiler-content[^"]*"/g);
        assert.deepEqual(contentTags, [
            '<div class="story-arc-spoiler-content"',
            '<div class="story-arc-spoiler-content"',
        ]);
        assert.equal(html.match(/class="story-arc-spoiler-toggle"/g).length, 2);
        assert.ok(textOf(html).includes('Characters (2)'));
        assert.ok(textOf(html).includes('Facts (1)'));
    });

    it('shows each fact with its holders and how they learned it', () => {
        const ledger = makeLedger();
        ledger.facts.push({
            id: 'suit',
            text: 'Noor tunes <Aegis>\'s suit',
            public: true,
            holders: [
                { characterId: 'noor', how: 'told', toldBy: 'gabriel', at: 2070 },
                { characterId: 'gabriel', how: 'user', toldBy: null, at: null },
            ],
        });
        const html = buildKnowledgeContent(ledger);

        assert.ok(factRowOf(html, 'suit').includes('Noor tunes &lt;Aegis&gt;&#39;s suit'));
        assert.ok(textOf(factRowOf(html, 'suit')).includes('public Noor al-Jamil (told by Gabriel Marin) × Gabriel Marin (entered by you) ×'));
        assert.ok(textOf(factRowOf(html, 'titanium')).includes('Gabriel Marin (witnessed) ×'));
    });

    it('shows each character with their aliases', () => {
        const text = textOf(buildKnowledgeContent(makeLedger()));
        assert.ok(text.includes('Gabriel Marin also: Aegis, Mr. Marin'));
    });
});

/** Solomon Stern and Vera Chen, and Julian Stern, added at message 12 with a name Solomon has. */
function makeFlaggedLedger() {
    return {
        characters: [
            { id: 'solomon', name: 'Solomon Stern', aliases: ['Sol'] },
            { id: 'vera', name: 'Vera Chen', aliases: [] },
            {
                id: 'julian',
                name: 'Julian Stern',
                aliases: [],
                nameClash: { names: ['Stern'], at: 12, messageId: 'msg-julian' },
            },
        ],
        facts: [
            {
                id: 'vault',
                text: 'The vault code is 4471',
                public: false,
                holders: [{ characterId: 'solomon', how: 'witnessed', toldBy: null, at: 10 }],
            },
        ],
        scene: { at: 12, present: ['solomon', 'julian'] },
        lastUpdatedAt: 12,
    };
}

/** The markup of the "Names to check" section, or '' when there is none. */
function namesToCheckOf(html) {
    const start = html.indexOf('id="story-arc-knowledge-names"');
    if (start === -1) return '';
    const end = html.indexOf('story-arc-spoiler-group', start);
    return html.slice(start, end);
}

describe('buildKnowledgeContent: names to check', () => {
    it('lists the flagged character, the shared name, who has it now and the message, before the spoiler groups', () => {
        const html = buildKnowledgeContent(makeFlaggedLedger(), []);

        const sectionStart = html.indexOf('id="story-arc-knowledge-names"');
        assert.ok(sectionStart !== -1);
        assert.ok(sectionStart < html.indexOf('story-arc-spoiler-group'));
        const text = textOf(namesToCheckOf(html));
        assert.ok(text.includes('Names to check'));
        assert.ok(text.includes('Rename here first, then edit the chat text'));
        assert.ok(text.includes('Julian Stern'));
        assert.ok(text.includes('"Stern" is also a name of Solomon Stern'));
        assert.ok(text.includes('named in message #12'));
        assert.ok(text.includes('Rename'));
        assert.ok(text.includes('Keep the name'));
    });

    it('shows no fact and no other character in the section', () => {
        const text = textOf(namesToCheckOf(buildKnowledgeContent(makeFlaggedLedger(), [])));
        assert.ok(!text.includes('vault'));
        assert.ok(!text.includes('Vera'));
    });

    it('has no section when nothing is flagged', () => {
        const html = buildKnowledgeContent(makeLedger(), []);
        assert.ok(!html.includes('story-arc-knowledge-names'));
        assert.ok(!textOf(html).includes('Names to check'));
    });

    it('escapes the names', () => {
        const ledger = makeFlaggedLedger();
        ledger.characters[0].name = 'Solomon <Stern>';
        ledger.characters[2].name = 'Julian & Stern';
        const section = namesToCheckOf(buildKnowledgeContent(ledger, []));
        assert.ok(section.includes('Solomon &lt;Stern&gt;'));
        assert.ok(section.includes('Julian &amp; Stern'));
        assert.ok(!section.includes('<Stern>'));
    });

    it('lists every character who has the shared name now, and not a stored name nobody has any more', () => {
        const ledger = makeFlaggedLedger();
        ledger.characters.push({ id: 'ava', name: 'Ava Stern', aliases: [] });
        ledger.characters[2].nameClash.names = ['Stern', 'Julian'];
        const text = textOf(namesToCheckOf(buildKnowledgeContent(ledger, [])));
        assert.ok(text.includes('"Stern" is also a name of Solomon Stern and Ava Stern'));
        assert.ok(!text.includes('"Julian"'));
    });

    it('says the clash is gone when no one else has a shared name, and offers only to clear the flag', () => {
        const ledger = makeFlaggedLedger();
        ledger.characters[0].name = 'Solomon Vance';
        const section = namesToCheckOf(buildKnowledgeContent(ledger, []));
        const text = textOf(section);
        assert.ok(text.includes('Julian Stern'));
        assert.ok(text.includes('No other character has this name any more: the clash is gone.'));
        assert.ok(text.includes('Clear the flag'));
        assert.ok(!section.includes('story-arc-name-rename-btn'));
        assert.ok(!text.includes('Keep the name'));
        assert.ok(!text.includes('is also a name of'));
    });

    it('shows the message where it is now, found by its message id', () => {
        const chatMessages = [];
        for (let index = 0; index < 10; index++) chatMessages.push({ mes: `message ${index}`, extra: {} });
        chatMessages[9].extra.story_arc_message_id = 'msg-julian';
        const text = textOf(namesToCheckOf(buildKnowledgeContent(makeFlaggedLedger(), chatMessages)));
        assert.ok(text.includes('named in message #9'));
        assert.ok(!text.includes('#12'));
    });

    it('shows the stored message index when the message is no longer in the chat', () => {
        const chatMessages = [{ mes: 'hello', extra: { story_arc_message_id: 'msg-other' } }];
        const text = textOf(namesToCheckOf(buildKnowledgeContent(makeFlaggedLedger(), chatMessages)));
        assert.ok(text.includes('named in message #12'));
    });

    it('marks the flagged row in the Characters group, and only that row', () => {
        const html = buildKnowledgeContent(makeFlaggedLedger(), []);
        const charactersGroup = html.slice(html.indexOf('id="story-arc-knowledge-characters"'), html.indexOf('id="story-arc-knowledge-facts"'));
        const rows = charactersGroup.split('<li ').slice(1);
        const julianRow = rows.find(row => row.includes('data-character-id="julian"'));
        const solomonRow = rows.find(row => row.includes('data-character-id="solomon"'));
        assert.ok(textOf(julianRow).includes('Julian Stern name to check'));
        assert.ok(!textOf(solomonRow).includes('name to check'));
    });
});

describe('keepCharacterName', () => {
    it('removes the flag and keeps the name, the aliases and the other characters', () => {
        const { ledger, error } = keepCharacterName(makeFlaggedLedger(), 'julian');
        assert.equal(error, null);
        assert.deepEqual(ledger.characters, [
            { id: 'solomon', name: 'Solomon Stern', aliases: ['Sol'] },
            { id: 'vera', name: 'Vera Chen', aliases: [] },
            { id: 'julian', name: 'Julian Stern', aliases: [] },
        ]);
    });

    it('leaves the ledger it was given untouched', () => {
        const before = makeFlaggedLedger();
        keepCharacterName(before, 'julian');
        assert.deepEqual(before, makeFlaggedLedger());
    });

    it('refuses an unknown character', () => {
        assert.equal(keepCharacterName(makeFlaggedLedger(), 'dougal').error, 'This character is no longer in the ledger.');
    });
});
