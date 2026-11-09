import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPlanCheck, buildPlanCheckVariables } from '../lib/planning/generator.js';

// The plan check renames a new character who got a taken name, everywhere
// in the plan (issue #49).

const CAST = [
    { name: 'Julian Sterling', aliases: ['Jules'] },
    { name: 'Priya', aliases: [] },
    { name: 'Mara Cole', aliases: ['Sundown'] },
];

/** A fresh act whose new character "Julian Hale" (short form "Hale") is in every field. */
function makePlannedAct() {
    return {
        id: 'act-1',
        title: 'Hale Street',
        tier: 'act',
        premise: 'Julian Hale runs the docks.',
        direction: 'Brody Kane wants the docks.',
        genre: 'Noir for Hale',
        themes: ['Debt to Hale'],
        tone: 'Grim as Hale',
        directives: ['Keep Hale offstage'],
        antiPatterns: ['Hale never pleads'],
        escalation: 'Hale tightens his grip.',
        characters: ['Julian Hale', 'Priya', 'Brody Kane'],
        secrets: [
            { id: 'debt', content: 'Julian Hale owes Brody Kane.', revealPhase: 'climax', disclosed: false, holders: ['Julian Hale', 'Priya'] },
        ],
        foreshadowing: [
            { id: 'ledger', clue: 'Hale burns a page.', target: 'The debt to Hale', planted: false },
        ],
        beats: [
            { id: 'seen', pressure: 'Hale watches the pier.', intention: 'Hale was seen.', flexibility: 'Hale may wait.', status: 'completed' },
            { id: 'paid', pressure: 'Hale circles Priya.', intention: 'Hale has paid.', flexibility: 'Hale may bargain.', status: 'active' },
        ],
        triggers: [
            { id: 'arrival', condition: 'Hale arrives', action: 'Hale smiles.', secret: '', fired: true },
            { id: 'pressed', condition: 'Hale is pressed', action: 'Hale deflects.', secret: '', fired: false },
        ],
    };
}

/** Record console.warn and console.log while a test runs. */
function recordConsole() {
    const recorded = { warnings: [], logs: [] };
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = (...parts) => recorded.warnings.push(parts.join(' '));
    console.log = (...parts) => recorded.logs.push(parts.join(' '));
    recorded.restore = () => {
        console.warn = originalWarn;
        console.log = originalLog;
    };
    return recorded;
}

