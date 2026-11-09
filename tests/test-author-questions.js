import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import {
    answeredAuthorAnswers, buildAskQuestionsVariables, clearTemplateCache, formatAuthorAnswersBlock,
    generateArc, loadTemplate, parseAuthorQuestions, prepareArc,
} from '../lib/planning/generator.js';
import { validateArcPlan } from '../lib/planning/validation.js';
import { mergeReplan } from '../lib/planning/replan.js';
import { buildInjection } from '../lib/injection/builder.js';

const read = name => readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');

function makeArc(overrides = {}) {
    return {
        id: 'arc00001-full-id',
        title: 'The Quiet Debt',
        status: 'active',
        tier: 'act',
        focus: 'normal',
        messageStart: 0,
        premise: 'A debt comes due.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        worldFacts: [],
        secrets: [{ id: 's1', content: 'The lender is her brother.', revealPhase: 'climax', disclosed: false }],
        foreshadowing: [],
        triggers: [],
        characters: [],
        escalation: 'Each favour costs more.',
        estimatedLength: 90,
        beats: [
            { id: 'm1', pressure: 'The favours keep coming, and so do the hints.', intention: 'She has refused a favour.', status: 'active', optional: false },
        ],
        ...overrides,
    };
}

describe('parseAuthorQuestions', () => {
    it('reads the questions with their suggestions, trimmed', () => {
        const response = JSON.stringify({ questions: [
            { question: ' How does the pressure work? ', suggestions: [' Open force ', 'Deniable hints nobody admits'] },
            { question: 'Can an ally talk a dilemma away?', suggestions: ['Yes, sometimes', 'No, nobody rescues'] },
        ] });
        assert.deepEqual(parseAuthorQuestions(response), [
            { question: 'How does the pressure work?', suggestions: ['Open force', 'Deniable hints nobody admits'] },
            { question: 'Can an ally talk a dilemma away?', suggestions: ['Yes, sometimes', 'No, nobody rescues'] },
        ]);
    });

    it('reads JSON inside prose or a code fence like the outline', () => {
        const response = 'Here you go:\n```json\n{ "questions": [{ "question": "How dark is it?", "suggestions": ["Light", "Bleak"] }] }\n```';
        assert.deepEqual(parseAuthorQuestions(response), [{ question: 'How dark is it?', suggestions: ['Light', 'Bleak'] }]);
    });

    it('gives no questions for garbage, a missing list or a list of the wrong shape', () => {
        assert.deepEqual(parseAuthorQuestions('I would ask about the tone.'), []);
        assert.deepEqual(parseAuthorQuestions('{ "asked": [] }'), []);
        assert.deepEqual(parseAuthorQuestions('{ "questions": "How dark?" }'), []);
    });

    it('gives no questions for an empty list', () => {
        assert.deepEqual(parseAuthorQuestions('{ "questions": [] }'), []);
    });

    it('caps the questions at five', () => {
        const questions = ['One?', 'Two?', 'Three?', 'Four?', 'Five?', 'Six?', 'Seven?'].map(question => ({ question, suggestions: ['A', 'B'] }));
        const parsed = parseAuthorQuestions(JSON.stringify({ questions }));
        assert.deepEqual(parsed.map(item => item.question), ['One?', 'Two?', 'Three?', 'Four?', 'Five?']);
    });

    it('caps the suggestions at four and drops blank and non-text ones', () => {
        const response = JSON.stringify({ questions: [
            { question: 'Who may step in?', suggestions: ['Nobody', '  ', 7, 'The guild', 'A friend', 'The law', 'Her mother'] },
        ] });
        assert.deepEqual(parseAuthorQuestions(response), [
            { question: 'Who may step in?', suggestions: ['Nobody', 'The guild', 'A friend', 'The law'] },
        ]);
    });

    it('drops an item without a question and keeps one without suggestions', () => {
        const response = JSON.stringify({ questions: [
            { question: '   ', suggestions: ['A', 'B'] },
            'How dark?',
            { suggestions: ['A'] },
            { question: 'What must never happen?' },
        ] });
        assert.deepEqual(parseAuthorQuestions(response), [{ question: 'What must never happen?', suggestions: [] }]);
    });
});

