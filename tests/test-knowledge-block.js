import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeBlock } from '../lib/knowledge/ledger.js';
import { createEmptyKnowledgeLedger } from '../lib/core/constants.js';

const HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]';

/** The workshop scene of the spec's appendix, cut down to five facts. */
function makeWorkshopLedger() {
    return {
        characters: [
            { id: 'noor', name: 'Noor', aliases: ['Al-Jamil'] },
            { id: 'dougal', name: 'Dougal', aliases: [] },
            { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
            { id: 'ellie', name: 'Ellie', aliases: ['Dice'] },
        ],
        facts: [
            {
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at: 100 }],
            },
            {
                id: 'f2', text: 'Gabriel Marin is Aegis', public: false,
                holders: [
                    { characterId: 'noor', how: 'user', toldBy: null, at: null },
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2000 },
                ],
            },
            {
                id: 'f3', text: 'Vera Lin broke into the Annex last night', public: false,
                holders: [
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2050 },
                    { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 2050 },
                ],
            },
            {
                id: 'f4', text: 'Noor should lock the gauntlet on with titanium latches', public: false,
                holders: [
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
                    { characterId: 'ellie', how: 'told', toldBy: 'gabriel', at: 2063 },
                ],
            },
            {
                id: 'f5', text: 'the kiln router logged 42.08 kHz queries overnight', public: false,
                holders: [{ characterId: 'dougal', how: 'witnessed', toldBy: null, at: 2070 }],
            },
        ],
        scene: { at: 2078, present: ['noor', 'dougal'] },
        lastUpdatedAt: 2078,
    };
}

function message(isUser, text) {
    return { is_user: isUser, is_system: false, name: isUser ? 'Ellie' : 'Narrator', mes: text };
}

