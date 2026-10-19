import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestConfiguration, siteUrl } from '../src/test-configuration.js';
import { RunStore } from '../src/run-store.js';
import { loadReference } from '../src/agents/reference-content.js';
import { createAudit } from '../src/orchestrator/audit.js';
import { compareRuns } from '../src/history.js';

test('site URLs accept reachable web schemes without credentials', () => {
  assert.equal(siteUrl('http://localhost:8081/#section'), 'http://localhost:8081/');
  for (const value of [null, [], 'example.test', 'file:///tmp/site', 'javascript:alert(1)', 'https://user:password@example.test/']) {
    assert.throws(() => siteUrl(value), /HTTP or HTTPS/);
  }
});

test('configuration catalogs server YAML and persists selected uploads with isolated references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qa-config-'));
  const keys = ['SITE_URL', 'LINGUISTIC_ASSET_PATH', 'REFERENCE_CONTENT_PATH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let store = new RunStore(join(directory, 'history.sqlite'));
  try {
    const assets = join(directory, 'assets'); await mkdir(assets);
    await writeFile(join(assets, 'default.yaml'), 'locale:\n  target_locale: en-GB\n');
    await writeFile(join(assets, 'alternate.yml'), 'locale:\n  target_locale: de-DE\n');
    Object.assign(process.env, { SITE_URL: 'http://localhost:8080/', LINGUISTIC_ASSET_PATH: join(assets, 'default.yaml'), REFERENCE_CONTENT_PATH: join(directory, 'default-references') });
    let config = new TestConfiguration(store, directory);
    const catalog = await config.catalog();
    assert.equal(catalog.profiles.length, 2); assert(catalog.profiles.some(item => item.locale === 'de-DE'));
    const oldRevision = config.revision;
    const siteId = config.addSite({ revision: oldRevision, name: 'Other site', url: 'https://other.test/' });
    await assert.rejects(config.select({ revision: oldRevision, siteId, profileId: 'environment' }), /changed/);
    const yaml = 'locale:\n  target_locale: fr-FR\nreference_content:\n  - page: /\n    source_text_path: reference-content/nested/home.md\n';
    const profileId = await config.uploadProfile({ revision: config.revision, name: 'French', yaml, references: [{ path: 'nested/home.md', content: 'Correct source for the uploaded profile.' }] });
    await config.select({ revision: config.revision, siteId, profileId });
    const resolved = await config.resolveSelection();
    assert.equal(resolved.site.url, 'https://other.test/');
    assert.equal(resolved.profile!.locale.target_locale, 'fr-FR');
    assert.equal((await loadReference('https://other.test/', 'https://other.test/', resolved.profile!, resolved.referenceContentPath))!.text, 'Correct source for the uploaded profile.');
    const fingerprint = resolved.configuration.profileFingerprint;
    store.close(); store = new RunStore(join(directory, 'history.sqlite')); config = new TestConfiguration(store, directory);
    assert.deepEqual((await config.catalog()).selected, { siteId, profileId });
    assert.equal((await config.resolveSelection()).configuration.profileFingerprint, fingerprint);
    const anotherId = await config.uploadProfile({ revision: config.revision, name: 'Changed source', yaml, references: [{ path: 'nested/home.md', content: 'Different reference policy.' }] });
    const another = await config.resolveSelection({ siteId, profileId: anotherId });
    assert.notEqual(another.configuration.profileFingerprint, fingerprint);
    assert.equal(process.env.LINGUISTIC_ASSET_PATH, join(assets, 'default.yaml'), 'switching never modifies process-wide inputs');
    const before = (await config.catalog()).profiles.length;
    for (const references of [[{ path: '../outside.md', content: 'escape' }], [{ path: '/outside.md', content: 'escape' }],
      [{ path: 'a.md', content: 'a' }, { path: 'a.md', content: 'b' }], [], [{ path: 'nested/home.md', content: 'x'.repeat(24001) }]]) {
      await assert.rejects(config.uploadProfile({ revision: config.revision, yaml, references }));
    }
    await assert.rejects(config.uploadProfile({ revision: config.revision, yaml: 'locale: {}' }), /Invalid linguistic profile/);
    assert.equal((await config.catalog()).profiles.length, before);
    assert.equal((await readdir(join(directory, 'profiles'))).length, 2, 'failed uploads leave no partial asset directories');
  } finally {
    store.close(); for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test('review carry-forward and automatic comparisons are isolated by profile fingerprint', () => {
  const store = new RunStore(':memory:');
  try {
    const first = { ...createAudit(), status: 'completed' as const, siteUrl: 'https://example.test/',
      configuration: { siteId: 'site', siteName: 'Site', profileId: 'a', profileName: 'A', profileFingerprint: 'fingerprint-a' },
      issues: [{ id: 'same', category: 'links' as const, severity: 'major' as const, status: 'new' as const, confidence: 1,
        location: { page_url: 'https://example.test/', element_type: 'link' as const }, description: 'Broken link', evidence: '404' }] };
    store.save(first, true); store.review(first.id, 'same', 'verified');
    const second = { ...first, id: 'second', configuration: { ...first.configuration, profileId: 'b', profileFingerprint: 'fingerprint-b' } };
    store.save(second, true);
    assert.equal(store.reviewIssues(first.siteUrl, 'fingerprint-a')[0].status, 'verified');
    assert.deepEqual(store.reviewIssues(first.siteUrl, 'fingerprint-b'), []);
    assert.deepEqual(store.reviewIssues(first.siteUrl), []);
    assert.equal(store.previous(second), null);
    assert.throws(() => compareRuns(second, first), /same linguistic profile/);
    const sameProfile = { ...first, id: 'third' }; store.save(sameProfile);
    assert.equal(store.previous(sameProfile)!.id, first.id);
    store.clearCurrent(first.siteUrl, 'fingerprint-b');
    assert.equal(store.reviewIssues(first.siteUrl, 'fingerprint-a').length, 1);
  } finally { store.close(); }
});