describe('answeredAuthorAnswers', () => {
    it('keeps the answered pairs, trimmed, and drops the blank ones', () => {
        const answers = [
            { question: ' How does the pressure work? ', answer: ' Deniable hints. ', suggestions: ['x'] },
            { question: 'Who rescues her?', answer: '   ' },
            { question: '', answer: 'Orphaned answer' },
            null,
        ];
        assert.deepEqual(answeredAuthorAnswers(answers), [{ question: 'How does the pressure work?', answer: 'Deniable hints.' }]);
    });

    it('gives an empty list for anything but a list', () => {
        assert.deepEqual(answeredAuthorAnswers(undefined), []);
        assert.deepEqual(answeredAuthorAnswers('Nobody.'), []);
    });
});

describe('formatAuthorAnswersBlock', () => {
    it('renders nothing without answers, so the template keeps no dangling header', () => {
        assert.equal(formatAuthorAnswersBlock([]), '');
        assert.equal(formatAuthorAnswersBlock(undefined), '');
    });

    it('binds the answers like the direction, a Q and an A line per pair, the answer winning over genre, themes and preference', () => {
        const block = formatAuthorAnswersBlock([
            { question: 'How does the pressure work?', answer: 'Through deniable hints nobody admits to.' },
            { question: 'Can an ally talk a dilemma away?', answer: 'No. Nobody rescues.' },
        ]);
        assert.equal(block, `== AUTHOR'S ANSWERS (binding, like the direction) ==
Q: How does the pressure work?
A: Through deniable hints nobody admits to.
Q: Can an ally talk a dilemma away?
A: No. Nobody rescues.

These are the author's own words about this arc, and they bind like the direction: where an answer and the genre, the themes or your own preference disagree, the answer wins.

`);
    });
});

describe('buildAskQuestionsVariables', () => {
    it('a new arc: the direction, tier, genre, themes, analysis and running arcs; no arc so far, nothing answered', () => {
        const variables = buildAskQuestionsVariables({
            analysis: 'She owes more than money.',
            userDirection: 'A debt she cannot pay.',
            existingArcs: [{ id: 'other', focus: 'normal', title: 'The Harbour', premise: 'Smugglers move in.' }],
            tier: 'act',
            reviseArc: null,
            genre: 'Drama',
            themeSeeds: 'guilt, family',
        });
        assert.deepEqual(variables, {
            USER_DIRECTION: 'A debt she cannot pay.',
            TIER: 'Act (roughly 60-150 messages of play)',
            GENRE: 'Drama',
            THEMES: 'guilt, family',
            PHASE1_ANALYSIS: 'She owes more than money.',
            EXISTING_ARCS: '[NORMAL] "The Harbour" — Smugglers move in.',
            ARC_SO_FAR: '',
            ANSWERED: '(none)',
        });
    });

    it('marks an empty direction, genre and themes as such', () => {
        const variables = buildAskQuestionsVariables({ analysis: 'A.', userDirection: '', existingArcs: [], tier: 'episode', reviseArc: null, genre: '', themeSeeds: '' });
        assert.equal(variables.USER_DIRECTION, '(No direction given)');
        assert.equal(variables.TIER, 'Episode (roughly 8-20 messages of play)');
        assert.equal(variables.GENRE, '(none)');
        assert.equal(variables.THEMES, '(none)');
        assert.equal(variables.EXISTING_ARCS, '(No existing arcs)');
    });

    it('a re-plan: the arc so far as the outline gets it, the earlier answers as answered, the arc itself not among the running arcs', () => {
        const reviseArc = makeArc({ authorAnswers: [{ question: 'Who rescues her?', answer: 'Nobody.' }, { question: 'How dark?', answer: ' ' }] });
        const variables = buildAskQuestionsVariables({
            analysis: 'She owes more than money.',
            userDirection: 'Tighten the screws.',
            existingArcs: [reviseArc, { id: 'other', focus: 'background', title: 'The Harbour', premise: 'Smugglers move in.' }],
            tier: 'act',
            reviseArc,
            genre: '',
            themeSeeds: '',
        });
        assert.ok(variables.ARC_SO_FAR.startsWith('== ARC SO FAR ==\nYou are RE-PLANNING an arc that is already running'));
        assert.ok(variables.ARC_SO_FAR.includes('\nCurrent premise: A debt comes due.\n'));
        assert.equal(variables.ANSWERED, 'Q: Who rescues her?\nA: Nobody.');
        assert.equal(variables.EXISTING_ARCS, '[BACKGROUND] "The Harbour" — Smugglers move in.');
    });
});

