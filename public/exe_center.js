const state = {
  lastRows: [],
  selectedIndex: -1
};

const els = {
  idFilter: document.getElementById('idFilter'),
  numberFilter: document.getElementById('numberFilter'),
  pageFilter: document.getElementById('pageFilter'),
  resourceFilter: document.getElementById('resourceFilter'),
  limitSelect: document.getElementById('limitSelect'),
  searchBtn: document.getElementById('searchBtn'),
  clearBtn: document.getElementById('clearBtn'),
  modeIdBtn: document.getElementById('modeIdBtn'),
  modeCompositeBtn: document.getElementById('modeCompositeBtn'),
  idFieldWrap: document.getElementById('idFieldWrap'),
  numberFieldWrap: document.getElementById('numberFieldWrap'),
  pageFieldWrap: document.getElementById('pageFieldWrap'),
  resourceFieldWrap: document.getElementById('resourceFieldWrap'),
  status: document.getElementById('status'),
  resultsBody: document.getElementById('resultsBody'),
  textPreview: document.getElementById('textPreview'),
  solutionPreview: document.getElementById('solutionPreview'),
  textPathLabel: document.getElementById('textPathLabel'),
  solutionPathLabel: document.getElementById('solutionPathLabel')
};

state.mode = 'id';

function setMode(mode) {
  state.mode = mode === 'composite' ? 'composite' : 'id';

  const isIdMode = state.mode === 'id';

  els.modeIdBtn.classList.toggle('active', isIdMode);
  els.modeCompositeBtn.classList.toggle('active', !isIdMode);

  els.idFieldWrap.classList.toggle('hidden', !isIdMode);
  els.numberFieldWrap.classList.toggle('hidden', isIdMode);
  els.pageFieldWrap.classList.toggle('hidden', isIdMode);
  els.resourceFieldWrap.classList.toggle('hidden', isIdMode);

  if (isIdMode) {
    els.numberFilter.value = '';
    els.pageFilter.value = '';
    els.resourceFilter.value = '';
  } else {
    els.idFilter.value = '';
  }

  setStatus('');
}

function setStatus(message, type = '') {
  els.status.textContent = message || '';
  els.status.className = type || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return '';
}

function getFilePath(row, ...keys) {
  const raw = pick(row, ...keys);
  return String(raw || '').trim();
}

function getFileUrl(filePath) {
  return `/exercise-file?path=${encodeURIComponent(filePath)}`;
}

function getFileExt(filePath) {
  const clean = String(filePath || '').split('?')[0].trim().toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  return lastDot >= 0 ? clean.slice(lastDot + 1) : '';
}

function isImageExt(ext) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(ext);
}

function isPdfExt(ext) {
  return ext === 'pdf';
}

function renderFilePreview(container, labelEl, filePath, emptyMessage) {
  if (!filePath) {
    labelEl.textContent = 'Няма файл.';
    labelEl.className = 'preview-path muted';
    container.innerHTML = `<div class="preview-fallback">${emptyMessage}</div>`;
    return;
  }

  const fileUrl = getFileUrl(filePath);
  const ext = getFileExt(filePath);

  labelEl.textContent = filePath;
  labelEl.className = 'preview-path';

  if (isPdfExt(ext)) {
    container.innerHTML = `
      <iframe class="preview-frame" src="${fileUrl}"></iframe>
      <a class="preview-link" href="${fileUrl}" target="_blank" rel="noopener">Отвори PDF в нов таб</a>
    `;
    return;
  }

  if (isImageExt(ext)) {
    container.innerHTML = `
      <img class="preview-image" src="${fileUrl}" alt="Preview" />
      <a class="preview-link" href="${fileUrl}" target="_blank" rel="noopener">Отвори файла в нов таб</a>
    `;
    return;
  }

  container.innerHTML = `
    <div class="preview-fallback">
      Форматът <strong>.${ext || 'unknown'}</strong> може да не се визуализира директно в браузъра.<br>
      Отвори файла от линка по-долу.
    </div>
    <a class="preview-link" href="${fileUrl}" target="_blank" rel="noopener">Отвори файла в нов таб</a>
  `;
}

