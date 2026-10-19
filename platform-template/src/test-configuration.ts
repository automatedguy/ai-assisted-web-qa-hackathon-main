import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { defaultProfilePath, loadProfile, parseProfile, type Profile } from './config.js';
import { loadReference, referenceRoot } from './agents/reference-content.js';
import type { RunStore } from './run-store.js';

type Site = { id: string; name: string; url: string };
type Asset = { id: string; name: string; path: string; referencePath: string };
type Selection = { siteId: string; profileId: string };
type Settings = { revision: string; sites: Site[]; profiles: Asset[]; selected: Selection };
export class ConfigurationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function name(value: unknown, fallback: string) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new ConfigurationError('Use a name between 1 and 120 characters.');
  return value.trim();
}
export function siteUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new ConfigurationError('Enter an HTTP or HTTPS website URL.');
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = ''; return url.href;
  } catch { throw new ConfigurationError('Enter an HTTP or HTTPS website URL without embedded credentials.'); }
}
export class TestConfiguration {
  private state: Settings;
  private readonly environmentSite: Site;
  constructor(private store: RunStore, private dataDirectory: string) {
    this.environmentSite = { id: 'environment', name: 'Configured site', url: siteUrl(process.env.SITE_URL ?? 'http://localhost:8080') };
    this.state = (store.configuration() as Settings | null) ?? { revision: 'initial', sites: [], profiles: [], selected: { siteId: 'environment', profileId: 'environment' } };
  }
  get revision() { return hash(this.state.revision + this.environmentSite.url + defaultProfilePath() + (process.env.REFERENCE_CONTENT_PATH ?? '')); }
  checkRevision(value: unknown, required = true) {
    if ((!required && value === undefined) || value === this.revision) return;
    throw new ConfigurationError('The test configuration changed. Reload the configuration and try again.', 409);
  }
  get selectedSite() { return [this.environmentSite, ...this.state.sites].find(site => site.id === this.state.selected.siteId); }
  private save(state: Settings, clearWorkspace = false) {
    state.revision = randomUUID(); this.store.saveConfiguration(state, clearWorkspace); this.state = state;
  }
  private async assets(): Promise<Asset[]> {
    const path = resolve(defaultProfilePath()), referencePath = await referenceRoot();
    const configured = { id: 'environment', name: basename(path), path, referencePath };
    const found: Asset[] = [];
    try {
      const root = await realpath(dirname(path));
      const configuredPath = await realpath(path).catch(() => path);
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
        const file = join(root, entry.name);
        if (file === path || file === configuredPath) continue;
        found.push({ id: 'file-' + hash(file).slice(0, 20), name: entry.name, path: file, referencePath });
      }
    } catch { /* The configured item remains visible with its validation error. */ }
    return [configured, ...found.sort((a,b) => a.name.localeCompare(b.name)), ...this.state.profiles];
  }
  async catalog() {
    const profiles = [];
    for (const asset of await this.assets()) {
      let profile: Profile | undefined, error: string | undefined;
      try { profile = await loadProfile(asset.path); } catch (cause) { error = (cause as Error).message; }
      profiles.push({ id: asset.id, name: asset.name, locale: profile?.locale.target_locale,
        referenceCount: profile?.reference_content?.length ?? 0, available: Boolean(profile), error,
        source: asset.id.startsWith('upload-') ? 'Uploaded' : 'Server asset' });
    }
    return { revision: this.revision, sites: [this.environmentSite, ...this.state.sites], profiles, selected: this.state.selected };
  }
  async resolveSelection(selection: Selection = this.state.selected, requireProfile = true) {
    const site = [this.environmentSite, ...this.state.sites].find(item => item.id === selection.siteId);
    const asset = (await this.assets()).find(item => item.id === selection.profileId);
    if (!site || !asset) throw new ConfigurationError('Choose an available site and linguistic asset.');
    let profile: Profile | undefined, fingerprint: string | undefined;
    if (requireProfile) {
      try {
        profile = await loadProfile(asset.path);
        if ((profile.reference_content?.length ?? 0) > 100) throw new Error('A profile supports at most 100 reference mappings.');
        const references = [];
        for (const entry of profile.reference_content ?? []) {
          references.push(await loadReference(new URL(entry.page, site.url).href, site.url, profile, asset.referencePath));
        }
        fingerprint = hash(JSON.stringify({ profile, references }));
      } catch (cause) { throw new ConfigurationError((cause as Error).message); }
    }
    return { site, profile, referenceContentPath: asset.referencePath,
      configuration: { siteId: site.id, siteName: site.name, profileId: asset.id, profileName: asset.name, profileFingerprint: fingerprint } };
  }
  async select(body: Record<string, unknown>) {
    this.checkRevision(body.revision);
    if (typeof body.siteId !== 'string' || typeof body.profileId !== 'string') throw new ConfigurationError('Choose a site and linguistic asset.');
    const selected = { siteId: body.siteId, profileId: body.profileId };
    await this.resolveSelection(selected);
    this.save({ ...this.state, selected }, true);
  }
  addSite(body: Record<string, unknown>) {
    this.checkRevision(body.revision);
    const url = siteUrl(body.url);
    if ([this.environmentSite, ...this.state.sites].some(site => site.url === url)) throw new ConfigurationError('This website is already in the selector.');
    if (this.state.sites.length >= 100) throw new ConfigurationError('The site list is limited to 100 saved websites.');
    const site = { id: randomUUID(), name: name(body.name, new URL(url).host), url };
    this.save({ ...this.state, sites: [...this.state.sites, site] }); return site.id;
  }
  async uploadProfile(body: Record<string, unknown>) {
    this.checkRevision(body.revision);
    if (typeof body.yaml !== 'string' || Buffer.byteLength(body.yaml) > 65536) throw new ConfigurationError('Choose a YAML profile no larger than 64 KB.');
    let profile: Profile;
    try { profile = parseProfile(body.yaml); } catch (cause) { throw new ConfigurationError((cause as Error).message); }
    if (this.state.profiles.length >= 100) throw new ConfigurationError('The asset list is limited to 100 uploaded profiles.');
    const files = body.references ?? [];
    if (!Array.isArray(files) || files.length > 100) throw new ConfigurationError('Upload at most 100 Markdown reference files.');
    const paths = new Set<string>(); let bytes = 0;
    for (const file of files) {
      if (!file || typeof file !== 'object' || typeof file.path !== 'string' || typeof file.content !== 'string' ||
        !/\.markdown$|\.md$/i.test(file.path) || file.path.length > 500 || file.path.includes('\\') ||
        file.path.split('/').some((part: string) => !part || part === '.' || part === '..') || /[\x00-\x1f:]/.test(file.path)) {
        throw new ConfigurationError('Reference files must have relative Markdown paths without parent-directory segments.');
      }
      if (paths.has(file.path)) throw new ConfigurationError('Reference file paths must be unique.');
      paths.add(file.path); bytes += Buffer.byteLength(file.content);
      if (!file.content.trim() || file.content.length > 24000) throw new ConfigurationError('Each reference must contain between 1 and 24,000 characters.');
    }
    if (bytes > 6 * 1024 * 1024) throw new ConfigurationError('The reference upload is limited to 6 MB.');
    const id = 'upload-' + randomUUID(), root = join(this.dataDirectory, 'profiles', id);
    const asset = { id, name: name(body.name, 'Uploaded profile'), path: join(root, 'profile.yaml'), referencePath: join(root, 'references') };
    try {
      await mkdir(asset.referencePath, { recursive: true });
      await writeFile(asset.path, body.yaml, 'utf8');
      for (const file of files) {
        const target = join(asset.referencePath, file.path); await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
      }
      if ((profile.reference_content?.length ?? 0) > 100) throw new ConfigurationError('A profile supports at most 100 reference mappings.');
      for (const entry of profile.reference_content ?? []) {
        await loadReference(new URL(entry.page, this.environmentSite.url).href, this.environmentSite.url, profile, asset.referencePath);
      }
      this.save({ ...this.state, profiles: [...this.state.profiles, asset] }); return asset.id;
    } catch (cause) {
      await rm(root, { recursive: true, force: true });
      if (cause instanceof ConfigurationError) throw cause;
      throw new ConfigurationError('Could not save this profile and its reference files: ' + (cause as Error).message);
    }
  }
}