describe('the question prompt and the outline slot', () => {
    it('the loader accepts the question prompt', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response('ASK');
        clearTemplateCache();
        try {
            assert.equal(await loadTemplate('ask-questions.txt'), 'ASK');
        } finally {
            globalThis.fetch = originalFetch;
            clearTemplateCache();
        }
    });

    it('the question prompt carries every input slot once', () => {
        const text = read('ask-questions.txt');
        for (const slot of ['USER_DIRECTION', 'TIER', 'GENRE', 'THEMES', 'PHASE1_ANALYSIS', 'EXISTING_ARCS', 'ARC_SO_FAR', 'ANSWERED']) {
            assert.equal(text.split(`{{${slot}}}`).length - 1, 1, slot);
        }
    });

    it('the question prompt states what to ask, what never to ask, and the output', () => {
        const text = read('ask-questions.txt');
        assert.ok(text.includes('Ask only where the answer would change the plan materially AND the direction leaves it open.'));
        assert.ok(text.includes('- How pressure works: open force, or deniable leverage nobody admits to.\n'));
        assert.ok(text.includes('- Whether allies or institutions can resolve a dilemma or step in, or whether nobody rescues.\n'));
        assert.ok(text.includes('- What must never happen: hard lines.\n'));
        assert.ok(text.includes('1. Never ask what the direction, the genre, the themes or an earlier answer already answers.\n'));
        assert.ok(text.includes('2. Never propose plot, twists or secrets, and never hint at one. The author must not be spoiled'));
        assert.ok(text.includes('4. Give each question 2 to 4 short suggested answers. They are distinct positions the author could take, not one right answer plus filler.\n'));
        assert.ok(text.includes('6. Zero questions is right when the direction is already specific. Then answer with an empty list.\n'));
        assert.ok(text.includes('"questions": [\n    { "question": "A short question about the author\'s intent", "suggestions": ["A short position", "Another position"] }\n  ]'));
    });

    it('the outline puts the answers right after the creative direction, and checks them', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('{{USER_DIRECTION}}\n\n{{AUTHOR_ANSWERS_BLOCK}}{{THEMES_BLOCK}}'));
        assert.equal(text.split('{{AUTHOR_ANSWERS_BLOCK}}').length - 1, 1);
        assert.ok(text.includes('- [ ] If an AUTHOR\'S ANSWERS block is given: nothing in the plan contradicts an answer\n'));
    });
});

