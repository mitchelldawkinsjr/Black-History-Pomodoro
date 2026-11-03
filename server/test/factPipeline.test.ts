import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFactPipeline } from '../src/services/factPipeline.js';
import { GENERIC_ASSET, ImageMatcher } from '../src/services/imageMatcher.js';
import { StubCommons, commonsImage } from './helpers.js';

test('pipeline attaches a verified portrait when Commons matches the subject', async () => {
  const matcher = new ImageMatcher(new StubCommons([commonsImage()]), 8);
  const result = await runFactPipeline(
    { Results: [{ _id: 'f1', text: 'Test Person founded a school in Alabama.', people: ['Test Person'] }] },
    matcher,
  );
  assert.equal(result.hadFacts, true);
  assert.equal(result.illustrated?.image.visual.depictsSubject, true);
  assert.equal(result.illustrated?.image.subject, 'Test Person');
  assert.ok(result.illustrated?.image.sourceUrl.startsWith('https://upload.wikimedia.org/'));
});

test('pipeline still returns an image when no subject can be verified', async () => {
  const matcher = new ImageMatcher(new StubCommons([commonsImage()]), 8);
  const result = await runFactPipeline(
    {
      Results: [
        { text: '   ' },
        { _id: 'f2', text: 'In 1961 a new institute for the arts was founded.' },
      ],
    },
    matcher,
  );
  assert.equal(result.hadFacts, true);
  assert.equal(result.illustrated?.fact.providerFactId, 'f2');
  assert.equal(result.illustrated?.image.visual.depictsSubject, false);
  assert.equal(result.illustrated?.image.visual.depictionType, 'generic');
  assert.equal(result.illustrated?.image.sourceUrl, GENERIC_ASSET);
});

test('pipeline prefers a later fact that has a portrait over an earlier generic one', async () => {
  const matcher = new ImageMatcher(new StubCommons([commonsImage()]), 8);
  const result = await runFactPipeline(
    {
      Results: [
        { _id: 'plain', text: 'In 1961 a new institute for the arts was founded.' },
        { _id: 'portrait', text: 'Test Person founded a school in Alabama.', people: ['Test Person'] },
      ],
    },
    matcher,
  );
  assert.equal(result.illustrated?.fact.providerFactId, 'portrait');
  assert.equal(result.illustrated?.image.visual.depictsSubject, true);
});

test('pipeline reports empty payloads and skipped facts without an image', async () => {
  const matcher = new ImageMatcher(new StubCommons([]), 8);
  const empty = await runFactPipeline({ Results: [{ text: '' }] }, matcher);
  assert.equal(empty.hadFacts, false);
  assert.equal(empty.illustrated, null);

  const skipped = await runFactPipeline(
    { Results: [{ _id: 'keep-out', text: 'Test Person founded a school in Alabama.', people: ['Test Person'] }] },
    matcher,
    (fact) => fact.providerFactId === 'keep-out',
  );
  assert.equal(skipped.hadFacts, true);
  assert.equal(skipped.illustrated, null);
});
