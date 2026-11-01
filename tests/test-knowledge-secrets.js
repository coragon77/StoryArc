import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection } from '../lib/injection/builder.js';
import { chat, chat_metadata, extension_settings } from './mocks/st-mocks.js';

/** An episode arc in setup with two secrets: one with holders, one without. */
function makeArc() {
    return {
        id: 'abcd1234-full-id',
        title: 'The Crane Drop',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        messageStart: 0,
        premise: 'A premise.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [
            { id: 's_a', content: 'Julian plans the crane drop.', revealPhase: 'any', disclosed: false, holders: ['Julian', 'Brody'] },
            { id: 's_b', content: 'The permit is forged.', revealPhase: 'any', disclosed: false },
        ],
        foreshadowing: [],
        triggers: [],
        estimatedLength: 40,
        beats: [
            { id: 'b1', pressure: 'The site goes quiet.', intention: 'x', status: 'active', optional: false },
        ],
    };
}

function setTracker(enabled) {
    extension_settings.story_arc = { knowledgeTracker: { enabled, updateInterval: 1 } };
}

function build(arcs) {
    chat.length = 0;
    return buildInjection(arcs);
}

afterEach(() => {
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc?.settings?.injectionBudget;
});

describe('SECRETS block — holders with the knowledge tracker on', () => {
    it('ends a secret with holders with its holder suffix, and prints one without as before', () => {
        setTracker(true);
        const text = build([makeArc()]);
        assert.ok(text.includes([
            'SECRETS (guard these carefully — do not reveal directly):',
            '- Julian plans the crane drop. (known only to: Julian, Brody)',
            '- The permit is forged.',
            '',
        ].join('\n')), text);
    });
});

describe('SECRETS block — the knowledge tracker off', () => {
    /** Today's injection for makeArc(): no holder text anywhere. */
    const EXPECTED_OFF = [
        '[STORY ARC - NARRATIVE DIRECTION]',
        '',
        '=== FOREGROUNDED: "The Crane Drop" ===',
        '[Phase: Setup | Pacing: Do not rush]',
        '',
        'PREMISE: A premise.',
        '',
        'CURRENT PRESSURE:',
        'The site goes quiet.',
        '',
        'PACING RULES:',
        '- You are in SETUP phase. Plant seeds. Build atmosphere. No revelations. No confrontations.',
        '- If tempted to resolve something — add a complication instead.',
        '',
        'SECRETS (guard these carefully — do not reveal directly):',
        '- Julian plans the crane drop.',
        '- The permit is forged.',
        '',
        '[END STORY ARC]',
    ].join('\n');

    it('prints the whole injection as before when the switch is off', () => {
        setTracker(false);
        assert.equal(build([makeArc()]), EXPECTED_OFF);
    });

    it('prints the whole injection as before when the tracker settings were never loaded', () => {
        assert.equal(build([makeArc()]), EXPECTED_OFF);
    });
});

describe('SECRETS block — budget trim with holders', () => {
    it('drops whole secret lines, holder suffix included, from the last one backwards', () => {
        setTracker(true);
        const arc = makeArc();
        arc.secrets = Array.from({ length: 30 }, (_, index) => ({
            id: `s_${index}`,
            content: `Secret number ${index}, phrased at length so each line carries real weight.`,
            revealPhase: 'any',
            disclosed: false,
            holders: ['Julian', 'Brody'],
        }));
        chat_metadata.story_arc.settings.injectionBudget = 200;
        const text = build([arc]);

        assert.ok(text.includes('SECRETS (guard these carefully — do not reveal directly):\n- Secret number 0, phrased at length so each line carries real weight. (known only to: Julian, Brody)\n'), text);
        assert.equal(text.includes('Secret number 29'), false);
        assert.ok(text.includes('PACING RULES:\n- You are in SETUP phase.'));
        assert.ok(Math.ceil((text.length - '\n[END STORY ARC]'.length) / 4) <= 200, 'trimmed to the budget');
        for (const line of text.split('\n')) {
            if (line.startsWith('- Secret number')) {
                assert.ok(line.endsWith(' (known only to: Julian, Brody)'), `intact line: ${line}`);
            }
        }
    });
});
