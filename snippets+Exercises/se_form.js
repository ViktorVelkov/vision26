(function(){
  'use strict';

  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 5;

  // modes: id | meta (name+keywords) | uslovie
  let mode = 'meta';

  let allRows = [];
  let page = 1;

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

    // translate by 0%, 100%, 200% of its own width
    ind.style.transform = `translateX(${idx * 100}%)`;
  }

  function setMode(newMode){
    mode = newMode;

    // active button
    $('modeIdBtn').classList.toggle('active', mode === 'id');
    $('modeMetaBtn').classList.toggle('active', mode === 'meta');
    $('modeUslovieBtn').classList.toggle('active', mode === 'uslovie');

    updateIndicator();

    // input label/type
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
    $('viewer').style.display = 'none';
    $('viewer').textContent = '';
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

  function formatFullRow(sn){
    const lines = [];
    const add = (k, v) => {
      if (Array.isArray(v)) lines.push(`${k}: ${csv(v)}`);
      else if (v === null || typeof v === 'undefined') lines.push(`${k}: `);
      else lines.push(`${k}: ${String(v)}`);
    };

    add('id', sn.id);
    add('name', sn.name);
    add('class', sn.class);
    add('keyWords', sn.keyWords);
    add('tripplet_lesson', sn.tripplet_lesson);
    add('order', sn.order);
    add('relatedTopic', sn.relatedTopic);
    add('lessons_in_tripplets', sn.lessons_in_tripplets);
    add('associatedSnippets', sn.associatedSnippets);
    add('uslovie', sn.uslovie);

    return lines.join('\n');
  }

  async function showSnippetById(id){
    const sn = await apiJson(`/snippets/${id}`);
    const v = $('viewer');
    v.style.display = '';
    v.textContent = formatFullRow(sn);
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
        $('viewer').style.display = '';
        $('viewer').textContent = formatFullRow(sn);
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

  // init
  setMode('meta');
})();