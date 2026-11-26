import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptsContent, buildPromptsButton, buildPromptsDrawerNote } from '../lib/ui/prompts.js';
import { renderSettingsPanel } from '../lib/ui/settings-panel.js';

/** The knowledge update as describePrompts returns it: edited before the clue check, so CLAIMED_CLUES is missing. */
function knowledgeUpdate(overrides = {}) {
    return {
        name: 'extract-knowledge.txt',
        displayName: 'Knowledge update',
        group: 'tracker',
        runs: 'After every reply: who learned what, beats, clue claims',
        profile: 'tracker profile',
        state: 'edited',
        text: 'Read {{MESSAGES}} and {{LEDGER}}.',
        builtIn: 'Read {{MESSAGES}} and {{LEDGER}}. Check {{CLAIMED_CLUES}}.',
        placeholders: ['MESSAGES', 'LEDGER', 'CLAIMED_CLUES'],
        missing: ['CLAIMED_CLUES'],
        unknown: [],
        ...overrides,
    };
}

/** The arc outline, never edited. */
function arcOutline(overrides = {}) {
    return {
        name: 'generate-arc.txt',
        displayName: 'Arc outline',
        group: 'planning',
        runs: 'When you plan an arc: the beats, secrets and clues',
        profile: 'generation profile',
        state: 'built-in',
        text: 'Plan from {{ANALYSIS}} and {{USER_DIRECTION}}.',
        builtIn: 'Plan from {{ANALYSIS}} and {{USER_DIRECTION}}.',
        placeholders: ['ANALYSIS', 'USER_DIRECTION'],
        missing: [],
        unknown: [],
        ...overrides,
    };
}

/** A popup view on the knowledge update; overrides change one field. */
function popupView({ prompts = [arcOutline(), knowledgeUpdate()], ...overrides } = {}) {
    const selected = prompts.find(prompt => prompt.name === (overrides.selectedName ?? 'extract-knowledge.txt'));
    return {
        prompts: { prompts, editedCount: prompts.filter(prompt => prompt.state !== 'built-in').length },
        selectedName: 'extract-knowledge.txt',
        mode: 'template',
        revealed: false,
        draft: { text: selected.text, missing: selected.missing, unknown: selected.unknown },
        message: null,
        lastSent: null,
        ...overrides,
    };
}

const SENT_RECORD = {
    text: 'Read the harbour messages. SECRET: the foreman sold the strike fund.',
    at: new Date(2026, 10, 26, 14, 5).getTime(),
    purpose: 'the update after reply #83',
    length: 68,
    edited: true,
};

describe('buildPromptsContent — Last sent', () => {
    it('leaves the filled text out while Reveal is off, and says what it hides', () => {
        const html = buildPromptsContent(popupView({ mode: 'sent', lastSent: SENT_RECORD }));

        assert.ok(!html.includes('the foreman sold the strike fund'), html);
        assert.ok(html.includes('Filled prompt hidden'), html);
        assert.ok(html.includes('the arcs\' secrets'), html);
        assert.ok(html.includes('It hides again when the popup closes.'), html);
        assert.ok(html.includes('class="pp-hidden-wrap"'), html);
    });

    it('shows the filled text when Reveal is on, with a read-only expand icon', () => {
        const html = buildPromptsContent(popupView({ mode: 'sent', lastSent: SENT_RECORD, revealed: true }));

        assert.ok(html.includes('SECRET: the foreman sold the strike fund.'), html);
        assert.ok(html.includes('data-act="expand-read"'), html);
        assert.ok(!html.includes('pp-hidden-wrap'), html);
    });
});

describe('buildPromptsContent — Last sent, nothing yet', () => {
    it('says nothing was sent this session and when this prompt is sent, with no Reveal switch', () => {
        const html = buildPromptsContent(popupView({ mode: 'sent', lastSent: null }));

        assert.ok(html.includes('Nothing sent yet this session'), html);
        assert.ok(html.includes('When it is sent: After every reply: who learned what, beats, clue claims.'), html);
        assert.ok(!html.includes('pp-reveal'), html);
    });
});

describe('buildPromptsContent — Last sent summary line', () => {
    it('says when, what for, how long and that it used the edit', () => {
        const html = buildPromptsContent(popupView({ mode: 'sent', lastSent: SENT_RECORD }));

        assert.ok(html.includes('for the update after reply #83 · 68 characters, about 17 tokens · from your edit'), html);
        assert.match(html, /Sent at <b>(14|02)[:.]05/);
    });
});

