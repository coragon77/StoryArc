import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillTemplate, loadTemplate } from '../lib/planning/generator.js';

describe('loadTemplate', () => {
    it('refuses the unbuilt detail-pass prompt like any unknown name', async () => {
        await assert.rejects(loadTemplate('detail-pass.txt'), /Invalid template: detail-pass\.txt/);
    });
});

describe('fillTemplate', () => {
    it('replaces single placeholder', () => {
        assert.equal(fillTemplate('Hello {{NAME}}', { NAME: 'World' }), 'Hello World');
    });

    it('replaces multiple placeholders', () => {
        const result = fillTemplate('{{A}} and {{B}}', { A: 'X', B: 'Y' });
        assert.equal(result, 'X and Y');
    });

    it('replaces repeated placeholders', () => {
        const result = fillTemplate('{{X}} is {{X}}', { X: 'same' });
        assert.equal(result, 'same is same');
    });

    it('leaves unmatched placeholders intact', () => {
        assert.equal(fillTemplate('Hello {{NAME}}', {}), 'Hello {{NAME}}');
    });

    it('only replaces placeholders present in variables', () => {
        assert.equal(fillTemplate('{{A}} and {{B}}', { A: 'X' }), 'X and {{B}}');
    });
});

describe('every fulfillment is one on-screen moment', () => {
    const read = name => readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');

    it('the outline prompt states the rule with a tally and a chain as counter-examples', () => {
        const text = read('generate-arc.txt');
        assert.ok(text.includes('It is ONE on-screen moment at which the development shows, and that moment may come in many different forms. Never a tally of many scenes ("The party has completed its first patrols of the border") and never a chain of separate events joined by "and"'));
        assert.ok(text.includes('This holds for scene beats and milestones alike.'));
        assert.ok(text.includes('Name ONE on-screen moment at which the development shows; it may take many forms.'));
        assert.ok(text.includes('an `intention` (a past-tense fulfillment condition: one on-screen moment, not a tally of scenes or a chain of events)'));
        assert.equal(text.includes('flexible about exact events'), false);
    });

    it('the detail pass keeps a sharpened intention one moment', () => {
        assert.ok(read('detail-pass.txt').includes('sharpening it never turns it into a tally of many scenes or a chain of separate events joined by "and".'));
    });

    it('the plan check gets the open fulfillments and may rewrite them by beat id', () => {
        const text = read('check-plan.txt');
        assert.ok(text.includes('== FULFILLMENTS ==\n{{FULFILLMENTS}}\n'));
        assert.ok(text.includes('3. FULFILLMENTS. Find every fulfillment that is a tally of many scenes or a chain of separate events, and rewrite it as the ONE on-screen moment at which the development shows'));
        assert.ok(text.includes('"kind": "trigger | pressure | fulfillment"'));
    });
});