describe('applyPlanCheck: renames', () => {
    let recorded;
    beforeEach(() => { recorded = recordConsole(); });
    afterEach(() => { recorded.restore(); });

    it('renames every text field of the plan, except completed beats, fired triggers, the direction and the genre', () => {
        const arc = makePlannedAct();

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Hale', to: 'Marsh' }, { from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST });

        assert.equal(checked.title, 'Marsh Street');
        assert.equal(checked.premise, 'Owen Marsh runs the docks.');
        assert.equal(checked.direction, 'Brody Kane wants the docks.');
        assert.equal(checked.genre, 'Noir for Hale');
        assert.deepEqual(checked.themes, ['Debt to Marsh']);
        assert.equal(checked.tone, 'Grim as Marsh');
        assert.deepEqual(checked.directives, ['Keep Marsh offstage']);
        assert.deepEqual(checked.antiPatterns, ['Marsh never pleads']);
        assert.equal(checked.escalation, 'Marsh tightens his grip.');
        assert.deepEqual(checked.characters, ['Owen Marsh', 'Priya', 'Brody Kane']);
        assert.deepEqual(checked.secrets, [
            { id: 'debt', content: 'Owen Marsh owes Brody Kane.', revealPhase: 'climax', disclosed: false, holders: ['Owen Marsh', 'Priya'] },
        ]);
        assert.deepEqual(checked.foreshadowing, [
            { id: 'ledger', clue: 'Marsh burns a page.', target: 'The debt to Marsh', planted: false },
        ]);
        assert.deepEqual(checked.beats, [
            { id: 'seen', pressure: 'Hale watches the pier.', intention: 'Hale was seen.', flexibility: 'Hale may wait.', status: 'completed' },
            { id: 'paid', pressure: 'Marsh circles Priya.', intention: 'Marsh has paid.', flexibility: 'Marsh may bargain.', status: 'active' },
        ]);
        assert.deepEqual(checked.triggers, [
            { id: 'arrival', condition: 'Hale arrives', action: 'Hale smiles.', secret: '', fired: true },
            { id: 'pressed', condition: 'Marsh is pressed', action: 'Marsh deflects.', secret: '', fired: false },
        ]);
    });

    it('does not mutate the arc given', () => {
        const arc = makePlannedAct();

        applyPlanCheck(arc, { renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }, { from: 'Hale', to: 'Marsh' }] }, [], { cast: CAST });

        assert.deepEqual(arc, makePlannedAct());
    });

    it('applies the longest name first: "Julian Hale" is not split by the pair for "Hale"', () => {
        const arc = { ...makePlannedAct(), escalation: 'Julian Hale and Hale are one man.' };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Hale', to: 'Marsh' }, { from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST });

        assert.equal(checked.escalation, 'Owen Marsh and Marsh are one man.');
    });

    it('replaces whole names only; a possessive still matches', () => {
        const arc = {
            ...makePlannedAct(),
            escalation: 'Vance met Vance-Chen and Vancester at the pier.',
            tone: 'Hale\'s coat, Hale’s hat, O\'Hale and Hale\'n stay.',
        };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Vance', to: 'Rook' }, { from: 'Hale', to: 'Marsh' }],
        }, [], { cast: CAST });

        assert.equal(checked.escalation, 'Rook met Vance-Chen and Vancester at the pier.');
        assert.equal(checked.tone, 'Marsh\'s coat, Marsh’s hat, O\'Hale and Hale\'n stay.');
    });

    it('is case-sensitive', () => {
        const arc = { ...makePlannedAct(), escalation: 'Hale walks past the hale old men.' };

        const checked = applyPlanCheck(arc, { renames: [{ from: 'Hale', to: 'Marsh' }] }, [], { cast: CAST });

        assert.equal(checked.escalation, 'Marsh walks past the hale old men.');
    });

    it('renames the proposed premise of a re-plan', () => {
        const arc = { ...makePlannedAct(), premise: 'The docks change hands.', proposedPremise: 'Julian Hale takes the docks.' };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.' });

        assert.equal(checked.premise, 'The docks change hands.');
        assert.equal(checked.proposedPremise, 'Owen Marsh takes the docks.');
    });

    it('logs the kept renames as name pairs only', () => {
        applyPlanCheck(makePlannedAct(), { renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }] }, [], { cast: CAST });

        assert.deepEqual(recorded.logs, ['[Story Arc] Plan check renamed: "Julian Hale" → "Owen Marsh"']);
        assert.deepEqual(recorded.warnings, []);
    });

    it('drops a rename of a cast alias', () => {
        const arc = { ...makePlannedAct(), escalation: 'Sundown keeps watch.' };

        const checked = applyPlanCheck(arc, { renames: [{ from: 'Sundown', to: 'Dusk' }] }, [], { cast: CAST });

        assert.equal(checked.escalation, 'Sundown keeps watch.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Sundown" → "Dusk" ignored: it is a cast name or alias']);
    });

    it('drops a rename of a name in the direction', () => {
        const checked = applyPlanCheck(makePlannedAct(), { renames: [{ from: 'Brody Kane', to: 'Brody Lund' }] }, [], { cast: CAST });

        assert.equal(checked.secrets[0].content, 'Julian Hale owes Brody Kane.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Brody Kane" → "Brody Lund" ignored: the author\'s direction or premise names it']);
    });

    it('drops a rename of a name in the premise a re-plan passed in', () => {
        const arc = { ...makePlannedAct(), proposedPremise: 'Julian Hale takes the docks.' };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST, replanPremise: 'Julian Hale runs the docks.' });

        assert.equal(checked.secrets[0].content, 'Julian Hale owes Brody Kane.');
        assert.equal(checked.proposedPremise, 'Julian Hale takes the docks.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Julian Hale" → "Owen Marsh" ignored: the author\'s direction or premise names it']);
    });

    it('drops a rename of a name a ruling quotes', () => {
        const arc = {
            ...makePlannedAct(),
            premise: 'The docks change hands.',
            rulings: [{ id: 'r1', text: 'Julian Hale is not her father.', at: 40, answeredAt: 50 }],
        };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Julian Hale', to: 'Owen Hale' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.', replanTitle: 'Dock Street' });

        assert.equal(checked.secrets[0].content, 'Julian Hale owes Brody Kane.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Julian Hale" → "Owen Hale" ignored: a ruling of the player names it']);
    });

    it('drops a rename of a name in the option a bare pick chose', () => {
        const arc = {
            ...makePlannedAct(),
            premise: 'The docks change hands.',
            rulings: [{ id: 'r1', text: 'Option two', chose: 'Hale walks away from the docks.', at: 40 }],
        };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Hale', to: 'Marsh' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.', replanTitle: 'Dock Street' });

        assert.equal(checked.escalation, 'Hale tightens his grip.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Hale" → "Marsh" ignored: a ruling of the player names it']);
    });

    it('drops a rename of a name in an answer of the author\'s answers', () => {
        const arc = {
            ...makePlannedAct(),
            premise: 'The docks change hands.',
            authorAnswers: [{ question: 'Who may step in?', answer: 'Julian Hale never helps her.' }],
        };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Julian Hale', to: 'Owen Hale' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.', replanTitle: 'Dock Street' });

        assert.equal(checked.secrets[0].content, 'Julian Hale owes Brody Kane.');
        assert.deepEqual(checked.authorAnswers, [{ question: 'Who may step in?', answer: 'Julian Hale never helps her.' }]);
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Julian Hale" → "Owen Hale" ignored: the author\'s answers name it']);
    });

    it('keeps a rename of a name that only the model-written question carries', () => {
        const arc = {
            ...makePlannedAct(),
            premise: 'The docks change hands.',
            authorAnswers: [{ question: 'Can Julian Hale step in?', answer: 'Nobody steps in.' }],
        };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Julian Hale', to: 'Owen Hale' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.', replanTitle: 'Dock Street' });

        assert.equal(checked.secrets[0].content, 'Owen Hale owes Brody Kane.');
        assert.deepEqual(recorded.warnings, []);
    });

    it('drops a rename of a name in the title a re-plan keeps', () => {
        const arc = { ...makePlannedAct(), premise: 'The docks change hands.' };

        const checked = applyPlanCheck(arc, {
            renames: [{ from: 'Hale', to: 'Marsh' }],
        }, [], { cast: CAST, replanPremise: 'The docks change hands.', replanTitle: 'Hale Street' });

        assert.equal(checked.title, 'Hale Street');
        assert.equal(checked.escalation, 'Hale tightens his grip.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Hale" → "Marsh" ignored: the player\'s title names it']);
    });

    it('drops a rename to a name with a taken name', () => {
        const checked = applyPlanCheck(makePlannedAct(), { renames: [{ from: 'Julian Hale', to: 'Owen Sterling' }] }, [], { cast: CAST });

        assert.equal(checked.secrets[0].content, 'Julian Hale owes Brody Kane.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Julian Hale" → "Owen Sterling" ignored: the new name uses a taken name']);
    });

    it('keeps a rename to a cast name', () => {
        const arc = { ...makePlannedAct(), escalation: 'Julian Starling tightens his grip.' };

        const checked = applyPlanCheck(arc, { renames: [{ from: 'Julian Starling', to: 'Julian Sterling' }] }, [], { cast: CAST });

        assert.equal(checked.escalation, 'Julian Sterling tightens his grip.');
        assert.deepEqual(recorded.warnings, []);
    });

    it('drops a rename that turns a fuller form of a single-word record into a new person', () => {
        const arc = { ...makePlannedAct(), escalation: 'Julian Vance tightens his grip.' };

        const checked = applyPlanCheck(arc, { renames: [{ from: 'Julian Vance', to: 'Julian Marsh' }] }, [], { cast: [{ name: 'Vance', aliases: [] }] });

        assert.equal(checked.escalation, 'Julian Vance tightens his grip.');
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Julian Vance" → "Julian Marsh" ignored: it may be the cast\'s "Vance"']);
    });

    it('keeps a rename that brings a fuller form back to the single-word record\'s name', () => {
        const arc = { ...makePlannedAct(), escalation: 'Priya Patel tightens her grip.' };

        const checked = applyPlanCheck(arc, { renames: [{ from: 'Priya Patel', to: 'Priya' }] }, [], { cast: [{ name: 'Priya', aliases: [] }] });

        assert.equal(checked.escalation, 'Priya tightens her grip.');
        assert.deepEqual(recorded.warnings, []);
    });

    it('drops a rename of a name the plan does not use', () => {
        const checked = applyPlanCheck(makePlannedAct(), { renames: [{ from: 'Toby Marsh', to: 'Toby Reed' }] }, [], { cast: CAST });

        assert.deepEqual(checked, makePlannedAct());
        assert.deepEqual(recorded.warnings, ['[Story Arc] Plan check rename "Toby Marsh" → "Toby Reed" ignored: the plan does not use it']);
    });

    it('changes nothing without a renames list', () => {
        const checked = applyPlanCheck(makePlannedAct(), { revealed: [], rewrites: [], links: [] }, [], { cast: CAST });

        assert.deepEqual(checked, makePlannedAct());
        assert.deepEqual(recorded.warnings, []);
    });

    it('ignores a malformed item with a warning and applies the others', () => {
        const checked = applyPlanCheck(makePlannedAct(), {
            renames: ['Julian Hale', { from: 'Julian Hale' }, { from: 'Hale', to: '' }, { from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST });

        assert.equal(checked.secrets[0].content, 'Owen Marsh owes Brody Kane.');
        assert.equal(recorded.warnings.length, 3);
        assert.ok(recorded.warnings.every(warning => warning.startsWith('[Story Arc] Plan check answered a malformed rename; ignored')));
    });

    it('ignores a renames list of the wrong shape', () => {
        const checked = applyPlanCheck(makePlannedAct(), { renames: { from: 'Julian Hale', to: 'Owen Marsh' } }, [], { cast: CAST });

        assert.deepEqual(checked, makePlannedAct());
    });

    it('renames inside a rewrite the same answer made', () => {
        const checked = applyPlanCheck(makePlannedAct(), {
            rewrites: [{ kind: 'trigger', id: 'pressed', text: 'Julian Hale goes quiet.' }],
            renames: [{ from: 'Julian Hale', to: 'Owen Marsh' }],
        }, [], { cast: CAST });

        assert.equal(checked.triggers[1].action, 'Owen Marsh goes quiet.');
    });
});

