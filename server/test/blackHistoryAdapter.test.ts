import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractFactCandidates,
  normalizeFactRecord,
  UPSTREAM_PROVIDER_LABEL,
} from '../src/providers/blackHistoryAdapter.js';

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
  const [fact] = facts;
  assert.equal(fact?.providerFactId, 'abc123');
  assert.equal(fact?.factText, 'A verified historical sentence.');
  assert.deepEqual(fact?.people, ['Example Person']);
  assert.deepEqual(fact?.tags, ['History']);
  assert.deepEqual(fact?.source, { label: 'Archive Label', url: null, providerUrl: null });
  assert.equal(fact?.sourceMissing, false);
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
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.eventDate, '1963');
  assert.equal(facts[0]?.source.label, 'Library');
  assert.equal(facts[0]?.source.url, 'https://example.org/source');
});

test('supports source_references as plain strings and {title,url} objects', () => {
  const a = normalizeFactRecord({ text: 'Fact A.', source_references: ['Smithsonian NMAAHC'] });
  assert.equal(a?.source.label, 'Smithsonian NMAAHC');
  const b = normalizeFactRecord({ text: 'Fact B.', source_references: [{ title: 'NPS', url: 'https://www.nps.gov/x' }] });
  assert.deepEqual(b?.source, { label: 'NPS', url: 'https://www.nps.gov/x', providerUrl: null });
  const c = normalizeFactRecord({ text: 'Fact C.', source: { name: 'Library of Congress', url: 'javascript:alert(1)' } });
  assert.equal(c?.source.url, null, 'non-http(s) URLs are dropped');
});

test('rejects empty or whitespace-only text and non-object items', () => {
  assert.equal(normalizeFactRecord({ _id: 'x', text: '   ' }), null);
  assert.equal(normalizeFactRecord({ _id: 'x' }), null);
  assert.equal(normalizeFactRecord('text'), null);
  assert.equal(normalizeFactRecord(null), null);
  assert.deepEqual(extractFactCandidates({ Results: [{ text: '' }, { text: '  ' }, 42] }), []);
});

test('handles missing people, tags and source without inventing values', () => {
  const fact = normalizeFactRecord({ _id: 'y', text: 'Only text present.' });
  assert.ok(fact);
  assert.deepEqual(fact.people, []);
  assert.deepEqual(fact.tags, []);
  assert.equal(fact.eventDate, null);
  assert.equal(fact.sourceMissing, true);
  assert.equal(fact.source.label, UPSTREAM_PROVIDER_LABEL);
  assert.equal(fact.source.url, null);
});

test('accepts people/tags as objects or a single string and dedupes', () => {
  const fact = normalizeFactRecord({
    text: 'Fact.',
    people: [{ name: 'Ada Lovelace' }, 'ada lovelace', '', null],
    tags: 'Science',
  });
  assert.deepEqual(fact?.people, ['Ada Lovelace']);
  assert.deepEqual(fact?.tags, ['Science']);
});

test('strips HTML and collapses whitespace in text', () => {
  const fact = normalizeFactRecord({ text: '  <p>Hello\n  <b>world</b></p> ' });
  assert.equal(fact?.factText, 'Hello world');
});

test('derives a stable id from text when upstream has none, and dedupes repeated ids', () => {
  const a = normalizeFactRecord({ text: 'Same text.' });
  const b = normalizeFactRecord({ text: 'Same text.' });
  assert.equal(a?.providerFactId, b?.providerFactId);
  assert.match(a?.providerFactId ?? '', /^h[a-f0-9]{24}$/);
  assert.equal(extractFactCandidates({ data: [{ text: 'Same text.' }, { text: 'Same text.' }] }).length, 1);
});

test('sanitizes unsafe upstream ids', () => {
  const fact = normalizeFactRecord({ _id: '../../etc/passwd', text: 'Fact.' });
  assert.match(fact?.providerFactId ?? '', /^[A-Za-z0-9._-]+$/);
  assert.ok(!fact?.providerFactId.includes('/'));
});

test('handles single-object, nested and malformed payloads', () => {
  assert.equal(extractFactCandidates({ data: { text: 'Single.' } }).length, 1);
  assert.equal(extractFactCandidates({ text: 'Bare.' }).length, 1);
  assert.equal(extractFactCandidates({ data: { results: [{ text: 'Nested.' }] } }).length, 1);
  assert.deepEqual(extractFactCandidates(null), []);
  assert.deepEqual(extractFactCandidates('nope'), []);
  assert.deepEqual(extractFactCandidates({ unrelated: true }), []);
});
