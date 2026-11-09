import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { formatGenreBlock, formatThemesBlock, generateArc, clearTemplateCache } from '../lib/planning/generator.js';
import { latestArcText } from '../lib/planning/storage.js';
import { mergeReplan } from '../lib/planning/replan.js';
import { buildInjection } from '../lib/injection/builder.js';

const GENRE = 'High fantasy adventure: guild jobs, monsters and ruins, banter around the campfire.';

function makeArc(overrides = {}) {
    return {
        id: 'gen00001-full-id',
        title: 'The Shadow over Greymoor',
        status: 'active',
        tier: 'saga',
        focus: 'normal',
        messageStart: 0,
        genre: GENRE,
        premise: 'The party joins the guild.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [{ id: 's1', content: 'The mentor once failed a trainee.', revealPhase: 'any', disclosed: false }],
        foreshadowing: [],
        triggers: [],
        estimatedLength: 800,
        beats: [
            { id: 'm1', pressure: 'The team has not decided whether she belongs.', intention: 'The team has claimed her.', status: 'active', optional: false },
        ],
        ...overrides,
    };
}

describe('formatGenreBlock', () => {
    it('renders nothing without a genre, so the template keeps no dangling header', () => {
        assert.equal(formatGenreBlock('', 'analysis'), '');
        assert.equal(formatGenreBlock('', 'outline'), '');
    });

    it('asks the analysis to read the story through the genre', () => {
        const block = formatGenreBlock(GENRE, 'analysis');
        assert.ok(block.startsWith('== GENRE OF THE ARC TO BE PLANNED ==\n'));
        assert.ok(block.includes(`\n${GENRE}\n`));
        assert.ok(block.includes('not as the story\'s true direction'));
        assert.ok(block.endsWith('\n\n'));
    });

    it('makes the genre binding for the outline, above analysis and recorded material', () => {
        const block = formatGenreBlock(GENRE, 'outline');
        assert.ok(block.startsWith('== GENRE (binding) ==\n'));
        assert.ok(block.includes(`\n${GENRE}\n`));
        assert.ok(block.includes('It outranks the story analysis and the recorded material'));
        assert.ok(block.endsWith('\n\n'));
    });

    it('binds the outline to the register only, never to what the genre\'s readers come for', () => {
        assert.equal(formatGenreBlock('Superhero drama', 'outline'), `== GENRE (binding) ==
The author has set this arc's genre. It outranks the story analysis and the recorded material: where they lean another way, follow the genre.

Superhero drama

The genre sets the arc's register: the arc reads as this genre. It does not mean every item carries the genre's signature. Most pressures, secrets, triggers and clues serve the plot, the characters and the stakes in the genre's voice; the genre's signature moments come from a few of them. Never build the arc on one device (one kind of incident, gag, mishap or set piece) repeated across secrets, pressures, triggers and clues: used once, a device lands; used everywhere, it turns the arc into a single joke.

`);
    });
});

describe('formatThemesBlock', () => {
    it('renders nothing without themes, so the template keeps no dangling header', () => {
        assert.equal(formatThemesBlock(''), '');
    });

    it('gives the themes as colour that seeds the themes field, never as obligations or world facts', () => {
        assert.equal(formatThemesBlock('corruption, political intrigue'), `== THEMES (colour, not obligations) ==
These are the author's themes for this arc:

corruption, political intrigue

They colour the arc: draw on them where the direction and the premise leave room. None of them is an obligation: none has to appear in the pressures, secrets, triggers or world facts. What the arc must deliver comes from the direction and the premise. A theme is never a world fact, and never the reason for a pressure, secret or trigger. The one place the themes seed is the arc's "themes" field: build its thematic statements from them, where the story supports them.

`);
    });
});

