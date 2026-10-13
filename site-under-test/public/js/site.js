(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#primary-navigation');

  if (menuButton && navigation) {
    const mobile = matchMedia('(max-width: 600px)');
    const setMenu = (expanded) => {
      menuButton.setAttribute('aria-expanded', String(expanded));
      menuButton.setAttribute('aria-label', expanded ? (mobile.matches ? 'Close menu' : 'Cerrar menú') : 'Abrir menú');
      navigation.dataset.collapsed = String(!expanded);
    };
    const syncMenu = () => {
      menuButton.hidden = !mobile.matches;
      setMenu(!mobile.matches);
    };
    menuButton.addEventListener('click', () => {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    navigation.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mobile.matches) {
        setMenu(false);
        menuButton.focus();
      }
    });
    menuButton.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenu(false);
    });
    navigation.addEventListener('click', (event) => {
      if (mobile.matches && event.target.closest('a')) setMenu(false);
    });
    mobile.addEventListener('change', syncMenu);
    syncMenu();
  }

  const workspace = document.querySelector('[data-workspace]');
  if (!workspace) return;

  const form = workspace.querySelector('form');
  const search = workspace.querySelector('#file-search');
  const sort = workspace.querySelector('#file-sort');
  const list = workspace.querySelector('.file-list');
  const files = [...list.querySelectorAll('.file')];
  const status = workspace.querySelector('.file-status');
  const emptyState = workspace.querySelector('.empty-state');
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const updateFiles = () => {
    const query = normalize(search.value.trim());
    const type = form.querySelector('[name="file-type"]:checked').value;
    let visible = 0;
    files.sort((first, second) => sort.value === 'date'
      ? second.dataset.date.localeCompare(first.dataset.date)
      : first.dataset.name.localeCompare(second.dataset.name));
    files.forEach((file) => {
      file.hidden = !normalize(file.dataset.name).includes(query)
        || (type !== 'all' && file.dataset.type !== type);
      if (!file.hidden) visible += 1;
      const [year, month, day] = file.dataset.date.split('-');
      file.querySelector('time').textContent = sort.value === 'date'
        ? `${month}/${day}/${year}`
        : `${day}/${month}/${year}`;
      list.append(file);
    });
    status.textContent = visible === 1 ? '1 archivos' : `${visible} archivos`;
    emptyState.hidden = visible !== 0;
    emptyState.textContent = visible === 0
      ? 'No files match your search.'
      : 'No hay archivos que coincidan con tu búsqueda.';
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  search.addEventListener('input', updateFiles);
  form.addEventListener('change', (event) => {
    if (event.target !== search) updateFiles();
  });
  form.addEventListener('reset', () => {
    requestAnimationFrame(() => {
      files.forEach((file) => { file.open = false; });
      updateFiles();
      search.focus();
    });
  });
  updateFiles();
  form.hidden = false;
  status.hidden = false;
})();
