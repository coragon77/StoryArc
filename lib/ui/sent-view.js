/**
 * @file The view of what Story Arc sends to the narrator (#83)
 * @module ui/sent-view
 *
 * One popup: a strip down the left draws the narrator's request top to
 * bottom, Story Arc's parts as blocks sized by their tokens and
 * SillyTavern's own parts as dashed spacers; the chosen part's text stands
 * on the right, as it is sent. "Last sent" is the record kept when the
 * latest request went out (narrator-prompts.js, saveLastSent); "Next
 * request" is built now by the same function that injects
 * (listStoryArcPrompts). Read-only: corrections belong in the Arc Manager
 * and the Knowledge popup.
 *
 * Spoilers stay hidden line by line until the player reveals the plan:
 * secrets, triggers, clues and fulfillments. Premise, world facts and
 * pressures always show; they steer every reply and reveal no plot.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { chat, chat_metadata } from '/script.js';
import { getArcs, getActiveArcs } from '../planning/storage.js';
import { ensureChatState, getChatSettings, getKnowledgeLedger, isEnabled } from '../core/settings.js';
import { HOLDER_HOW, KNOWLEDGE_PROMPT_KEY, NAMES_PROMPT_KEY } from '../core/constants.js';
import { estimateTokens } from '../context/chat-history.js';
import { listStoryArcPrompts, PLAN_PROMPT_KEY, SIGNALS_PROMPT_KEY } from '../injection/narrator-prompts.js';
import { buildStamp } from '../injection/stamping.js';
import { selectPacingClock } from '../injection/clock.js';
import { BEAT_CHECK_LINE_START, CLUE_CHECK_LINE_START, TRIGGER_CHECK_LINE_START, TRIMMABLE_LIST_HEADER } from '../injection/builder.js';
import { formatNumber } from './beat-strip.js';

/** The key of the stamp, which has no prompt key: it rides on the newest user message. */
const STAMP_KEY = 'stamp';

/** Each part's name in the UI, in the order the narrator reads them. */
const PART_NAMES = {
    [PLAN_PROMPT_KEY]: 'Arc plan',
    [KNOWLEDGE_PROMPT_KEY]: 'Who knows what',
    [NAMES_PROMPT_KEY]: 'Names already in this story',
    [STAMP_KEY]: 'Message stamp',
    [SIGNALS_PROMPT_KEY]: 'Pacing and checks',
};

/** Shortest spoiler line the content rule matches: a short one could hide unrelated text. */
const SHORTEST_SPOILER_LINE = 12;

/** The open view: the request it shows and whether the plan is revealed. */
let session = null;

// ─── Show the view ───

/**
 * Open the view. It opens on Last sent when the chat has a record of the
 * last send, otherwise on Next request.
 */
export async function showSentView() {
    ensureChatState();
    const lastSent = chat_metadata.story_arc?.lastSent ?? null;
    session = {
        mode: lastSent ? 'sent' : 'next',
        revealed: false,
        selectedKey: PLAN_PROMPT_KEY,
    };

    const popup = new Popup(`<div class="am sv" id="story-arc-sent-view">${renderSentView()}</div>`, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        // The reader and the strip scroll on their own; the head and the status bar stay
        allowVerticalScrolling: false,
    });
    const popupPromise = popup.show();
    await delay(50);
    wireSentViewEvents(popup);

    await popupPromise;
    $(document).off('.storyArcSentView');
    session = null;
}

/**
 * Bind the view's controls. Every change renders the view again from the
 * session; the parts are rebuilt each time, so Next request follows a
 * change made elsewhere while the view is open.
 * @param {object} popup - The ST popup
 */