describe('prompt templates carry the genre slot', () => {
    const read = name => readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');

    it('analysis: after the context, before the task', () => {
        const text = read('analyze-context.txt');
        assert.ok(text.includes('== END OF CONTEXT ==\n\n{{GENRE_BLOCK}}== YOUR TASK =='));
    });

    it('outline: the genre after the analysis, before the creative direction', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('{{PHASE1_ANALYSIS}}\n\n{{GENRE_BLOCK}}{{CAST_BLOCK}}== AUTHOR\'S CREATIVE DIRECTION =='));
    });

    it('outline: the themes right after the creative direction, before the tier', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('{{USER_DIRECTION}}\n\n{{THEMES_BLOCK}}{{TIER_BLOCK}}'));
        assert.equal(text.split('{{THEMES_BLOCK}}').length - 1, 1);
    });

    it('analysis: no themes slot', () => {
        assert.equal(read('analyze-context.txt').includes('THEMES'), false);
    });

    it('outline checklist: the genre binds the register only; no theme is a world fact', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('- [ ] If a GENRE block is given: the arc reads as that genre, and no single device (one kind of incident, gag, mishap or set piece) repeats across the secrets, pressures, triggers and clues\n'));
        assert.ok(text.includes('- [ ] If a THEMES block is given: no theme is a world fact or the reason for a pressure, secret or trigger, and the `themes` field grows from the given themes where the story supports them\n'));
        assert.equal(text.includes('what its readers come for'), false);
    });

    it('outline schema: the author\'s themes seed the themes field', () => {
        assert.ok(read('generate-arc.txt').includes('"themes": ["List 2-4 thematic currents this arc explores. When a THEMES block is given, grow them from the author\'s themes where the story supports them.'));
    });

    it('outline: secrets are optional', () => {
        assert.ok(read('generate-arc.txt').includes('- Use 0-5 secrets'));
    });
});

describe('the genre steers generation only (ADR-0004 amendment 2026-11-09)', () => {
    it('a normal saga goes from its header straight to the premise', () => {
        const text = buildInjection([makeArc()]);
        assert.ok(text.includes('=== SAGA: "The Shadow over Greymoor" ===\nPREMISE: The party joins the guild.'));
    });

    it('a spotlit saga goes from its header straight to the premise', () => {
        const text = buildInjection([makeArc({ focus: 'spotlight' })]);
        assert.ok(text.includes('=== SAGA: "The Shadow over Greymoor" ===\nPREMISE: The party joins the guild.'));
    });

    it('an episode goes from its phase line straight to the premise', () => {
        const text = buildInjection([makeArc({ tier: 'episode', estimatedLength: 20 })]);
        assert.ok(text.includes('[Phase: Setup | Pacing: Do not rush]\n\nPREMISE: The party joins the guild.'));
    });

    it('no section of any tier or focus carries the genre', () => {
        for (const tier of ['episode', 'act', 'saga']) {
            for (const focus of ['normal', 'spotlight', 'background', 'paused']) {
                const text = buildInjection([makeArc({ tier, focus, estimatedLength: tier === 'episode' ? 20 : 800 })]);
                assert.equal(text.includes('GENRE'), false, `${tier}/${focus}`);
                assert.equal(text.includes(GENRE), false, `${tier}/${focus}`);
            }
        }
    });

    it('no section of any tier or focus carries the theme seeds', () => {
        for (const tier of ['episode', 'act', 'saga']) {
            for (const focus of ['normal', 'spotlight', 'background', 'paused']) {
                const arc = makeArc({ tier, focus, themeSeeds: 'corruption, political intrigue', estimatedLength: tier === 'episode' ? 20 : 800 });
                assert.equal(buildInjection([arc]).includes('corruption'), false, `${tier}/${focus}`);
            }
        }
    });
});

describe('latestArcText', () => {
    it('returns the genre of the newest arc that has one', () => {
        const arcs = [{ genre: 'Space opera' }, {}, { genre: 'Cozy mystery' }, { genre: '' }];
        assert.equal(latestArcText(arcs, 'genre'), 'Cozy mystery');
    });

    it('returns the genre of the first arc when it is the only arc that has one', () => {
        assert.equal(latestArcText([{ genre: 'Space opera' }, {}, { genre: '' }], 'genre'), 'Space opera');
        assert.equal(latestArcText([{ genre: 'Space opera' }], 'genre'), 'Space opera');
    });

    it('returns an empty string when no arc has a genre', () => {
        assert.equal(latestArcText([], 'genre'), '');
        assert.equal(latestArcText([{}, { genre: '' }], 'genre'), '');
    });

    it('returns the theme seeds of the newest arc that has them, whatever the newest genre', () => {
        const arcs = [{ themeSeeds: 'found family' }, {}, { themeSeeds: 'corruption' }, { genre: 'Space opera', themeSeeds: '' }];
        assert.equal(latestArcText(arcs, 'themeSeeds'), 'corruption');
    });

    it('returns an empty string when no arc has theme seeds', () => {
        assert.equal(latestArcText([], 'themeSeeds'), '');
        assert.equal(latestArcText([{ genre: 'Space opera' }, { themeSeeds: '' }], 'themeSeeds'), '');
    });
});

