import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    acceptAppearanceFinding, acceptAppearanceFindings, buildKnowledgeContent, createKnowledgeView, findSourceMessageRefusal, listChangeLines, lockCharacterDetail, saveCharacterDetails,
} from '../lib/ui/knowledge-popup.js';
import { dropKnowledgeFrom } from '../lib/knowledge/ledger.js';

/**
 * Priya and Ellie: the story said Priya's hair is dark at message 6 and her
 * eyes brown at message 3, which the player locked; Ellie's hair is blonde.
 */
function makeLedger() {
    return {
        characters: [
            {
                id: 'c1',
                name: 'Priya Nair',
                aliases: ['Priya'],
                details: {
                    role: [{ value: 'nurse', at: 1, messageId: 'm1' }],
                    hair: [{ value: 'dark', at: 6, messageId: 'm6' }],
                    eyes: [{ value: 'brown', at: 3, messageId: 'm3' }, { value: 'brown', at: null, by: 'user' }],
                },
            },
            { id: 'c2', name: 'Ellie', aliases: [], details: { hair: [{ value: 'blonde', at: 4, messageId: 'm4' }] } },
        ],
        facts: [],
        scene: { at: 6, present: ['c1'] },
        lastUpdatedAt: 6,
    };
}

/** A chat of seven messages; message 2 is hidden */
function makeChat() {
    return Array.from({ length: 7 }, (_, index) => ({ mes: `message ${index}`, is_system: index === 2, extra: {} }));
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A view of Cast & facts with this character's sheet open */
function sheetViewOf(characterId) {
    const view = createKnowledgeView();
    view.tab = 'cast';
    view.sheet = { type: 'character', id: characterId };
    return view;
}

/** The markup of a detail row of the open sheet, up to the next row or the list's end. */
function detailRowOf(html, kind) {
    const start = html.indexOf(`<div class="k-detail" data-detail="${kind}"`);
    if (start === -1) return '';
    const nextRow = html.indexOf('<div class="k-detail"', start + 1);
    const listEnd = html.indexOf('</dl>', start);
    return html.slice(start, nextRow === -1 || nextRow > listEnd ? listEnd : nextRow);
}

/** The markup of the row a finding turned into the proposal, up to the next row or the list's end. */
function findingOf(html, kind) {
    const start = html.indexOf(`<div class="k-detail is-proposal" data-detail="${kind}" data-finding="${kind}"`);
    if (start === -1) return '';
    const nextRow = html.indexOf('<div class="k-detail', start + 1);
    const listEnd = html.indexOf('</dl>', start);
    return html.slice(start, nextRow === -1 || nextRow > listEnd ? listEnd : nextRow);
}

describe('buildKnowledgeContent: appearance rows on a character sheet', () => {
    it('lists the six appearance kinds under Appearance, with where each came from, while appearance is on', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c1'), true);

        assert.ok(html.includes('<h5 id="sa-k-sh-appearance">Appearance</h5>'));
        assert.equal(textOf(detailRowOf(html, 'hair')), 'Hair dark From the story, message #6 Edit Lock');
        assert.equal(textOf(detailRowOf(html, 'eyes')), 'Eyes brown Locked by you · the story says the same (message #3) Edit Unlock');
        assert.equal(textOf(detailRowOf(html, 'ethnicity')), 'Ethnicity unknown The story has not stated it. Set');
        for (const kind of ['skin', 'build', 'features']) assert.ok(html.includes(`data-detail="${kind}"`), kind);
        assert.ok(textOf(html).includes('Find details'));
    });

    it('puts the appearance rows after the other details, so D still lands on the first detail row', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c1'), true);

        assert.ok(html.indexOf('data-detail="gender"') < html.indexOf('data-detail="status"'));
        assert.ok(html.indexOf('data-detail="status"') < html.indexOf('sa-k-sh-appearance'));
        assert.ok(html.indexOf('sa-k-sh-appearance') < html.indexOf('data-detail="ethnicity"'));
    });

    it('shows no appearance row while appearance is off, but Find details at the top of the details', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c1'));

        assert.ok(html.includes('data-detail="role"'));
        assert.ok(!html.includes('data-detail="hair"'));
        assert.ok(!html.includes('sa-k-sh-appearance'));
        assert.match(html, /<div class="k-sec-head"><h4 id="sa-k-sh-details">Details <kbd>D<\/kbd><\/h4><div class="k-row-actions"><button[^>]*data-act="search-appearance" data-cid="c1"/);
        assert.ok(html.indexOf('data-act="search-appearance"') < html.indexOf('data-detail="gender"'));
        assert.match(html, /title="[^"]*for their gender, age and role; you accept or skip each finding"/);
    });

    it('puts Find details above the details and out of the Appearance heading while appearance is on', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c1'), true);

        assert.ok(html.includes('<div class="k-subhead"><h5 id="sa-k-sh-appearance">Appearance</h5></div>'));
        assert.ok(html.indexOf('data-act="search-appearance"') < html.indexOf('data-detail="gender"'));
        assert.match(html, /title="[^"]*for their gender, age, role and how they look; you accept/);
    });

    it('says in the Details help that a locked value stays, not a set one', () => {
        const html = buildKnowledgeContent(makeLedger(), [], true, sheetViewOf('c1'), true);

        assert.ok(html.includes('<p class="k-help">Recorded only as the story text states them. A value you lock stays: the story no longer changes it.</p>'));
    });

    it('turns the gender row under Details and the hair row under Appearance into the proposals, each in its own place', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [
            { kind: 'gender', value: 'female', at: 5, sources: [5], passages: [{ source: 5, text: 'She was the night nurse.' }], sourceTexts: {} },
            { kind: 'hair', value: 'dark glossy curls', at: 2, sources: [2], passages: [{ source: 2, text: 'Priya pushed her dark glossy curls back.' }], sourceTexts: {} },
        ];

        const html = buildKnowledgeContent(makeLedger(), [], true, view, true);

        const genderAt = html.indexOf('data-finding="gender"');
        const hairAt = html.indexOf('data-finding="hair"');
        assert.ok(genderAt !== -1 && genderAt < html.indexOf('data-detail="age"'), 'gender in the first Details row');
        assert.ok(html.indexOf('data-detail="ethnicity"') < hairAt && hairAt < html.indexOf('data-detail="eyes"'), 'hair between ethnicity... and eyes');
        assert.ok(!html.includes('k-findings'), 'no separate list of findings');
        assert.equal(html.split('data-detail="gender"').length, 2, 'one gender row, the proposal');
        assert.ok(findingOf(html, 'gender').includes('data-area="details:c1"'));
        assert.ok(findingOf(html, 'hair').includes('data-area="appearance:c1"'));
    });

    it('shows the search busy, and the button disabled, while it runs', () => {
        const view = sheetViewOf('c1');
        view.appearanceSearching.add('c1');

        const html = buildKnowledgeContent(makeLedger(), [], true, view, true);

        assert.match(html, /data-act="search-appearance" data-cid="c1"[^>]*disabled/);
        assert.ok(textOf(html).includes('Searching…'));
    });
});

