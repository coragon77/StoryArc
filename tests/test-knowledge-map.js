import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeContent, createKnowledgeView, startMapMerge } from '../lib/ui/knowledge-popup.js';

/**
 * The ledger was last updated at message 3000, so "recent" is a fact held
 * at message 2900 or later.
 * - Diana Masters (c1): in the scene.
 * - Raj Barrows (c2): a fact at 2950, recent.
 * - Barrows (c3): a fact at 2700, earlier.
 * - Raj (c4), Mira Barrows (c5), Tom Vance (c8): no facts; Tom's only
 *   entry comes from an arc plan, which the map does not count.
 * - Raj Barrows's mother (c6): an unnamed relative without facts.
 * - Kendra Osei (c7): a fact at 2600, earlier; Diana's sister; a name to check.
 */
function makeLedger() {
    const holder = (characterId, at, how = 'witnessed') => ({ characterId, how, toldBy: null, at, messageId: `m${at}` });
    return {
        characters: [
            { id: 'c1', name: 'Diana Masters', aliases: [] },
            { id: 'c2', name: 'Raj Barrows', aliases: [] },
            { id: 'c3', name: 'Barrows', aliases: [] },
            { id: 'c4', name: 'Raj', aliases: [] },
            { id: 'c5', name: 'Mira Barrows', aliases: [] },
            { id: 'c6', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c2' }, at: 2950, by: 'story' }] } },
            { id: 'c7', name: 'Kendra Osei', aliases: ['Anvil'], details: { relation: [{ value: { kind: 'sister', of: 'c1' }, at: 2600, by: 'story' }] }, nameClash: { names: ['Kendra'], at: 2600 } },
            { id: 'c8', name: 'Tom Vance', aliases: [] },
        ],
        facts: [
            { id: 'f1', text: 'Diana runs the pier', public: false, holders: [holder('c1', 2990)] },
            { id: 'f2', text: 'Raj owes money', public: false, holders: [holder('c2', 2950)] },
            { id: 'f3', text: 'Barrows sold the boat', public: false, holders: [holder('c3', 2700)] },
            { id: 'f4', text: 'Kendra hides a key', public: false, holders: [holder('c7', 2600)] },
            { id: 'f5', text: 'Tom will betray Diana', public: false, holders: [holder('c8', 2995, 'plan')] },
        ],
        retractedFacts: [],
        scene: { at: 3000, messageId: 'm3000', present: ['c1'] },
        lastUpdatedAt: 3000,
        updateLog: [],
    };
}

function mapView(changes = {}) {
    return Object.assign(createKnowledgeView(), { tab: 'map' }, changes);
}

/** The ids of the map's nodes on one ring, in the order the ring places them */
function ringIds(html, ring) {
    return [...html.matchAll(/<button[^>]*class="k-map-node[^"]*"[^>]*>/g)]
        .map(match => match[0])
        .filter(tag => tag.includes(`data-ring="${ring}"`))
        .map(tag => tag.match(/data-cid="([^"]+)"/)[1]);
}

describe('Knowledge popup: the Map tab', () => {
    it('puts the scene in the centre, then recent, earlier and no facts, a relative without facts on its anchor\'s ring', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());

        assert.deepEqual(ringIds(html, 'scene'), ['c1']);
        assert.deepEqual(ringIds(html, 'recent'), ['c2', 'c6']);
        assert.deepEqual(ringIds(html, 'earlier'), ['c3', 'c7']);
        assert.deepEqual(ringIds(html, 'none'), ['c5', 'c4', 'c8']);
    });

    it('draws one node per character, each a single button with no control inside', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());
        const nodes = [...html.matchAll(/<button[^>]*class="k-map-node[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];

        assert.equal(nodes.length, 8);
        for (const node of nodes) assert.doesNotMatch(node[1], /<(button|input|select|a)\b/);
    });

    it('lays out the same ledger the same way every time', () => {
        const first = buildKnowledgeContent(makeLedger(), [], true, mapView());
        const second = buildKnowledgeContent(makeLedger(), [], true, mapView());

        assert.equal(first, second);
    });

    it('groups records sharing a name word into one family, with a band behind neighbours on a ring', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());
        const familyOf = id => html.match(new RegExp(`data-cid="${id}"[^>]*data-family="([^"]*)"`))[1];
        const bands = [...html.matchAll(/class="k-map-fam" data-family="([^"]+)" data-members="([^"]+)"/g)].map(match => [match[1], match[2]]);

        assert.equal(familyOf('c4'), 'barrows'); // "Raj" sits in the longer "Raj Barrows"
        assert.equal(familyOf('c6'), 'barrows'); // the unnamed relative, with Raj Barrows
        assert.equal(familyOf('c7'), 'osei');
        assert.deepEqual(bands, [['barrows', 'c2 c6'], ['barrows', 'c5 c4']]);
    });

    it('draws each relation as one line between the two records, with its kinship word', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());
        const lines = [...html.matchAll(/class="k-map-rel[^"]*" data-pair="([^"]+)" data-kinds="([^"]+)"/g)].map(match => [match[1], match[2]]);

        assert.deepEqual(lines, [['c2|c6', 'mother'], ['c1|c7', 'sister']]);
    });

    it('marks a name to check by a shape on the node and says so in its label', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());
        const kendra = html.match(/<button[^>]*data-cid="c7"[^>]*>[\s\S]*?<\/button>/)[0];

        assert.match(kendra, /class="k-map-node[^"]*is-clash/);
        assert.match(kendra, /fa-triangle-exclamation/);
        assert.match(kendra, /aria-label="Kendra Osei, also Anvil\. Earlier, knows 1 fact, name to check"/);
    });

    it('does not count a fact an arc plan gives a character', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, mapView());

        assert.match(html, /aria-label="Tom Vance\. No facts, knows 0 facts"/);
    });

    it('dims who the filter does not match and always labels who it does', () => {
        const view = mapView();
        view.map.filter = 'barrows'; // Raj Barrows's mother is found by her display name
        const html = buildKnowledgeContent(makeLedger(), [], true, view);
        const node = id => html.match(new RegExp(`<button[^>]*data-cid="${id}"[^>]*>[\\s\\S]*?</button>`))[0];

        assert.match(html, /4 of 8/);
        for (const id of ['c2', 'c3', 'c5', 'c6']) {
            assert.match(node(id), /is-match/);
            assert.doesNotMatch(node(id), /k-map-lab is-off/);
        }
        assert.match(node('c8'), /is-dim/);
    });

    it('opens the selected character\'s sheet next to the map, the same sheet as in Cast & facts', () => {
        const view = mapView({ sheet: { type: 'character', id: 'c2', from: null, back: null } });
        const html = buildKnowledgeContent(makeLedger(), [], true, view);

        assert.match(html, /id="sa-k-map-side"[\s\S]*id="sa-k-sheet"[\s\S]*Raj Barrows/);
        assert.match(html, /Back to the map/);
        assert.match(html.match(/<button[^>]*data-cid="c2"[^>]*>/)[0], /is-sel/);
    });

    it('a drop of one character onto another opens the merge preview of the first into the second', () => {
        const view = mapView();
        startMapMerge(view, 'c4', 'c2');
        const html = buildKnowledgeContent(makeLedger(), [], true, view);

        assert.deepEqual(view.sheet, { type: 'character', id: 'c4', from: null, back: null });
        assert.deepEqual(view.editors.get('sheet'), { mode: 'merge', characterId: 'c4', targetId: 'c2', keepSelf: false });
        assert.match(html, /Merge Raj into Raj Barrows\?/);
        assert.match(html, /data-act="merge-go"/);
    });
});