function wireSentViewEvents(popup) {
    const $doc = $(document);
    $doc.off('.storyArcSentView');

    $doc.on('change.storyArcSentView', '#story-arc-sent-view input[name="sv-mode"]', function () {
        session.mode = this.value;
        rerender();
    });
    $doc.on('change.storyArcSentView', '#story-arc-sent-view #sv-reveal', function () {
        session.revealed = this.checked;
        rerender();
    });
    $doc.on('click.storyArcSentView', '#story-arc-sent-view [data-sv-part]', function () {
        session.selectedKey = this.dataset.svPart;
        rerender(this.dataset.svPart);
    });
    // Up and Down move between the strip's blocks
    $doc.on('keydown.storyArcSentView', '#story-arc-sent-view [data-sv-part]', function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const blocks = [...document.querySelectorAll('#story-arc-sent-view [data-sv-part]')];
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = blocks[blocks.indexOf(this) + step];
        if (!next) return;
        session.selectedKey = next.dataset.svPart;
        rerender(next.dataset.svPart);
    });
    $doc.on('click.storyArcSentView', '#story-arc-sent-view #sv-close', () => popup.complete(0));
}

/**
 * Render the view again in place, keeping the focus on a strip block.
 * @param {string} [focusKey] - The block to focus afterwards
 */
function rerender(focusKey) {
    const root = document.getElementById('story-arc-sent-view');
    if (!root) return;
    root.innerHTML = renderSentView();
    if (focusKey) root.querySelector(`[data-sv-part="${CSS.escape(focusKey)}"]`)?.focus();
}

/** The view's HTML from the session and the chat as it stands. */
function renderSentView() {
    const lastSent = chat_metadata.story_arc?.lastSent ?? null;
    const view = {
        enabled: isEnabled(),
        mode: lastSent ? session.mode : 'next',
        revealed: session.revealed,
        selectedKey: session.selectedKey,
        sent: lastSent ? sentRequestOf(lastSent) : null,
        next: nextRequest(),
        budget: getChatSettings().injectionBudget || 3000,
        spoilers: listSpoilers(getArcs(), getKnowledgeLedger()),
    };
    return buildSentViewContent(view);
}

// ─── The two requests ───

/**
 * The next request as listStoryArcPrompts builds it now, with the stamp
 * the next request will carry: on the player's next message when the
 * newest message is the narrator's, on the newest when it is the player's.
 * @returns {{parts: object[], newestMessageIndex: number, replyIndex: number}}
 */
function nextRequest() {
    const newestIsPlayers = chat.length > 0 && chat[chat.length - 1].is_user;
    const stampedIndex = newestIsPlayers ? chat.length - 1 : chat.length;
    const clock = isEnabled() ? selectPacingClock(getActiveArcs()) : null;
    const stampText = clock ? buildStamp(clock, stampedIndex) : '';

    const prompts = listStoryArcPrompts();
    return {
        parts: partsInReadingOrder(prompts, stampText),
        newestMessageIndex: stampedIndex,
        replyIndex: stampedIndex + 1,
    };
}

/**
 * The last sent request from its record.
 * @param {object} lastSent - chat_metadata.story_arc.lastSent
 * @returns {{parts: object[], newestMessageIndex: number, replyIndex: number, savedAt: string}}
 */
function sentRequestOf(lastSent) {
    return {
        parts: partsInReadingOrder(lastSent.parts, lastSent.stamp ?? ''),
        newestMessageIndex: lastSent.newestMessageIndex,
        replyIndex: lastSent.replyIndex,
        savedAt: lastSent.savedAt,
    };
}

/**
 * The five parts in the order the narrator reads them: the prompt keys,
 * with the stamp after the names (it rides on the newest message, between
 * the depth-1 message and the depth-0 one).
 * @param {{key: string, text: string}[]} prompts - The four keyed prompts
 * @param {string} stampText - The stamp, '' for none
 * @returns {{key: string, name: string, text: string, tokens: number}[]}
 */
export function partsInReadingOrder(prompts, stampText) {
    const textOf = key => prompts.find(prompt => prompt.key === key)?.text ?? '';
    const keys = [PLAN_PROMPT_KEY, KNOWLEDGE_PROMPT_KEY, NAMES_PROMPT_KEY, STAMP_KEY, SIGNALS_PROMPT_KEY];
    return keys.map(key => {
        const text = key === STAMP_KEY ? stampText : textOf(key);
        return { key, name: PART_NAMES[key], text, tokens: estimateTokens(text) };
    });
}

