import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanCheck, buildPlanCheckVariables } from '../lib/planning/generator.js';

/** A merged re-plan: one kept and one new secret, a fired and an unfired trigger, a done and an open milestone. */
function makeReplannedAct() {
    return {
        id: 'act-1',
        title: 'Trade Dress',
        tier: 'act',
        premise: 'Vanguard wants the rookie humiliated.',
        direction: 'Julian needs her to submit.',
        secrets: [
            { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: false },
            { id: 'jumbotron_cut', content: 'Julian rigged the Jumbotron to broadcast his gauntlet feed.', revealPhase: 'climax', disclosed: false },
        ],
        triggers: [
            { id: 'usb_accepted', condition: 'Ellie takes the drive', action: 'Vera breaks down and swears to feed Ellie updates from inside.', secret: '', fired: false },
            { id: 'photo_leak', condition: 'someone leaks the photos', action: 'Stern files the claim.', secret: '', fired: true },
        ],
        beats: [
            { id: 'old_milestone', pressure: 'The card is still out there.', intention: 'The card was destroyed.', status: 'completed' },
            { id: 'pier_stage', pressure: 'The stage is rigged with Julian\'s gauntlet tether.', intention: 'The scrimmage was played.', status: 'active' },
        ],
        foreshadowing: [],
    };
}

/** The re-planned arc's one secret as it was stored before the re-plan. */
const EARLIER_LEASH = [
    { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: false },
];