describe('buildPromptsContent — the template view', () => {
    it('names each missing and unknown placeholder in its own warning, and counts the filled ones', () => {
        const html = buildPromptsContent(popupView({
            draft: { text: 'Read {{MESSAGES}} and {{MOOD}}.', missing: ['LEDGER', 'CLAIMED_CLUES'], unknown: ['MOOD'] },
        }));

        assert.ok(html.includes('<code>{{LEDGER}}</code> is missing: what Story Arc fills in there never reaches the model.'), html);
        assert.ok(html.includes('<code>{{CLAIMED_CLUES}}</code> is missing: the narrator\'s clue claims never reach the check, so every PLANTED claim is dropped.'), html);
        assert.ok(html.includes('<code>{{MOOD}}</code> is not in this prompt\'s built-in text: Story Arc may not fill it in, and then the model gets it as written.'), html);
        assert.ok(html.includes('Fills 1 of 3 placeholders · 31 characters'), html);
    });

    it('says every placeholder is filled when none is missing', () => {
        const html = buildPromptsContent(popupView({ selectedName: 'generate-arc.txt' }));

        assert.ok(html.includes('Fills all 2 placeholders · 46 characters'), html);
        assert.ok(!html.includes('am-alert'), html);
    });

    it('has exactly one primary button, Save, disabled while nothing changed', () => {
        const html = buildPromptsContent(popupView());

        assert.equal(html.match(/am-primary/g).length, 1);
        assert.match(html, /<button type="button" class="menu_button am-primary" data-act="save" disabled>/);
        assert.ok(!html.includes('data-act="discard"'), html);
    });

    it('enables Save and offers Discard changes once the draft differs from the saved text', () => {
        const html = buildPromptsContent(popupView({ draft: { text: 'Read {{MESSAGES}}, {{LEDGER}} and {{CLAIMED_CLUES}}.', missing: [], unknown: [] } }));

        assert.match(html, /data-act="save" >/);
        assert.ok(html.includes('data-act="discard">Discard changes'), html);
        assert.equal(html.match(/am-primary/g).length, 1);
    });

    it('offers Reset to built-in on an edited prompt only', () => {
        assert.ok(buildPromptsContent(popupView()).includes('data-act="reset"'));
        assert.ok(!buildPromptsContent(popupView({ selectedName: 'generate-arc.txt' })).includes('data-act="reset"'));
    });

    it('puts SillyTavern\'s expand icon on the count line, pointing at the editor', () => {
        const html = buildPromptsContent(popupView());

        assert.ok(html.includes('<i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="pp-editor"'), html);
        assert.ok(html.includes('<textarea id="pp-editor"'), html);
    });

    it('shows the message with Undo after a save', () => {
        const html = buildPromptsContent(popupView({ message: { ok: true, text: 'Saved. It is sent from the next call on, in every chat.', undo: true } }));

        assert.ok(html.includes('Saved. It is sent from the next call on, in every chat. <button type="button" class="am-link-btn" data-act="undo">Undo</button>'), html);
    });
});

describe('buildPromptsContent — built-in changed', () => {
    const changed = knowledgeUpdate({ state: 'changed' });

    it('offers Show built-in once when both the note and a warning show', () => {
        const html = buildPromptsContent(popupView({ prompts: [arcOutline(), changed] }));

        assert.ok(html.includes('am-alert is-note'), html);
        assert.ok(html.includes('<code>{{CLAIMED_CLUES}}</code> is missing'), html);
        assert.equal(html.match(/data-act="show-builtin"/g).length, 1);
        assert.ok(html.includes('data-act="keep">Keep mine'), html);
    });

    it('offers Show built-in once on the warnings when no note offers it', () => {
        const html = buildPromptsContent(popupView({
            draft: { text: 'Read.', missing: ['MESSAGES', 'LEDGER', 'CLAIMED_CLUES'], unknown: [] },
        }));

        assert.ok(!html.includes('is-note'), html);
        assert.equal(html.match(/data-act="show-builtin"/g).length, 1);
    });

    it('marks the prompt in the list as edited with the built-in changed', () => {
        const html = buildPromptsContent(popupView({ prompts: [arcOutline(), changed] }));

        assert.ok(html.includes('fa-circle-info" aria-hidden="true"></i>Edited · built-in changed</span>'), html);
        assert.ok(html.includes('<span class="pp-state">Built-in</span>'), html);
    });
});

