import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPrompt } from '../../server/engine/promptcheck.js';
import { defaultSpec, deepMerge } from '../../server/engine/shotspec.js';

const refs = { '@mira': { name: 'Mira' }, '@dev': { name: 'Dev' } };
const spec = (over) => deepMerge(defaultSpec(), over);

test('unknown @handles block the request; known ones pass', () => {
  const r = checkPrompt(spec({ intent: { summary: '@mira hands the letter to @ravi' }, subjects: [{ ref: '@mira' }] }), { refsByHandle: refs, prompt: 'x' });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /@ravi is not in Reference Studio/);
  assert.deepEqual(checkPrompt(spec({ intent: { summary: '@mira and @dev' } }), { refsByHandle: refs, prompt: 'x' }).errors, []);
});

test('word budget: warning past ~220 words, error past the model ceiling', () => {
  const long = Array(260).fill('word').join(' ');
  assert.ok(checkPrompt(spec({ intent: { summary: 'x' } }), { prompt: long }).warnings.some((w) => w.includes('260 words')));
  assert.ok(checkPrompt(spec({ intent: { summary: 'x' } }), { prompt: long, caps: { prompt_words_max: 200 } }).errors.some((e) => e.includes('200-word limit')));
});

test('dialogue: off-screen speaker, overlap, quoted line not in the list', () => {
  const r = checkPrompt(spec({ intent: { summary: 'She says "You knew about this?" quietly' }, subjects: [{ ref: '@mira' }],
    dialogue: [{ speaker: '@mira', line: 'Tell me.', start_s: 0, end_s: 2 }, { speaker: '@dev', line: 'I was going to.', start_s: 1.5, end_s: 3 }] }), { refsByHandle: refs, prompt: 'x' });
  assert.ok(r.warnings.some((w) => w.includes('@dev speaks but is not a subject')));
  assert.ok(r.warnings.some((w) => w.startsWith('dialogue overlaps')));
  assert.ok(r.warnings.some((w) => w.includes('"You knew about this?"')));
});

test('contradictions between settings and description', () => {
  const r = checkPrompt(spec({ intent: { summary: 'Full body shot in bright sunlight, camera pushes in' }, framing: { shot_size: 'ECU' },
    lighting: { time_of_day: 'night' }, camera: { movement: 'static' }, negative: ['sunlight'] }), { prompt: 'x' });
  const w = r.warnings.join(' | ');
  assert.match(w, /Night but the description mentions daylight/);
  assert.match(w, /ECU conflicts/);
  assert.match(w, /Locked off but the description describes camera movement/);
  assert.match(w, /"sunlight" is in Avoid/);
  assert.equal(r.errors.length, 0, 'contradictions warn, they do not block');
});

test('clean spec produces no findings', () => {
  const r = checkPrompt(spec({ intent: { summary: '@mira reads the letter by the window at night' }, subjects: [{ ref: '@mira' }], framing: { shot_size: 'CU' },
    lighting: { time_of_day: 'night' }, camera: { movement: 'push_in' } }), { refsByHandle: refs, prompt: 'short prompt' });
  assert.deepEqual([r.errors, r.warnings], [[], []]);
});