describe('buildPlanCheckVariables: the names block', () => {
    const CAST_OF_TWO = [
        { name: 'Julian Sterling', aliases: ['Jules'] },
        { name: 'Priya', aliases: [] },
    ];

    function makeArc(characters) {
        return { premise: 'A debt.', direction: '', secrets: [], triggers: [], beats: [], characters };
    }

    it('lists the cast, the taken names, the plan\'s characters and the task for a cast of two', () => {
        const variables = buildPlanCheckVariables(makeArc(['Julian Hale', 'Priya']), null, CAST_OF_TWO);

        assert.equal(variables.NAMES_BLOCK, `== NAMES ==
The cast, the characters already in the story. Each line gives the name, then the aliases, then after a dash what the story has established about them:

- Julian Sterling (aliases: Jules)
- Priya

Names already taken: Jules, Julian, Priya, Sterling

The plan's own list of characters. It can be incomplete: the secrets, triggers, pressures and fulfillments above name characters too.

- Julian Hale
- Priya

RENAMES. For each character the plan names, decide whether it is a cast member or a new character.
- A cast member named differently from the cast (a changed surname, another spelling) is renamed to the cast's name.
- A new character whose first name or surname is a taken name, and whom the plan does not make related to the character who has it, is renamed to a full name that uses no taken name.
- A name that extends a cast name by one more name ("Julian Vance" for the cast's "Vance") may be that cast member. Leave it unless the plan makes clear it is someone else.
- Never rename a character the author's direction names.
- Give one pair for each form the plan uses for the character: the full name, and any short form that means that character alone in this plan.
Answer the renames as one more key of the JSON object below: "renames": [{ "from": "the name as the plan writes it", "to": "the new name" }]. An empty list is fine.

`);
    });

    it('lists a member\'s details after a dash, and a member without details as before', () => {
        const castWithDetails = [
            {
                name: 'Ellie Masters',
                aliases: ['Dice'],
                details: { age: '18', role: 'uncertified Ward, senior at Westbrook High', relation: 'Mara Masters\'s sister' },
            },
            { name: 'Mara Masters', aliases: [], details: {} },
        ];

        const variables = buildPlanCheckVariables(makeArc([]), null, castWithDetails);

        assert.ok(variables.NAMES_BLOCK.startsWith(`== NAMES ==
The cast, the characters already in the story. Each line gives the name, then the aliases, then after a dash what the story has established about them:

- Ellie Masters (aliases: Dice) — age: 18; role: uncertified Ward, senior at Westbrook High; relation: Mara Masters's sister
- Mara Masters

Names already taken: Dice, Ellie, Mara, Masters
`));
    });

    it('writes (none) when the plan lists no characters', () => {
        const variables = buildPlanCheckVariables(makeArc([]), null, CAST_OF_TWO);

        assert.ok(variables.NAMES_BLOCK.includes('The plan\'s own list of characters. It can be incomplete: the secrets, triggers, pressures and fulfillments above name characters too.\n\n(none)\n\nRENAMES.'));
    });

    it('is empty for an empty cast, and without one', () => {
        assert.equal(buildPlanCheckVariables(makeArc(['Julian Hale']), null, []).NAMES_BLOCK, '');
        assert.equal(buildPlanCheckVariables(makeArc(['Julian Hale']), null).NAMES_BLOCK, '');
    });
});

describe('check-plan.txt carries the names slot', () => {
    it('puts the names block right before the answer key', () => {
        const checkTemplate = readFileSync(new URL('../prompts/check-plan.txt', import.meta.url), 'utf8');

        assert.ok(checkTemplate.includes('whatever secret explains the reaction.\n\n{{NAMES_BLOCK}}Answer with ONLY this JSON object, no prose before or after it:\n'));
    });
});
