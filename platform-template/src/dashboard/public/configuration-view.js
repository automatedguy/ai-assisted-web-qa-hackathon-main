export function createConfigurationView(document, api, onChange, onApplied) {
  const $ = selector => document.querySelector(selector);
  const site = $('#test-site'), profile = $('#test-profile'), feedback = $('#configuration-message');
  let catalog = null, blocked = false, saving = false, dirty = false;
  function controls() {
    const disabled = blocked || saving;
    for (const element of document.querySelectorAll('#test-configuration input, #test-configuration select, #test-configuration button')) {
      element.disabled = disabled || !catalog;
    }
    $('#configuration-reload').disabled = disabled;
    $('#configuration-apply').disabled = disabled || !catalog || !dirty;
  }
  function changed() { dirty = Boolean(catalog && (site.value !== catalog.selected.siteId || profile.value !== catalog.selected.profileId)); controls(); onChange(); }
  function render(data, draft) {
    catalog = data;
    site.replaceChildren(...data.sites.map(item => new Option(`${item.name} · ${item.url}`, item.id)));
    profile.replaceChildren(...data.profiles.map(item => new Option(`${item.name}${item.locale ? ' · ' + item.locale : ''}${item.available ? '' : ' · unavailable'}`, item.id)));
    site.value = draft?.siteId ?? data.selected.siteId; profile.value = draft?.profileId ?? data.selected.profileId;
    const selectedSite = data.sites.find(item => item.id === data.selected.siteId);
    const selectedProfile = data.profiles.find(item => item.id === data.selected.profileId);
    $('#configuration-current').textContent = `Next run: ${selectedSite?.url || 'Site unavailable'} · ${selectedProfile?.name || 'Profile unavailable'}${selectedProfile?.locale ? ' · ' + selectedProfile.locale : ''}`;
    $('#configuration-detail').textContent = selectedProfile?.error || `${selectedProfile?.referenceCount ?? 0} translation reference mappings. The website must already be running and reachable from the QA server.`;
    changed();
  }
  function message(value, error = false) { feedback.textContent = value; feedback.dataset.error = String(error); }
  async function refresh() {
    saving = true; controls(); onChange();
    try { render(await api('/api/test-configuration')); message(''); }
    catch (error) { catalog = null; message('Could not load test configuration: ' + error.message, true); }
    finally { saving = false; controls(); onChange(); }
  }
  async function change(action) {
    if (saving || blocked || !catalog) return;
    saving = true; controls(); onChange(); message('Saving configuration…');
    try { await action(); }
    catch (error) { message(error.message, true); }
    finally { saving = false; controls(); onChange(); }
  }
  const request = (path, method, body) => api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, revision: catalog.revision }) });
  site.addEventListener('change', changed); profile.addEventListener('change', changed);
  $('#configuration-reload').addEventListener('click', () => void refresh());
  $('#configuration-form').addEventListener('submit', event => {
    event.preventDefault();
    void change(async () => {
      render(await request('/api/test-configuration', 'PATCH', { siteId: site.value, profileId: profile.value }));
      await onApplied(); message('Configuration applied. Start a run when ready. Saved history has been retained.');
    });
  });
  $('#site-form').addEventListener('submit', event => {
    event.preventDefault();
    void change(async () => {
      const profileId = profile.value;
      const result = await request('/api/test-configuration/sites', 'POST', { name: $('#site-name').value, url: $('#site-url').value });
      render(result, { siteId: result.addedId, profileId }); $('#site-form').reset();
      message('Website added. Choose the matching linguistic asset, then Apply selection.');
    });
  });
  $('#profile-form').addEventListener('submit', event => {
    event.preventDefault();
    void change(async () => {
      const file = $('#profile-file').files[0];
      if (!file || file.size > 65536) throw new Error('Choose a YAML profile no larger than 64 KB.');
      const files = [...$('#profile-references').files].filter(file => /\.md$|\.markdown$/i.test(file.name));
      if (files.length > 100 || files.reduce((sum,file) => sum + file.size, 0) > 6 * 1024 * 1024) throw new Error('Choose at most 100 Markdown files, totalling no more than 6 MB.');
      const references = [];
      for (const item of files) {
        if (item.size > 96000) throw new Error('Each reference is limited to 24,000 characters.');
        const path = item.webkitRelativePath ? item.webkitRelativePath.split('/').slice(1).join('/') : item.name;
        references.push({ path, content: await item.text() });
      }
      const siteId = site.value;
      const result = await request('/api/test-configuration/profiles', 'POST', { name: $('#profile-name').value || file.name, yaml: await file.text(), references });
      render(result, { siteId, profileId: result.addedId }); $('#profile-form').reset();
      message('Linguistic asset added. Click Apply selection to use it for the next run.');
    });
  });
  controls();
  return { refresh, setBusy(value) { blocked = value; controls(); },
    get ready() { return Boolean(catalog && !dirty && !saving && catalog.profiles.find(item => item.id === catalog.selected.profileId)?.available); },
    get busy() { return saving; },
    payload() { return { configurationRevision: catalog?.revision }; },
  };
}
