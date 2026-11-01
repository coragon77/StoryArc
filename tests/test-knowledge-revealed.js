import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat } from './mocks/st-mocks.js';
import {
    listShownSecrets,
    buildKnowledgeExtractionVariables,
    parseKnowledgeExtractionAnswer,
    resolveRevealedSecrets,
    applyExtractionAnswer,
    buildKnowledgeBlock,
} from '../lib/knowledge/ledger.js';

/**
 * Two active arcs in setup (no beat done, empty chat). The crane arc has one
 * secret shown from the start, one held back to the climax and one the plan
 * check already marked disclosed; the tether arc reuses the id "the_drop".
 */
function makeArcs() {
    return [
        {
            id: 'arc-crane',
            status: 'active',
            messageStart: 0,
            estimatedLength: 40,
            beats: [{ id: 'b1', status: 'active' }, { id: 'b2', status: 'pending' }],
            secrets: [
                { id: 'the_drop', content: 'Julian plans to drop the crane on the Annex', revealPhase: 'any', disclosed: false, holders: ['Julian', 'Brody'] },
                { id: 'vera_drive', content: 'Vera\'s flash drive holds the Annex keys', revealPhase: 'climax', disclosed: false, holders: ['Gabriel Marin'] },
                { id: 'old_pins', content: 'Dougal milled the ring for titanium pins', revealPhase: 'any', disclosed: true, holders: [] },
            ],
        },
        {
            id: 'arc-tether',
            status: 'active',
            messageStart: 0,
            estimatedLength: 20,
            beats: [{ id: 'b1', status: 'active' }],
            secrets: [
                { id: 'the_drop', content: 'The tether snaps at the second floor', revealPhase: 'setup', disclosed: false, holders: [] },
            ],
        },
    ];
}

beforeEach(() => {
    chat.length = 0;
});

describe('listShownSecrets', () => {
    it('lists the active arcs\' secrets the phase shows, disclosed ones too, with their holders and a ref unique in the call', () => {
        assert.deepEqual(listShownSecrets(makeArcs()), [
            { ref: 'the_drop', arcId: 'arc-crane', secretId: 'the_drop', text: 'Julian plans to drop the crane on the Annex', holders: ['Julian', 'Brody'] },
            { ref: 'old_pins', arcId: 'arc-crane', secretId: 'old_pins', text: 'Dougal milled the ring for titanium pins', holders: [] },
            { ref: 'the_drop_2', arcId: 'arc-tether', secretId: 'the_drop', text: 'The tether snaps at the second floor', holders: [] },
        ]);
    });

    it('leaves out arcs that are not active', () => {
        const arcs = makeArcs().map(arc => ({ ...arc, status: 'completed' }));
        assert.deepEqual(listShownSecrets(arcs), []);
    });
});

