import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaIssueId } from '../src/agents/media-identity.js';

const input: Parameters<typeof mediaIssueId>[0] = {
  pageUrl: 'https://example.test/products', pageText: 'AsterBox protects stored files.', targetLocale: 'fr-FR',
  glossary: { do_not_translate: ['AsterBox'], preferred_terms: { storage: 'stockage', file: 'fichier' } },
  check: 'image_text', resource: { status: 200, contentType: 'image/png', digest: 'image-content-version-one' },
  asset: { src: 'https://example.test/asset.png', selector: '(//img)[1]', elementType: 'image',
    alt: 'AsterBox', captionText: null, context: 'Product image', decorative: false },
};

test('media identity is deterministic and independent of profile object key order', () => {
  assert.equal(mediaIssueId(input), mediaIssueId(JSON.parse(JSON.stringify(input))));
  assert.equal(mediaIssueId(input), mediaIssueId({ ...input,
    glossary: { preferred_terms: { file: 'fichier', storage: 'stockage' }, do_not_translate: ['AsterBox'] } }));
});

test('media identity separates pages, elements, asset versions, check types and policy/context changes', () => {
  const changes: Parameters<typeof mediaIssueId>[0][] = [
    { ...input, pageUrl: 'https://example.test/about' },
    { ...input, asset: { ...input.asset, selector: '(//img)[2]' } },
    { ...input, asset: { ...input.asset, src: 'https://example.test/mobile.png' } },
    { ...input, resource: { ...input.resource!, digest: 'replaced-image-at-the-same-url' } },
    { ...input, check: 'image_content' },
    { ...input, targetLocale: 'ja-JP' },
    { ...input, glossary: { do_not_translate: ['DifferentProduct'] } },
    { ...input, pageText: 'Changed factual claim.' },
    { ...input, asset: { ...input.asset, alt: 'Different product description' } },
  ];
  const ids = [input, ...changes].map(mediaIssueId);
  assert.equal(new Set(ids).size, ids.length);
});

test('metadata and caption identities track inspected facts, not unrelated image versions', () => {
  const alt = { ...input, check: 'alt_language' as const };
  assert.equal(mediaIssueId(alt), mediaIssueId({ ...alt, resource: undefined,
    asset: { ...alt.asset, src: 'https://example.test/mobile.png' } }));
  const caption = { ...input, check: 'caption_language' as const,
    asset: { ...input.asset, elementType: 'video', captionText: 'Welcome to AsterBox', srclang: 'fr' } };
  assert.notEqual(mediaIssueId(caption), mediaIssueId({ ...caption, asset: { ...caption.asset, srclang: 'ja' } }));
  assert.notEqual(mediaIssueId(caption), mediaIssueId({ ...caption, asset: { ...caption.asset, captionText: 'Changed cue' } }));
  const metadata = { ...input, check: 'caption_metadata' as const, facts: [{ srclang: 'en' }] };
  assert.notEqual(mediaIssueId(metadata), mediaIssueId({ ...metadata, facts: [{ srclang: 'de' }] }));
  const missingAlt = { ...input, check: 'missing_alt' as const, asset: { ...input.asset, alt: null } };
  assert.equal(mediaIssueId(missingAlt), mediaIssueId({ ...missingAlt, resource: undefined, pageText: 'Unrelated text update' }));
});