// ─── Spoilers ───

/**
 * What the masking needs from the arcs and the ledger: every line of every
 * secret, trigger condition and action, clue and clue target, and
 * fulfillment, of all arcs (a record of the last send may hold an arc that
 * has ended since); and the names of the characters who hold a fact only
 * as planned holders.
 * @param {object[]} arcs - All arcs of the chat
 * @param {object|null} ledger - The knowledge ledger, null while the tracker is off
 * @returns {{spoilerLines: string[], plannedHolderNames: string[]}}
 */
export function listSpoilers(arcs, ledger) {
    const spoilerTexts = [];
    for (const arc of arcs) {
        for (const secret of arc.secrets || []) spoilerTexts.push(secret.content);
        for (const trigger of arc.triggers || []) spoilerTexts.push(trigger.condition, trigger.action);
        for (const foreshadowing of arc.foreshadowing || []) spoilerTexts.push(foreshadowing.clue, foreshadowing.target);
        for (const beat of arc.beats || []) spoilerTexts.push(beat.intention);
    }
    const spoilerLines = spoilerTexts
        .flatMap(text => String(text ?? '').split('\n'))
        .map(line => line.trim())
        .filter(line => line.length >= SHORTEST_SPOILER_LINE);

    const plannedHolderNames = [];
    for (const character of ledger?.characters ?? []) {
        const holdsAsPlanned = (ledger.facts || []).some(fact =>
            fact.holders.some(holder => holder.characterId === character.id && holder.how === HOLDER_HOW.plan));
        if (holdsAsPlanned && character.name.trim()) plannedHolderNames.push(character.name.trim());
    }
    return { spoilerLines, plannedHolderNames };
}

/**
 * Split one part's text into runs of shown and hidden lines. It classifies
 * the lines of the text as sent; it never builds a second text.
 *
 * Hidden by place: the items under a SECRETS, TRIGGERS or FORESHADOWING TO
 * PLANT header in the plan, and the BEAT CHECK and PLANT CHECK lines of the
 * signals, each run up to the blank line the builder closes it with (an
 * item with a line break continues on a line without "- "). Hidden by
 * content: any line holding a line of a spoiler (listSpoilers), which
 * catches what the place rule misses. In the knowledge block, a line whose
 * "(shared only with …)" names a planned holder.
 *
 * @param {string} partKey - The part's key
 * @param {string} text - The part's text as sent
 * @param {{spoilerLines: string[], plannedHolderNames: string[]}} spoilers - listSpoilers
 * @returns {{hidden: boolean, lines: string[], items: string[]}[]} Runs; `items` names the
 *   hidden items by kind, one entry per item ('secret', 'trigger', 'clue', 'beat check', 'plan line')
 */
export function maskSpoilerLines(partKey, text, spoilers) {
    const runs = [];
    const pushLine = (line, hidden, item) => {
        const last = runs[runs.length - 1];
        if (last && last.hidden === hidden) {
            last.lines.push(line);
            if (item) last.items.push(item);
            return;
        }
        runs.push({ hidden, lines: [line], items: item ? [item] : [] });
    };
    const holdsSpoilerLine = line => spoilers.spoilerLines.some(spoilerLine => line.includes(spoilerLine));

    let openList = null;
    for (const line of text.split('\n')) {
        if (line.trim() === '') {
            openList = null;
            pushLine(line, false, null);
            continue;
        }

        let item = null;
        if (partKey === PLAN_PROMPT_KEY) {
            // A section line closes a list too: the budget trim can drop
            // the blank line after the last list before [END STORY ARC].
            if (/^(===|\[END STORY ARC\])/.test(line)) openList = null;
            const header = TRIMMABLE_LIST_HEADER.exec(line);
            if (header) {
                openList = header[1].startsWith('SECRETS') ? 'secret' : header[1].startsWith('TRIGGERS') ? 'trigger' : 'clue';
                pushLine(line, false, null);
                continue;
            }
            if (openList && line.startsWith('- ')) item = openList;
        } else if (partKey === SIGNALS_PROMPT_KEY) {
            if (line.startsWith(BEAT_CHECK_LINE_START)) item = 'beat check';
            else if (line.startsWith(CLUE_CHECK_LINE_START)) item = 'clue';
            else if (line.startsWith(TRIGGER_CHECK_LINE_START)) item = 'trigger';
            if (item) openList = item;
        } else if (partKey === KNOWLEDGE_PROMPT_KEY) {
            const sharedWith = line.split('(shared only with ')[1] ?? '';
            if (spoilers.plannedHolderNames.some(name => sharedWith.includes(name))) item = 'knowledge line';
        }

        if (item) pushLine(line, true, item);
        else if (openList) pushLine(line, true, null);
        else if (holdsSpoilerLine(line)) pushLine(line, true, 'plan line');
        else pushLine(line, false, null);
    }
    return runs;
}

