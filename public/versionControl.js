;(function(){
  // --- Page switch (Индивидуално / Групово) ---
  const tabIndividual = document.getElementById('tabIndividual');
  const tabGroup = document.getElementById('tabGroup');
  const pageIndividual = document.getElementById('pageIndividual');
  const pageGroup = document.getElementById('pageGroup');

  function setTab(which){
    const mode = (which === 'group') ? 'group' : 'individual';
    if (tabIndividual) tabIndividual.classList.toggle('active', mode==='individual');
    if (tabGroup) tabGroup.classList.toggle('active', mode==='group');
    if (pageIndividual) pageIndividual.toggleAttribute('hidden', mode!=='individual');
    if (pageGroup) pageGroup.toggleAttribute('hidden', mode!=='group');
    try{ localStorage.setItem('vc_page', mode); }catch(_){ }
  }
  if (tabIndividual) tabIndividual.addEventListener('click', ()=> setTab('individual'));
  if (tabGroup) tabGroup.addEventListener('click', ()=> setTab('group'));
  // restore last chosen tab
  try{ setTab(localStorage.getItem('vc_page') || 'individual'); }catch(_){ setTab('individual'); }
  const studentSearch = document.getElementById('studentSearch');
  const findStudentBtn = document.getElementById('findStudentBtn');
  const studentPick = document.getElementById('studentPick');
  const meta = document.getElementById('meta');
  const historyTableBody = document.querySelector('#historyTable tbody');
  const unthreadedBody = document.querySelector('#unthreadedTable tbody');
  const threadSummaryBody = document.querySelector('#threadSummaryTable tbody');
  const resultsWrap = document.getElementById('resultsWrap');
  const toggleHistoryBtn = document.getElementById('toggleHistoryBtn');
  const searchRow = document.getElementById('searchRow');
  const makeThreadBtn = document.getElementById('makeThreadBtn');
  const selectedUnthreaded = new Set();
  // Grouping helpers
  const groupMembers = new Map();  // rootId -> number[]
  const idToGroup    = new Map();  // anyId  -> rootId
  // Per-group color assignment
  const groupColor = new Map(); // rootId -> palette index
  let groupColorNext = 0;
  const groupColorTotal = 6; // must match count of .gcN classes in CSS

  if (toggleHistoryBtn) {
    toggleHistoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('/vc_chronology.html', '_blank', 'noopener');
    });
  }

  const unthreadedHeader = document.getElementById('unthreadedHeader');
  const threadsHeader = document.getElementById('threadsHeader');
  const newActionHeader = document.getElementById('newActionHeader');
  const historyToggleRow = document.getElementById('historyToggleRow');
  const studentArea = document.getElementById('studentArea');
  // Delete-by-id UI
  const deleteRowHeader = document.getElementById('deleteRowHeader');
  const deleteRowWrap   = document.getElementById('deleteRowWrap');
  const deleteRowId     = document.getElementById('deleteRowId');
  const deleteRowBtn    = document.getElementById('deleteRowBtn');

  // Previous-by-id UI
  const prevEditHeader = document.getElementById('prevEditHeader');
  const prevEditWrap   = document.getElementById('prevEditWrap');
  const prevEditRowId  = document.getElementById('prevEditRowId');
  const prevEditValue  = document.getElementById('prevEditValue');
  const prevEditBtn    = document.getElementById('prevEditBtn');

  const closeThreadDetailBtn = document.getElementById('closeThreadDetailBtn');
  const threadDetailWrap = document.getElementById('threadDetailWrap');
  const threadDetailHeader = document.getElementById('threadDetailHeader');

  // --- Snippet cache (id -> label) ---
  const snippetCache = new Map();
  async function loadSnippetsMap(ids){
    const want = Array.from(new Set((ids||[]).filter(x=>Number.isFinite(x))));
    const missing = want.filter(id => !snippetCache.has(id));
    if (missing.length === 0) return snippetCache;

    // Try bulk endpoints first; fall back to per-id. Any network error is swallowed (fail-safe)
    const qs = missing.join(',');
    const tryUrls = [
      `/snippets/bulk?ids=${encodeURIComponent(qs)}`,
      `/snippets?ids=${encodeURIComponent(qs)}`
    ];
    let got = [];
    for (const url of tryUrls){
      try{
        const r = await fetch(url);
        if (r && r.ok){ got = await r.json(); }
        if (Array.isArray(got) && got.length) break;
      }catch(_){}
    }
    if (!Array.isArray(got) || got.length === 0){
      // fallback: fetch individually
      try{
        const arr = await Promise.all(missing.map(async id=>{
          try{ const rr = await fetch(`/snippets/${id}`); if(rr.ok) return await rr.json(); }catch(_){ }
          return null;
        }));
        got = arr.filter(Boolean);
      }catch(_){ got = []; }
    }

    // normalize: expect objects with id and name/uslovie
    for(const s of got){
      if (!s) continue;
      const sid = Number(s.id ?? s.ID); if (!Number.isFinite(sid)) continue;
      const name = s.name ?? s.uslovie ?? '';
      const label = name ? name : String(sid); // show text only; fallback to id if missing
      snippetCache.set(sid, label);
    }
    // ensure at least numeric labels exist (fail-safe)
    for(const id of missing){
      if (!snippetCache.has(id)) snippetCache.set(id, String(id));
    }
    return snippetCache;
  }
  function snippetLabel(id){
    const n = Number(id);
    if (!Number.isFinite(n)) return id ?? '';
    return snippetCache.get(n) || String(n);
  }

  // --- Exercise cache (id -> tuple_key label) ---
  const exerciseCache = new Map();
  async function loadExercisesMap(ids){
    const want = Array.from(new Set((ids||[]).filter(x=>Number.isFinite(x))));
    const missing = want.filter(id => !exerciseCache.has(id));
    if (missing.length === 0) return exerciseCache;
    try{
      const qs = missing.join(',');
      const r = await fetch(`/exercises/tuple-keys?ids=${encodeURIComponent(qs)}`);
      if (r && r.ok){
        const arr = await r.json();
        if (Array.isArray(arr)){
          for(const row of arr){
            const id = Number(row.id);
            if (Number.isFinite(id)) exerciseCache.set(id, (row.tuple_key ? JSON.stringify(row.tuple_key) : String(id)));
          }
        }
      }
    }catch(_){/* fail-safe */}
    // ensure placeholders for any still-missing ids
    for(const id of missing){ if(!exerciseCache.has(id)) exerciseCache.set(id, String(id)); }
    return exerciseCache;
  }
  function exerciseLabel(id){
    const n = Number(id);
    if (!Number.isFinite(n)) return id ?? '';
    return exerciseCache.get(n) || String(n);
  }

  function fmtDDMMYY(src){
    if (!src) return '';
    const d = new Date(src);
    if (isNaN(d)) return String(src);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
  }

  function makeAssessmentEditable(td, rowObj){
    if (!td || !rowObj) return;
    td.classList.add('cell-editable');
    td.setAttribute('contenteditable','true');
    td.setAttribute('spellcheck','false');

    const cur = (rowObj.assessment == null) ? '' : String(rowObj.assessment);
    td.textContent = cur;
    td.dataset.prev = cur;

    // prevent newline
    td.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        td.blur();
      }
    });

    td.addEventListener('blur', async ()=>{
      const nextRaw = (td.textContent || '').trim();
      const prevRaw = (td.dataset.prev || '').trim();
      if (nextRaw === prevRaw) return;

      // normalize value
      let nextVal = null;
      if (nextRaw !== ''){
        const n = parseInt(nextRaw, 10);
        if (!Number.isInteger(n)){
          td.textContent = prevRaw;
          return;
        }
        nextVal = n;
      }

      // optimistic
      td.dataset.prev = nextRaw;

      try{
        const idNum = Number(rowObj.id ?? rowObj.ID);
        if (!Number.isFinite(idNum)) throw new Error('Invalid row id');

        const r = await fetch(`/student-assessment-skills-exercises/${idNum}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assessment: nextVal })
        });
        if (!r.ok) throw new Error('Save failed');

        rowObj.assessment = nextVal;
      }catch(e){
        td.textContent = prevRaw;
        td.dataset.prev = prevRaw;
        alert('Неуспешен запис на оценката.');
      }
    });
  }

  function setStudentSectionsVisible(visible){
    // Primary: toggle the whole area wrapper
    if (studentArea) studentArea.toggleAttribute('hidden', !visible);

    // Fallbacks (in case markup changes)
    if (unthreadedHeader) unthreadedHeader.toggleAttribute('hidden', !visible);
    if (threadsHeader) threadsHeader.toggleAttribute('hidden', !visible);
    if (newActionHeader) newActionHeader.toggleAttribute('hidden', !visible);
    if (meta) meta.toggleAttribute('hidden', !visible);
    const unthreadedWrap = document.getElementById('unthreadedWrap');
    const threadsWrap = document.getElementById('threadsWrap');
    const newActionForm = document.getElementById('newActionForm');
    if (unthreadedWrap) unthreadedWrap.toggleAttribute('hidden', !visible);
    if (threadsWrap) threadsWrap.toggleAttribute('hidden', !visible);
    if (newActionForm) newActionForm.toggleAttribute('hidden', !visible);
    if (deleteRowHeader) deleteRowHeader.toggleAttribute('hidden', !visible);
    if (deleteRowWrap) deleteRowWrap.toggleAttribute('hidden', !visible);
    if (prevEditHeader) prevEditHeader.toggleAttribute('hidden', !visible);
    if (prevEditWrap) prevEditWrap.toggleAttribute('hidden', !visible);
    if (historyToggleRow) historyToggleRow.toggleAttribute('hidden', !visible);
  }
// Update previous_id by row id
if (prevEditBtn){
  prevEditBtn.addEventListener('click', async ()=>{
    if(!currentStudent){ alert('Избери ученик.'); return; }

    const idNum = prevEditRowId && prevEditRowId.value ? parseInt(prevEditRowId.value, 10) : NaN;
    if(!Number.isInteger(idNum)){ alert('Въведи валидно ID на ред.'); return; }

    // Allow empty -> NULL
    const rawPrev = prevEditValue ? String(prevEditValue.value || '').trim() : '';
    let prevVal = null;
    if (rawPrev !== '') {
      const p = parseInt(rawPrev, 10);
      if (!Number.isInteger(p)) { alert('Въведи валиден Previous ID или остави празно за NULL.'); return; }
      prevVal = p;
    }

    const ok = confirm(`Записваме Previous за ред #${idNum} -> ${prevVal == null ? 'NULL' : '#'+prevVal}?`);
    if(!ok) return;

    try{
      const r = await fetch(`/student-assessment-skills-exercises/${idNum}?studentID=${encodeURIComponent(currentStudent.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previous_id: prevVal })
      });

      const data = await r.json().catch(()=> ({}));
      if(!r.ok){
        throw new Error(data && data.error ? data.error : 'Грешка при запис');
      }

      // refresh tables from server (no full reload)
      await loadHistory(currentStudent.id);

      // ако е отворена история на нишка – обнови я веднага
      if (window.ThreadHistory && window.ThreadHistory.showDetail) {
        try {
          const last = window.ThreadHistory.lastThreadId || null;
          if (last) {
            window.ThreadHistory.showDetail(last);
          }
        } catch (_) {}
      }

      // clear inputs
      if (prevEditRowId) prevEditRowId.value = '';
      if (prevEditValue) prevEditValue.value = '';

    }catch(e){
      alert('Неуспешен запис на Previous: ' + (e?.message||''));
    }
  });
}

  // Hide all student-dependent sections on initial load
  setStudentSectionsVisible(false);

  const f_triplet = document.getElementById('f_triplet');
  const f_isSnippet = document.getElementById('f_isSnippet');
  const f_component = document.getElementById('f_component');
  const f_assessment = document.getElementById('f_assessment');
  const f_thread = document.getElementById('f_thread');
  const f_thread_mode_old = document.getElementById('f_thread_mode_old');
  const f_thread_mode_new = document.getElementById('f_thread_mode_new');
  const f_thread_select = document.getElementById('f_thread_select');

  const g2_thread = document.getElementById('g2_thread');
  const g2_thread_mode_old = document.getElementById('g2_thread_mode_old');
  const g2_thread_mode_new = document.getElementById('g2_thread_mode_new');
  const g2_thread_select = document.getElementById('g2_thread_select');
  const f_followup_id = document.getElementById('f_followup_id');
  const f_followup_exp = document.getElementById('f_followup_exp');
  const saveActionBtn = document.getElementById('saveActionBtn');



  let currentStudent = null;
  // Expose selected student for the chronology UI module (vc_chronology)
  window.VC_CURRENT_STUDENT = null;

// Delete a row/component by id
if (deleteRowBtn){
  deleteRowBtn.addEventListener('click', async ()=>{
    if(!currentStudent){ alert('Избери ученик.'); return; }

    const idNum = deleteRowId && deleteRowId.value ? parseInt(deleteRowId.value, 10) : NaN;
    if(!Number.isInteger(idNum)){ alert('Въведи валидно ID.'); return; }

    const ok = confirm(`Сигурен ли си, че искаш да изтриеш ред #${idNum}? Това е необратимо.`);
    if(!ok) return;

    try{
      const r = await fetch(`/student-assessment-skills-exercises/${idNum}?studentID=${encodeURIComponent(currentStudent.id)}`, {
        method: 'DELETE'
      });

      const data = await r.json().catch(()=> ({}));
      if(!r.ok){
        throw new Error(data && data.error ? data.error : 'Грешка при изтриване');
      }

      window.location.reload();
    }catch(e){
      alert('Неуспешно изтриване: ' + (e?.message||''));
    }
  });
}

  function normalizeThreadId(v){
    if (v == null) return '';
    return String(v).trim();
  }

  function collectThreads(rows){
    const byId = new Map(); // threadID -> latestTimeStr
    for (const r of (rows || [])){
      const t = normalizeThreadId(r.threadid ?? r.threadID);
      if (!t) continue;
      const when = String(r.entrytime || r.entryTime || '');
      const prev = byId.get(t);
      if (!prev || when > prev) byId.set(t, when);
    }
    return Array.from(byId.entries())
      .map(([id, latest]) => ({ id, latest }))
      .sort((a,b) => String(b.latest).localeCompare(String(a.latest)) || a.id.localeCompare(b.id));
  }


  // индивидуално
  function setThreadMode(mode){
    const isOld = (mode === 'old');
    if (f_thread_mode_old) f_thread_mode_old.checked = isOld;
    if (f_thread_mode_new) f_thread_mode_new.checked = !isOld;

    // Dropdown removed: always type into the input
    if (f_thread) f_thread.readOnly = false;
  }

  function wireThreadPick(){
    if (f_thread_mode_old) f_thread_mode_old.addEventListener('change', ()=> setThreadMode('old'));
    if (f_thread_mode_new) f_thread_mode_new.addEventListener('change', ()=> setThreadMode('new'));
    setThreadMode('old');
  }

  // групово
  function setGroupThreadMode(mode){
    const isOld = (mode === 'old');
    if (g2_thread_mode_old) g2_thread_mode_old.checked = isOld;
    if (g2_thread_mode_new) g2_thread_mode_new.checked = !isOld;

    // Dropdown removed: always type into the input
    if (g2_thread) g2_thread.readOnly = false;
  }

  function wireGroupThreadPick(){
    if (g2_thread_mode_old) g2_thread_mode_old.addEventListener('change', ()=> setGroupThreadMode('old'));
    if (g2_thread_mode_new) g2_thread_mode_new.addEventListener('change', ()=> setGroupThreadMode('new'));
    setGroupThreadMode('old');
  }
  async function searchStudents(q){
    const r = await fetch(`/students/search?name=${encodeURIComponent(q)}`);
    if(!r.ok) return [];
    return await r.json();
  }

  function renderPicks(list){
    studentPick.innerHTML = '';
    list.forEach(s => {
      const li = document.createElement('li');
      li.textContent = `${s.First_Name || s.first_name || ''} ${s.Sirname || s.sirname || ''} (ID: ${s.ID || s.id})`;
      li.addEventListener('click', ()=> selectStudent({ id: s.ID || s.id, name: `${s.First_Name || s.first_name || ''} ${s.Sirname || s.sirname || ''}` }));
      studentPick.appendChild(li);
    });
  }

  async function selectStudent(st){
    currentStudent = st;
    window.VC_CURRENT_STUDENT = st;
    meta.textContent = `Избран ученик: ${st.name} (ID ${st.id})`;
    if (studentSearch) studentSearch.value = st.name;
    if (searchRow) searchRow.setAttribute('hidden','');
    if (studentPick) studentPick.setAttribute('hidden','');
    setStudentSectionsVisible(true);
    await loadHistory(st.id);
  }
async function loadHistory(studentID){
  historyTableBody.innerHTML = '';
  if (unthreadedBody) unthreadedBody.innerHTML = '';
  if (threadSummaryBody) threadSummaryBody.innerHTML = '';

  const r2 = await fetch(`/student-assessment-skills-exercises?studentID=${encodeURIComponent(studentID)}`);
  let rows = [];
  try{ if(r2.ok) rows = await r2.json(); }catch(e){}

  rows.sort((a,b)=> String(b.entrytime||b.entryTime||'').localeCompare(String(a.entrytime||a.entryTime||'')));
  if (window.ThreadHistory) { window.ThreadHistory.setRows(rows); }
  if (window.ThreadHistory) { try { window.ThreadHistory.init(); } catch(_){ } }
  const threads = collectThreads(rows);

  // ако има точно една нишка, авто-избери я (по желание)
  if (threads.length === 1){
    if (f_thread_mode_old && f_thread_mode_old.checked && f_thread_select){
      f_thread_select.value = threads[0].id;
      if (f_thread) f_thread.value = threads[0].id;
    }
    if (g2_thread_mode_old && g2_thread_mode_old.checked && g2_thread_select){
      g2_thread_select.value = threads[0].id;
      if (g2_thread) g2_thread.value = threads[0].id;
    }
  }

  // Prepare snippet and exercise labels for component IDs (fail-safe)
  const compIdsSnippet = rows.filter(x => (x.issnippet || x.isSnippet)).map(x=> Number(x.componentID ?? x.componentid)).filter(Number.isFinite);
  const compIdsTask    = rows.filter(x => !(x.issnippet || x.isSnippet)).map(x=> Number(x.componentID ?? x.componentid)).filter(Number.isFinite);
  await loadSnippetsMap(compIdsSnippet);
  await loadExercisesMap(compIdsTask);
  // Пълна хронология
  for(const x of rows){
    const tr = document.createElement('tr');
    const whenRaw = x.entrytime || x.entryTime || null;
    const when = whenRaw ? fmtDDMMYY(whenRaw) : '— няма дата —';
    const trip = x.lessontriplet || x.lessonTriplet || '';
    const kind = (x.issnippet || x.isSnippet) ? 'Умение' : 'Задача';
    const comp = (()=>{
      const n = Number(x.componentID ?? x.componentid);
      if (!Number.isFinite(n)) return '';
      const isSn = (x.issnippet || x.isSnippet) ? true : false;
      return isSn ? snippetLabel(n) : exerciseLabel(n);
    })();
    const ass = x.assessment ?? '';
    const note = x.comment || '';
    const thread = x.threadid ?? x.threadID ?? '';
    const fup = x.followup_id ? `← #${x.followup_id}` : '';
    tr.innerHTML = `<td>${when}</td><td>${trip}</td><td>${kind}</td><td>${comp}</td><td></td><td>${note}</td><td>${thread}</td><td>${fup}</td>`;

    // Make assessment editable (5th column)
    const assTd = tr.children[4];
    makeAssessmentEditable(assTd, x);

    historyTableBody.appendChild(tr);
  }

  // Разделяне
  const hasThread = (x) => {
    const t = (x.threadid ?? x.threadID ?? null);
    if (t === null || t === undefined) return false;
    if (typeof t === 'string' && t.trim() === '') return false;
    return true;
  };
  const unthreaded = rows.filter(x => !hasThread(x));
  const threaded   = rows.filter(x =>  hasThread(x));

  // clear selection set for unthreaded
  selectedUnthreaded.clear();
  groupMembers.clear();
  idToGroup.clear();
  groupColor.clear();
  groupColorNext = Math.floor(Math.random() * groupColorTotal);
  // Таблица „Без нишка“ — групирай root реда с неговите follow-up по веригата
  function renderUnthreadedRow(x, isChild, groupKey){
    const tr = document.createElement('tr');
    tr.className = isChild ? 'group-child' : 'group-root';

    const whenRaw = x.entrytime || x.entryTime || null;
    const when = whenRaw ? fmtDDMMYY(whenRaw) : '— няма дата —';
    const trip = (x.id ?? x.ID ?? '');
    const kind = (x.issnippet || x.isSnippet) ? 'Умение' : 'Задача';
    const comp = (()=>{
      const n = Number(x.componentID ?? x.componentid);
      if (!Number.isFinite(n)) return '';
      const isSn = (x.issnippet || x.isSnippet) ? true : false;
      return isSn ? snippetLabel(n) : exerciseLabel(n);
    })();
    const ass  = x.assessment ?? '';
    const note = x.comment || '';

    // selection checkbox
    const tdSel = document.createElement('td');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = String(x.id ?? x.ID);
    if (groupKey != null) cb.dataset.group = String(groupKey);

    const idNum = Number(cb.dataset.id);
    if (selectedUnthreaded.has(idNum)) cb.checked = true;

    cb.addEventListener('change', ()=>{
      const n  = Number(cb.dataset.id);
      if (!Number.isFinite(n)) return;
      const gk = cb.dataset.group ? Number(cb.dataset.group) : n;
      const members = groupMembers.get(gk) || [n];

      if (cb.checked){
        members.forEach(mid => selectedUnthreaded.add(mid));
      } else {
        members.forEach(mid => selectedUnthreaded.delete(mid));
      }

      // визуално синхронизиране на всички чекове в групата
      document
        .querySelectorAll('input[type="checkbox"][data-group="'+String(gk)+'"]')
        .forEach(inp => { inp.checked = cb.checked; });
    });
    tdSel.appendChild(cb);

    function td(text){ const td = document.createElement('td'); td.textContent = text; return td; }

    tr.appendChild(tdSel);
    tr.appendChild(td(when));     // Дата (ще получи стрелка чрез CSS при child)
    tr.appendChild(td(trip));      // Умение ID (всъщност показваме id на реда за ориентация)
    tr.appendChild(td(kind));
    tr.appendChild(td(comp));
    tr.appendChild(td(ass));
    tr.appendChild(td(note));

    unthreadedBody && unthreadedBody.appendChild(tr);
  }

// Построй map на редовете без нишка
const unMap = new Map();        // id -> row
const pointed = new Set();      // id-та, към които някой сочи с followup_id
for (const r of unthreaded) {
  const id = Number(r.id ?? r.ID);
  if (Number.isFinite(id)) unMap.set(id, r);
  const fid = Number(r.followup_id);
  if (Number.isFinite(fid)) pointed.add(fid);
}

const visited = new Set();
// Helpers for group selection UI (partial selection support)
function groupMembersList(gKey){
  return groupMembers.get(gKey) || [gKey];
}
function updateGroupCheckboxUI(gKey){
  const members = groupMembersList(gKey);
  const total = members.length;
  let sel = 0;
  members.forEach(id => { if (selectedUnthreaded.has(id)) sel++; });
  const rootCb = document.querySelector('input[type="checkbox"][data-group="'+String(gKey)+'"][data-role="root"]');
  if (rootCb){
    rootCb.indeterminate = (sel > 0 && sel < total);
    rootCb.checked = (sel === total);
  }
}
// помощна функция за рендериране
  function renderUnRow(row, isChild, groupKey, hasChildren) {
    const tr = document.createElement('tr');
    const cn = isChild ? 'group-child' : (hasChildren ? 'group-root has-children' : 'group-root');
    tr.className = cn;

    // Color ONLY if this root truly represents a multi-row group (root + at least one follow-up)
    if (Number.isFinite(Number(groupKey))) {
      const root = Number(groupKey);
      const members = groupMembers.get(root);
      if (Array.isArray(members) && members.length > 1) {
        if (!groupColor.has(root)) {
          // Step to the next palette color ensuring consecutive groups differ
          groupColorNext = (groupColorNext + 1) % groupColorTotal;
          groupColor.set(root, groupColorNext);
        }
        const ci = groupColor.get(root);
        tr.classList.add('gc' + String(ci));
      }
      // else: single-row group -> no color (transparent/white)
    }

    const whenRaw = row.entrytime || row.entryTime || null;
    const when = whenRaw ? fmtDDMMYY(whenRaw) : '— няма дата —';
    const kind = (row.issnippet || row.isSnippet) ? 'Умение' : 'Задача';
    const comp = (() => {
      const n = Number(row.componentID ?? row.componentid);
      if (!Number.isFinite(n)) return '';
      return (row.issnippet || row.isSnippet) ? snippetLabel(n) : exerciseLabel(n);
    })();

    const tdSel = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = String(row.id ?? row.ID);
    const gk = Number.isFinite(Number(groupKey)) ? Number(groupKey) : Number(cb.dataset.id);
    cb.dataset.group = String(gk);
    // role: root toggles whole group, child toggles only itself
    cb.dataset.role = isChild ? 'child' : 'root';

    const idNum = Number(cb.dataset.id);
    if (selectedUnthreaded.has(idNum)) cb.checked = true;

    cb.addEventListener('change', () => {
      const gKey = Number(cb.dataset.group);
      const members = groupMembersList(gKey);
      const thisId = Number(cb.dataset.id);
      const isRoot = (cb.dataset.role === 'root');

      if (isRoot){
        // Root toggles entire group
        if (cb.checked){ members.forEach(mid => selectedUnthreaded.add(mid)); }
        else { members.forEach(mid => selectedUnthreaded.delete(mid)); }
        // Sync all checkboxes in group and reset root indeterminate
        document.querySelectorAll('input[type="checkbox"][data-group="'+String(gKey)+'"]').forEach(inp => {
          const idNum = Number(inp.dataset.id);
          const checked = selectedUnthreaded.has(idNum);
          inp.checked = checked;
          if (inp.dataset.role === 'root'){ inp.indeterminate = false; }
        });
      } else {
        // Child toggles only itself
        if (cb.checked) selectedUnthreaded.add(thisId); else selectedUnthreaded.delete(thisId);
        cb.checked = selectedUnthreaded.has(thisId);
      }
      // Update the root checkbox UI to show partial selection if needed
      updateGroupCheckboxUI(gKey);
    });
    tdSel.appendChild(cb);

    function td(text){ const el = document.createElement('td'); el.textContent = text; return el; }

    tr.appendChild(tdSel);
    tr.appendChild(td(when));
    tr.appendChild(td(String(row.id ?? row.ID ?? ''))); // визуално „Умение ID“ – реално id на реда
    tr.appendChild(td(kind));
    tr.appendChild(td(comp));
    const assTd = td(row.assessment ?? '');
    tr.appendChild(assTd);
    makeAssessmentEditable(assTd, row);
    tr.appendChild(td(row.comment || ''));

    unthreadedBody && unthreadedBody.appendChild(tr);
  }

// 1) корени: записи, към които никой не сочи
for (const r of unthreaded) {
  const id = Number(r.id ?? r.ID);
  if (!Number.isFinite(id) || visited.has(id)) continue;
  if (pointed.has(id)) continue; // не е root

  // веригата r -> r.followup_id -> ...
  const group = [];
  let cur = r;
  while (cur) {
    const curId = Number(cur.id ?? cur.ID);
    if (!Number.isFinite(curId) || visited.has(curId)) break;
    group.push(cur);
    visited.add(curId);
    const nextId = Number(cur.followup_id);
    cur = (Number.isFinite(nextId) && unMap.has(nextId)) ? unMap.get(nextId) : null;
  }

  if (group.length) {
    const rootId = Number(group[0].id ?? group[0].ID);
    const ids = group.map(x => Number(x.id ?? x.ID)).filter(Number.isFinite);
    groupMembers.set(rootId, ids);
    ids.forEach(mid => idToGroup.set(mid, rootId));

    renderUnRow(group[0], false, rootId, group.length > 1);
    for (let i = 1; i < group.length; i++) renderUnRow(group[i], true, rootId, true);
  }
}

// 2) останали единични
for (const [id, row] of unMap.entries()) {
  if (!visited.has(id)) {
    groupMembers.set(id, [id]);
    idToGroup.set(id, id);
    renderUnRow(row, false, id, false);
  }
}
// Initialize root checkbox UI (checked/indeterminate) per group
for (const rootId of groupMembers.keys()){
  updateGroupCheckboxUI(rootId);
}
  // Обобщена таблица за нишки — делегирано към ThreadHistory
  if (window.ThreadHistory) {
    window.ThreadHistory.renderSummary();
  }
}


  // Helper to run a search and (re)show the UI block
  async function runStudentSearch(){
    if (searchRow) searchRow.removeAttribute('hidden');
    if (studentPick) studentPick.removeAttribute('hidden');
    if (studentSearch) studentSearch.disabled = false;

    const q = studentSearch.value.trim();
    if(!q){ studentPick.innerHTML=''; return; }
    const list = await searchStudents(q);
    renderPicks(list);
  }

  // Click on the search button
  findStudentBtn.addEventListener('click', async (e)=>{
    e.preventDefault();
    runStudentSearch();
  });

  // Pressing Enter in the input triggers search
  studentSearch.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){
      e.preventDefault();
      runStudentSearch();
    }
  });
  // Auto-restore last selected student after a page reload (e.g., after saving a new action)
  (async function restoreLastStudent(){
    try {
      const raw = localStorage.getItem('vc_last_student');
      if (!raw) return;
      const obj = JSON.parse(raw);
      const id = obj && obj.id != null ? parseInt(obj.id, 10) : null;
      const name = obj && typeof obj.name === 'string' ? obj.name : '';
      if (!Number.isInteger(id)) return;

      await selectStudent({ id, name: name || String(id) });
    } catch(_) {}
  })();
  
  saveActionBtn.addEventListener('click', async ()=>{
    if(!currentStudent){ alert('Избери ученик.'); return; }
    const row = {
      lessonTriplet: f_triplet.value.trim(),
      isSnippet: !!f_isSnippet.checked,
      componentID: f_component.value ? parseInt(f_component.value,10) : null,
      assessment: f_assessment.value ? parseInt(f_assessment.value,10) : null,
      comment: '',
      studentID: currentStudent.id,
      threadID: (f_thread.value && f_thread.value.trim()) ? f_thread.value.trim() : null,
      followup_id: f_followup_id.value ? parseInt(f_followup_id.value,10) : null,
      followup_exp: f_followup_exp.value.trim()
    };
    // Delete a row/component by id
    if (deleteRowBtn){
      deleteRowBtn.addEventListener('click', async ()=>{
        if(!currentStudent){ alert('Избери ученик.'); return; }

        const idNum = deleteRowId && deleteRowId.value ? parseInt(deleteRowId.value, 10) : NaN;
        if(!Number.isInteger(idNum)){ alert('Въведи валидно ID.'); return; }

        const ok = confirm(`Сигурен ли си, че искаш да изтриеш ред #${idNum}? Това е необратимо.`);
        if(!ok) return;

        try{
          const r = await fetch(`/student-assessment-skills-exercises/${idNum}?studentID=${encodeURIComponent(currentStudent.id)}`, {
            method: 'DELETE'
          });
          const data = await r.json().catch(()=> ({}));
          if(!r.ok){
            throw new Error(data && data.error ? data.error : 'Грешка при изтриване');
          }

          // Keep selected student after refresh
          try {
            localStorage.setItem('vc_last_student', JSON.stringify({
              id: currentStudent.id,
              name: currentStudent.name || (studentSearch ? studentSearch.value.trim() : '') || ''
            }));
          } catch(_){}

          window.location.reload();
        }catch(e){
          alert('Неуспешно изтриване: ' + (e?.message||''));
        }
      });
    }

    const r = await fetch('/student-assessment-skills-exercises',{
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rows:[row] })
    });
      if (r.ok){
      // Запази текущия ученик за автоматично възстановяване след refresh
      try {
        if (currentStudent && currentStudent.id) {
          localStorage.setItem('vc_last_student', JSON.stringify({
            id: currentStudent.id,
            name: currentStudent.name || (studentSearch ? studentSearch.value.trim() : '') || ''
          }));
        }
      } catch(_) {}

      // Най-сигурно: пълен refresh + нов GET
      window.location.reload();
    } else {
      alert('Грешка при запис.');
    }
  });

  if (toggleHistoryBtn && resultsWrap){
    toggleHistoryBtn.addEventListener('click', ()=>{
      const isHidden = resultsWrap.hasAttribute('hidden');
      if (isHidden){
        resultsWrap.removeAttribute('hidden');
        toggleHistoryBtn.textContent = 'Скрий хронология';
      } else {
        resultsWrap.setAttribute('hidden','');
        toggleHistoryBtn.textContent = 'Покажи хронология';
      }
    });
  }

  if (closeThreadDetailBtn && threadDetailWrap && threadDetailHeader){
    closeThreadDetailBtn.addEventListener('click', ()=>{
      threadDetailWrap.setAttribute('hidden','');
      threadDetailHeader.setAttribute('hidden','');
    });
  }

  if (makeThreadBtn){
  makeThreadBtn.addEventListener('click', async ()=>{
    if(!currentStudent){ alert('Избери ученик.'); return; }
    const ids = Array.from(selectedUnthreaded);
    if(ids.length === 0){ alert('Маркирай един или повече реда.'); return; }

    // Text input: empty => NEW thread, non-empty => EXISTING thread
    const threadID = (mergeThreadId && mergeThreadId.value)
      ? String(mergeThreadId.value).trim()
      : '';

    try{
      const r = await fetch('/threads/create', {
        method: 'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          studentID: currentStudent.id,
          baseIds: ids,
          threadID: threadID ? threadID : null
        })
      });

      const data = await r.json().catch(()=> ({}));
      if(!r.ok){
        throw new Error(data && data.error ? data.error : 'Грешка при обединяване в нишка');
      }

      // Keep selected student after refresh
      try {
        localStorage.setItem('vc_last_student', JSON.stringify({
          id: currentStudent.id,
          name: currentStudent.name || (studentSearch ? studentSearch.value.trim() : '') || ''
        }));
      } catch(_){}

      window.location.reload();
    }catch(e){
      alert('Неуспешно обединяване: ' + (e?.message||''));
    }
  });
}
  wireThreadPick();
  wireGroupThreadPick();
})();
