import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFactCandidates, normalizeFactRecord } from '../src/providers/blackHistoryAdapter.js';

test('normalizes older Results shape', () => {
  const facts = extractFactCandidates({
    Results: [
      {
        _id: 'abc123',
        text: 'A verified historical sentence.',
        people: ['Example Person'],
        tags: ['History'],
        source: 'Archive Label',
      },
    ],
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.providerFactId, 'abc123');
  assert.equal(facts[0]!.factText, 'A verified historical sentence.');
});

test('normalizes newer data shape with source_references', () => {
  const facts = extractFactCandidates({
    data: [
      {
        id: 'new-1',
        text: 'Another verified sentence.',
        date_of_event: '1963',
        source_references: [{ source: 'Library', source_url: 'https://example.org/source' }],
      },
    ],
  });
  assert.equal(facts[0]!.eventDate, '1963');
  assert.equal(facts[0]!.source.url, 'https://example.org/source');
});

test('rejects empty text', () => {
  assert.equal(normalizeFactRecord({ _id: 'x', text: '   ' }), null);
});

test('handles missing people and tags', () => {
  const fact = normalizeFactRecord({ _id: 'y', text: 'Only text present.' });
  assert.ok(fact);
  assert.deepEqual(fact.people, []);
  assert.deepEqual(fact.tags, []);
});
