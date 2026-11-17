import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeBlock } from '../lib/knowledge/ledger.js';
import { createEmptyKnowledgeLedger } from '../lib/core/constants.js';

const HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each fact line names everyone who knows that fact; a character knows only the facts that name them, '
    + 'what everyone knows, and what happened in front of them on-screen. '
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
const HEADER_WITH_MEETINGS = `${HEADER.slice(0, -1)} `
    + 'A character knows the face, looks and voice only of someone they have met: '
    + 'a name on their Has met line, or someone the story put in front of them on-screen. Hearing a name is not meeting.]';

/** The workshop block with Dougal present and nobody talked about. */
const DOUGAL_ALONE = [
    HEADER,
    '',
    'DOUGAL (present)',
    '',
    'WHAT THE CHARACTERS HERE KNOW',
    '- the kiln router logged 42.08 kHz queries overnight — known only to Dougal',
].join('\n');

/** The workshop block with Dougal present and Ellie talked about. */
const DOUGAL_WITH_ELLIE = [
    HEADER,
    '',
    'DOUGAL (present)',
    '',
    'ELLIE (talked about, not present)',
    '',
    'WHAT THE CHARACTERS HERE KNOW',
    '- the kiln router logged 42.08 kHz queries overnight — known only to Dougal',
    '- Noor should lock the gauntlet on with titanium latches — known only to Gabriel Marin and Ellie; Ellie was told by Gabriel Marin',
    '- Vera Lin broke into the Annex last night — known only to Gabriel Marin and Ellie',
].join('\n');

/**
 * A private fact one character witnessed, its text the label padded with
 * "x" to the given length, so a test can count the characters of its line.
 */
function witnessedFact(label, characterId, at, textLength) {
    const padding = textLength > label.length ? ` ${'x'.repeat(textLength - label.length - 1)}` : '';
    return {
        id: label.replaceAll(' ', '-'), text: `${label}${padding}`, public: false,
        holders: [{ characterId, how: 'witnessed', toldBy: null, at }],
    };
}

/** The lines of the block's WHAT THE CHARACTERS HERE KNOW section. */
function factListLines(block) {
    const factSection = block.split('\n\n').find(section => section.startsWith('WHAT THE CHARACTERS HERE KNOW\n'));
    return factSection.split('\n').slice(1);
}

/** The label a witnessedFact line starts with: "- bo fact 12 xxx… — …" gives "bo fact 12". */
function factLabel(line) {
    return line.match(/^- (\S+ fact \d+)/)[1];
}


