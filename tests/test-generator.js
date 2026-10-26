import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isRetryableError, generateArc } from '../lib/planning/generator.js';

describe('isRetryableError', () => {
    it('retries bad gateway responses', () => {
        assert.equal(isRetryableError('Got response status 502: Bad Gateway'), true);
    });

    it('retries timeouts', () => {
        assert.equal(isRetryableError('request failed ETIMEDOUT'), true);
    });

    it('retries empty responses (reasoning-only output)', () => {
        assert.equal(isRetryableError('Empty response from API '), true);
    });

    it('does not retry auth failures', () => {
        assert.equal(isRetryableError('Got response status 401: Unauthorized'), false);
    });

    it('does not retry unknown model errors', () => {
        assert.equal(isRetryableError('Got response status 400: model not found'), false);
    });

    it('does not retry an empty detail string', () => {
        assert.equal(isRetryableError(''), false);
    });
});

// ─── Direct backend stream (no Connection Manager profile) ──────────────────
//
// The fallback path pipes the response body through SillyTavern's own
// EventSourceStream. That class cannot come from the shared mock, so this file
// registers one more loader hook: '/scripts/sse-stream.js' resolves to the real
// file of the local SillyTavern checkout (its two helper imports stubbed), and
// '/scripts/openai.js' to a stub carrying the chat API settings.

const SILLYTAVERN_SCRIPTS_DIR = process.env.SILLYTAVERN_SCRIPTS_DIR
    || '/opt/LLMS/silly_tavern/SillyTavern-Launcher/SillyTavern/public/scripts';
const sseStreamPath = `${SILLYTAVERN_SCRIPTS_DIR}/sse-stream.js`;
const sillyTavernAvailable = existsSync(sseStreamPath);

function moduleFromSource(source) {
    return `data:text/javascript,${encodeURIComponent(source)}`;
}

if (sillyTavernAvailable) {
    const openaiStub = moduleFromSource(`
        export const oai_settings = { temp_openai: 0.7, openai_max_tokens: 4096, chat_completion_source: 'openai' };
        export function getChatCompletionModel() { return 'test-model'; }
        // ST's per-source parser, reduced to the two shapes the tests send:
        // Google's candidates/parts and OpenAI's choices/delta.
        export function getStreamingReply(data, state, { chatCompletionSource = null } = {}) {
            if (chatCompletionSource === 'makersuite') {
                return data?.candidates?.[0]?.content?.parts?.filter(part => !part.thought)?.map(part => part.text)?.[0] || '';
            }
            return data?.choices?.[0]?.delta?.content || '';
        }
    `);
    const powerUserStub = moduleFromSource('export const power_user = {};');
    const utilsStub = moduleFromSource('export async function delay() {}');
    const sseStreamUrl = pathToFileURL(sseStreamPath).href;
    register(moduleFromSource(`
        export function resolve(specifier, context, nextResolve) {
            if (specifier === '/scripts/sse-stream.js') return { url: ${JSON.stringify(sseStreamUrl)}, shortCircuit: true };
            if (specifier === '/scripts/openai.js') return { url: ${JSON.stringify(openaiStub)}, shortCircuit: true };
            if (context.parentURL === ${JSON.stringify(sseStreamUrl)}) {
                if (specifier === './power-user.js') return { url: ${JSON.stringify(powerUserStub)}, shortCircuit: true };
                if (specifier === './utils.js') return { url: ${JSON.stringify(utilsStub)}, shortCircuit: true };
            }
            return nextResolve(specifier, context);
        }
    `));
}

const harvestedContext = {
    character: null,
    persona: { name: '', description: '' },
    lorebook: { constants: [], arcSummaries: [], recent: [] },
    chatHistory: [],
    existingArcs: [],
};

/** A fetch body that delivers the given strings as separate network chunks. */
function streamOfChunks(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

/**
 * Replace fetch: the outline template only echoes the analysis, and each
 * backend call answers with the next queued list of chunks. Returns the
 * request bodies the backend received.
 */
function installFetch(backendReplies) {
    const backendRequests = [];
    globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('analyze-context.txt')) return new Response('ANALYZE');
        if (String(url).endsWith('generate-arc.txt')) return new Response('OUTLINE FROM: {{PHASE1_ANALYSIS}}');
        backendRequests.push(JSON.parse(init.body));
        return new Response(streamOfChunks(backendReplies.shift()));
    };
    return backendRequests;
}

describe('generateArc over the direct backend stream', { skip: !sillyTavernAvailable && `no SillyTavern checkout at ${SILLYTAVERN_SCRIPTS_DIR}` }, () => {
    it('keeps a data line that arrives split across two network chunks', async () => {
        const backendRequests = installFetch([
            [
                'data: {"choices":[{"delta":{"content":"The story stands"}}]}\n\ndata: {"choices":[{"delta":{"con',
                'tent":" at a crossroads."}}]}\n\ndata: [DONE]\n\n',
            ],
            ['data: {"choices":[{"delta":{"content":"not json"}}]}\n\n'],
            ['data: {"choices":[{"delta":{"content":"still not json"}}]}\n\n'],
        ]);

        await generateArc(harvestedContext, '');

        assert.equal(backendRequests[1].messages[0].content, 'OUTLINE FROM: The story stands at a crossroads.');
    });

    it('reads a Google (makersuite) stream through ST\'s per-source parser, skipping thoughts', async () => {
        const { oai_settings } = await import('/scripts/openai.js');
        oai_settings.chat_completion_source = 'makersuite';
        try {
            const backendRequests = installFetch([
                [
                    'data: {"candidates":[{"content":{"parts":[{"text":"weighing it","thought":true}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":"The story stands"}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":" at a crossroads."}]}}]}\n\n',
                ],
                ['data: {"candidates":[{"content":{"parts":[{"text":"not json"}]}}]}\n\n'],
                ['data: {"candidates":[{"content":{"parts":[{"text":"still not json"}]}}]}\n\n'],
            ]);

            await generateArc(harvestedContext, '');

            assert.equal(backendRequests[0].chat_completion_source, 'makersuite');
            assert.equal(backendRequests[1].messages[0].content, 'OUTLINE FROM: The story stands at a crossroads.');
        } finally {
            oai_settings.chat_completion_source = 'openai';
        }
    });

    it('fails with the API error an event carries', async () => {
        installFetch([
            ['data: {"error":{"message":"quota exceeded"}}\n\n'],
        ]);

        const result = await generateArc(harvestedContext, '');

        assert.deepEqual(result, { arc: null, error: 'API error: quota exceeded' });
    });

    it('fails on a complete event that is not JSON instead of skipping it', async () => {
        installFetch([
            ['data: {"choices":[{"delta":{"content":"The story"}}]}\n\ndata: {"choices":[{"delta\n\n'],
        ]);

        const result = await generateArc(harvestedContext, '');

        assert.equal(result.arc, null);
        assert.match(result.error, /JSON/);
    });
});