describe('mergeReplan keeps the genre as edited in the wizard', () => {
    it('takes the genre from the re-planned arc, not from the generated plan', () => {
        const existing = makeArc({ genre: 'Edited genre' });
        const generated = makeArc({ genre: 'Model echo', beats: [] });
        assert.equal(mergeReplan(existing, generated).genre, 'Edited genre');
    });

    it('takes the theme seeds from the re-planned arc, not from the generated plan', () => {
        const existing = makeArc({ themeSeeds: 'edited seeds' });
        const generated = makeArc({ themeSeeds: 'model echo', beats: [] });
        assert.equal(mergeReplan(existing, generated).themeSeeds, 'edited seeds');
    });
});

describe('generateArc: the genre reaches both phases, the themes only the outline', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;

    const MINIMAL_TEMPLATES = {
        'analyze-context.txt': 'ANALYSE\n{{GENRE_BLOCK}}END',
        'generate-arc.txt': 'OUTLINE\n{{GENRE_BLOCK}}{{THEMES_BLOCK}}END',
        'check-plan.txt': 'CHECK',
    };

    const generatedPlan = JSON.stringify({
        title: 'The Quiet Debt',
        premise: 'A debt comes due.',
        beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
        secrets: [],
        triggers: [],
        themeSeeds: 'model echo',
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

    function installBackend(answers) {
        const sentPrompts = [];
        globalThis.fetch = async (url) => new Response(MINIMAL_TEMPLATES[String(url).split('/').pop()]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
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

    it('the analysis gets the genre and no themes; the outline gets both; the arc carries both as typed', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(context, 'She pays.', {}, { genre: ' Superhero drama ', themeSeeds: ' corruption, political intrigue ' });

        assert.equal(result.error, null);
        assert.ok(sentPrompts[0].startsWith('ANALYSE\n== GENRE OF THE ARC TO BE PLANNED ==\n'));
        assert.ok(sentPrompts[0].endsWith('report it as an imbalance in the recorded material, not as the story\'s true direction.\n\nEND'));
        assert.equal(sentPrompts[0].includes('corruption'), false);
        assert.ok(sentPrompts[1].startsWith('OUTLINE\n== GENRE (binding) ==\n'));
        assert.ok(sentPrompts[1].includes('turns the arc into a single joke.\n\n== THEMES (colour, not obligations) ==\nThese are the author\'s themes for this arc:\n\ncorruption, political intrigue\n\n'));
        assert.ok(sentPrompts[1].endsWith('build its thematic statements from them, where the story supports them.\n\nEND'));
        assert.equal(result.arc.genre, 'Superhero drama');
        assert.equal(result.arc.themeSeeds, 'corruption, political intrigue');
    });

    it('without themes the outline has no themes block and the arc no themeSeeds, even when the model echoes one', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(context, 'She pays.', {}, { genre: 'Superhero drama', themeSeeds: '   ' });

        assert.equal(result.error, null);
        assert.equal(sentPrompts[1].includes('THEMES'), false);
        assert.equal('themeSeeds' in result.arc, false);
    });

    it('without either field both prompts carry neither block', async () => {
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(context, 'She pays.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts[0], 'ANALYSE\nEND');
        assert.equal(sentPrompts[1], 'OUTLINE\nEND');
        assert.equal('genre' in result.arc, false);
        assert.equal('themeSeeds' in result.arc, false);
    });

    it('a re-plan keeps the arc\'s theme seeds as the wizard passed them, never the model\'s echo', async () => {
        installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);
        const reviseArc = makeArc({ themeSeeds: 'edited seeds' });

        const result = await generateArc(context, 'She pays.', {}, { tier: 'saga', reviseArc, genre: GENRE, themeSeeds: 'edited seeds' });

        assert.equal(result.error, null);
        assert.equal(result.arc.id, 'gen00001-full-id');
        assert.equal(result.arc.themeSeeds, 'edited seeds');
    });
});
