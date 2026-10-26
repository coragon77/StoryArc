import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildStamp, stampPromptMessages } from '../lib/injection/stamping.js';
import { INJECTION_HEADER } from '../lib/core/constants.js';
import { chat } from './mocks/st-mocks.js';

function makeArc(overrides = {}) {
    return {
        id: 'abcd1234-full-id',
        title: 'The Warmth Behind the Wall',
        tier: 'episode',
        focus: 'normal',
        messageStart: 4,
        estimatedLength: 20,
        ...overrides,
    };
}

/**
 * Fill the mock chat with `n` alternating user/assistant messages.
 * Message i reads "line i", user messages are the even indices.
 */
function fillChat(n) {
    chat.length = 0;
    for (let i = 0; i < n; i++) {
        chat.push({ mes: `line ${i}`, is_user: i % 2 === 0 });
    }
}

/**
 * The outgoing prompt ST would build from the mock chat: the plan block first,
 * then every chat message as its own entry.
 */
function makePrompt() {
    return [
        { role: 'system', content: `${INJECTION_HEADER}\nplan text` },
        ...chat.map((m, i) => ({ role: m.is_user ? 'user' : 'assistant', content: `line ${i}` })),
    ];
}

beforeEach(() => {
    chat.length = 0;
});

describe('buildStamp', () => {
    it('numbers messages relative to the arc start, one-based', () => {
        const arc = makeArc(); // messageStart 4, estimatedLength 20
        assert.equal(buildStamp(arc, 4), '[Arc: message 1 of ~20]');
        assert.equal(buildStamp(arc, 10), '[Arc: message 7 of ~20]');
    });

    it('drops the total for arcs planned without an estimated length', () => {
        assert.equal(buildStamp(makeArc({ estimatedLength: 0 }), 9), '[Arc: message 6]');
    });

    it('returns nothing for positions before the arc started', () => {
        assert.equal(buildStamp(makeArc(), 3), '');
    });

    it('depends only on the index, never on how long the chat has grown', () => {
        const arc = makeArc();
        fillChat(6);
        const early = buildStamp(arc, 5);
        fillChat(60);
        assert.equal(buildStamp(arc, 5), early);
        assert.equal(early, '[Arc: message 2 of ~20]');
    });
});

