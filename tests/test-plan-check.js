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
        }, ['brother_leash']);

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
        const wrongShape = applyPlanCheck(arc, { revealed: 'brother_leash', rewrites: { id: 'pier_stage' }, links: null }, ['brother_leash']);

        assert.equal(emptyRewrite.beats[1].pressure, 'The stage is rigged with Julian\'s gauntlet tether.');
        assert.deepEqual(wrongShape, arc);
    });

    it('does not mutate the arc it is given', () => {
        const arc = makeReplannedAct();

        applyPlanCheck(arc, {
            revealed: ['brother_leash'],
            rewrites: [{ kind: 'trigger', id: 'usb_accepted', text: 'Her composure cracks.' }],
            links: [{ trigger: 'usb_accepted', secret: 'brother_leash' }],
        }, ['brother_leash']);

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
    });

    it('gives a re-plan the analysis and the last ten story messages', () => {
        const messages = Array.from({ length: 12 }, (_, index) => ({ name: 'Narrator', content: `message ${index}` }));

        const variables = buildPlanCheckVariables(makeReplannedAct(), { analysis: 'Vera confessed on Floor 3.', chatHistory: messages });

        const lastTen = ['message 2', 'message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9', 'message 10', 'message 11']
            .map(text => `Narrator: ${text}`)
            .join('\n\n');
        assert.equal(variables.STORY_BLOCK, `== STORY SO FAR ==\nAnalysis: Vera confessed on Floor 3.\n\nMost recent messages:\n${lastTen}\n\n`);
    });

    it('writes (none) for an empty list', () => {
        const arc = { ...makeReplannedAct(), secrets: [], triggers: [], beats: [] };

        const variables = buildPlanCheckVariables(arc, null);

        assert.deepEqual([variables.SECRETS, variables.TRIGGERS, variables.PRESSURES], ['(none)', '(none)', '(none)']);
    });
});