describe('buildKnowledgeContent: what each section says the search found', () => {
    const allKinds = ['gender', 'age', 'role', 'ethnicity', 'skin', 'hair', 'eyes', 'build', 'features'];

    /** Priya's sheet after a search that found gender and role and nothing about her looks */
    function viewAfterSearch() {
        const view = sheetViewOf('c1');
        view.appearanceSearches.c1 = { searchedKinds: allKinds, foundKinds: ['gender', 'role'] };
        view.appearanceFindings.c1 = [
            { kind: 'gender', value: 'female', at: 5, sources: [5], passages: [{ source: 5, text: 'She was the night nurse.' }] },
            { kind: 'role', value: 'night nurse', at: 5, sources: [5], passages: [{ source: 5, text: 'She was the night nurse.' }] },
        ];
        return view;
    }

    /** The texts of the result lines, in page order */
    function resultLinesOf(html) {
        return [...html.matchAll(/<p class="k-result">(.*?)<\/p>/g)].map(match => textOf(match[1]));
    }

    it('says nothing before a search', () => {
        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, sheetViewOf('c1'), true);

        assert.deepEqual(resultLinesOf(html), []);
    });

    it('counts the proposals under Details and says Appearance got nothing new, naming what is recorded', () => {
        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, viewAfterSearch(), true);

        assert.deepEqual(resultLinesOf(html), [
            '2 proposals from the search. Accept or skip each, or all at once.',
            'Nothing new: the story says no more about their looks than the hair and eyes already recorded.',
        ]);
        assert.ok(html.indexOf('k-result') < html.indexOf('data-detail="gender"'));
    });

    it('says one is left once the other is handled, and nothing once both are', () => {
        const view = viewAfterSearch();
        view.appearanceFindings.c1 = view.appearanceFindings.c1.slice(1);
        const oneLeft = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);
        view.appearanceFindings.c1 = [];
        const noneLeft = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.equal(resultLinesOf(oneLeft)[0], 'One proposal from the search: accept or skip it.');
        assert.deepEqual(resultLinesOf(noneLeft), ['Nothing new: the story says no more about their looks than the hair and eyes already recorded.']);
    });

    it('says what Details already records when the search found none of its kinds', () => {
        const view = sheetViewOf('c1');
        view.appearanceSearches.c1 = { searchedKinds: allKinds, foundKinds: ['hair'] };

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.deepEqual(resultLinesOf(html), ['Nothing new: the story says no more about their gender, age and role than the role already recorded.']);
    });

    it('says the story says nothing about the looks of a character with none recorded', () => {
        const view = sheetViewOf('c2');
        view.appearanceSearches.c2 = { searchedKinds: allKinds, foundKinds: [] };
        const ledger = makeLedger();
        ledger.characters[1].details = {};

        const html = buildKnowledgeContent(ledger, makeChat(), true, view, true);

        assert.deepEqual(resultLinesOf(html), [
            'Nothing new: the story says nothing about their gender, age and role.',
            'Nothing new: the story says nothing about their looks.',
        ]);
    });

    it('says nothing under Appearance when the search did not look at the looks', () => {
        const view = viewAfterSearch();
        view.appearanceSearches.c1.searchedKinds = ['gender', 'age', 'role'];

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.deepEqual(resultLinesOf(html), ['2 proposals from the search. Accept or skip each, or all at once.']);
    });
});