describe('buildKnowledgeBlock', () => {
    it('gives an empty string for an empty ledger', () => {
        assert.equal(buildKnowledgeBlock(createEmptyKnowledgeLedger(), []), '');

    it('covers the characters present and the one the latest message names, in the card format', () => {
        const messages = [
            message(false, 'Noor looks up from the bench. Dougal is out back.'),
            message(true, 'I drop my bag on the bench. "Gabriel Marin says hi."'),
        ];

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '',
            'DOUGAL (present)',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Gabriel Marin is Aegis — known only to Noor and Gabriel Marin',
            '- the kiln router logged 42.08 kHz queries overnight — known only to Dougal',
            '- Noor should lock the gauntlet on with titanium latches — known only to Gabriel Marin and Ellie; Ellie was told by Gabriel Marin',
            '- Vera Lin broke into the Annex last night — known only to Gabriel Marin and Ellie',
            '- Ellie is Dice — known only to Noor',
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
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Gabriel Marin is Aegis — known only to Noor and Gabriel Marin',
            '- Noor should lock the gauntlet on with titanium latches — known only to Gabriel Marin and Ellie; Ellie was told by Gabriel Marin',
            '- Vera Lin broke into the Annex last night — known only to Gabriel Marin and Ellie',
            '- Ellie is Dice — known only to Noor',
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
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Noor should lock the gauntlet on with titanium latches — known only to Gabriel Marin and Ellie; Ellie was told by Gabriel Marin',
            '- Vera Lin broke into the Annex last night — known only to Gabriel Marin and Ellie',
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
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- the kiln-room window was broken overnight — known only to Noor',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('prints all of a short list longer than the always-printed five, newest first, and gives a character with no line no section', () => {
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
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- fact 7 — known only to Noor',
            '- fact 6 — known only to Noor',
            '- fact 5 — known only to Noor',
            '- fact 4 — known only to Noor',
            '- fact 3 — known only to Noor',
            '- fact 2 — known only to Noor',
            '- fact 1 — known only to Noor',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('shows the public fact, the shared private facts and a talked-about holder, each private fact once', () => {
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
            '',
            'AMY (present)',
            '',
            'LENA (talked about, not present)',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Steve is quitting next month — known only to Steve and Amy; Amy was told by Steve',
            '- The demo ran on a scripted fallback — known only to Lena, Steve and Amy',
        ].join('\n');

        const block = buildKnowledgeBlock(ledger, messages);
        assert.equal(block, expected);
        assert.equal(block.split('The demo ran on a scripted fallback').length - 1, 1);
        assert.equal(block.split('Steve is quitting next month').length - 1, 1);
    });

    it('prints a fact three covered characters hold once, naming all three', () => {
        const ledger = {
            characters: [
                { id: 'ellie', name: 'Ellie', aliases: [] },
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'dougal', name: 'Dougal', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'the vault code is 4471', public: false,
                holders: [
                    { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 10 },
                    { characterId: 'noor', how: 'witnessed', toldBy: null, at: 10 },
                    { characterId: 'dougal', how: 'witnessed', toldBy: null, at: 10 },
                ],
            }],
            scene: { at: 10, present: ['ellie', 'noor', 'dougal'] },
            lastUpdatedAt: 10,
        };

        const expected = [
            HEADER,
            '',
            'ELLIE (present)',
            '',
            'NOOR (present)',
            '',
            'DOUGAL (present)',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- the vault code is 4471 — known only to Ellie, Noor and Dougal',
        ].join('\n');

        const block = buildKnowledgeBlock(ledger, []);
        assert.equal(block, expected);
        assert.equal(block.split('the vault code is 4471').length - 1, 1);
    });

    it('says who was told by whom after the holders, "were" for several told by one teller', () => {
        const ledger = {
            characters: [
                { id: 'jalen', name: 'Jalen', aliases: [] },
                { id: 'dez', name: 'Dez', aliases: [] },
                { id: 'mara', name: 'Mara', aliases: [] },
                { id: 'kim', name: 'Kim', aliases: [] },
            ],
            facts: [
                {
                    id: 'f1', text: 'Jalen hid the ledger in the boathouse', public: false,
                    holders: [
                        { characterId: 'jalen', how: 'witnessed', toldBy: null, at: 20 },
                        { characterId: 'dez', how: 'told', toldBy: 'jalen', at: 30 },
                    ],
                },
                {
                    id: 'f2', text: 'the boathouse key is under the third plank', public: false,
                    holders: [
                        { characterId: 'jalen', how: 'witnessed', toldBy: null, at: 21 },
                        { characterId: 'dez', how: 'told', toldBy: 'jalen', at: 22 },
                        { characterId: 'mara', how: 'told', toldBy: 'jalen', at: 25 },
                        { characterId: 'kim', how: 'told', toldBy: 'dez', at: 24 },
                    ],
                },
            ],
            scene: { at: 30, present: ['jalen', 'dez'] },
            lastUpdatedAt: 30,
        };

        const expected = [
            HEADER,
            '',
            'JALEN (present)',
            '',
            'DEZ (present)',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Jalen hid the ledger in the boathouse — known only to Jalen and Dez; Dez was told by Jalen',
            '- the boathouse key is under the third plank — known only to Jalen, Dez, Mara and Kim; '
                + 'Dez and Mara were told by Jalen; Kim was told by Dez',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('prints a big holder\'s five newest facts, then older ones only while the budget allows', () => {
        // Each fact line costs its text plus "- " and " — known only to Ada"
        // (2 + 20 characters) or " — known only to Bo" (2 + 19), plus 1 for
        // the line break. Ada: 3 facts of 10 characters, 33 each = 99.
        // Bo's five newest: 600 characters, 622 each = 3110; 3209 so far.
        // Bo's older ones: 775 characters, 797 each. Three of them take
        // 2391 and reach exactly 5600; a fourth would make 6397.
        const ledger = {
            characters: [
                { id: 'ada', name: 'Ada', aliases: [] },
                { id: 'bo', name: 'Bo', aliases: [] },
            ],
            facts: [],
            scene: { at: 60, present: ['bo', 'ada'] },
            lastUpdatedAt: 60,
        };
        for (let number = 1; number <= 3; number++) {
            ledger.facts.push(witnessedFact(`ada fact ${number}`, 'ada', 50 + number, 10));
        }
        for (let number = 1; number <= 12; number++) {
            const textLength = number >= 8 ? 600 : 775;
            ledger.facts.push(witnessedFact(`bo fact ${number}`, 'bo', number, textLength));
        }

        const factLines = factListLines(buildKnowledgeBlock(ledger, []));

        assert.deepEqual(factLines.map(factLabel), [
            'ada fact 3', 'ada fact 2', 'ada fact 1',
            'bo fact 12', 'bo fact 11', 'bo fact 10', 'bo fact 9', 'bo fact 8',
            'bo fact 7', 'bo fact 6', 'bo fact 5',
        ]);
        const usedCharacters = factLines.reduce((total, line) => total + line.length + 1, 0);
        assert.equal(usedCharacters, 5600);
    });

    it('prints the five newest facts of every holder even past the budget', () => {
        // Two holders' five newest at 1022 characters each (1000 + 22) take
        // 10220, past the 5600 budget, and are all printed; no older fact is.
        const ledger = {
            characters: [
                { id: 'ada', name: 'Ada', aliases: [] },
                { id: 'bo', name: 'Bo', aliases: [] },
            ],
            facts: [],
            scene: { at: 60, present: ['ada', 'bo'] },
            lastUpdatedAt: 60,
        };
        for (let number = 1; number <= 6; number++) {
            ledger.facts.push(witnessedFact(`ada fact ${number}`, 'ada', 10 + number, 999));
            ledger.facts.push(witnessedFact(`bo fact ${number}`, 'bo', number, 1000));
        }

        const factLines = factListLines(buildKnowledgeBlock(ledger, []));

        assert.deepEqual(factLines.map(factLabel), [
            'ada fact 6', 'ada fact 5', 'ada fact 4', 'ada fact 3', 'ada fact 2',
            'bo fact 6', 'bo fact 5', 'bo fact 4', 'bo fact 3', 'bo fact 2',
        ]);
    });

    it('fills the budget with the older facts of the holder with the fewest facts first', () => {
        // Every line costs 400 (378 + 2 + 19 + 1). The ten newest take 4000,
        // which leaves 1600: Cy's two older facts first, though Bo comes
        // first in the scene, then two of Bo's older ones.
        const ledger = {
            characters: [
                { id: 'bo', name: 'Bo', aliases: [] },
                { id: 'cy', name: 'Cy', aliases: [] },
            ],
            facts: [],
            scene: { at: 200, present: ['bo', 'cy'] },
            lastUpdatedAt: 200,
        };
        for (let number = 1; number <= 12; number++) {
            ledger.facts.push(witnessedFact(`bo fact ${number}`, 'bo', number, 378));
        }
        for (let number = 1; number <= 7; number++) {
            ledger.facts.push(witnessedFact(`cy fact ${number}`, 'cy', 100 + number, 378));
        }

        const factLines = factListLines(buildKnowledgeBlock(ledger, []));

        assert.deepEqual(factLines.map(factLabel), [
            'cy fact 7', 'cy fact 6', 'cy fact 5', 'cy fact 4', 'cy fact 3', 'cy fact 2', 'cy fact 1',
            'bo fact 12', 'bo fact 11', 'bo fact 10', 'bo fact 9', 'bo fact 8', 'bo fact 7', 'bo fact 6',
        ]);
    });

    it('leaves unnamed extras off the Has met line and keeps the named characters', () => {
        const ledger = {
            characters: [
                { id: 'ellie', name: 'Ellie', aliases: [] },
                { id: 'cyclist', name: 'the bearded cyclist', aliases: [] },
                { id: 'levi', name: 'Levi', aliases: [] },
                { id: 'girls', name: 'the two college girls', aliases: [] },
            ],
            facts: [],
            scene: { at: 40, present: ['ellie'] },
            meetings: [
                { at: 30, present: ['ellie', 'cyclist', 'levi'] },
                { at: 35, present: ['ellie', 'girls'] },
            ],
            lastUpdatedAt: 40,
        };

        const expected = [
            HEADER_WITH_MEETINGS,
            '',
            'ELLIE (present)',
            '- Has met: Levi',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
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
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- Julian means to bring the crane down tonight — known only to Ellie, Julian and Noor; Noor was told by Ellie',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('selects no fact for a present planned holder whose other holders are not covered', () => {
        const ledger = {
            characters: [
                { id: 'ellie', name: 'Ellie', aliases: [] },
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'julian', name: 'Julian', aliases: [] },
            ],
            facts: [
                {
                    id: 'f1', text: 'the crane bolts were loosened', public: false,
                    holders: [
                        { characterId: 'noor', how: 'witnessed', toldBy: null, at: 15 },
                        { characterId: 'julian', how: 'plan', toldBy: null, at: 15 },
                    ],
                },
                {
                    id: 'f2', text: 'the arena opens at noon', public: false,
                    holders: [
                        { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 18 },
                        { characterId: 'julian', how: 'plan', toldBy: null, at: 18 },
                    ],
                },
            ],
            scene: { at: 21, present: ['ellie', 'julian'] },
            lastUpdatedAt: 21,
        };

        const expected = [
            HEADER,
            '',
            'ELLIE (present)',
            '',
            'WHAT THE CHARACTERS HERE KNOW',
            '- the arena opens at noon — known only to Ellie and Julian',
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

        assert.equal(buildKnowledgeBlock(ledger, messages), DOUGAL_ALONE);
    });

    it('still counts a name in the story text outside the tags', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['dougal'];
        const messages = [
            message(true, 'I wait by the door.'),
            message(false, '<svt><bg>Noor: asleep</bg></svt>Ellie walks in.<trk>scene 4</trk>'),
        ];

        assert.equal(buildKnowledgeBlock(ledger, messages), DOUGAL_WITH_ELLIE);
    });

    it('still counts a name inside inline formatting tags', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['dougal'];
        const messages = [
            message(true, 'I wait by the door.'),
            message(false, 'Dougal mutters, <i>where is <b>Ellie</b></i>?\n<svt><bg>Noor: asleep</bg></svt>'),
        ];

        assert.equal(buildKnowledgeBlock(ledger, messages), DOUGAL_WITH_ELLIE);
    });

    describe('which tagged text decides who is talked about', () => {
        const blockFor = (userText, replyText) => {
            const ledger = makeWorkshopLedger();
            ledger.scene.present = ['dougal'];
            return buildKnowledgeBlock(ledger, [message(true, userText), message(false, replyText)]);
        };

        it('reads each message on its own, so a tag cannot close across them', () => {
            assert.equal(blockFor('I check <note> the board', 'Ellie waves. </note>'), DOUGAL_WITH_ELLIE);
        });

        it('keeps the text inside HTML paragraph and link tags', () => {
            assert.equal(blockFor('I wait.', '<p>Dougal nods.</p><p><a href="#">Ellie</a> walks in.</p>'), DOUGAL_WITH_ELLIE);
        });

        it('drops a status block the length limit cut off before its closing tag', () => {
            assert.equal(blockFor('I wait.', 'The workshop is quiet.\n<svt><bg>Ellie: asleep'), DOUGAL_ALONE);
        });

        it('drops a status block whose closing tag is written in other case', () => {
            assert.equal(blockFor('I wait.', 'The workshop is quiet.\n<SVT>Ellie: asleep</svt>'), DOUGAL_ALONE);
        });

        it('keeps two names apart that sit in neighbouring paragraphs', () => {
            assert.equal(blockFor('I wait.', '<p>Dougal</p><p>Ellie</p>'), DOUGAL_WITH_ELLIE);
        });
    });
    });

    it('gives an empty string when no character is present or talked about', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = [];
        const messages = [message(true, 'I head out.'), message(false, 'The street is empty.')];

        assert.equal(buildKnowledgeBlock(ledger, messages), '');
    });
});
