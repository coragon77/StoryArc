import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatGenreBlock } from '../lib/planning/generator.js';
import { latestGenre } from '../lib/planning/storage.js';
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
});

describe('prompt templates carry the genre slot', () => {
    const read = name => readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');

    it('analysis: after the context, before the task', () => {
        const text = read('analyze-context.txt');
        assert.ok(text.includes('== END OF CONTEXT ==\n\n{{GENRE_BLOCK}}== YOUR TASK =='));
    });

    it('outline: after the analysis, before the creative direction', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('{{PHASE1_ANALYSIS}}\n\n{{GENRE_BLOCK}}== AUTHOR\'S CREATIVE DIRECTION =='));
    });

    it('outline: secrets are optional', () => {
        assert.ok(read('generate-arc.txt').includes('- Use 0-5 secrets'));
    });
});

describe('GENRE line in the injection', () => {
    it('follows the header of a normal saga', () => {
        const text = buildInjection([makeArc()]);
        assert.ok(text.includes(`=== SAGA: "The Shadow over Greymoor" ===\nGENRE: ${GENRE}\nPREMISE: The party joins the guild.`));
    });

    it('is carried by a spotlit saga', () => {
        const text = buildInjection([makeArc({ focus: 'spotlight' })]);
        assert.ok(text.includes(`=== SAGA: "The Shadow over Greymoor" ===\nGENRE: ${GENRE}\n`));
    });

    it('sits above the premise of an episode', () => {
        const text = buildInjection([makeArc({ tier: 'episode', estimatedLength: 20 })]);
        assert.ok(text.includes(`GENRE: ${GENRE}\n\nPREMISE: The party joins the guild.`));
    });

    it('is absent when the arc has no genre', () => {
        for (const tier of ['episode', 'saga']) {
            const text = buildInjection([makeArc({ tier, genre: undefined })]);
            assert.equal(text.includes('GENRE'), false, tier);
        }
    });

    it('is absent from a paused arc', () => {
        assert.equal(buildInjection([makeArc({ focus: 'paused' })]).includes('GENRE'), false);
    });
});

describe('latestGenre', () => {
    it('returns the genre of the newest arc that has one', () => {
        const arcs = [{ genre: 'Space opera' }, {}, { genre: 'Cozy mystery' }, { genre: '' }];
        assert.equal(latestGenre(arcs), 'Cozy mystery');
    });

    it('returns an empty string when no arc has a genre', () => {
        assert.equal(latestGenre([]), '');
        assert.equal(latestGenre([{}, { genre: '' }]), '');
    });
});

describe('mergeReplan keeps the genre as edited in the wizard', () => {
    it('takes the genre from the re-planned arc, not from the generated plan', () => {
        const existing = makeArc({ genre: 'Edited genre' });
        const generated = makeArc({ genre: 'Model echo', beats: [] });
        assert.equal(mergeReplan(existing, generated).genre, 'Edited genre');
    });
});