describe('buildKnowledgeContent: Accept all', () => {
    /** A finding from message 5 */
    function findingFor(kind, value) {
        return { kind, value, at: 5, sources: [5], passages: [{ source: 5, text: 'Priya, five-two and slight.' }] };
    }

    /** The Accept all buttons: their label and section */
    function acceptAllButtonsOf(html) {
        return [...html.matchAll(/<button[^>]*class="menu_button k-btn is-primary" data-act="accept-all-appearance" data-cid="c1" data-section="(\w+)"[^>]*>.*?<span>([^<]*)<\/span><\/button>/g)]
            .map(match => `${match[2]} (${match[1]})`);
    }

    it('puts "Accept both" in the Details head for two detail findings', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [findingFor('gender', 'female'), findingFor('age', '24'), findingFor('build', 'slight')];

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.deepEqual(acceptAllButtonsOf(html), ['Accept both (details)']);
        assert.ok(html.indexOf('data-act="accept-all-appearance"') < html.indexOf('data-act="search-appearance"'));
    });

    it('puts "Accept all 3" in the Appearance head for three appearance findings and one detail finding', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [findingFor('age', '24'), findingFor('skin', 'warm brown'), findingFor('build', 'slight'), findingFor('features', 'freckles')];

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.deepEqual(acceptAllButtonsOf(html), ['Accept all 3 (appearance)']);
        assert.ok(html.indexOf('sa-k-sh-appearance') < html.indexOf('data-act="accept-all-appearance"'));
    });

    it('keeps one primary button: one "Accept all 4" for the sheet when both sections have two', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [findingFor('gender', 'female'), findingFor('age', '24'), findingFor('skin', 'warm brown'), findingFor('build', 'slight')];

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.deepEqual(acceptAllButtonsOf(html), ['Accept all 4 (all)']);
        assert.equal(html.split('is-primary').length, 2);
    });

    it('offers no Accept all for one finding per section, nor for appearance findings while appearance is off', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [findingFor('gender', 'female'), findingFor('skin', 'warm brown'), findingFor('build', 'slight')];

        assert.ok(!buildKnowledgeContent(makeLedger(), makeChat(), true, sheetViewOf('c1'), true).includes('accept-all-appearance'));
        view.appearanceFindings.c1 = [findingFor('gender', 'female'), findingFor('build', 'slight')];
        assert.ok(!buildKnowledgeContent(makeLedger(), makeChat(), true, view, true).includes('accept-all-appearance'));
        view.appearanceFindings.c1 = [findingFor('gender', 'female'), findingFor('skin', 'warm brown'), findingFor('build', 'slight')];
        assert.ok(!buildKnowledgeContent(makeLedger(), makeChat(), true, view, false).includes('accept-all-appearance'));
    });

});

