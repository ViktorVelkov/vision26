(function(){
  'use strict';

  const $ = (id) => document.getElementById(id);

  let activeSnippetId = null;

  async function apiJson(url, options){
    const res = await fetch(url, options);
    const txt = await res.text();
    let data = null;

    try {
      data = txt ? JSON.parse(txt) : null;
    } catch (_) {
      data = { raw: txt };
    }

    if (!res.ok) {
      throw new Error((data && data.error) ? data.error : (res.status + ' ' + res.statusText));
    }

    return data;
  }

  async function loadLessonsPanelHtml(){
    const mount = $('snippetLessonsMount');
    if (!mount) return false;

    const res = await fetch('/se/se_form_tableOfLessons.html');
    if (!res.ok) {
      mount.innerHTML = '<div class="muted">Неуспешно зареждане на панела за уроци.</div>';
      return false;
    }

    mount.innerHTML = await res.text();
    return true;
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[ch]));
  }

  function lessonTitle(row){
    return row.name || row.description || row.tripplet_id || '';
  }

  function getCurrentSnippetId(){
    const raw = $('v_id') ? String($('v_id').textContent || '').trim() : '';
    const id = parseInt(raw, 10);
    return Number.isInteger(id) ? id : null;
  }

    function clearLessonSearch(){
    const id = $('lessonSearchId');
    const name = $('lessonSearchName');
    const table = $('lessonSearchTable');
    const body = $('lessonSearchBody');
    const st = $('lessonSearchStatus');

    if (id) id.value = '';
    if (name) name.value = '';
    if (body) body.innerHTML = '';
    if (table) table.style.display = 'none';
    if (st) st.textContent = '—';
    }

  function renderLinkedLessons(rows){
    const body = $('linkedLessonsBody');
    const st = $('linkedLessonsStatus');
    if (!body || !st) return;

    body.innerHTML = '';

    if (!Array.isArray(rows) || rows.length === 0){
      st.textContent = 'Няма свързани уроци.';
      return;
    }

    st.textContent = `Свързани уроци: ${rows.length}`;

    for (const r of rows){
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${esc(r.lesson_id)}</td>
        <td>${esc(lessonTitle(r))}</td>
        <td>${esc(r.class ?? '')}</td>
        <td><button class="smallBtn danger" type="button">Махни</button></td>
      `;

      tr.querySelector('button').addEventListener('click', () => {
        toggleLessonSnippet(r.lesson_id, false);
      });

      body.appendChild(tr);
    }
  }

  async function loadLinkedLessons(snippetId){
    const st = $('linkedLessonsStatus');
    if (st) st.textContent = 'Зареждане…';

    try {
      const rows = await apiJson(`/snippets/${snippetId}/lessons`);
      renderLinkedLessons(rows);
    } catch (e) {
      if (st) st.textContent = 'Грешка при зареждане на уроците.';
      console.error(e);
    }
  }

  function renderLessonSearch(rows){
    const table = $('lessonSearchTable');
    const body = $('lessonSearchBody');
    const st = $('lessonSearchStatus');
    if (!table || !body || !st) return;

    body.innerHTML = '';

    if (!Array.isArray(rows) || rows.length === 0){
      table.style.display = 'none';
      st.textContent = 'Няма намерени уроци.';
      return;
    }

    table.style.display = '';
    st.textContent = `Намерени уроци: ${rows.length}`;

    for (const r of rows){
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${esc(r.lesson_id)}</td>
        <td>${esc(lessonTitle(r))}</td>
        <td>${esc(r.class ?? '')}</td>
        <td><button class="smallBtn add" type="button">Добави</button></td>
      `;

      tr.querySelector('button').addEventListener('click', () => {
        toggleLessonSnippet(r.lesson_id, true);
      });

      body.appendChild(tr);
    }
  }

async function searchLessonsById(){
  const snippetId = getCurrentSnippetId();
  if (!snippetId) return;

  const id = String($('lessonSearchId')?.value || '').trim();

  if (!id){
    $('lessonSearchStatus').textContent = 'Въведи ID на урок.';
    return;
  }

  $('lessonSearchStatus').textContent = 'Търсене…';

  try {
    const rows = await apiJson(`/lessons/search?id=${encodeURIComponent(id)}`);
    renderLessonSearch(rows);
  } catch (e) {
    $('lessonSearchStatus').textContent = 'Грешка при търсене по ID.';
    console.error(e);
  }
}

async function searchLessonsByName(){
  const snippetId = getCurrentSnippetId();
  if (!snippetId) return;

  const name = String($('lessonSearchName')?.value || '').trim();

  if (!name){
    $('lessonSearchStatus').textContent = 'Въведи име на урок.';
    return;
  }

  $('lessonSearchStatus').textContent = 'Търсене…';

  try {
    const rows = await apiJson(`/lessons/search?name=${encodeURIComponent(name)}`);
    renderLessonSearch(rows);
  } catch (e) {
    $('lessonSearchStatus').textContent = 'Грешка при търсене по име.';
    console.error(e);
  }
}
  async function toggleLessonSnippet(lessonId, linked){
    const snippetId = getCurrentSnippetId();
    if (!snippetId) return;

    try {
      await apiJson(`/lessons/${lessonId}/theory-snippets/${snippetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked })
      });

      await loadLinkedLessons(snippetId);

      const id = String($('lessonSearchId')?.value || '').trim();
      const name = String($('lessonSearchName')?.value || '').trim();

    if (id) await searchLessonsById();
    else if (name) await searchLessonsByName();
    } catch (e) {
      alert('Грешка при обновяване на урока: ' + (e?.message || 'unknown'));
      console.error(e);
    }
  }

  function refreshForCurrentSnippet(){
    const snippetId = getCurrentSnippetId();

    if (!snippetId || snippetId === activeSnippetId) return;

    activeSnippetId = snippetId;
    clearLessonSearch();
    loadLinkedLessons(snippetId);
  }
function wireLessonPanel(){
  const searchByIdBtn = $('lessonSearchByIdBtn');
  const searchByNameBtn = $('lessonSearchByNameBtn');
  const clearBtn = $('lessonSearchClearBtn');
  const idInput = $('lessonSearchId');
  const nameInput = $('lessonSearchName');

  if (searchByIdBtn) searchByIdBtn.addEventListener('click', searchLessonsById);
  if (searchByNameBtn) searchByNameBtn.addEventListener('click', searchLessonsByName);
  if (clearBtn) clearBtn.addEventListener('click', clearLessonSearch);

  if (idInput) {
    idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchLessonsById();
    });
  }

  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchLessonsByName();
    });
  }
}
  async function init(){
    const ok = await loadLessonsPanelHtml();
    if (!ok) return;

    wireLessonPanel();

    const viewer = $('viewerWrap');
    if (viewer) {
      const observer = new MutationObserver(refreshForCurrentSnippet);
      observer.observe(viewer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
      });
    }

    refreshForCurrentSnippet();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();