describe('applyPlanCheck', () => {
    it('applies valid rewrites, revealed secrets and links, and nothing else', () => {
        const arc = makeReplannedAct();

        const checked = applyPlanCheck(arc, {
            revealed: ['brother_leash', 'jumbotron_cut', 'no_such_secret'],
            rewrites: [
                { kind: 'trigger', id: 'usb_accepted', text: 'Vera\'s composure cracks into tearful relief.' },
                { kind: 'trigger', id: 'photo_leak', text: 'A rewrite of a fired trigger.' },
                { kind: 'pressure', id: 'pier_stage', text: 'Vanguard\'s handlers prepare the stage behind closed doors.' },
                { kind: 'pressure', id: 'old_milestone', text: 'A rewrite of a completed milestone.' },
                { kind: 'pressure', id: 'no_such_beat', text: 'Nowhere to go.' },
            ],
            links: [
                { trigger: 'usb_accepted', secret: 'brother_leash' },
                { trigger: 'no_such_trigger', secret: 'brother_leash' },
            ],
        }, EARLIER_LEASH);

        assert.deepEqual(checked.secrets.map(secret => [secret.id, secret.disclosed]), [
            ['brother_leash', true],
            ['jumbotron_cut', false],
        ]);
        assert.deepEqual(checked.triggers.map(trigger => [trigger.id, trigger.action, trigger.secret]), [
            ['usb_accepted', 'Vera\'s composure cracks into tearful relief.', 'brother_leash'],
            ['photo_leak', 'Stern files the claim.', ''],
        ]);
        assert.deepEqual(checked.beats.map(beat => [beat.id, beat.pressure]), [
            ['old_milestone', 'The card is still out there.'],
            ['pier_stage', 'Vanguard\'s handlers prepare the stage behind closed doors.'],
        ]);
    });

    it('keeps only the action when the check echoes the whole trigger line', () => {
        const checked = applyPlanCheck(makeReplannedAct(), {
            rewrites: [{ kind: 'trigger', id: 'usb_accepted', text: 'IF If Ellie takes the drive → Vera\'s facade shatters into tearful gratitude.' }],
        }, []);

        assert.equal(checked.triggers[0].action, 'Vera\'s facade shatters into tearful gratitude.');
    });

    it('on a re-plan, un-marks an existing secret the check no longer lists — the user may have rewound the reveal', () => {
        const arc = makeReplannedAct();
        arc.secrets[0].disclosed = true;

        const checked = applyPlanCheck(arc, { revealed: [] }, EARLIER_LEASH);

        assert.equal(checked.secrets[0].disclosed, false);
    });

    it('keeps every earlier secret as stored when a re-plan\'s answer has no revealed list', () => {
        // The planner rewrote brother_leash and added gala_deal; without a
        // revealed list nothing says whether brother_leash came out.
        const arc = makeReplannedAct();
        arc.secrets = [
            { id: 'brother_leash', content: 'Vanguard holds her brother\'s debts.', revealPhase: 'climax', disclosed: false },
            { id: 'gala_deal', content: 'Julian bought the gala seats with Vanguard money.', revealPhase: 'any', disclosed: false },
        ];
        const earlierSecrets = [
            { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: false },
            { id: 'old_vow', content: 'Vera swore an oath to the guild.', revealPhase: 'any', disclosed: true },
        ];
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = message => warnings.push(message);
        let checked;
        try {
            checked = applyPlanCheck(arc, {
                rewrites: [
                    { kind: 'secret', id: 'brother_leash', text: 'The clinic answers to Vanguard.' },
                    { kind: 'secret', id: 'gala_deal', text: 'Julian paid for the gala seats himself.' },
                ],
            }, earlierSecrets);
        } finally {
            console.warn = originalWarn;
        }

        assert.deepEqual(checked.secrets, [
            { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: false },
            { id: 'old_vow', content: 'Vera swore an oath to the guild.', revealPhase: 'any', disclosed: true },
            { id: 'gala_deal', content: 'Julian paid for the gala seats himself.', revealPhase: 'any', disclosed: false },
        ]);
        assert.deepEqual(warnings, ['[Story Arc] Re-plan keeps every earlier secret as stored: the plan check gave no revealed list']);
    });

    it('leaves a new plan\'s secrets alone when the answer has no revealed list', () => {
        const checked = applyPlanCheck(makeReplannedAct(), { rewrites: [] }, []);

        assert.deepEqual(checked.secrets, makeReplannedAct().secrets);
    });

    it('treats an earlier secret the ledger saw come out as revealed though the list leaves it out', () => {
        const arc = makeReplannedAct();
        arc.secrets[0] = { id: 'brother_leash', content: 'Vanguard holds her brother\'s debts.', revealPhase: 'climax', disclosed: false };

        const checked = applyPlanCheck(arc, {
            revealed: [],
            rewrites: [{ kind: 'secret', id: 'brother_leash', text: 'The clinic answers to Vanguard.' }],
        }, EARLIER_LEASH, {}, ['brother_leash']);

        assert.deepEqual(checked.secrets[0], { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: true });
    });

    it('never un-marks a secret the story cannot have revealed — only the re-planned arc\'s own', () => {
        const arc = makeReplannedAct();
        arc.secrets[1].disclosed = true;

        const checked = applyPlanCheck(arc, { revealed: [] }, EARLIER_LEASH);

        assert.equal(checked.secrets[1].disclosed, true);
    });

    it('marks nothing revealed on a new plan — its secrets were just invented', () => {
        const checked = applyPlanCheck(makeReplannedAct(), { revealed: ['brother_leash'], rewrites: [], links: [] }, []);

        assert.equal(checked.secrets[0].disclosed, false);
    });

    it('keeps a link the generator set and ignores a link to an unknown secret', () => {
        const arc = makeReplannedAct();
        arc.triggers[0].secret = 'jumbotron_cut';

        const checked = applyPlanCheck(arc, {
            links: [
                { trigger: 'usb_accepted', secret: 'brother_leash' },
                { trigger: 'photo_leak', secret: 'no_such_secret' },
            ],
        }, []);

        assert.equal(checked.triggers[0].secret, 'jumbotron_cut');
        assert.equal(checked.triggers[1].secret, '');
    });

    it('ignores an empty rewrite and an answer of the wrong shape', () => {
        const arc = makeReplannedAct();

        const emptyRewrite = applyPlanCheck(arc, { rewrites: [{ kind: 'pressure', id: 'pier_stage', text: '  ' }] }, []);
        const wrongShape = applyPlanCheck(arc, { revealed: 'brother_leash', rewrites: { id: 'pier_stage' }, links: null }, EARLIER_LEASH);

        assert.equal(emptyRewrite.beats[1].pressure, 'The stage is rigged with Julian\'s gauntlet tether.');
        assert.deepEqual(wrongShape, arc);
    });

    it('replaces only the fulfillment of the beat the rewrite names', () => {
        const arc = makeReplannedAct();
        arc.beats.push({ id: 'rookie_drills', pressure: 'Shifts pile up.', intention: 'Ellie has completed her first patrols and training shifts.', status: 'active' });

        const checked = applyPlanCheck(arc, {
            rewrites: [{ kind: 'fulfillment', id: 'rookie_drills', text: 'Someone in authority has treated Ellie as a working Ward rather than a viral act.' }],
        }, []);

        assert.deepEqual(checked.beats.map(beat => [beat.id, beat.pressure, beat.intention]), [
            ['old_milestone', 'The card is still out there.', 'The card was destroyed.'],
            ['pier_stage', 'The stage is rigged with Julian\'s gauntlet tether.', 'The scrimmage was played.'],
            ['rookie_drills', 'Shifts pile up.', 'Someone in authority has treated Ellie as a working Ward rather than a viral act.'],
        ]);
    });

    it('rewrites a pressure and a fulfillment of the same beat together', () => {
        const checked = applyPlanCheck(makeReplannedAct(), {
            rewrites: [
                { kind: 'pressure', id: 'pier_stage', text: 'The handlers prepare the stage.' },
                { kind: 'fulfillment', id: 'pier_stage', text: 'The crowd has seen Ellie hold the stage.' },
            ],
        }, []);

        assert.deepEqual([checked.beats[1].pressure, checked.beats[1].intention], ['The handlers prepare the stage.', 'The crowd has seen Ellie hold the stage.']);
    });

    it('ignores and logs a fulfillment rewrite for a completed beat, an unknown beat or with empty text', () => {
        const arc = makeReplannedAct();
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = message => warnings.push(message);
        let checked;
        try {
            checked = applyPlanCheck(arc, {
                rewrites: [
                    { kind: 'fulfillment', id: 'old_milestone', text: 'A rewrite of a completed milestone.' },
                    { kind: 'fulfillment', id: 'no_such_beat', text: 'Nowhere to go.' },
                    { kind: 'fulfillment', id: 'pier_stage', text: '  ' },
                ],
            }, []);
        } finally {
            console.warn = originalWarn;
        }

        assert.deepEqual(checked.beats.map(beat => beat.intention), ['The card was destroyed.', 'The scrimmage was played.']);
        assert.deepEqual(warnings, [
            '[Story Arc] Plan check rewrote the fulfillment of unknown or closed beat "old_milestone"; ignored',
            '[Story Arc] Plan check rewrote the fulfillment of unknown or closed beat "no_such_beat"; ignored',
            '[Story Arc] Plan check answered an empty fulfillment for beat "pier_stage"; ignored',
        ]);
    });

    it('restores an earlier secret the story revealed in place of the planner\'s rewrite, and never rewrites it', () => {
        // The secret came out on screen but was never marked disclosed, and
        // the planner rewrote it under its id.
        const arc = makeReplannedAct();
        arc.secrets[0] = { id: 'brother_leash', content: 'Vanguard holds her brother\'s debts.', revealPhase: 'climax', disclosed: false, holders: ['Julian'] };
        arc.triggers[0].secret = 'brother_leash';
        const earlierSecrets = [
            { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: false, holders: ['Vera'] },
        ];

        const checked = applyPlanCheck(arc, {
            revealed: ['brother_leash'],
            rewrites: [{ kind: 'secret', id: 'brother_leash', text: 'The clinic answers to Vanguard.' }],
        }, earlierSecrets);

        assert.deepEqual(checked.secrets[0], { id: 'brother_leash', content: 'Her brother\'s clinic place is the leash.', revealPhase: 'escalation', disclosed: true, holders: ['Vera'] });
        assert.equal(checked.triggers[0].secret, 'brother_leash');
    });

    it('brings back an earlier secret the story revealed when the plan dropped it', () => {
        const arc = makeReplannedAct();
        const earlierSecrets = [
            { id: 'gala_deal', content: 'Julian bought the gala seats with Vanguard money.', revealPhase: 'any', disclosed: false, holders: ['Julian'] },
        ];

        const checked = applyPlanCheck(arc, { revealed: ['gala_deal'] }, earlierSecrets);

        assert.deepEqual(checked.secrets.map(secret => [secret.id, secret.disclosed]), [
            ['brother_leash', false],
            ['jumbotron_cut', false],
            ['gala_deal', true],
        ]);
        assert.equal(checked.secrets[2].content, 'Julian bought the gala seats with Vanguard money.');
    });

    it('keeps the planner\'s rewrite of an earlier secret the story did not reveal', () => {
        const arc = makeReplannedAct();
        arc.secrets[0] = { id: 'brother_leash', content: 'Vanguard holds her brother\'s debts.', revealPhase: 'climax', disclosed: false, holders: [] };

        const checked = applyPlanCheck(arc, { revealed: [] }, EARLIER_LEASH);

        assert.equal(checked.secrets[0].content, 'Vanguard holds her brother\'s debts.');
        assert.equal(checked.secrets[0].disclosed, false);
    });

    it('leaves a skipped milestone alone like a completed one', () => {
        const arc = makeReplannedAct();
        arc.beats.push({ id: 'gala_night', pressure: 'The gala looms.', intention: 'Ellie has attended the gala.', status: 'skipped' });
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = message => warnings.push(message);
        let checked;
        try {
            checked = applyPlanCheck(arc, {
                rewrites: [
                    { kind: 'pressure', id: 'gala_night', text: 'Vanguard counts the guests.' },
                    { kind: 'fulfillment', id: 'gala_night', text: 'Ellie has been seen at the gala.' },
                ],
            }, []);
        } finally {
            console.warn = originalWarn;
        }

        assert.deepEqual(checked.beats[2], { id: 'gala_night', pressure: 'The gala looms.', intention: 'Ellie has attended the gala.', status: 'skipped' });
        assert.deepEqual(warnings, ['[Story Arc] Plan check rewrote the fulfillment of unknown or closed beat "gala_night"; ignored']);
    });

    it('does not mutate the arc it is given', () => {
        const arc = makeReplannedAct();

        applyPlanCheck(arc, {
            revealed: ['brother_leash'],
            rewrites: [
                { kind: 'trigger', id: 'usb_accepted', text: 'Her composure cracks.' },
                { kind: 'fulfillment', id: 'pier_stage', text: 'The crowd has seen Ellie hold the stage.' },
            ],
            links: [{ trigger: 'usb_accepted', secret: 'brother_leash' }],
        }, EARLIER_LEASH);

        assert.deepEqual(arc, makeReplannedAct());
    });
});