describe('buildKnowledgeContent: a row that became the proposal', () => {
    /** Priya's sheet with two findings of her search in the view */
    function viewWithFindings() {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [
            {
                kind: 'hair', value: 'dark glossy curls', at: 5, sources: [1, 2, 4, 5],
                passages: [
                    { source: 1, text: 'Priya smiled.' },
                    { source: 2, text: 'Priya pushed her dark glossy curls back.' },
                    { source: 4, text: 'Her curls, Priya thought, needed a cut.' },
                    { source: 5, text: 'Priyanka waved at Priya Nair & co.' },
                ],
            },
            { kind: 'build', value: 'five-two, slight', at: 5, sources: [5], passages: [{ source: 5, text: 'Priya, five-two and slight, ducked under the tape.' }] },
        ];
        return view;
    }

    it('shows the current value struck through, the found value, where it was found, Accept and Skip', () => {
        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, viewWithFindings(), true);

        assert.equal(textOf(findingOf(html, 'hair')), 'Hair Now dark , found: dark glossy curls Found in 4 messages, newest #5, 1 hidden · Show sources Accept Skip');
        assert.ok(findingOf(html, 'hair').includes('<s class="k-was">dark</s>'));
        assert.ok(findingOf(html, 'hair').includes('<span class="k-new">dark glossy curls</span>'));
        assert.equal(textOf(findingOf(html, 'build')), 'Build Now unknown , found: five-two, slight Found in message #5 · Show sources Accept Skip');
        assert.ok(findingOf(html, 'build').includes('<span class="k-was k-unknown">unknown</span>'));
        assert.ok(!findingOf(html, 'build').includes('data-act="ed-detail"'), 'Set gives way to Accept and Skip');
    });

    it('says where a finding from the persona, the card and the lorebook was found', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [
            { kind: 'skin', value: 'warm brown', at: null, sources: ['lorebook: Paragon / Priya'], passages: [{ source: 'lorebook: Paragon / Priya', text: 'Skin: warm brown' }] },
            { kind: 'build', value: 'five-two', at: 2, sources: ['persona', 'card', 2], passages: [] },
            { kind: 'features', value: 'freckles', at: 4, sources: ['persona', 'lorebook: A / x', 'lorebook: A / y', 2, 4], passages: [] },
        ];

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.ok(textOf(findingOf(html, 'skin')).includes('Found in a lorebook entry ·'));
        assert.ok(textOf(findingOf(html, 'build')).includes('Found in the persona, the card and message #2, hidden ·'));
        assert.ok(textOf(findingOf(html, 'features')).includes('Found in the persona, 2 lorebook entries and 2 messages, newest #4, 1 hidden ·'));
    });

    it('shows the sources only once they are asked for: a chip per source and the three newest passages, the names marked', () => {
        const view = viewWithFindings();
        const before = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);
        view.shownSources.add('c1:hair');
        const after = findingOf(buildKnowledgeContent(makeLedger(), makeChat(), true, view, true), 'hair');

        assert.ok(!before.includes('k-sources'));
        assert.ok(after.includes('<div class="k-chips" aria-label="Sources"><span class="k-chip">#1</span>'
            + '<span class="k-chip is-hidden"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>#2<span class="k-visually-hidden">, hidden</span></span>'
            + '<span class="k-chip">#4</span><span class="k-chip">#5</span></div>'));
        assert.ok(after.includes('<p class="k-quote"><b>#5</b>Priyanka waved at <mark>Priya Nair</mark> &amp; co.</p>'
            + '<p class="k-quote"><b>#4</b>Her curls, <mark>Priya</mark> thought, needed a cut.</p>'
            + '<p class="k-quote"><b>#2</b><mark>Priya</mark> pushed her dark glossy curls back.</p></div>'));
        assert.ok(!after.includes('Priya smiled.'), 'only the three newest');
        assert.match(after, /data-act="show-sources" data-cid="c1" data-kind="hair" data-fk="show-sources\|c1\|hair" aria-expanded="true">Hide sources</);
    });

    it('shows a definition source as a chip by its name and its text under it', () => {
        const view = sheetViewOf('c1');
        view.appearanceFindings.c1 = [{
            kind: 'skin', value: 'warm brown', at: null, sources: ['persona', 'lorebook: Paragon / <Priya>'],
            passages: [{ source: 'persona', text: 'Priya is tall.' }, { source: 'lorebook: Paragon / <Priya>', text: 'Skin: warm brown' }],
        }];
        view.shownSources.add('c1:skin');

        const row = findingOf(buildKnowledgeContent(makeLedger(), makeChat(), true, view, true), 'skin');

        assert.ok(row.includes('<span class="k-chip">persona</span><span class="k-chip" title="lorebook: Paragon / &lt;Priya&gt;">lorebook: &lt;Priya&gt;</span>'));
        assert.ok(row.includes('<p class="k-quote"><b>lorebook: &lt;Priya&gt;</b>Skin: warm brown</p><p class="k-quote"><b>persona</b><mark>Priya</mark> is tall.</p>'));
    });

    it('shows no finding of one character on another character\'s sheet', () => {
        const view = viewWithFindings();
        view.sheet = { type: 'character', id: 'c2' };

        const html = buildKnowledgeContent(makeLedger(), makeChat(), true, view, true);

        assert.ok(!html.includes('is-proposal'));
    });
});