/** The ledger before the crane talk: Julian and Ellie, no facts yet. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Julian', aliases: ['Jules'] },
            { id: 'c2', name: 'Ellie', aliases: [] },
        ],
        facts: [],
        scene: { at: 2070, present: ['c1', 'c2'] },
        lastUpdatedAt: 2070,
    };
}

describe('buildKnowledgeExtractionVariables with shown secrets', () => {
    it('lists the shown secrets by ref with their planned holders and leaves out a secret its phase still hides', () => {
        const chatMessages = [];
        chatMessages[2071] = { name: 'Julian', is_user: false, mes: 'The crane comes down on the Annex tonight.' };

        const variables = buildKnowledgeExtractionVariables(makeLedger(), chatMessages, 2071, 'Ellie', listShownSecrets(makeArcs()));

        assert.equal(variables.SECRETS, [
            '- [the_drop] Julian plans to drop the crane on the Annex (planned holders: Julian, Brody)',
            '- [old_pins] Dougal milled the ring for titanium pins (no planned holders)',
            '- [the_drop_2] The tether snaps at the second floor (no planned holders)',
        ].join('\n'));
        assert.ok(!variables.SECRETS.includes('flash drive'));
    });

    it('writes (none) without shown secrets', () => {
        const variables = buildKnowledgeExtractionVariables(makeLedger(), [], 0, 'Ellie');
        assert.equal(variables.SECRETS, '(none)');
    });
});

describe('parseKnowledgeExtractionAnswer with revealed secrets', () => {
    it('reads the revealed secrets and drops keys outside the shape', () => {
        const answer = parseKnowledgeExtractionAnswer(`{
            "present": ["Julian", "Ellie"], "newCharacters": [], "learned": [],
            "revealedSecrets": [{ "secretId": "the_drop", "text": "Julian means to bring the crane down", "heardBy": ["Ellie"], "at": 2071, "why": "he says it" }]
        }`);

        assert.deepEqual(answer.revealedSecrets, [{ secretId: 'the_drop', text: 'Julian means to bring the crane down', heardBy: ['Ellie'], at: 2071 }]);
    });

    it('reads a missing list as no revealed secrets', () => {
        const answer = parseKnowledgeExtractionAnswer('{ "present": [], "newCharacters": [], "learned": [] }');

        assert.deepEqual(answer.revealedSecrets, []);
    });

    it('gives nothing when the list or an item has the wrong type', () => {
        const base = '"present": [], "newCharacters": [], "learned": []';
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": "the_drop" }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": [{ "secretId": "", "heardBy": ["Ellie"] }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": [{ "secretId": "the_drop", "text": "Julian means to bring the crane down", "heardBy": "Ellie", "at": 2071 }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": [{ "secretId": "the_drop", "text": "Julian means to bring the crane down", "heardBy": ["Ellie"] }] }`), null);
    });
});

describe('applyExtractionAnswer with revealed secrets', () => {
    const emptyAnswer = { present: ['Julian', 'Ellie'], newCharacters: [], learned: [] };

    it('makes a revealed secret a fact held by the characters who heard it, as witnessed', () => {
        const answer = {
            ...emptyAnswer,
            revealedSecrets: [{ arcId: 'arc-crane', secretId: 'the_drop', text: 'Julian plans to drop the crane on the Annex', heardBy: ['ellie', 'Nobody Known'] }],
        };

        const ledger = makeLedger();
        applyExtractionAnswer(ledger, answer, 2071, 2071);

        assert.deepEqual(ledger.facts, [
            {
                id: 'f1',
                text: 'Julian plans to drop the crane on the Annex',
                public: false,
                secret: { arcId: 'arc-crane', secretId: 'the_drop' },
                holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2071 }],
            },
        ]);
    });

    it('adds the secret\'s planned holders who are in the ledger as plan holders at the reveal, after the witnesses', () => {
        // Julian planned the crane drop and is not in the scene; Ellie overhears it.
        const ledger = {
            characters: [
                { id: 'c1', name: 'Julian', aliases: ['Jules'] },
                { id: 'c2', name: 'Ellie', aliases: [] },
                { id: 'c3', name: 'Noor al-Jamil', aliases: ['Noor'] },
            ],
            facts: [],
            scene: { at: 2070, present: ['c2', 'c3'] },
            lastUpdatedAt: 2070,
        };
        const answer = {
            present: ['Ellie', 'Noor'],
            newCharacters: [],
            learned: [],
            revealedSecrets: [{
                arcId: 'arc-crane',
                secretId: 'the_drop',
                text: 'Julian plans to drop the crane on the Annex',
                holders: ['Jules', 'Brody', 'Ellie'],
                heardBy: ['Ellie'],
            }],
        };

        applyExtractionAnswer(ledger, answer, 2072, 2072);

        assert.deepEqual(ledger.facts, [
            {
                id: 'f1',
                text: 'Julian plans to drop the crane on the Annex',
                public: false,
                secret: { arcId: 'arc-crane', secretId: 'the_drop' },
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2072 },
                    { characterId: 'c1', how: 'plan', toldBy: null, at: 2072 },
                ],
            },
        ]);
    });

    it('extends the fact a secret already became instead of making a second one', () => {
        const ledger = {
            ...makeLedger(),
            facts: [{
                id: 'f4',
                text: 'Julian plans to drop the crane on the Annex',
                public: false,
                secret: { arcId: 'arc-crane', secretId: 'the_drop' },
                holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 2060 }],
            }],
        };
        const answer = {
            ...emptyAnswer,
            revealedSecrets: [{ arcId: 'arc-crane', secretId: 'the_drop', text: 'Julian plans to drop the crane on the Annex', heardBy: ['Jules', 'Ellie'] }],
        };

        applyExtractionAnswer(ledger, answer, 2071, 2071);

        assert.deepEqual(ledger.facts[0].holders, [
            { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2060 },
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 2071 },
        ]);
        assert.equal(ledger.facts.length, 1);
    });

    it('changes no fact when the answer has no revealed secrets or nobody known heard one', () => {
        const ledgerWithoutReveal = makeLedger();
        applyExtractionAnswer(ledgerWithoutReveal, emptyAnswer, 2071, 2071);
        assert.deepEqual(ledgerWithoutReveal.facts, []);

        const ledgerWithUnheardReveal = makeLedger();
        const unheard = { ...emptyAnswer, revealedSecrets: [{ arcId: 'arc-crane', secretId: 'the_drop', text: 'Julian plans to drop the crane on the Annex', heardBy: ['Brody'] }] };
        applyExtractionAnswer(ledgerWithUnheardReveal, unheard, 2071, 2071);
        assert.deepEqual(ledgerWithUnheardReveal.facts, []);
    });
});

describe('resolveRevealedSecrets', () => {
    it('turns each ref into its arc, secret id and text, and drops a ref the input did not list', () => {
        const revealed = resolveRevealedSecrets(
            [
                { secretId: 'the_drop_2', text: 'The tether will not hold', heardBy: ['Ellie'], at: 2071 },
                { secretId: 'vera_drive', text: 'Vera has a drive', heardBy: ['Ellie'], at: 2071 },
                { secretId: 'made_up', text: 'Something', heardBy: ['Julian'], at: 2071 },
            ],
            listShownSecrets(makeArcs()),
        );

        assert.deepEqual(revealed, [
            { arcId: 'arc-tether', secretId: 'the_drop', text: 'The tether will not hold', holders: [], heardBy: ['Ellie'], at: 2071 },
        ]);
    });
});

describe('a revealed secret, from the answer text to the knowledge block', () => {
    it('becomes a fact worded as the characters heard it, and the secret\'s own text appears nowhere', () => {
        // Julian lets slip only part of the plan: the crane, not the Annex.
        const answerText = `{
            "present": ["Julian", "Ellie", "Noor"],
            "newCharacters": [{ "name": "Noor", "aliases": [] }],
            "learned": [],
            "revealedSecrets": [{ "secretId": "the_drop", "text": "Julian means to bring the crane down tonight", "heardBy": ["Ellie"], "at": 2071 }]
        }`;
        const answer = parseKnowledgeExtractionAnswer(answerText);
        answer.revealedSecrets = resolveRevealedSecrets(answer.revealedSecrets, listShownSecrets(makeArcs()));

        const ledger = makeLedger();
        applyExtractionAnswer(ledger, answer, 2071, 2071);

        assert.deepEqual(ledger.facts, [{
            id: 'f1',
            text: 'Julian means to bring the crane down tonight',
            public: false,
            secret: { arcId: 'arc-crane', secretId: 'the_drop' },
            holders: [
                { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2071 },
                { characterId: 'c1', how: 'plan', toldBy: null, at: 2071 },
            ],
        }]);
        const block = buildKnowledgeBlock(ledger, [
            { is_user: true, mes: 'What happens tonight?' },
            { is_user: false, mes: 'The crane comes down tonight.' },
        ]);
        assert.equal(block, [
            '[WHO KNOWS WHAT — characters in this scene and characters being talked about. Each character speaks and acts only from their own list. Knowledge moves between characters only on-screen.]',
            '',
            'ELLIE (present)',
            '- Knows: Julian means to bring the crane down tonight',
            '',
            'NOOR (present)',
            '- Does not know: Julian means to bring the crane down tonight',
        ].join('\n'));
        assert.ok(!block.includes('on the Annex'));
    });

    it('gives nothing when a revealed secret has no heard text', () => {
        const base = '"present": [], "newCharacters": [], "learned": []';
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": [{ "secretId": "the_drop", "heardBy": ["Ellie"], "at": 2071 }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "revealedSecrets": [{ "secretId": "the_drop", "text": " ", "heardBy": ["Ellie"], "at": 2071 }] }`), null);
    });
});
