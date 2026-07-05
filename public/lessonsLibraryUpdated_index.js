/* lessonsLibraryUpdated_index.js
   Minimal UI for browsing lessons + loading exercise photos.

   Expected backend endpoints (you can implement later):
   - GET /api/lessons            -> [{ lesson_id, name, filepath, url, description, description2 }]
   - GET /api/lessons/:id/photos -> [{ position, exercise_id, text, solution }]

   If your existing routes are different, change API.* constants below.
*/

const API = {
  lessons: '/api/lessons',
  lessonPhotos: (lessonId) => `/api/lessons/${encodeURIComponent(lessonId)}/photos`,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));


function esc(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}


function isPdfUrl(u){
  const s = String(u || '').trim().replace(/^[\s'"]+|[\s'"]+$/g,'').toLowerCase();  if (!s) return false;
  // strip query/hash
  const clean = s.split('#')[0].split('?')[0];
  return clean.endsWith('.pdf');
}

// Map absolute macOS file paths under /Users/viktorvelkov/Documents to /files/... URLs for server access
function normalizeFileUrl(u){
  let raw = String(u || '').trim();
  if (!raw) return '';

  // Remove stray wrapping/trailing quotes/apostrophes (common when stored as text)
  raw = raw.replace(/^[\s'\"]+|[\s'\"]+$/g, '');
  if (!raw) return '';

  // If someone stored a file:// URL, convert it to a path first.
  if (raw.startsWith('file://')) {
    try {
      raw = decodeURI(raw.replace(/^file:\/\//, ''));
    } catch (_) {
      raw = raw.replace(/^file:\/\//, '');
    }
  }

  if (raw.startsWith('r2://')) {
    return `/file-preview?path=${encodeURIComponent(raw)}`;
  }

  // Already an http(s) URL or already mapped
  if (
    /^https?:\/\//i.test(raw) ||
    raw.startsWith('/files/') ||
    raw.startsWith('/file-preview?') ||
    raw.startsWith('/file-proxy?')
  ) {
    return raw;
  }

  // Map absolute local paths under /Users/viktorvelkov/Documents -> /files/...
  const base = '/Users/viktorvelkov/Documents';
  if (raw.startsWith(base)) {
    const rest = raw.slice(base.length);
    return '/files' + (rest.startsWith('/') ? rest : '/' + rest);
  }

  return raw;
}

function renderMediaCard(label, url, altText){
  const uIn = String(url || '').trim();
  if (!uIn) return '';

  const uRaw = normalizeFileUrl(uIn);

  // IMPORTANT: encode spaces / Cyrillic in URLs (e.g. under /files/...)
  // encodeURI keeps '/' but encodes unsafe chars.
  const u = encodeURI(uRaw);

  const safeUrl = esc(u);
  const safeAlt = esc(altText || label || '');

  if (isPdfUrl(uRaw)) {
  return `
    <div class="imgCard">
      <div class="imgLabel">
        ${esc(label)} (PDF) ·
        <a href="${safeUrl}" target="_blank" rel="noopener">отвори</a>
      </div>
      <embed
        src="${safeUrl}"
        type="application/pdf"
        style="width:100%; height:780px; border:0; display:block;" />
    </div>
  `;
}

  return `
    <div class="imgCard">
      <div class="imgLabel">${esc(label)}${isPdfUrl(uRaw) ? ' (PDF)' : ''}</div>
      <img loading="lazy" src="${safeUrl}" alt="${safeAlt}">
    </div>
  `;
}

function setStatus(msg){
  const el = $('#status');
  if (!el) return;
  el.textContent = msg || '';
}

async function fetchJSON(url){
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.includes('application/json');

  if (!res.ok) {
    // Avoid dumping big HTML error pages into the UI.
    let details = '';
    try {
      const text = await res.text();
      const t = (text || '').trim();
      const looksHtml = t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body');
      if (t && !looksHtml) details = t.slice(0, 160);
    } catch {}

    const base = `${res.status} ${res.statusText}`;
    throw new Error(details ? `${base} — ${details}` : base);
  }

  if (!isJson) {
    throw new Error(`Очаквах JSON, но получих: ${ct || 'unknown content-type'}`);
  }

  return res.json();
}

function lessonLabel(lesson){
  const name = lesson?.name ?? '(без име)';
  const d2 = (lesson?.description2 ?? '').trim();
  return d2 ? `${name} — ${d2}` : name;
}

function renderLessons(list){
  const wrap = $('#lessonsList');
  if (!wrap) return;

  if (!Array.isArray(list) || list.length === 0) {
    wrap.innerHTML = `<div class="empty">Няма намерени уроци.</div>`;
    return;
  }

  wrap.innerHTML = list.map(l => {
    const id = l.lesson_id ?? l.id;
    return `
      <button class="lessonCard" data-lesson-id="${esc(id)}" title="${esc(l.name)}">
      <div class="lessonTitle">${esc((String(l.name ?? '').trim()) || (String(l.description ?? '').trim()) || '(без име)')}</div>        <div class="lessonMeta">
          <span class="pill">ID: ${esc(id)}</span>
          ${(l.description2 ?? '').trim() ? `<div class="lessonDesc">${esc(l.description2)}</div>` : ''}        </div>
          ${(l.description ?? '').trim() ? `<span class="pill">описание</span>` : ''}      </button>
    `;
  }).join('');

  // click handlers
  $$('.lessonCard', wrap).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-lesson-id');
      selectLesson(id);

      // UI selected state
      $$('.lessonCard.selected', wrap).forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

function renderLessonHeader(lesson){
  const title = $('#lessonTitle');
  const meta = $('#lessonMeta');
  const open = $('#openLessonFile');

  if (title) {
    const d1 = String(lesson?.description ?? '').trim();
    const nm = String(lesson?.name ?? '').trim();
    title.textContent = d1 || nm || '(без име)';
  }

  const id = lesson?.lesson_id ?? lesson?.id ?? '';
  const d2 = (lesson?.description2 ?? '').trim();
  const d1 = (lesson?.description ?? '').trim();
  if (meta) {
    meta.innerHTML = [
      id ? `<span class="pill">ID: ${esc(id)}</span>` : '',
    ].filter(Boolean).join(' ');
  }

  // Open file link: prefer url, fallback to filepath.
  // If filepath is a server path you expose via /files, change this accordingly.
  const href = normalizeFileUrl((lesson?.url ?? lesson?.filepath ?? '').trim());
  if (open) {
    if (href) {
      open.href = encodeURI(href);
      open.classList.remove('disabled');
      open.setAttribute('target', '_blank');
      open.setAttribute('rel', 'noopener');
      open.textContent = 'Отвори файла към урока';
    } else {
      open.removeAttribute('href');
      open.classList.add('disabled');
      open.textContent = 'Няма файл към урока';
    }
  }
}

function renderPhotos(items){
  const wrap = $('#photosWrap');
  if (!wrap) return;

  if (!Array.isArray(items) || items.length === 0) {
    wrap.innerHTML = `<div class="empty">Няма снимки/упражнения към този урок.</div>`;
    return;
  }

  wrap.innerHTML = items.map(x => {
    const pos = x.position ?? '';
    const exId = x.exercise_id ?? x.id ?? '';
    const text = normalizeFileUrl(x.text ?? x.text_filepath ?? '');
    const sol = normalizeFileUrl(x.solution ?? x.solution_filepath ?? '');

    return `
      <div class="photoRow">
        <div class="photoRowHeader">
          <div class="photoRowTitle">Упражнение ${esc(exId)}${pos !== '' ? ` (позиция ${esc(pos)})` : ''}</div>
          <div class="photoRowLinks">
            ${text ? `<a href="${esc(encodeURI(text))}" target="_blank" rel="noopener">условие</a>` : '<span class="muted">няма условие</span>'}
            ${sol ? `<a href="${esc(encodeURI(sol))}" target="_blank" rel="noopener">решение</a>` : '<span class="muted">няма решение</span>'}
          </div>
        </div>
        <div class="photoGrid">
          ${text ? renderMediaCard('Условие', text, `Условие ${exId}`) : ''}
          ${sol ? renderMediaCard('Решение', sol, `Решение ${exId}`) : ''}
        </div>
      </div>
    `;
  }).join('');
}

let LESSONS_CACHE = [];
let SELECTED_LESSON_ID = null;

function getSearchMode(){
  // OFF (unchecked) => description, ON (checked) => ID
  return ($('#searchModeSwitch')?.checked) ? 'id' : 'desc';
}

function updateSearchPlaceholder(){
  const mode = getSearchMode();
  const inp = $('#searchInput');
  if (!inp) return;
  inp.placeholder = (mode === 'id') ? 'Търси по ID...' : 'Търси по description...';
}

function applySearch(){
  const mode = getSearchMode();
  const qRaw = ($('#searchInput')?.value ?? '').trim();
  const q = qRaw.toLowerCase();

  if (!q) {
    // Show nothing until the user searches
    renderLessons([]);
    renderLessonHeader(null);
    renderPhotos([]);
    setStatus('Въведи текст за търсене, за да се покажат уроци.');
    return;
  }

  if (mode === 'id') {
    const filtered = LESSONS_CACHE.filter(l => {
      const id = String(l.lesson_id ?? l.id ?? '').trim().toLowerCase();
      return id.includes(q);
    });
    renderLessons(filtered);
    setStatus(filtered.length ? '' : 'Няма намерени уроци за това търсене.');
    return;
  }

  // description mode
  const filtered = LESSONS_CACHE.filter(l => {
    const d = String(l.description ?? '').trim().toLowerCase();
    return d.includes(q);
  });
  renderLessons(filtered);
  setStatus(filtered.length ? '' : 'Няма намерени уроци за това търсене.');
}

async function loadLessons(){
  setStatus('Зареждам уроци...');
  try {
    const data = await fetchJSON(API.lessons);
    // accept either direct array or { rows: [...] }
    const list = Array.isArray(data) ? data : (data?.rows ?? []);
    LESSONS_CACHE = list;
    updateSearchPlaceholder();
    renderLessons([]);
    renderLessonHeader(null);
    renderPhotos([]);
    setStatus('Въведи текст за търсене, за да се покажат уроци.');
  } catch (e) {
    console.error(e);
    const msg = String(e.message || '').includes('404')
      ? 'Липсва API endpoint /api/lessons (404). Засега показвам празен списък.'
      : `Грешка при зареждане на уроци: ${e.message}`;
    setStatus(msg);
    // Ensure only one call to renderLessons([]) and renderPhotos([])
    renderLessons([]);
    renderPhotos([]);
  }
}

async function selectLesson(lessonId){
  SELECTED_LESSON_ID = lessonId;
  const lesson = LESSONS_CACHE.find(l => String(l.lesson_id ?? l.id) === String(lessonId)) ?? null;
  renderLessonHeader(lesson);

  setStatus('Зареждам снимки...');
  try {
    const data = await fetchJSON(API.lessonPhotos(lessonId));
    const items = Array.isArray(data) ? data : (data?.rows ?? []);
    renderPhotos(items);
    setStatus('');
  } catch (e) {
    console.error(e);
    renderPhotos([]);
    setStatus(`Грешка при зареждане на снимки: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#reloadBtn')?.addEventListener('click', loadLessons);

  $('#searchModeSwitch')?.addEventListener('change', () => {
    updateSearchPlaceholder();
    applySearch();
  });

  $('#searchInput')?.addEventListener('input', applySearch);
  $('#searchBtn')?.addEventListener('click', applySearch);

  loadLessons();
});