describe('listChangeLines: appearance detail lines', () => {
    /** A ledger whose one update set Priya's role and hair */
    function ledgerWithUpdate() {
        const ledger = makeLedger();
        ledger.updateLog = [{
            kind: 'update', from: 5, to: 6, messageId: 'm6', recordId: 'u1', answer: { newCharacters: 0 }, factsCreated: [], holdersAdded: 0, factsRetracted: [], detailsSet: 2,
            items: {
                characters: [], holders: [], names: [], scene: ['c1'],
                details: [{ characterId: 'c1', kind: 'role', messageId: 'm1' }, { characterId: 'c1', kind: 'hair', messageId: 'm6' }],
            },
        }];
        return ledger;
    }

    it('lists an appearance detail line only while appearance is on', () => {
        const detailKindsOf = lines => lines.groups[0].lines.filter(line => line.type === 'detail').map(line => line.detailKind);

        assert.deepEqual(detailKindsOf(listChangeLines(ledgerWithUpdate(), true, true)), ['role', 'hair']);
        assert.deepEqual(detailKindsOf(listChangeLines(ledgerWithUpdate(), true, false)), ['role']);
    });

    it('says a later value from the persona came from the persona, not from a message', () => {
        const ledger = ledgerWithUpdate();
        ledger.characters[0].details.hair.push({ value: 'dark glossy curls', at: null, by: 'record', source: 'persona' });

        const text = textOf(buildKnowledgeContent(ledger, [], true, createKnowledgeView(), true));

        assert.ok(text.includes('Changed later, from the persona, to dark glossy curls.'), text);
        assert.ok(!text.includes('#null'));
    });
});