describe('stampPromptMessages', () => {
    it('stamps user messages from the arc start onward', () => {
        fillChat(10); // arc starts at index 4
        const prompt = makePrompt();
        const stamped = stampPromptMessages(prompt, [makeArc()]);

        assert.equal(stamped, 3); // indices 4, 6, 8
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nline 4');
        assert.equal(prompt[7].content, '[Arc: message 3 of ~20]\nline 6');
        assert.equal(prompt[9].content, '[Arc: message 5 of ~20]\nline 8');
    });

    it('leaves assistant messages and pre-arc messages alone', () => {
        fillChat(10);
        const prompt = makePrompt();
        stampPromptMessages(prompt, [makeArc()]);

        assert.equal(prompt[3].content, 'line 2'); // user, before messageStart
        assert.equal(prompt[6].content, 'line 5'); // assistant, inside the arc
    });

    it('keeps old positions byte-identical when the chat grows', () => {
        fillChat(10);
        const before = makePrompt();
        stampPromptMessages(before, [makeArc()]);

        fillChat(12);
        const after = makePrompt();
        stampPromptMessages(after, [makeArc()]);

        for (let i = 0; i < before.length; i++) {
            assert.equal(after[i].content, before[i].content, `entry ${i} changed`);
        }
        // ...and the newly appended user message carries the current number.
        assert.equal(after[11].content, '[Arc: message 7 of ~20]\nline 10');
    });

    it('matches messages ST prefixed with the speaker name', () => {
        fillChat(6);
        const prompt = makePrompt();
        prompt[5].content = 'Mira: line 4';
        stampPromptMessages(prompt, [makeArc()]);
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nMira: line 4');
    });

    it('does not let a foreign injected entry shift the numbering', () => {
        fillChat(10);
        const prompt = makePrompt();
        // Another extension splices a user-role entry in between chat messages.
        prompt.splice(8, 0, { role: 'user', content: 'remember to stay in character' });
        stampPromptMessages(prompt, [makeArc()]);

        assert.equal(prompt[8].content, 'remember to stay in character');
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nline 4');
        assert.equal(prompt[10].content, '[Arc: message 5 of ~20]\nline 8');
    });

    it('skips prompts that do not carry the arc plan (other extensions\' calls)', () => {
        fillChat(10);
        const prompt = makePrompt();
        prompt[0].content = 'summarize the conversation so far';
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 0);
        assert.equal(prompt[5].content, 'line 4');
    });

    it('follows the first normal episode in storage order, and the spotlit one once there is one', () => {
        fillChat(10);
        const first = makeArc({ id: 'first', title: 'First' });                          // start 4, ~20
        const second = makeArc({ id: 'second', title: 'Second', messageStart: 0, estimatedLength: 12 });

        const plain = makePrompt();
        stampPromptMessages(plain, [first, second]);
        assert.equal(plain[9].content, '[Arc: message 5 of ~20]\nline 8');
        assert.equal(plain[3].content, 'line 2'); // before First started; Second is not the clock

        const lit = makePrompt();
        stampPromptMessages(lit, [first, { ...second, focus: 'spotlight' }]);
        assert.equal(lit[9].content, '[Arc: message 9 of ~12]\nline 8');
        assert.equal(lit[3].content, '[Arc: message 3 of ~12]\nline 2');
    });

    it('stamps nothing when no episode can be the pacing clock', () => {
        fillChat(10);
        const prompt = makePrompt();
        assert.equal(stampPromptMessages(prompt, [makeArc({ focus: 'paused' })]), 0);
        assert.equal(stampPromptMessages(prompt, [makeArc({ tier: 'act' })]), 0);
    });

    it('returns 0 without throwing for a missing or empty prompt', () => {
        fillChat(10);
        assert.equal(stampPromptMessages(undefined, [makeArc()]), 0);
        assert.equal(stampPromptMessages(null, [makeArc()]), 0);
        assert.equal(stampPromptMessages([], [makeArc()]), 0);
    });

    it('skips entries without string content: a tool-call reply and a multimodal user message', () => {
        fillChat(10);
        const prompt = makePrompt();
        // An assistant tool call carries content null; a user message with an
        // attached image carries an array of parts.
        prompt.splice(6, 0, { role: 'assistant', content: null });
        prompt[8] = { role: 'user', content: [{ type: 'text', text: 'line 6' }] };
        const stamped = stampPromptMessages(prompt, [makeArc()]);

        assert.equal(stamped, 2);
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nline 4');
        assert.deepEqual(prompt[8].content, [{ type: 'text', text: 'line 6' }]);
        assert.equal(prompt[10].content, '[Arc: message 5 of ~20]\nline 8');

        // A foreign prompt is scanned to its end for the plan block.
        const foreign = [{ role: 'user', content: 'line 8' }, { role: 'assistant', content: null }];
        assert.equal(stampPromptMessages(foreign, [makeArc()]), 0);
        assert.equal(foreign[0].content, 'line 8');
    });

    it('stamps a user message at prompt index 0 when the plan block comes later', () => {
        fillChat(7); // user messages at 4 and 6
        const prompt = [
            { role: 'user', content: 'line 4' },
            { role: 'assistant', content: 'line 5' },
            { role: 'user', content: 'line 6' },
            { role: 'system', content: `${INJECTION_HEADER}\nplan text` },
        ];
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 2);
        assert.equal(prompt[0].content, '[Arc: message 1 of ~20]\nline 4');
        assert.equal(prompt[2].content, '[Arc: message 3 of ~20]\nline 6');
    });

    it('stamps the message at messageStart when it directly precedes another user message', () => {
        chat.push({ mes: 'line 0', is_user: true }, { mes: 'line 1', is_user: false },
            { mes: 'line 2', is_user: true }, { mes: 'line 3', is_user: false },
            { mes: 'first in the arc', is_user: true }, { mes: 'and another', is_user: true });
        const prompt = [
            { role: 'system', content: `${INJECTION_HEADER}\nplan text` },
            { role: 'user', content: 'first in the arc' },
            { role: 'user', content: 'and another' },
        ];
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 2);
        assert.equal(prompt[1].content, '[Arc: message 1 of ~20]\nfirst in the arc');
        assert.equal(prompt[2].content, '[Arc: message 2 of ~20]\nand another');
    });

    it('gives two user messages with identical text their own numbers', () => {
        fillChat(8);
        chat[4].mes = 'Again.';
        chat[6].mes = 'Again.';
        const prompt = makePrompt();
        prompt[5].content = 'Again.';
        prompt[7].content = 'Again.';
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 2);
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nAgain.');
        assert.equal(prompt[7].content, '[Arc: message 3 of ~20]\nAgain.');
    });

    it('never lets a chat message with empty text take another message\'s stamp', () => {
        // Message 6 has no text (an image-only message) and is not in the prompt.
        fillChat(7);
        chat[6].mes = '';
        const prompt = makePrompt().slice(0, 7);
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 1);
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\nline 4');
    });

    it('tells apart user messages where one text is the tail of the other ("oh yes" / "yes")', () => {
        for (const [older, newer] of [['oh yes', 'yes'], ['yes', 'oh yes']]) {
            fillChat(7);
            chat[4].mes = older;
            chat[6].mes = newer;
            const prompt = makePrompt();
            prompt[5].content = older;
            prompt[7].content = newer;
            assert.equal(stampPromptMessages(prompt, [makeArc()]), 2, `${older} / ${newer}`);
            assert.equal(prompt[5].content, `[Arc: message 1 of ~20]\n${older}`);
            assert.equal(prompt[7].content, `[Arc: message 3 of ~20]\n${newer}`);
        }
    });

    it('does not give a user message the number of a later assistant reply that is its tail', () => {
        fillChat(6);
        chat[4].mes = 'oh yes';
        chat[5].mes = 'yes';
        const prompt = makePrompt();
        prompt[5].content = 'oh yes';
        prompt[6].content = 'yes';
        stampPromptMessages(prompt, [makeArc()]);
        assert.equal(prompt[5].content, '[Arc: message 1 of ~20]\noh yes');
    });

    it('stamps nothing when message text no longer matches the stored chat', () => {
        fillChat(10);
        const prompt = makePrompt();
        // A regex script rewrote every message for the prompt.
        for (const entry of prompt.slice(1)) entry.content = `<<${entry.content}>>`;
        assert.equal(stampPromptMessages(prompt, [makeArc()]), 0);
    });
});