describe('buildPromptsContent — Show built-in', () => {
    it('shows the built-in text read-only with its counts and the way back', () => {
        const html = buildPromptsContent(popupView({ mode: 'builtin' }));

        assert.ok(html.includes('<b>Built-in prompt</b>, read-only · 3 placeholders · 58 characters'), html);
        assert.ok(html.includes('Read {{MESSAGES}} and {{LEDGER}}. Check {{CLAIMED_CLUES}}.'), html);
        assert.ok(html.includes('data-act="back"'), html);
        assert.ok(html.includes('data-act="expand-read"'), html);
        assert.ok(!html.includes('<textarea'), html);
    });
});

describe('buildPromptsContent — head and list', () => {
    it('says how many prompts are edited and that edits apply to every chat', () => {
        const html = buildPromptsContent(popupView());

        assert.ok(html.includes('<b>1 of 2 edited</b> · your edits apply to every chat.'), html);
    });

    it('lists the prompts under their two groups, each with when it runs', () => {
        const html = buildPromptsContent(popupView());

        assert.ok(html.indexOf('Planning an arc') < html.indexOf('Arc outline'), html);
        assert.ok(html.indexOf('Arc outline') < html.indexOf('Knowledge tracker'), html);
        assert.ok(html.indexOf('Knowledge tracker') < html.indexOf('>Knowledge update<'), html);
        assert.ok(html.includes('<span class="pp-row-runs">After every reply: who learned what, beats, clue claims</span>'), html);
        assert.ok(html.includes('data-pp="extract-knowledge.txt" aria-current="true"'), html);
    });

    it('closes with the status bar line about parts built in code', () => {
        const html = buildPromptsContent(popupView());

        assert.ok(html.includes('Some parts are built in code and not shown here'), html);
        assert.ok(html.includes('id="pp-close">Close</button>'), html);
    });
});

describe('the drawer entry', () => {
    it('shows "N edited" on the Prompts button only while a prompt is edited', () => {
        assert.ok(buildPromptsButton({ prompts: [], editedCount: 2 }).includes('Prompts <span class="muted">2 edited</span>'));
        assert.ok(!buildPromptsButton({ prompts: [], editedCount: 0 }).includes('edited'));
    });

    it('shows the note only for a prompt whose built-in text changed', () => {
        assert.equal(buildPromptsDrawerNote({ prompts: [arcOutline(), knowledgeUpdate()], editedCount: 1 }), '');

        const note = buildPromptsDrawerNote({ prompts: [arcOutline(), knowledgeUpdate({ state: 'changed' })], editedCount: 1 });
        assert.ok(note.includes('The built-in Knowledge update prompt changed since you edited it. Open Prompts to compare or reset.'), note);
    });

    it('names every changed prompt in one note', () => {
        const note = buildPromptsDrawerNote({ prompts: [arcOutline({ state: 'changed' }), knowledgeUpdate({ state: 'changed' })], editedCount: 2 });

        assert.ok(note.includes('The built-in Arc outline and Knowledge update prompts changed since you edited them.'), note);
    });

    it('sits in the Connection group beside Create arc preset, with the note under them', () => {
        const html = renderSettingsPanel({ prompts: [knowledgeUpdate({ state: 'changed' })], editedCount: 1 });
        const connection = html.slice(html.indexOf('story-arc-drawer-connection-heading'), html.indexOf('story-arc-drawer-knowledge-heading'));
        const buttons = connection.slice(connection.indexOf('story-arc-drawer-buttons'), connection.indexOf('id="story-arc-prompts-note"'));

        assert.ok(buttons.includes('story-arc-create-preset-btn'), connection);
        assert.ok(buttons.indexOf('story-arc-create-preset-btn') < buttons.indexOf('story-arc-prompts-btn'), connection);
        assert.ok(buttons.includes('1 edited'), connection);
        assert.ok(connection.indexOf('The built-in Knowledge update prompt changed') > connection.indexOf('id="story-arc-prompts-note"'), connection);
    });

    it('renders the drawer without a note or count when no view is given', () => {
        const html = renderSettingsPanel();

        assert.ok(html.includes('id="story-arc-prompts-btn"'), html);
        assert.ok(!html.includes('story-arc-drawer-note'), html);
    });
});
