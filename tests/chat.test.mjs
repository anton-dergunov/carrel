import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duration, modelName, stem, usageText, wholeParagraphs } from '../src/carrel/static/chat.js';

test('the model as the status line names it', () => {
  assert.equal(modelName('haiku'), 'Haiku');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-sonnet-5'), 'Sonnet 5');
});

test("a paper's stem, as its PDF and its text share it", () => {
  assert.equal(stem('llm/memory/A Paper. Its Subtitle.pdf'), 'A Paper. Its Subtitle');
  assert.equal(stem('library/llm/memory/A Paper. Its Subtitle.txt'), 'A Paper. Its Subtitle');
  assert.equal(stem('Zep. A Temporal Knowledge Graph'), 'Zep. A Temporal Knowledge Graph');
});

test('on e-ink a streaming answer is drawn a whole paragraph at a time', () => {
  assert.equal(wholeParagraphs('The first line, still being wr'), '');
  assert.equal(wholeParagraphs('One paragraph.\n\nThe next, half'), 'One paragraph.');
  assert.equal(wholeParagraphs('One.\n\nTwo.\n\nThr'), 'One.\n\nTwo.');
});

test('the usage line says what is left, and when it resets', () => {
  const now = 1_000_000;
  const session = { kind: 'session', percent: 37, severity: 'normal', resets_at: now + 2 * 3600 };
  const week = { kind: 'weekly_all', percent: 18.4, severity: 'normal', resets_at: now + 3 * 86400 + 3600 };
  const { parts, warn } = usageText({ available: true, limits: [session, week] }, now);
  assert.match(parts[0], /^5 h 63% left · resets \d{1,2}:\d\d/);
  assert.equal(parts[1], 'week 82% left · resets in 3 d 1 h');
  assert.equal(warn, false);
  // Used up and close; a model's week shown only when close.
  const spent = usageText(
    {
      available: true,
      limits: [
        { kind: 'session', percent: 100, severity: 'exceeded', resets_at: now + 600 },
        { kind: 'weekly_sonnet', percent: 10, severity: 'normal', resets_at: now + 86400 },
        { kind: 'weekly_opus', percent: 91, severity: 'warning', resets_at: now + 5 * 3600 + 1200 },
      ],
    },
    now,
  );
  assert.match(spent.parts[0], /^5 h used up · resets /);
  assert.deepEqual(spent.parts.slice(1), ['week opus 9% left · resets in 5 h 20 min']);
  assert.equal(spent.warn, true);
  // A window whose reset has passed is whole again, until it is read anew.
  assert.deepEqual(usageText({ available: true, limits: [{ ...session, percent: 90, resets_at: now - 1 }] }, now).parts, ['5 h 100% left']);
  // An API key: nothing.
  assert.deepEqual(usageText({ available: false }, now), { parts: [], warn: false });
  assert.deepEqual(usageText(null, now).parts, []);
});

test('durations', () => {
  assert.equal(duration(3 * 86400), '3 d');
  assert.equal(duration(2 * 3600), '2 h');
  assert.equal(duration(12 * 60 + 10), '12 min');
  assert.equal(duration(5), '1 min');
});