describe('buildPlanCheckVariables', () => {
    it('lists secrets with phase and disclosure, unfired triggers and open pressures by id', () => {
        const arc = makeReplannedAct();
        arc.secrets[1].disclosed = true;

        const variables = buildPlanCheckVariables(arc, null);

        assert.equal(variables.STORY_BLOCK, '');
        assert.equal(variables.PREMISE, 'Vanguard wants the rookie humiliated.');
        assert.equal(variables.DIRECTION, 'Julian needs her to submit.');
        assert.equal(variables.SECRETS, [
            '- [brother_leash] (escalation) Her brother\'s clinic place is the leash.',
            '- [jumbotron_cut] (climax, disclosed) Julian rigged the Jumbotron to broadcast his gauntlet feed.',
        ].join('\n'));
        assert.equal(variables.TRIGGERS, '- [usb_accepted] IF Ellie takes the drive → Vera breaks down and swears to feed Ellie updates from inside.');
        assert.equal(variables.PRESSURES, '- [pier_stage] The stage is rigged with Julian\'s gauntlet tether.');
        assert.equal(variables.FULFILLMENTS, '- [pier_stage] The scrimmage was played.');
    });

    it('reads a re-plan\'s proposed premise as the premise, the stored one otherwise', () => {
        const arc = { ...makeReplannedAct(), proposedPremise: 'Vanguard wants the rookie broken before the final.' };

        assert.equal(buildPlanCheckVariables(arc, { analysis: 'A.', chatHistory: [] }).PREMISE, 'Vanguard wants the rookie broken before the final.');
        assert.equal(buildPlanCheckVariables(makeReplannedAct(), null).PREMISE, 'Vanguard wants the rookie humiliated.');
    });

    it('passes the fulfillments of open beats only — a re-plan\'s kept completed beat stays out', () => {
        const arc = makeReplannedAct();
        arc.beats.push({ id: 'rookie_drills', pressure: 'Shifts pile up.', intention: 'Ellie has completed her first patrols and training shifts.', status: 'pending' });

        const variables = buildPlanCheckVariables(arc, { analysis: 'A.', chatHistory: [] });

        assert.equal(variables.FULFILLMENTS, [
            '- [pier_stage] The scrimmage was played.',
            '- [rookie_drills] Ellie has completed her first patrols and training shifts.',
        ].join('\n'));
        assert.equal(variables.FULFILLMENTS.includes('The card was destroyed.'), false);
    });

    it('passes neither the pressure nor the fulfillment of a skipped milestone', () => {
        const arc = makeReplannedAct();
        arc.beats.push({ id: 'gala_night', pressure: 'The gala looms.', intention: 'Ellie has attended the gala.', status: 'skipped' });

        const variables = buildPlanCheckVariables(arc, { analysis: 'A.', chatHistory: [] });

        assert.equal(variables.PRESSURES, '- [pier_stage] The stage is rigged with Julian\'s gauntlet tether.');
        assert.equal(variables.FULFILLMENTS, '- [pier_stage] The scrimmage was played.');
    });

    it('on a re-plan, hides the old disclosure mark so the check judges from the story alone', () => {
        const arc = makeReplannedAct();
        arc.secrets[0].disclosed = true;

        const variables = buildPlanCheckVariables(arc, { analysis: 'A.', chatHistory: [] });

        assert.equal(variables.SECRETS.split('\n')[0], '- [brother_leash] (escalation) Her brother\'s clinic place is the leash.');
    });

    it('gives a re-plan the analysis and the last ten story messages', () => {
        const messages = Array.from({ length: 12 }, (_, index) => ({ name: 'Narrator', content: `message ${index}` }));

        const variables = buildPlanCheckVariables(makeReplannedAct(), { analysis: 'Vera confessed on Floor 3.', chatHistory: messages }, [], EARLIER_LEASH);

        const lastTen = ['message 2', 'message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9', 'message 10', 'message 11']
            .map(text => `Narrator: ${text}`)
            .join('\n\n');
        assert.equal(variables.STORY_BLOCK, `== STORY SO FAR ==\nAnalysis: Vera confessed on Floor 3.\n\nMost recent messages:\n${lastTen}\n\n`
            + '== SECRETS BEFORE THIS RE-PLAN ==\n'
            + 'The arc\'s secrets as they were worded while the story above was played. The plan below may have rewritten or dropped some of them; step 1 judges these.\n'
            + '- [brother_leash] Her brother\'s clinic place is the leash.\n\n');
    });

    it('writes (none) under the secrets before the re-plan when the arc had none', () => {
        const variables = buildPlanCheckVariables(makeReplannedAct(), { analysis: 'A.', chatHistory: [] }, [], []);

        assert.ok(variables.STORY_BLOCK.endsWith('step 1 judges these.\n(none)\n\n'), variables.STORY_BLOCK);
    });

    it('writes (none) for an empty list', () => {
        const arc = { ...makeReplannedAct(), secrets: [], triggers: [], beats: [] };

        const variables = buildPlanCheckVariables(arc, null);

        assert.deepEqual([variables.SECRETS, variables.TRIGGERS, variables.PRESSURES, variables.FULFILLMENTS], ['(none)', '(none)', '(none)', '(none)']);
    });
});
