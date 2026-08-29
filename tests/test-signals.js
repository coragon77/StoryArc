import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignals, processSignalResults } from '../lib/injection/signals.js';

describe('parseSignals', () => {
    it('parses a single signal', () => {
        const signals = parseSignals('Story text here.\n[ARC_SIGNAL:abc123:beat_1:COMPLETE]');
        assert.equal(signals.length, 1);
        assert.equal(signals[0].arcId, 'abc123');
        assert.equal(signals[0].beatId, 'beat_1');
    });

    it('parses multiple signals', () => {
        const text = 'Text\n[ARC_SIGNAL:arc1:beat_1:COMPLETE]\n[ARC_SIGNAL:arc2:beat_2:COMPLETE]';
        const signals = parseSignals(text);
        assert.equal(signals.length, 2);
    });

    it('returns empty array for no signals', () => {
        assert.deepEqual(parseSignals('Just regular story text'), []);
    });

    it('returns empty array for null/empty input', () => {
        assert.deepEqual(parseSignals(null), []);
        assert.deepEqual(parseSignals(''), []);
    });

    it('handles signals with underscores and hyphens in IDs', () => {
        const signals = parseSignals('[ARC_SIGNAL:arc-1:valdris_dinner:COMPLETE]');
        assert.equal(signals[0].arcId, 'arc-1');
        assert.equal(signals[0].beatId, 'valdris_dinner');
    });
});

describe('processSignalResults', () => {
    function makeArc() {
        return {
            id: 'arc12345-full-id',
            title: 'Test Arc',
            status: 'active',
            beats: [
                { id: 'b1', intention: 'first', status: 'active', unlockAfter: [], optional: false },
                { id: 'b2', intention: 'second', status: 'pending', unlockAfter: [], optional: false },
                { id: 'b3', intention: 'third', status: 'locked', unlockAfter: ['b2'], optional: false },
            ],
        };
    }

    it('completes the active beat and promotes the next pending beat', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[0].status, 'completed');
        assert.equal(arc.beats[1].status, 'active');
    });

    it('accepts a signal for a pending beat without touching the active one', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b2', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[1].status, 'completed');
        assert.equal(arc.beats[0].status, 'active');
        assert.equal(arc.beats[2].status, 'pending');
    });

    it('ignores signals for locked beats', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b3', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[2].status, 'locked');
        assert.equal(arc.beats[0].status, 'active');
    });
});