describe('buildKnowledgeBlock', () => {
    it('gives an empty string for an empty ledger', () => {
        assert.equal(buildKnowledgeBlock(createEmptyKnowledgeLedger(), []), '');
    });

    it('covers the characters present and the one the latest message names, in the card format', () => {
        const messages = [
            message(false, 'Noor looks up from the bench. Dougal is out back.'),
            message(true, 'I drop my bag on the bench. "Gabriel Marin says hi."'),
        ];

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: Gabriel Marin is Aegis (shared only with Gabriel Marin)',
            '- Knows: Ellie is Dice (known only to them)',
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight (known only to them)',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Knows: Noor should lock the gauntlet on with titanium latches (shared only with Ellie)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Ellie)',
            '- Knows: Gabriel Marin is Aegis (shared only with Noor)',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(makeWorkshopLedger(), messages), expected);
    });

    it('covers a character the latest reply names only by an alias', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['noor'];
        const messages = [
            message(true, 'I wave at Noor.'),
            message(false, 'Somewhere above the workshop, Aegis lands on the roof.'),
        ];

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: Gabriel Marin is Aegis (shared only with Gabriel Marin)',
            '- Knows: Ellie is Dice (known only to them)',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Knows: Noor should lock the gauntlet on with titanium latches (shared only with Ellie)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Ellie)',
            '- Knows: Gabriel Marin is Aegis (shared only with Noor)',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, messages), expected);
    });

    it('says who told a character what they know', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['ellie'];

        const expected = [
            HEADER,
            '',
            'ELLIE (present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches (shared only with Gabriel Marin)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Gabriel Marin)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, [message(true, 'I head to the workshop.')]), expected);
    });

    it('prints a public fact under EVERYONE KNOWS and a fact held only through the plan nowhere', () => {
        const ledger = {
            characters: [
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'julian', name: 'Julian', aliases: [] },
            ],
            facts: [
                {
                    id: 'promo', text: 'Overdrive unravels synthetic suits', public: true,
                    holders: [
                        { characterId: 'noor', how: 'public', toldBy: null, at: 1990 },
                        { characterId: 'julian', how: 'public', toldBy: null, at: 1990 },
                    ],
                },
                {
                    id: 'crane', text: 'Julian plans to drop a crane on the arena', public: false,
                    holders: [{ characterId: 'julian', how: 'plan', toldBy: null, at: null }],
                },
                {
                    id: 'window', text: 'the kiln-room window was broken overnight', public: false,
                    holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at: 2075 }],
                },
            ],
            scene: { at: 2078, present: ['noor', 'julian'] },
            lastUpdatedAt: 2078,
        };

        const expected = [
            HEADER,
            '',
            'EVERYONE KNOWS',
            '- Overdrive unravels synthetic suits',
            '',
            'NOOR (present)',
            '- Knows: the kiln-room window was broken overnight (known only to them)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('keeps the five newest entries of a list longer than its cap, and gives a character with no line no section', () => {
        const facts = [];
        for (let at = 1; at <= 7; at++) {
            facts.push({
                id: `f${at}`, text: `fact ${at}`, public: false,
                holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at }],
            });
        }
        const ledger = {
            characters: [
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'dougal', name: 'Dougal', aliases: [] },
            ],
            facts,
            scene: { at: 7, present: ['noor', 'dougal'] },
            lastUpdatedAt: 7,
        };

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: fact 7 (known only to them)',
            '- Knows: fact 6 (known only to them)',
            '- Knows: fact 5 (known only to them)',
            '- Knows: fact 4 (known only to them)',
            '- Knows: fact 3 (known only to them)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('shows the public fact, the shared private facts and a talked-about holder, each private fact once per holder', () => {
        const ledger = {
            characters: [
                { id: 'steve', name: 'Steve', aliases: [] },
                { id: 'amy', name: 'Amy', aliases: [] },
                { id: 'lena', name: 'Lena', aliases: [] },
            ],
            facts: [
                {
                    id: 'f1', text: 'Steve is quitting next month', public: false,
                    holders: [
                        { characterId: 'steve', how: 'witnessed', toldBy: null, at: 10 },
                        { characterId: 'amy', how: 'told', toldBy: 'steve', at: 12 },
                    ],
                },
                {
                    id: 'f2', text: 'Steve\'s team won the Best Live Demo award', public: true,
                    holders: [
                        { characterId: 'steve', how: 'public', toldBy: null, at: 8 },
                        { characterId: 'amy', how: 'public', toldBy: null, at: 8 },
                    ],
                },
                {
                    id: 'f3', text: 'The demo ran on a scripted fallback', public: false,
                    holders: [
                        { characterId: 'lena', how: 'witnessed', toldBy: null, at: 5 },
                        { characterId: 'steve', how: 'witnessed', toldBy: null, at: 5 },
                        { characterId: 'amy', how: 'witnessed', toldBy: null, at: 5 },
                    ],
                },
            ],
            scene: { at: 12, present: ['steve', 'amy'] },
            lastUpdatedAt: 12,
        };
        const messages = [message(true, 'I ask Steve how Lena is doing.')];

        const expected = [
            HEADER,
            '',
            'EVERYONE KNOWS',
            '- Steve\'s team won the Best Live Demo award',
            '',
            'STEVE (present)',
            '- Knows: Steve is quitting next month (shared only with Amy)',
            '- Knows: The demo ran on a scripted fallback (shared only with Lena and Amy)',
            '',
            'AMY (present)',
            '- Knows (told by Steve): Steve is quitting next month (shared only with Steve)',
            '- Knows: The demo ran on a scripted fallback (shared only with Lena and Steve)',
            '',
            'LENA (talked about, not present)',
            '- Knows: The demo ran on a scripted fallback (shared only with Steve and Amy)',
        ].join('\n');

        const block = buildKnowledgeBlock(ledger, messages);
        assert.equal(block, expected);
        assert.equal(block.split('The demo ran on a scripted fallback').length - 1, 3);
        assert.equal(block.split('Steve is quitting next month').length - 1, 2);
    });

    it('names a planned holder among those a fact is shared with, never with a section of their own', () => {
        const ledger = {
            characters: [
                { id: 'ellie', name: 'Ellie', aliases: [] },
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'julian', name: 'Julian', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'Julian means to bring the crane down tonight', public: false,
                holders: [
                    { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 20 },
                    { characterId: 'julian', how: 'plan', toldBy: null, at: 20 },
                    { characterId: 'noor', how: 'told', toldBy: 'ellie', at: 21 },
                ],
            }],
            scene: { at: 21, present: ['ellie', 'julian'] },
            lastUpdatedAt: 21,
        };

        const expected = [
            HEADER,
            '',
            'ELLIE (present)',
            '- Knows: Julian means to bring the crane down tonight (shared only with Julian and Noor)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('prints only the public facts when no character has a line, newest first, undated ones after in ledger order, capped', () => {
        const publicFact = (id, holders) => ({ id, text: `public ${id}`, public: true, holders });
        const ledger = {
            characters: [{ id: 'noor', name: 'Noor', aliases: [] }],
            facts: [
                publicFact('a', [{ characterId: 'noor', how: 'public', toldBy: null, at: 10 }]),
                publicFact('b', []),
                publicFact('c', [{ characterId: 'noor', how: 'public', toldBy: null, at: 30 }]),
                publicFact('d', []),
                publicFact('e', [{ characterId: 'noor', how: 'user', toldBy: null, at: null }]),
                publicFact('g', []),
            ],
            scene: { at: 30, present: [] },
            lastUpdatedAt: 30,
        };

        const expected = [
            HEADER,
            '',
            'EVERYONE KNOWS',
            '- public e',
            '- public c',
            '- public a',
            '- public b',
            '- public d',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('gives no section to a character named only inside a status tag of the reply', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['dougal'];
        const messages = [
            message(true, 'I wait by the door.'),
            message(false, 'The workshop is quiet.\n<svt><bg>Gabriel Marin: <i>on patrol</i></bg>\n<bg>Noor: asleep</bg></svt>\n<trk>Ellie</trk>'),
        ];

        const expected = [
            HEADER,
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight (known only to them)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, messages), expected);
    });

    it('still counts a name in the story text outside the tags', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['dougal'];
        const messages = [
            message(true, 'I wait by the door.'),
            message(false, '<svt><bg>Noor: asleep</bg></svt>Ellie walks in.<trk>scene 4</trk>'),
        ];

        const expected = [
            HEADER,
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight (known only to them)',
            '',
            'ELLIE (talked about, not present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches (shared only with Gabriel Marin)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Gabriel Marin)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, messages), expected);
    });

    it('still counts a name inside inline formatting tags', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['dougal'];
        const messages = [
            message(true, 'I wait by the door.'),
            message(false, 'Dougal mutters, <i>where is <b>Ellie</b></i>?\n<svt><bg>Noor: asleep</bg></svt>'),
        ];

        const expected = [
            HEADER,
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight (known only to them)',
            '',
            'ELLIE (talked about, not present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches (shared only with Gabriel Marin)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Gabriel Marin)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, messages), expected);
    });

    describe('which tagged text decides who is talked about', () => {
        const withoutEllie = [
            HEADER,
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight (known only to them)',
        ].join('\n');
        const withEllie = [
            withoutEllie,
            '',
            'ELLIE (talked about, not present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches (shared only with Gabriel Marin)',
            '- Knows: Vera Lin broke into the Annex last night (shared only with Gabriel Marin)',
        ].join('\n');
        const blockFor = (userText, replyText) => {
            const ledger = makeWorkshopLedger();
            ledger.scene.present = ['dougal'];
            return buildKnowledgeBlock(ledger, [message(true, userText), message(false, replyText)]);
        };

        it('reads each message on its own, so a tag cannot close across them', () => {
            assert.equal(blockFor('I check <note> the board', 'Ellie waves. </note>'), withEllie);
        });

        it('keeps the text inside HTML paragraph and link tags', () => {
            assert.equal(blockFor('I wait.', '<p>Dougal nods.</p><p><a href="#">Ellie</a> walks in.</p>'), withEllie);
        });

        it('drops a status block the length limit cut off before its closing tag', () => {
            assert.equal(blockFor('I wait.', 'The workshop is quiet.\n<svt><bg>Ellie: asleep'), withoutEllie);
        });

        it('drops a status block whose closing tag is written in other case', () => {
            assert.equal(blockFor('I wait.', 'The workshop is quiet.\n<SVT>Ellie: asleep</svt>'), withoutEllie);
        });

        it('keeps two names apart that sit in neighbouring paragraphs', () => {
            assert.equal(blockFor('I wait.', '<p>Dougal</p><p>Ellie</p>'), withEllie);
        });
    });

    it('gives an empty string when no character is present or talked about', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = [];
        const messages = [message(true, 'I head out.'), message(false, 'The street is empty.')];

        assert.equal(buildKnowledgeBlock(ledger, messages), '');
    });
});
