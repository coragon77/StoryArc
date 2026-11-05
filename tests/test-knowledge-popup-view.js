import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeContent, createKnowledgeView, findFocusTarget, listChangeLines } from '../lib/ui/knowledge-popup.js';

/**
 * Noor (c1), Ellie (c2), Gabriel (c3, new in message 6). f1 old, f2 learned
 * in message 6, f3 retracted there. The log: an old record with counts only,
 * a skip, and the record of messages 5–6 with its items.
 */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Noor', aliases: ['Wrench'] },
            { id: 'c2', name: 'Ellie', aliases: [], details: { gender: [{ value: 'female', at: 6, messageId: 'm6' }] } },
            { id: 'c3', name: 'Gabriel', aliases: [] },
        ],
        facts: [
            { id: 'f1', text: 'Ellie is Dice', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' },
                { characterId: 'c3', how: 'told', toldBy: 'c1', at: 6, messageId: 'm6' },
            ] },
            { id: 'f2', text: 'Gabriel wants titanium latches', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 6, messageId: 'm6' },
                { characterId: 'c2', how: 'witnessed', toldBy: null, at: 6, messageId: 'm6' },
            ] },
        ],
        retractedFacts: [{ at: 6, messageId: 'm6', fact: { id: 'f3', text: 'Noor owns the bay', public: false, holders: [
            { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2, messageId: 'm2' },
        ] } }],
        scene: { at: 6, messageId: 'm6', present: ['c1', 'c2', 'c3'] },
        lastUpdatedAt: 6,
        updateLog: [
            { kind: 'update', from: 1, to: 2, messageId: 'm2', answer: { newCharacters: 0 }, factsCreated: ['f1'], holdersAdded: 1, factsRetracted: [] },
            { kind: 'skipped', from: 3, to: 4, reason: 'no answer' },
            {
                kind: 'update', from: 5, to: 6, messageId: 'm6', answer: { newCharacters: 1 },
                factsCreated: ['f2'], holdersAdded: 3, factsRetracted: ['f3'], detailsSet: 1, newNamesAdded: 1,
                items: {
                    characters: ['c3'],
                    holders: [
                        { factId: 'f2', characterId: 'c1', messageId: 'm6' },
                        { factId: 'f2', characterId: 'c2', messageId: 'm6' },
                        { factId: 'f1', characterId: 'c3', messageId: 'm6' },
                    ],
                    details: [{ characterId: 'c2', kind: 'gender', messageId: 'm6' }],
                    names: [{ characterId: 'c1', name: 'Wrench' }],
                    scene: ['c1', 'c2', 'c3'],
                },
            },
        ],
        reviewedMarks: ['m6:update:holder:f1:c3'],
    };
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('listChangeLines', () => {
    it('makes one line per change, the holders of one fact on one line, newest record first', () => {
        const { groups } = listChangeLines(makeLedger());

        assert.equal(groups.length, 1);
        assert.deepEqual(groups[0].lines.map(line => [line.type, line.itemKeys]), [
            ['character', ['m6:update:character:c3']],
            ['detail', ['m6:update:detail:c2:gender']],
            ['fact', ['m6:update:holder:f2:c1', 'm6:update:holder:f2:c2']],
            ['learned', ['m6:update:holder:f1:c3']],
            ['retracted', ['m6:update:retracted:f3']],
            ['name', ['m6:update:name:c1:Wrench']],
            ['scene', ['m6:update:scene:c1:c2:c3']],
        ]);
    });

    it('counts a line reviewed only when every item it covers is marked', () => {
        const ledger = makeLedger();
        ledger.reviewedMarks = ['m6:update:holder:f2:c1', 'm6:update:holder:f1:c3'];
        const lines = listChangeLines(ledger).groups[0].lines;

        assert.equal(lines.find(line => line.type === 'fact').reviewed, false);
        assert.equal(lines.find(line => line.type === 'learned').reviewed, true);
    });

    it('lists the records without items as earlier updates, newest first', () => {
        const { earlier } = listChangeLines(makeLedger());

        assert.deepEqual(earlier.map(record => [record.kind, record.from]), [['skipped', 3], ['update', 1]]);
    });

    it('leaves the detail lines out while character details are off', () => {
        const lines = listChangeLines(makeLedger(), false).groups[0].lines;

        assert.equal(lines.some(line => line.type === 'detail'), false);
    });
});