function renderSelectedPreviews(row) {
  if (!row) {
    els.textPathLabel.textContent = 'Няма избран ред.';
    els.textPathLabel.className = 'preview-path muted';
    els.solutionPathLabel.textContent = 'Няма избран ред.';
    els.solutionPathLabel.className = 'preview-path muted';
    els.textPreview.innerHTML = '<div class="preview-fallback">Маркирай ред, за да се визуализира файлът за условието.</div>';
    els.solutionPreview.innerHTML = '<div class="preview-fallback">Маркирай ред, за да се визуализира файлът за решението.</div>';
    return;
  }

  const textFilePath = getFilePath(row, 'text_filepath');
  const solutionFilePath = getFilePath(row, 'solution_filepath');

  renderFilePreview(
    els.textPreview,
    els.textPathLabel,
    textFilePath,
    'За този ред няма файл за условие.'
  );

  renderFilePreview(
    els.solutionPreview,
    els.solutionPathLabel,
    solutionFilePath,
    'За този ред няма файл за решение.'
  );
}

function renderRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    els.resultsBody.innerHTML = `
      <tr>
        <td colspan="17" class="muted">Няма намерени резултати.</td>
      </tr>
    `;
    renderSelectedPreviews(null);
    return;
  }

  els.resultsBody.innerHTML = rows.map((row, index) => `
    <tr class="result-row${state.selectedIndex === index ? ' selected' : ''}" data-row-index="${index}">
      <td>${escapeHtml(formatValue(pick(row, 'id', 'ID')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'number', 'Number')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'page', 'Page')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'resourceid', 'resourceId', 'ResourceID')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'difficulty')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'date_last_solvec')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'for_revision')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'has_assignment')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'has_solution')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'comments')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'multiple_solution')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'text_filepath')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'solution_filepath')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'tuple_key')))}</td>
      <td>${escapeHtml(formatValue(pick(row, 'topic')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'keyWords')))}</td>
      <td class="mono">${escapeHtml(formatValue(pick(row, 'secondarySolutions', 'secondary_solutions')))}</td>
    </tr>
  `).join('');

  els.resultsBody.querySelectorAll('tr.result-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      const idx = Number(tr.dataset.rowIndex);
      state.selectedIndex = state.selectedIndex === idx ? -1 : idx;
      renderRows(state.lastRows);
      renderSelectedPreviews(state.selectedIndex >= 0 ? state.lastRows[state.selectedIndex] : null);
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

function getFilters() {
  return {
    id: els.idFilter.value.trim(),
    number: els.numberFilter.value.trim(),
    page: els.pageFilter.value.trim(),
    resourceId: els.resourceFilter.value.trim(),
    limit: els.limitSelect.value
  };
}

function buildSearchUrl() {
  const { id, number, page, resourceId, limit } = getFilters();

  if (state.mode === 'id') {
    if (!id) {
      throw new Error('Въведи ID за търсене.');
    }
    return `/exercises/${encodeURIComponent(id)}`;
  }

  const params = new URLSearchParams();
  if (resourceId) params.set('resourceId', resourceId);
  if (page) params.set('page', page);
  if (number) params.set('number', number);
  if (limit) params.set('limit', limit);

  if (![resourceId, page, number].some(Boolean)) {
    throw new Error('Въведи поне едно поле: ResourceID, Page или Number.');
  }

  return `/exercises?${params.toString()}`;
}

async function loadRows() {
  setStatus('Зареждане...');

  try {
    const url = buildSearchUrl();
    const data = await fetchJson(url);
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    state.lastRows = rows;
    state.selectedIndex = -1;
    renderRows(rows);
    renderSelectedPreviews(null);
    setStatus(`Заредени резултати: ${rows.length}`, 'success');
  } catch (error) {
    renderRows([]);
    setStatus(error.message || 'Грешка при зареждане.', 'error');
  }
}

function clearFilters() {
  els.idFilter.value = '';
  els.numberFilter.value = '';
  els.pageFilter.value = '';
  els.resourceFilter.value = '';
  els.limitSelect.value = '50';
  setMode('id');
  state.lastRows = [];
  state.selectedIndex = -1;
  setStatus('');
  renderRows([]);
  renderSelectedPreviews(null);
}

els.searchBtn.addEventListener('click', loadRows);
els.clearBtn.addEventListener('click', clearFilters);

els.modeIdBtn.addEventListener('click', () => setMode('id'));
els.modeCompositeBtn.addEventListener('click', () => setMode('composite'));

[els.idFilter, els.numberFilter, els.pageFilter, els.resourceFilter].forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadRows();
  });
});

setMode('id');
renderSelectedPreviews(null);