/**
 * The placeholder's words for a hidden run: "3 triggers, 4 clues hidden · 455 tokens".
 * @param {{lines: string[], items: string[]}} run
 * @returns {string}
 */
export function describeHiddenRun(run) {
    const counts = new Map();
    for (const item of run.items) counts.set(item, (counts.get(item) || 0) + 1);
    const countWords = [...counts].map(([item, count]) => `${count} ${count === 1 ? item : `${item}s`}`);
    const tokens = estimateTokens(run.lines.join('\n'));
    return `${countWords.join(', ') || 'Plan text'} hidden · ${formatNumber(tokens)} tokens`;
}

// ─── The HTML ───

/**
 * The whole view: head, note line, the strip and the reader, the status bar.
 * @param {object} view
 * @param {boolean} view.enabled - Story Arc is on
 * @param {'sent'|'next'} view.mode - Which request is shown
 * @param {boolean} view.revealed - The plan is revealed
 * @param {string} view.selectedKey - The part shown in the reader
 * @param {object|null} view.sent - The last sent request (sentRequestOf), null when none
 * @param {object} view.next - The next request (nextRequest)
 * @param {number} view.budget - The plan's token budget
 * @param {{spoilerLines: string[], plannedHolderNames: string[]}} view.spoilers - listSpoilers
 * @returns {string} HTML
 */
export function buildSentViewContent(view) {
    const request = view.mode === 'sent' ? view.sent : view.next;
    const hiddenLineCount = request.parts
        .flatMap(part => maskSpoilerLines(part.key, part.text, view.spoilers))
        .filter(run => run.hidden)
        .reduce((count, run) => count + run.lines.filter(line => line.trim()).length, 0);
    const sendsNothing = request.parts.every(part => !part.text);

    return `
        ${buildHead(view, request, hiddenLineCount)}
        ${buildNote(view, request)}
        <div class="sv-split">
            ${buildStrip(view, request)}
            <div class="sv-reader">${buildReader(view, request, sendsNothing)}</div>
        </div>
        <div class="am-controls">
            <span class="sv-status"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Read-only. Correct the plan in the Arc Manager, the knowledge in the Knowledge popup.</span>
            <button type="button" class="menu_button" id="sv-close">Close</button>
        </div>`;
}