describe('buildKnowledgeContent: What changed', () => {
    it('opens on What changed with the number of lines to review on its tab', () => {
        const html = buildKnowledgeContent(makeLedger(), []);

        assert.match(html, /id="sa-k-tab-changes"[^>]*aria-selected="true"/);
        assert.match(html, /id="sa-k-changes-count"[^>]*>6</);
    });

    it('says each change in one sentence', () => {
        const text = textOf(buildKnowledgeContent(makeLedger(), []));

        assert.ok(text.includes('Messages 5–6'), text);
        assert.ok(text.includes('Gabriel is new in the ledger'));
        assert.ok(text.includes("Ellie 's gender set to female"));
        assert.ok(text.includes('Gabriel wants titanium latches Learned by Noor witnessed Ellie witnessed'));
        assert.ok(text.includes('No longer true: Noor owns the bay'));
        assert.ok(text.includes('“Wrench” is now a name of Noor'));
        assert.ok(text.includes('In the scene: Noor, Ellie and Gabriel'));
    });

    it('folds a reviewed line away and offers to show it', () => {
        const html = buildKnowledgeContent(makeLedger(), []);

        assert.equal(html.includes('data-line="m6:update:holder:f1:c3"'), false);
        assert.ok(textOf(html).includes('Show 1 reviewed'));
    });

    it('shows the reviewed line with Reopen when reviewed lines are shown', () => {
        const view = createKnowledgeView();
        view.showReviewed = true;
        const html = buildKnowledgeContent(makeLedger(), [], true, view);

        const line = html.split('<li class="k-line').find(chunk => chunk.includes('data-line="m6:update:holder:f1:c3"'));
        assert.ok(line.includes('is-reviewed'));
        assert.ok(textOf(line).includes('Reopen'));
    });

    it('lists an earlier record as a count summary with a way into Cast & facts', () => {
        const text = textOf(buildKnowledgeContent(makeLedger(), []));

        assert.ok(text.includes('Earlier updates'));
        assert.ok(text.includes('Messages 1–2 1 fact learned, 1 holder added Open in Cast &amp; facts'), text);
        assert.ok(text.includes('Messages 3–4 not read (no answer)'));
    });

    it('hides a holder an arc plan gave until it is revealed', () => {
        const ledger = makeLedger();
        ledger.facts[1].holders[1].how = 'plan';
        const hidden = buildKnowledgeContent(ledger, []);
        const view = createKnowledgeView();
        view.revealed.add('f2:c2');
        const shown = buildKnowledgeContent(ledger, [], true, view);

        assert.ok(textOf(hidden).includes('Learned by Noor witnessed Planned holder show'));
        assert.ok(textOf(shown).includes('Learned by Noor witnessed Ellie planned'));
    });

    it('teaches the tab while the log is empty', () => {
        const ledger = makeLedger();
        ledger.updateLog = [];

        assert.ok(textOf(buildKnowledgeContent(ledger, [])).includes('No update yet'));
    });
});

describe('findFocusTarget', () => {
    /** A stand-in for the popup root: elements with attributes, found by `[attribute]` or by id */
    function makeRoot(elements) {
        return {
            querySelector: selector => elements.find(element => `#${element.id}` === selector) || null,
            querySelectorAll: selector => elements.filter(element => selector.slice(1, -1) in element.attributes),
        };
    }
    const element = (id, attributes, inner = null) => ({
        id, attributes, getAttribute: name => attributes[name] ?? null, querySelector: () => inner,
    });

    it('finds a line whose key holds a comma and a quote, which a selector list would split', () => {
        const line = element('line-1', { 'data-line': 'u1:name:c3:Vale, "Jr"' });
        const root = makeRoot([element('other', { 'data-line': 'u1:name:c3:Vale' }), line, element('sa-k-title', {})]);

        assert.equal(findFocusTarget(root, [{ attribute: 'data-line', value: 'u1:name:c3:Vale, "Jr"' }, '#sa-k-title']), line);
    });

    it('takes the targets in the order listed, not in document order', () => {
        const title = element('sa-k-title', {});
        const button = element('later-button', { 'data-area': 'clash:c3, x' });
        const root = makeRoot([title, button]);

        assert.equal(findFocusTarget(root, [{ attribute: 'data-area', value: 'clash:c3, x' }, '#sa-k-title']), button);
        assert.equal(findFocusTarget(root, [{ attribute: 'data-area', value: 'gone' }, '#sa-k-title']), title);
    });

    it('goes into the found element with `then`', () => {
        const keepButton = { id: 'keep' };
        const row = element('row', { 'data-area': 'clash:c3' }, keepButton);

        assert.equal(findFocusTarget(makeRoot([row]), [{ attribute: 'data-area', value: 'clash:c3', then: '[data-act="keep-name"]' }]), keepButton);
    });
});

