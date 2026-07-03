(function(){
  'use strict';

  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 5;

  // modes: id | meta (name+keywords) | uslovie
  let mode = 'meta';

  let allRows = [];
  let page = 1;

  let currentSnippetId = null;
  let originalSnapshot = null; // stringified snapshot to detect changes

  async function apiJson(url){
    const res = await fetch(url);
    const txt = await res.text();
    let data;
    try{ data = txt ? JSON.parse(txt) : null; }catch(_){ data = { raw: txt }; }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (res.status + ' ' + res.statusText);
      throw new Error(msg);
    }
    return data;
  }

  function setHint(msg){ $('hint').textContent = msg; }

  function csv(arr){
    if (!Array.isArray(arr)) return '';
    return arr.map(x => String(x)).join(', ');
  }

  function updateIndicator(){
    const seg = document.querySelector('.seg');
    if (!seg) return;
    const ind = seg.querySelector('.seg-indicator');
    if (!ind) return;

    // order must match the buttons: id | meta | uslovie
    const idx = (mode === 'id') ? 0 : (mode === 'meta') ? 1 : 2;
    ind.style.transform = `translateX(${idx * 100}%)`;
  }

  function setMode(newMode){
    mode = newMode;

    $('modeIdBtn').classList.toggle('active', mode === 'id');
    $('modeMetaBtn').classList.toggle('active', mode === 'meta');
    $('modeUslovieBtn').classList.toggle('active', mode === 'uslovie');

    updateIndicator();

    const label = $('qLabel');
    const input = $('q');

    if (mode === 'id'){
      label.textContent = 'Snippet ID';
      input.type = 'number';
      input.placeholder = 'напр. 12';
      input.inputMode = 'numeric';
    } else if (mode === 'uslovie'){
      label.textContent = 'Търси в Uslovie';
      input.type = 'text';
      input.placeholder = 'дума/фраза от условието…';
      input.inputMode = 'text';
    } else {
      label.textContent = 'Име / ключови думи';
      input.type = 'text';
      input.placeholder = 'напр. питагор, подобие, триъгълник';
      input.inputMode = 'text';
    }

    clearResultsOnly();
  }

  function hideViewer(){
    const wrap = document.getElementById('viewerWrap');
    if (wrap) wrap.style.display = 'none';
    const st = document.getElementById('saveStatus');
    if (st) st.textContent = '—';
  }

  function hideTable(){
    $('resultsTable').style.display = 'none';
    $('resultsTable').querySelector('tbody').innerHTML = '';
    $('pager').style.display = 'none';
    $('pageInfo').textContent = '—';
  }

  function clearResultsOnly(){
    allRows = [];
    page = 1;
    hideViewer();
    hideTable();
    setHint('—');
  }

  function splitCSV(text){
    const s = String(text || '').trim();
    if (!s) return [];
    return s.split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
  }

  function splitIntCSV(text){
    return splitCSV(text).map(x => parseInt(x, 10)).filter(n => Number.isInteger(n));
  }

  function snapshotFromUI(){
    return JSON.stringify({
      name: $('v_name').value,
      class: $('v_class').value,
      order: $('v_order').value,
      division: $('v_division').value,
      keyWords: $('v_keywords').value,
      relatedTopic: $('v_related').value,
      lessons_in_tripplets: $('v_lessons').value,
      associatedSnippets: $('v_assoc').value,
      uslovie: $('v_uslovie').value
    });
  }

  function setDirty(isDirty){
    const btn = $('saveChangesBtn');
    if (!btn) return;
    btn.style.display = isDirty ? '' : 'none';
  }

  function checkDirty(){
    if (!originalSnapshot) { setDirty(false); return; }
    setDirty(snapshotFromUI() !== originalSnapshot);
  }

  function fillEditor(sn){
    currentSnippetId = sn.id;
    $('v_id').textContent = String(sn.id);

    $('v_name').value = sn.name || '';
    $('v_class').value = (sn.class ?? '') === null ? '' : (sn.class ?? '');
    $('v_division').value = sn.division || '';
    $('v_order').value = (sn.order ?? '') === null ? '' : (sn.order ?? '');

    $('v_keywords').value = Array.isArray(sn.keyWords) ? sn.keyWords.join(', ') : '';
    $('v_related').value = Array.isArray(sn.relatedTopic) ? sn.relatedTopic.join(', ') : '';
    $('v_lessons').value = Array.isArray(sn.lessons_in_tripplets) ? sn.lessons_in_tripplets.join(', ') : '';
    $('v_assoc').value = Array.isArray(sn.associatedSnippets) ? sn.associatedSnippets.join(', ') : '';

    $('v_uslovie').value = sn.uslovie || '';

    originalSnapshot = snapshotFromUI();
    setDirty(false);

    $('saveStatus').textContent = '—';
    document.getElementById('viewerWrap').style.display = '';
  }

  async function showSnippetById(id){
    const sn = await apiJson(`/snippets/${id}`);
    fillEditor(sn);
  }

  function totalPages(){
    return Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  }

  function updatePager(){
    const tp = totalPages();
    $('pager').style.display = allRows.length ? 'flex' : 'none';
    $('pageInfo').textContent = `Страница ${page} / ${tp} (общо ${allRows.length})`;
    $('prevBtn').disabled = (page <= 1);
    $('nextBtn').disabled = (page >= tp);
  }

  function renderPage(){
    const table = $('resultsTable');
    const body = table.querySelector('tbody');
    body.innerHTML = '';

    if (!Array.isArray(allRows) || allRows.length === 0){
      hideTable();
      setHint('Няма намерени резултати.');
      return;
    }

    table.style.display = '';

    const start = (page - 1) * PAGE_SIZE;
    const slice = allRows.slice(start, start + PAGE_SIZE);

    for (const r of slice){
      const tr = document.createElement('tr');
      tr.onclick = () => showSnippetById(r.id);

      const u = (r.uslovie || '').trim();
      const preview = u.length > 120 ? (u.slice(0, 120) + '…') : u;

      const kw = Array.isArray(r.keyWords) ? csv(r.keyWords) : '';
      const kwShort = kw.length > 40 ? (kw.slice(0, 40) + '…') : kw;

      tr.innerHTML = `
        <td>${r.id}</td>
        <td>${(r.name || '')}</td>
        <td>${(r.class ?? '')}</td>
        <td>${kwShort}</td>
        <td>${preview}</td>
      `;
      body.appendChild(tr);
    }

    setHint(`Намерени: ${allRows.length} (по ${PAGE_SIZE} на страница; клик върху ред за детайли)`);
    updatePager();
  }

  async function search(){
    hideViewer();
    setHint('Търсене…');

    const qRaw = String($('q').value || '').trim();

    if (!qRaw){
      setHint(mode === 'id' ? 'Въведи ID.' : 'Въведи текст за търсене.');
      hideTable();
      return;
    }

    try{
      if (mode === 'id'){
        const id = parseInt(qRaw, 10);
        if (!Number.isInteger(id)) {
          setHint('Невалидно ID.');
          hideTable();
          return;
        }
        const sn = await apiJson(`/snippets/${id}`);
        allRows = [sn];
        page = 1;
        renderPage();
        fillEditor(sn);
      } else {
        const rows = await apiJson(`/snippets/search?q=${encodeURIComponent(qRaw)}&mode=${encodeURIComponent(mode)}`);
        allRows = Array.isArray(rows) ? rows : [];
        page = 1;
        renderPage();
      }
    } catch (e) {
      setHint('Грешка: ' + (e && e.message ? e.message : 'неуспешно търсене'));
      hideTable();
    }
  }

  function clearAll(){
    $('q').value = '';
    clearResultsOnly();
  }

  // Wire up
  $('modeIdBtn').addEventListener('click', () => setMode('id'));
  $('modeMetaBtn').addEventListener('click', () => setMode('meta'));
  $('modeUslovieBtn').addEventListener('click', () => setMode('uslovie'));

  $('searchBtn').addEventListener('click', search);
  $('clearBtn').addEventListener('click', clearAll);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  $('prevBtn').addEventListener('click', () => { if (page > 1) { page--; renderPage(); } });
  $('nextBtn').addEventListener('click', () => { if (page < totalPages()) { page++; renderPage(); } });

  const editIds = ['v_name','v_class','v_division','v_order','v_keywords','v_related','v_lessons','v_assoc','v_uslovie'];
  editIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', checkDirty);
  });

  $('saveChangesBtn').addEventListener('click', async () => {
    try {
      if (!currentSnippetId) return;
      $('saveStatus').textContent = 'Запазване…';

      const payload = {
        name: $('v_name').value.trim(),
        class: $('v_class').value === '' ? null : parseInt($('v_class').value, 10),
        division: $('v_division').value.trim() || null,
        order: $('v_order').value === '' ? null : parseInt($('v_order').value, 10),
        keyWords: splitCSV($('v_keywords').value),
        relatedTopic: splitCSV($('v_related').value),
        lessons_in_tripplets: splitCSV($('v_lessons').value),
        associatedSnippets: splitIntCSV($('v_assoc').value),
        uslovie: $('v_uslovie').value
      };

      const res = await fetch(`/snippets/${currentSnippetId}` , {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch(_){ data = { raw: txt }; }

      if (!res.ok) throw new Error((data && data.error) ? data.error : (res.status + ' ' + res.statusText));

      fillEditor(data);
      $('saveStatus').textContent = '✅ Запазено';
      originalSnapshot = snapshotFromUI();
      setDirty(false);
    } catch (e) {
      $('saveStatus').textContent = 'Грешка при запис';
      console.error(e);
    }
  });


function openAddModal(){
  const m = document.getElementById('addModal');
  if (!m) return;
  m.classList.add('show');
  m.setAttribute('aria-hidden','false');
  const st = document.getElementById('createStatus');
  if (st) st.textContent = '—';
  const nm = document.getElementById('n_name');
  if (nm) setTimeout(()=>nm.focus(), 0);
}
function closeAddModal(){
  const m = document.getElementById('addModal');
  if (!m) return;
  m.classList.remove('show');
  m.setAttribute('aria-hidden','true');
}
function clearNewForm(){
['n_name','n_class','n_division','n_order','n_keywords','n_related','n_lessons','n_assoc','n_uslovie'].forEach(id => {    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const st = document.getElementById('createStatus');
  if (st) st.textContent = '—';
}

// open/close hooks
const addBtn = document.getElementById('addSnippetBtn');
if (addBtn) addBtn.addEventListener('click', openAddModal);

const addClose = document.getElementById('addModalClose');
if (addClose) addClose.addEventListener('click', closeAddModal);

const overlay = document.getElementById('addModal');
if (overlay) {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAddModal();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAddModal();
});

const clr = document.getElementById('clearNewBtn');
if (clr) clr.addEventListener('click', clearNewForm);

const confirmBtn = document.getElementById('confirmCreateBtn');
if (confirmBtn) confirmBtn.addEventListener('click', async () => {
  try {
    document.getElementById('createStatus').textContent = 'Създаване…';

    
    const modal = document.getElementById('addModal');
    const nName = modal.querySelector('#n_name');
    const nClass = modal.querySelector('#n_class');
    const nDivision = modal.querySelector('#n_division');
    const nOrder = modal.querySelector('#n_order');

    const payload = {
      name: nName.value.trim(),
      class: nClass.value === '' ? null : parseInt(nClass.value, 10),
      division: nDivision.value.trim() || null,
      order: nOrder.value === '' ? null : parseInt(nOrder.value, 10),
      keyWords: splitCSV(document.getElementById('n_keywords').value),
      relatedTopic: splitCSV(document.getElementById('n_related').value),
      lessons_in_tripplets: splitCSV(document.getElementById('n_lessons').value),
      associatedSnippets: splitIntCSV(document.getElementById('n_assoc').value),
      uslovie: document.getElementById('n_uslovie').value
    };

    if (!payload.name) {
      document.getElementById('createStatus').textContent = 'Моля въведи заглавие.';
      return;
    }

    const res = await fetch('/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch(_) { data = { raw: txt }; }
    if (!res.ok) throw new Error((data && data.error) ? data.error : (res.status + ' ' + res.statusText));

    const newId = data && (data.id || (data.row && data.row.id));
    document.getElementById('createStatus').textContent = `✅ Създаден (id=${newId ?? '?'})`;

    // автоматично: затвори модала и отвори новия snippet в search
    if (newId != null) {
      closeAddModal();
      setMode('id');
      document.getElementById('q').value = String(newId);
      await search();
    }
  } catch (e) {
    console.error(e);
    document.getElementById('createStatus').textContent = 'Грешка: ' + (e?.message || 'unknown');
  }
});

  // init
  setMode('meta');
})();