/** The head: title, summary line, the request switch and Reveal plan. */
function buildHead(view, request, hiddenLineCount) {
    const total = request.parts.reduce((sum, part) => sum + part.tokens, 0);
    let summary;
    if (view.mode === 'sent') {
        const savedAt = new Date(request.savedAt);
        const time = Number.isNaN(savedAt.getTime()) ? '' : ` · saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        summary = `Story Arc added <b>${formatNumber(total)} tokens</b> to the request for reply #${request.replyIndex}${time}`;
    } else {
        summary = `Story Arc would add <b>${formatNumber(total)} tokens</b> to the next request`;
        if (view.sent) {
            const sentTotal = view.sent.parts.reduce((sum, part) => sum + part.tokens, 0);
            const difference = total - sentTotal;
            if (difference !== 0) summary += ` · ${formatNumber(Math.abs(difference))} ${difference < 0 ? 'fewer' : 'more'} than last sent`;
        }
    }

    const sentDisabled = view.sent ? '' : 'disabled';
    const sentTitle = view.sent ? '' : ' title="No request saved in this chat yet. Story Arc keeps the last one it sent through a chat completion API."';
    const revealState = view.revealed ? 'shown' : `${formatNumber(hiddenLineCount)} ${hiddenLineCount === 1 ? 'line' : 'lines'} hidden`;
    return `
        <div class="am-head">
            <div class="am-head-text">
                <h2>What the narrator gets</h2>
                <p class="am-summary">${summary}</p>
            </div>
            <div class="am-head-actions">
                <fieldset class="am-seg" role="radiogroup" aria-label="Which request">
                    <label class="am-seg-opt"${sentTitle}><input type="radio" name="sv-mode" value="sent" ${view.mode === 'sent' ? 'checked' : ''} ${sentDisabled}><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>Last sent</span></label>
                    <label class="am-seg-opt"><input type="radio" name="sv-mode" value="next" ${view.mode === 'next' ? 'checked' : ''}><i class="fa-solid fa-forward" aria-hidden="true"></i><span>Next request</span></label>
                </fieldset>
                <label class="am-switch"><input type="checkbox" role="switch" id="sv-reveal" ${view.revealed ? 'checked' : ''}>
                    <span class="am-switch-track" aria-hidden="true"></span>Reveal plan <span class="am-switch-state">${revealState}</span></label>
            </div>
        </div>`;
}

/** The note line under the head: what this request is and what stays hidden. */
function buildNote(view, request) {
    if (view.mode === 'sent') {
        return `<div class="sv-note"><div class="am-alert is-note"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
            <p>Saved when the request for reply #${request.replyIndex} went out. Secrets, triggers, clues and beat checks stay hidden until you reveal the plan; premise, world facts and pressures always show.</p></div></div>`;
    }
    const marks = view.sent ? ' Marked lines are not in the last sent request.' : '';
    return `<div class="sv-note"><div class="am-alert is-note"><i class="fa-solid fa-forward" aria-hidden="true"></i>
        <p>Built now from the story as it stands. Sending your message can still change it: a beat may become current, and Who knows what reads your message for who is talked about.${marks}</p></div></div>`;
}

/** Where each part sits in the request, and the sub-line under it. */
function placementOf(key, request) {
    if (key === PLAN_PROMPT_KEY) return { where: 'End of the Main prompt', sub: 'appended to your preset\'s Main prompt' };
    if (key === KNOWLEDGE_PROMPT_KEY) return { where: 'In chat, depth 1', sub: 'one system message with Names and any depth-1 prompt of your preset or other extensions' };
    if (key === NAMES_PROMPT_KEY) return { where: 'In chat, depth 1', sub: 'right after Who knows what, in the same message' };
    if (key === STAMP_KEY) return { where: `On message #${request.newestMessageIndex}`, sub: 'in front of the newest message\'s text' };
    return { where: 'In chat, depth 0', sub: 'after the newest message, the last thing before the reply' };
}

