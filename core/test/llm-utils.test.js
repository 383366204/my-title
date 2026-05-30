const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { z } = require('zod');
const { parseJsonFromLLM, validateLLMJson } = require('../llm-utils');

describe('parseJsonFromLLM', () => {
  it('parses plain JSON', () => {
    assert.deepEqual(parseJsonFromLLM('{"titles":["A"]}'), { titles: ['A'] });
  });

  it('parses fenced JSON', () => {
    const content = '```json\n{"titles":["A"],}\n```';

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A'] });
  });

  it('strips MiniMax reasoning blocks before parsing JSON', () => {
    const content = '<think>I should return a JSON object.</think>\n{"titles":["A"]}';

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A'] });
  });

  it('extracts JSON after unfinished reasoning text', () => {
    const content = '<think>reasoning without close tag\n{"titles":["A","B"]}';

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A', 'B'] });
  });

  it('extracts the first balanced JSON candidate from prose', () => {
    const content = 'Here is the answer: {"selectedProducts":[],"titles":[{"title":"A"}]} done.';

    assert.deepEqual(parseJsonFromLLM(content), {
      selectedProducts: [],
      titles: [{ title: 'A' }]
    });
  });

  it('keeps braces inside strings while extracting JSON', () => {
    const content = 'Result: {"title":"A {nice} title","items":[{"id":"p1"}]} trailing.';

    assert.deepEqual(parseJsonFromLLM(content), {
      title: 'A {nice} title',
      items: [{ id: 'p1' }]
    });
  });

  it('skips invalid brace pairs before the real JSON', () => {
    const content = 'Reasoning note {not json}. Final: {"titles":["A"]}';

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A'] });
  });

  it('parses JSON that starts immediately but has trailing prose', () => {
    const content = '{"titles":["A"]}\nDone.';

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A'] });
  });

  it('repairs common non-standard JSON', () => {
    const content = "{titles:['A','B'], count:2,}";

    assert.deepEqual(parseJsonFromLLM(content), { titles: ['A', 'B'], count: 2 });
  });
});

describe('validateLLMJson', () => {
  it('returns parsed data when schema matches', () => {
    const schema = z.object({ titles: z.array(z.string()) });

    assert.deepEqual(validateLLMJson({ titles: ['A'] }, schema, 'title response'), { titles: ['A'] });
  });

  it('throws a readable error when schema does not match', () => {
    const schema = z.object({ titles: z.array(z.string()) });

    assert.throws(
      () => validateLLMJson({ titles: 'A' }, schema, 'title response'),
      /Invalid title response: titles/
    );
  });
});