describe('generation with the author\'s answers', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;

    const MINIMAL_TEMPLATES = {
        'analyze-context.txt': 'ANALYSE',
        'ask-questions.txt': 'ASK {{USER_DIRECTION}} | {{ANSWERED}}',
        'generate-arc.txt': 'OUTLINE {{PHASE1_ANALYSIS}}\n{{AUTHOR_ANSWERS_BLOCK}}END',
        'check-plan.txt': 'CHECK',
    };

    const generatedPlan = JSON.stringify({
        title: 'The Quiet Debt',
        premise: 'A debt comes due.',
        beats: [{ id: 'favour', pressure: 'The favours keep coming.', intention: 'She has refused a favour.' }],
        secrets: [],
        triggers: [],
        authorAnswers: [{ question: 'Model echo?', answer: 'Echo.' }],
    });
    const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [] });
    const context = {
        character: null,
        persona: { name: '', description: '' },
        lorebook: { constants: [], arcSummaries: [], recent: [] },
        chatHistory: [],
        existingArcs: [],
        cast: [],
    };

    /** Each call answers the next text; a function answer may throw. */
    function installBackend(answers) {
        const sentPrompts = [];
        globalThis.fetch = async (url) => new Response(MINIMAL_TEMPLATES[String(url).split('/').pop()]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const answer = answers.shift();
            const text = typeof answer === 'function' ? answer() : answer;
            return () => (async function* () { yield { text }; })();
        };
        return sentPrompts;
    }

    beforeEach(() => {
        clearTemplateCache();
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    it('prepareArc runs Phase 1, then the question call, and hands back both', async () => {
        const questions = JSON.stringify({ questions: [{ question: 'How dark is it?', suggestions: ['Light', 'Bleak'] }] });
        const sentPrompts = installBackend(['She owes more than money.', questions]);
        const phases = [];

        const prepared = await prepareArc(context, 'A debt.', { onProgress: phase => phases.push(phase) });

        assert.deepEqual(sentPrompts, ['ANALYSE', 'ASK A debt. | (none)']);
        assert.deepEqual(phases, ['phase1', 'questions']);
        assert.deepEqual(prepared, { analysis: 'She owes more than money.', questions: [{ question: 'How dark is it?', suggestions: ['Light', 'Bleak'] }] });
    });

    it('prepareArc: a failed question call means no questions, never a failed generation', async () => {
        installBackend(['She owes more than money.', () => { throw new Error('401 Unauthorized'); }]);
        const phases = [];

        const prepared = await prepareArc(context, 'A debt.', { onProgress: (phase, message) => phases.push([phase, message]) });

        assert.deepEqual(prepared, { analysis: 'She owes more than money.', questions: [] });
        assert.deepEqual(phases.at(-1), ['retry', 'Questions failed (401 Unauthorized) — planning without them']);
    });

    it('prepareArc on a re-plan tells the question call the arc\'s earlier answers', async () => {
        const sentPrompts = installBackend(['She owes more than money.', '{ "questions": [] }']);
        const reviseArc = makeArc({ authorAnswers: [{ question: 'Who rescues her?', answer: 'Nobody.' }] });

        await prepareArc({ ...context, existingArcs: [reviseArc] }, 'Tighten the screws.', {}, { tier: 'act', reviseArc });

        assert.equal(sentPrompts[1], 'ASK Tighten the screws. | Q: Who rescues her?\nA: Nobody.');
    });

    it('generateArc given an analysis skips Phase 1 and plans from it', async () => {
        const sentPrompts = installBackend([generatedPlan, planCheckAnswer]);
        const phases = [];

        const result = await generateArc(context, 'A debt.', { onProgress: phase => phases.push(phase) }, { analysis: 'She owes more than money.' });

        assert.equal(result.error, null);
        assert.deepEqual(sentPrompts, ['OUTLINE She owes more than money.\nEND', 'CHECK']);
        assert.deepEqual(phases, ['phase2', 'phase3']);
    });

    it('generateArc without an analysis still runs Phase 1 first', async () => {
        const sentPrompts = installBackend(['She owes more than money.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(context, 'A debt.');

        assert.equal(result.error, null);
        assert.deepEqual(sentPrompts, ['ANALYSE', 'OUTLINE She owes more than money.\nEND', 'CHECK']);
    });

    it('the outline gets the answered pairs; the arc carries them, never the model\'s echo', async () => {
        const sentPrompts = installBackend([generatedPlan, planCheckAnswer]);
        const authorAnswers = [
            { question: ' How does the pressure work? ', answer: ' Deniable hints. ' },
            { question: 'How dark is it?', answer: '' },
        ];

        const result = await generateArc(context, 'A debt.', {}, { analysis: 'She owes more.', authorAnswers });

        assert.equal(sentPrompts[0], `OUTLINE She owes more.
== AUTHOR'S ANSWERS (binding, like the direction) ==
Q: How does the pressure work?
A: Deniable hints.

These are the author's own words about this arc, and they bind like the direction: where an answer and the genre, the themes or your own preference disagree, the answer wins.

END`);
        assert.deepEqual(result.arc.authorAnswers, [{ question: 'How does the pressure work?', answer: 'Deniable hints.' }]);
    });

    it('without answers the arc has no authorAnswers, even when the model echoes some', async () => {
        installBackend([generatedPlan, planCheckAnswer]);

        const result = await generateArc(context, 'A debt.', {}, { analysis: 'She owes more.', authorAnswers: [{ question: 'Q?', answer: '  ' }] });

        assert.equal('authorAnswers' in result.arc, false);
    });

    it('a re-plan keeps the answers as the wizard passed them on the arc being re-planned', async () => {
        installBackend([generatedPlan, planCheckAnswer]);
        const authorAnswers = [{ question: 'Who rescues her?', answer: 'Nobody, ever.' }];
        const reviseArc = makeArc({ authorAnswers });

        const result = await generateArc({ ...context, existingArcs: [reviseArc] }, 'A debt.', {}, { tier: 'act', reviseArc, analysis: 'She owes more.', authorAnswers });

        assert.equal(result.error, null);
        assert.equal(result.arc.id, 'arc00001-full-id');
        assert.deepEqual(result.arc.authorAnswers, [{ question: 'Who rescues her?', answer: 'Nobody, ever.' }]);
    });
});

describe('the answers are planning input only', () => {
    it('validateArcPlan drops authorAnswers the model echoed', () => {
        const raw = {
            title: 'The Quiet Debt',
            premise: 'A debt comes due.',
            beats: [{ id: 'favour', intention: 'She has refused a favour.' }],
            authorAnswers: [{ question: 'Echo?', answer: 'Echo.' }],
        };
        const { arc } = validateArcPlan(raw, { tier: 'episode' });
        assert.equal('authorAnswers' in arc, false);
    });

    it('mergeReplan takes the answers from the re-planned arc, not from the generated plan', () => {
        const existing = makeArc({ authorAnswers: [{ question: 'Who rescues her?', answer: 'Nobody.' }] });
        const generated = makeArc({ authorAnswers: [{ question: 'Echo?', answer: 'Echo.' }], beats: [] });
        assert.deepEqual(mergeReplan(existing, generated).authorAnswers, [{ question: 'Who rescues her?', answer: 'Nobody.' }]);
    });

    it('no section of any tier or focus carries a question or an answer', () => {
        const authorAnswers = [{ question: 'How does the pressure work?', answer: 'Through deniable hints nobody admits to.' }];
        for (const tier of ['episode', 'act', 'saga']) {
            for (const focus of ['normal', 'spotlight', 'background', 'paused']) {
                const arc = makeArc({ tier, focus, authorAnswers, estimatedLength: tier === 'episode' ? 20 : 800 });
                const text = buildInjection([arc]);
                assert.ok(text.includes('The Quiet Debt'), `${tier}/${focus}`);
                assert.equal(text.includes('deniable hints'), false, `${tier}/${focus}`);
                assert.equal(text.includes('How does the pressure work'), false, `${tier}/${focus}`);
                assert.equal(text.includes('ANSWERS'), false, `${tier}/${focus}`);
            }
        }
    });
});