describe('buildKnowledgeContent: Not true', () => {
    it('offers "Not true" on a new fact, a learned line and the fact sheet', () => {
        const html = buildKnowledgeContent(makeLedger(), []);
        const view = createKnowledgeView();
        view.tab = 'cast';
        view.sheet = { type: 'fact', id: 'f2' };
        const sheetHtml = buildKnowledgeContent(makeLedger(), [], true, view);

        assert.match(html, /data-act="retract" data-area="m6:update:holder:f2:c1" data-fid="f2"/);
        assert.match(sheetHtml, /data-act="retract" data-area="fs" data-fid="f2"/);
    });

    it('says the player took a fact back and offers "Still true"', () => {
        const ledger = makeLedger();
        const fact = ledger.facts.splice(1, 1)[0];
        ledger.retractedFacts.push({ at: null, fact });
        const view = createKnowledgeView();
        view.showReviewed = true;

        const factLine = buildKnowledgeContent(ledger, [], true, view).split('<li class="k-line').find(chunk => chunk.includes('data-line="m6:update:holder:f2:c1"'));

        assert.ok(textOf(factLine).includes('You marked it not true: the narrator is no longer told it.'), textOf(factLine));
        assert.match(factLine, /data-act="restore"/);
    });
});

describe('buildKnowledgeContent: a planned fact on a character sheet', () => {
    /** Ellie (c2) planned to learn f2; Noor witnessed it */
    function ledgerWithPlan() {
        const ledger = makeLedger();
        ledger.facts[1].holders[1].how = 'plan';
        return ledger;
    }
    function sheetOf(ledger, characterId, revealed = []) {
        const view = createKnowledgeView();
        view.tab = 'cast';
        view.sheet = { type: 'character', id: characterId };
        revealed.forEach(key => view.revealed.add(key));
        return buildKnowledgeContent(ledger, [], true, view);
    }

    it('folds the planned facts into one line with Show, and counts only the facts they know', () => {
        const text = textOf(sheetOf(ledgerWithPlan(), 'c2'));

        assert.ok(text.includes('knows 0 facts'), text);
        assert.ok(text.includes('1 planned fact An arc plan gives them this. Show'));
        assert.ok(!text.includes('titanium'));
    });

    it('shows the planned fact once revealed', () => {
        const text = textOf(sheetOf(ledgerWithPlan(), 'c2', ['plans:c2']));

        assert.ok(text.includes('Gabriel wants titanium latches'));
        assert.ok(text.includes('Ellie planned'));
    });

    it('does not count a hidden planned holder among the others who know a fact', () => {
        const text = textOf(sheetOf(ledgerWithPlan(), 'c1'));

        assert.ok(text.includes('Gabriel wants titanium latches'));
        assert.ok(text.includes('only they know it'), text);
    });
});

describe('buildKnowledgeContent: a relative the story named', () => {
    it('offers "Not their name" on the new name line', () => {
        const ledger = makeLedger();
        ledger.characters.push({ id: 'c4', name: 'Maren', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c2' }, at: null, by: 'record' }] } });
        ledger.updateLog[2].items.names.push({ characterId: 'c4', name: 'Maren' });

        const html = buildKnowledgeContent(ledger, []);

        assert.match(html, /data-act="unname" data-area="m6:update:name:c4:Maren" data-cid="c4"/);
    });
});

describe('buildKnowledgeContent: earlier updates that stored no fact', () => {
    it('offers a message search for an update that only added holders or details', () => {
        const ledger = makeLedger();
        ledger.updateLog.unshift({ kind: 'update', from: 0, to: 0, messageId: 'm0', answer: { newCharacters: 0 }, factsCreated: [], holdersAdded: 2, factsRetracted: [], detailsSet: 1 });

        const html = buildKnowledgeContent(ledger, []);
        const row = html.split('<li class="k-sum">').find(chunk => chunk.startsWith('<span class="k-sum-range">Message 0<'));

        assert.ok(textOf(row).includes('Message 0 2 holders added, 1 detail set Message search'), textOf(row));
        assert.match(row, /data-act="message-search" data-from="0" data-to="0"/);
    });

    it('offers nothing for a skipped update', () => {
        const row = buildKnowledgeContent(makeLedger(), []).split('<li class="k-sum">').find(chunk => chunk.includes('not read'));

        assert.ok(!row.split('</li>')[0].includes('data-act'));
    });
});