/** The strip: the request top to bottom, Story Arc's parts as blocks sized by tokens. */
function buildStrip(view, request) {
    const block = part => {
        const height = Math.min(240, Math.max(44, Math.round(part.tokens / 12)));
        const isSelected = part.key === view.selectedKey;
        return `<button type="button" class="sv-block ${part.text ? '' : 'is-empty'}" data-sv-part="${part.key}" aria-pressed="${isSelected}" style="min-height:${height}px">
            <b>${escapeHtml(part.name)}</b><span class="sv-block-tokens">${formatNumber(part.tokens)}</span>
            <span class="sv-block-where">${escapeHtml(placementOf(part.key, request).where)}</span></button>`;
    };
    const gap = text => `<div class="sv-gap">${escapeHtml(text)}</div>`;
    const [plan, knowledge, names, stamp, signals] = request.parts;
    const historyEnd = request.newestMessageIndex - 1;
    const replyLine = view.mode === 'sent' ? `Reply #${request.replyIndex} was written here` : 'The reply is written here';
    return `
        <div class="sv-strip" role="group" aria-label="The request, top to bottom">
            <p class="sv-strip-label">The request, top to bottom · heights follow tokens</p>
            ${gap('Main prompt (your preset)')}
            ${block(plan)}
            ${gap('Card, persona, lorebook and the rest of your preset')}
            ${historyEnd >= 0 ? gap(`Chat history up to #${historyEnd}`) : ''}
            ${block(knowledge)}
            ${block(names)}
            ${block(stamp)}
            ${gap(`Newest message, #${request.newestMessageIndex}`)}
            ${block(signals)}
            ${gap(replyLine)}
        </div>`;
}

/** The reader: the chosen part's placement, tokens and text, hidden runs as placeholders. */
function buildReader(view, request, sendsNothing) {
    if (!view.enabled) return '<p class="sv-empty">Story Arc is off: it sends nothing.</p>';
    if (sendsNothing) return '<p class="sv-empty">Story Arc sends nothing to this chat right now.</p>';

    const part = request.parts.find(candidate => candidate.key === view.selectedKey) ?? request.parts[0];
    const { where, sub } = placementOf(part.key, request);
    let tokens = `${formatNumber(part.tokens)} tokens`;
    if (part.key === PLAN_PROMPT_KEY) tokens += ` of a ${formatNumber(view.budget)} budget`;
    if (view.mode === 'next' && view.sent) {
        const sentTokens = view.sent.parts.find(candidate => candidate.key === part.key)?.tokens ?? 0;
        const difference = part.tokens - sentTokens;
        if (difference !== 0) tokens += ` · ${formatNumber(Math.abs(difference))} ${difference < 0 ? 'fewer' : 'more'} than last sent`;
    }

    const head = `
        <h3>${escapeHtml(part.name)}</h3>
        <p class="sv-where"><span>${escapeHtml(where)}</span><span class="muted">${escapeHtml(sub)}</span><span class="muted">${tokens}</span></p>`;
    if (!part.text) return `${head}<p class="sv-empty">Nothing: this part is empty for this request.</p>`;

    // In Next request, a line the last sent text did not have is marked
    const sentLines = view.mode === 'next' && view.sent
        ? new Set((view.sent.parts.find(candidate => candidate.key === part.key)?.text ?? '').split('\n'))
        : null;
    const lineHtml = line => {
        const isChanged = sentLines && line.trim() && !sentLines.has(line);
        const html = headedLineHtml(line);
        return isChanged ? `<span class="sv-changed">${html}</span>` : html;
    };
    const textHtml = maskSpoilerLines(part.key, part.text, view.spoilers).map(run => {
        if (run.hidden && !view.revealed) {
            return `<span class="sv-hidden"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>${describeHiddenRun(run)}</span>`;
        }
        return run.lines.map(lineHtml).join('\n');
    }).join('\n');
    return `${head}<div class="sv-text">${textHtml}</div>`;
}

/**
 * One line of a part, its section head in weight 600: a whole "=== … ==="
 * or "[STORY ARC …]" line, or the capitals label in front of the text
 * ("PREMISE:", "TRIGGERS (…):").
 * @param {string} line
 * @returns {string} HTML
 */
function headedLineHtml(line) {
    if (/^===.*===$/.test(line) || /^\[(STORY ARC|END STORY ARC|WHO KNOWS WHAT|NAMES ALREADY)/.test(line)) {
        return `<span class="sv-head">${escapeHtml(line)}</span>`;
    }
    const label = /^([A-Z][A-Z ]{3,}(?: \(.*\))?:)(.*)$/.exec(line);
    if (label) return `<span class="sv-head">${escapeHtml(label[1])}</span>${escapeHtml(label[2])}`;
    return escapeHtml(line);
}