describe('Knowledge popup: a search tie', () => {
    it('goes to who knows more, planned facts not counted', () => {
        // Ann Lee knows one fact; Ann Kay knows none but holds two from an arc plan
        const holder = (characterId, how) => ({ characterId, how, toldBy: null, at: 5, messageId: 'm5' });
        const ledger = {
            characters: [
                { id: 'c2', name: 'Ann Kay', aliases: [] },
                { id: 'c1', name: 'Ann Lee', aliases: [] },
            ],
            facts: [
                { id: 'f1', text: 'Ann Lee keeps the ledger', public: false, holders: [holder('c1', 'witnessed')] },
                { id: 'f2', text: 'The heist is set for Friday', public: false, holders: [holder('c2', 'plan')] },
                { id: 'f3', text: 'The vault code is 4471', public: false, holders: [holder('c2', 'plan')] },
            ],
            retractedFacts: [],
            scene: { at: 5, present: [] },
            lastUpdatedAt: 5,
            updateLog: [],
        };
        const view = Object.assign(createKnowledgeView(), { tab: 'cast', query: 'ann' });
        const html = buildKnowledgeContent(ledger, [], true, view);
        const order = [...html.matchAll(/data-fk="row\|character:(c\d)"/g)].map(match => match[1]);

        assert.deepEqual(order, ['c1', 'c2']);
    });
});