describe('buildKnowledgeContent: an update\'s count of details', () => {
    /** A ledger whose one update set Priya's role and refined her hair */
    function ledgerWithCounts(counts) {
        const ledger = makeLedger();
        ledger.updateLog = [{
            kind: 'update', from: 5, to: 6, messageId: 'm6', recordId: 'u1', answer: { newCharacters: 0 }, factsCreated: [], holdersAdded: 0, factsRetracted: [], ...counts,
            items: { characters: [], holders: [], names: [], scene: ['c1'], details: [{ characterId: 'c1', kind: 'role', messageId: 'm1' }] },
        }];
        return ledger;
    }

    it('counts a refinement as a detail set', () => {
        const text = textOf(buildKnowledgeContent(ledgerWithCounts({ detailsSet: 1, detailsRefined: 1 }), [], true, createKnowledgeView(), true));

        assert.ok(text.includes('2 details set'), text);
    });

    it('counts an older record without the refinement count as before', () => {
        const text = textOf(buildKnowledgeContent(ledgerWithCounts({ detailsSet: 1, detailsChanged: 1 }), [], true, createKnowledgeView(), true));

        assert.ok(text.includes('2 details set'), text);
        assert.ok(!text.includes('NaN'));
    });
});

describe('saveCharacterDetails and lockCharacterDetail: appearance kinds', () => {
    it('saves a typed appearance value as a player entry, which locks the kind', () => {
        const { ledger, error } = saveCharacterDetails(makeLedger(), 'c1', { hair: 'black, cropped short' }, { hair: 'dark' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.hair, [
            { value: 'dark', at: 6, messageId: 'm6' },
            { value: 'black, cropped short', at: null, by: 'user' },
        ]);
    });

    it('locks an appearance kind at the value the story set', () => {
        const { ledger, error } = lockCharacterDetail(makeLedger(), 'c1', 'hair');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.hair, [
            { value: 'dark', at: 6, messageId: 'm6' },
            { value: 'dark', at: null, by: 'user' },
        ]);
    });

    it('still refuses a kind that is neither a detail nor an appearance kind', () => {
        const { ledger, error } = lockCharacterDetail(makeLedger(), 'c1', 'outfit');

        assert.equal(ledger, null);
        assert.equal(error, 'There is no character detail "outfit".');
    });
});

describe('buildKnowledgeContent: the merge preview names an appearance kind', () => {
    it('says which hair stays and which is dropped', () => {
        const view = sheetViewOf('c2');
        view.editors.set('sheet', { mode: 'merge', characterId: 'c2', targetId: 'c1', keepSelf: false });

        const text = textOf(buildKnowledgeContent(makeLedger(), [], true, view, true));

        assert.ok(text.includes('Hair: Priya Nair&#39;s dark stays; Ellie&#39;s blonde is dropped.'), text);
    });

    it('leaves appearance out of the preview while appearance is off', () => {
        const view = sheetViewOf('c2');
        view.editors.set('sheet', { mode: 'merge', characterId: 'c2', targetId: 'c1', keepSelf: false });

        const text = textOf(buildKnowledgeContent(makeLedger(), [], true, view));

        assert.ok(!text.includes('Hair:'));
    });
});

describe('buildKnowledgeContent: the message search lists appearance the story set', () => {
    it('lists Priya\'s hair at message 6 while appearance is on, and not while it is off', () => {
        const view = createKnowledgeView();
        view.tab = 'cast';
        view.query = '#6';

        const withAppearance = textOf(buildKnowledgeContent(makeLedger(), [], true, view, true));
        const withoutAppearance = textOf(buildKnowledgeContent(makeLedger(), [], true, view));

        assert.ok(withAppearance.includes('hair: dark at message #6'), withAppearance);
        assert.ok(!withoutAppearance.includes('hair: dark'));
    });
});

describe('acceptAppearanceFinding', () => {
    it('appends an older refining finding after the newer entry, so it is current', () => {
        const finding = { kind: 'hair', value: 'dark glossy curls', at: 2, sources: [2], passage: 'Priya pushed her dark glossy curls back.' };

        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', finding, 'm2');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.hair, [
            { value: 'dark', at: 6, messageId: 'm6' },
            { value: 'dark glossy curls', at: 2, messageId: 'm2' },
        ]);
    });

    it('starts the history of a kind the ledger did not know', () => {
        const { ledger } = acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'build', value: 'five-two, slight', at: 5, passage: '' }, 'm5');

        assert.deepEqual(ledger.characters[0].details.build, [{ value: 'five-two, slight', at: 5, messageId: 'm5' }]);
        assert.deepEqual(ledger.characters[0].details.role, [{ value: 'nurse', at: 1, messageId: 'm1' }]);
    });

    it('stores a finding from a definition as a record entry with its source, which a rollback keeps and the sheet names', () => {
        const finding = { kind: 'build', value: 'five-two', at: null, sources: ['persona', 'card'], passage: 'Priya is five-two. … Priya is slight.' };

        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', finding);
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.build, [{ value: 'five-two', at: null, by: 'record', source: 'persona and card' }]);

        dropKnowledgeFrom(ledger, 0);
        assert.deepEqual(ledger.characters[0].details.build, [{ value: 'five-two', at: null, by: 'record', source: 'persona and card' }]);
        const html = buildKnowledgeContent(ledger, [], true, sheetViewOf('c1'), true);
        assert.equal(textOf(detailRowOf(html, 'build')), 'Build five-two From the persona and card Edit Lock');
    });

    it('shows a lorebook source on the sheet as text, not as markup', () => {
        const finding = { kind: 'build', value: 'slight', at: null, sources: ['lorebook: Book / <img src=x>'], passage: 'Priya is slight.' };

        const { ledger } = acceptAppearanceFinding(makeLedger(), 'c1', finding);
        const html = buildKnowledgeContent(ledger, [], true, sheetViewOf('c1'), true);

        assert.ok(detailRowOf(html, 'build').includes('From the lorebook: Book / &lt;img src=x&gt;'));
        assert.ok(!html.includes('<img src=x>'));
    });

    it('stores a finding that also uses a message as a story entry at that message, which rolls back with it', () => {
        const finding = { kind: 'build', value: 'five-two, slight', at: 5, sources: ['persona', 5], passage: 'Priya is five-two. … Priya ducked under the tape.' };

        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', finding, 'm5');
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.build, [{ value: 'five-two, slight', at: 5, messageId: 'm5' }]);

        dropKnowledgeFrom(ledger, 5);
        assert.equal(ledger.characters[0].details.build, undefined);
    });

    it('stores a found gender from a message as a story entry, which the sheet shows unlocked and a rollback removes', () => {
        const finding = { kind: 'gender', value: 'female', at: 5, sources: [5], passage: 'Priya tucked her badge away. She was the night nurse.' };

        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', finding, 'm5');
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.gender, [{ value: 'female', at: 5, messageId: 'm5' }]);
        const html = buildKnowledgeContent(ledger, [], true, sheetViewOf('c1'), true);
        assert.equal(textOf(detailRowOf(html, 'gender')), 'Gender female From the story, message #5 Edit Lock');

        dropKnowledgeFrom(ledger, 5);
        assert.equal(ledger.characters[0].details.gender, undefined);
    });

    it('stores a found age from the card alone as a record entry, unlocked, named after the card', () => {
        const finding = { kind: 'age', value: '17', at: null, sources: ['card'], passage: 'Priya is 17.' };

        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', finding);
        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.age, [{ value: '17', at: null, by: 'record', source: 'card' }]);
        const html = buildKnowledgeContent(ledger, [], true, sheetViewOf('c1'), true);
        assert.equal(textOf(detailRowOf(html, 'age')), 'Age 17 From the card Edit Lock');
    });

    it('refuses a locked kind', () => {
        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'eyes', value: 'dark brown', at: 5, passage: '' }, 'm5');

        assert.equal(ledger, null);
        assert.equal(error, 'Priya Nair\'s eyes is locked by you; unlock it to accept a finding.');
    });

    it('refuses an unknown character and a kind the search does not find', () => {
        assert.equal(acceptAppearanceFinding(makeLedger(), 'c9', { kind: 'hair', value: 'red', at: 5 }, 'm5').error, 'This character is no longer in the ledger.');
        assert.equal(acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'relation', value: 'mother', at: 5 }, 'm5').error, 'The search does not find the kind "relation".');
    });

    it('leaves its input unchanged', () => {
        const ledger = makeLedger();

        acceptAppearanceFinding(ledger, 'c1', { kind: 'hair', value: 'dark glossy curls', at: 2 }, 'm2');

        assert.deepEqual(ledger, makeLedger());
    });

    it('refuses a finding an update has overtaken since the search: an older value that does not refine the newer one', () => {
        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'hair', value: 'auburn', at: 2 }, 'm2');

        assert.equal(ledger, null);
        assert.equal(error, 'The story has changed Priya Nair\'s hair since the search; search again.');
    });

    it('refuses a finding whose value the ledger now holds', () => {
        const { error } = acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'hair', value: 'Dark', at: 7 }, 'm7');

        assert.equal(error, 'The story has changed Priya Nair\'s hair since the search; search again.');
    });

    it('accepts a newer different value', () => {
        const { ledger, error } = acceptAppearanceFinding(makeLedger(), 'c1', { kind: 'hair', value: 'black', at: 7 }, 'm7');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.hair.at(-1), { value: 'black', at: 7, messageId: 'm7' });
    });
});

describe('acceptAppearanceFindings: Accept all as one edit', () => {
    it('stores each finding with its own source message id, a definition finding as a record entry', () => {
        const stored = makeLedger();
        const findings = [
            { kind: 'gender', value: 'female', at: 5, sources: [5] },
            { kind: 'build', value: 'five-two', at: null, sources: ['card'] },
            { kind: 'hair', value: 'black', at: 7, sources: [3, 7] },
        ];

        const { ledger, error } = acceptAppearanceFindings(stored, 'c1', findings, { gender: 'm5', hair: 'm7' });

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[0].details.gender, [{ value: 'female', at: 5, messageId: 'm5' }]);
        assert.deepEqual(ledger.characters[0].details.build, [{ value: 'five-two', at: null, by: 'record', source: 'card' }]);
        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark', at: 6, messageId: 'm6' }, { value: 'black', at: 7, messageId: 'm7' }]);
        assert.equal(stored.characters[0].details.gender, undefined, 'the stored ledger is left untouched');
    });

    it('refuses them all when one is refused', () => {
        const findings = [
            { kind: 'gender', value: 'female', at: 5, sources: [5] },
            { kind: 'eyes', value: 'dark brown', at: 5, sources: [5] },
        ];

        const { ledger, error } = acceptAppearanceFindings(makeLedger(), 'c1', findings, { gender: 'm5', eyes: 'm5' });

        assert.equal(ledger, null);
        assert.equal(error, 'Priya Nair\'s eyes is locked by you; unlock it to accept a finding.');
    });
});

describe('findSourceMessageRefusal', () => {
    it('lets a finding through while its message still has the text the search read', () => {
        assert.equal(findSourceMessageRefusal(makeChat(), { at: 2, sources: [2], sourceTexts: { 2: 'message 2' } }), null);
    });

    it('refuses a finding whose message is gone', () => {
        assert.equal(findSourceMessageRefusal(makeChat(), { at: 9, sources: [9], sourceTexts: { 9: 'message 9' } }), 'Message #9 is no longer in the chat; search again.');
    });

    it('refuses a finding when an older one of its messages changed, not only its newest', () => {
        const chatMessages = makeChat();
        chatMessages[1].mes = 'message 1, edited';

        const finding = { at: 4, sources: ['persona', 1, 4], sourceTexts: { 1: 'message 1', 4: 'message 4' } };
        assert.equal(findSourceMessageRefusal(chatMessages, finding), 'Message #1 changed since the search; search again.');
    });

    it('lets a finding from definitions only through: it has no message', () => {
        assert.equal(findSourceMessageRefusal([], { at: null, sources: ['persona', 'card'], sourceTexts: {} }), null);
    });

    it('refuses a finding whose index now holds another text: an edit, or a deletion moved the messages', () => {
        const chatMessages = makeChat();
        chatMessages.splice(1, 1);

        assert.equal(findSourceMessageRefusal(chatMessages, { at: 2, sources: [2], sourceTexts: { 2: 'message 2' } }), 'Message #2 changed since the search; search again.');
    });
});
