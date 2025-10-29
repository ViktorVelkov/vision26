(function(){
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

  const unthreadedHeader = document.getElementById('unthreadedHeader');
  const threadsHeader = document.getElementById('threadsHeader');
  const newActionHeader = document.getElementById('newActionHeader');
  const historyToggleRow = document.getElementById('historyToggleRow');
  const studentArea = document.getElementById('studentArea');

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
    if (historyToggleRow) historyToggleRow.toggleAttribute('hidden', !visible);
  }

  // Hide all student-dependent sections on initial load
  setStudentSectionsVisible(false);

  const f_triplet = document.getElementById('f_triplet');
  const f_isSnippet = document.getElementById('f_isSnippet');
  const f_component = document.getElementById('f_component');
  const f_assessment = document.getElementById('f_assessment');
  const f_thread = document.getElementById('f_thread');
  const f_followup_id = document.getElementById('f_followup_id');
  const f_followup_exp = document.getElementById('f_followup_exp');
  const saveActionBtn = document.getElementById('saveActionBtn');

  let currentStudent = null;

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
  // Prepare snippet and exercise labels for component IDs (fail-safe)
  const compIdsSnippet = rows.filter(x => (x.issnippet || x.isSnippet)).map(x=> Number(x.componentID ?? x.componentid)).filter(Number.isFinite);
  const compIdsTask    = rows.filter(x => !(x.issnippet || x.isSnippet)).map(x=> Number(x.componentID ?? x.componentid)).filter(Number.isFinite);
  await loadSnippetsMap(compIdsSnippet);
  await loadExercisesMap(compIdsTask);
  // Пълна хронология
  for(const x of rows){
    const tr = document.createElement('tr');
    const when = fmtDDMMYY(x.entrytime || x.entryTime || '');
    const trip = x.lessontriplet || x.lessonTriplet || '';
    const kind = (x.issnippet || x.isSnippet) ? 'Snippet' : 'Task';
    const comp = (()=>{
      const n = Number(x.componentID ?? x.componentid);
      if (!Number.isFinite(n)) return '';
      const isSn = (x.issnippet || x.isSnippet) ? true : false;
      return isSn ? snippetLabel(n) : exerciseLabel(n);
    })();
    const ass = x.assessment ?? '';
    const note = x.comment || '';
    const thread = x.threadid ?? x.threadID ?? '';
    const fup = x.followup_id ? `#${x.followup_id}` : '';
    tr.innerHTML = `<td>${when}</td><td>${trip}</td><td>${kind}</td><td>${comp}</td><td>${ass}</td><td>${note}</td><td>${thread}</td><td>${fup}</td>`;
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

  // Таблица „Без нишка“
  for(const x of unthreaded){
    const tr = document.createElement('tr');
    const when = fmtDDMMYY(x.entrytime || x.entryTime || '');
    const trip = (x.id ?? x.ID ?? '');
    const kind = (x.issnippet || x.isSnippet) ? 'Умение' : 'Задача';
    const comp = (()=>{
      const n = Number(x.componentID ?? x.componentid);
      if (!Number.isFinite(n)) return '';
      const isSn = (x.issnippet || x.isSnippet) ? true : false;
      return isSn ? snippetLabel(n) : exerciseLabel(n);
    })();
    const ass = x.assessment ?? '';
    const note = x.comment || '';

    // selection checkbox
    const tdSel = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = String(x.id ?? x.ID);
    // Set checked if already selected
    const idNum = Number(cb.dataset.id);
    if (selectedUnthreaded.has(idNum)) cb.checked = true;
    cb.addEventListener('change', (e)=>{
      const idNum = Number(cb.dataset.id);
      if (!Number.isFinite(idNum)) return;
      if (cb.checked) selectedUnthreaded.add(idNum); else selectedUnthreaded.delete(idNum);
    });
    tdSel.appendChild(cb);

    // Helper to create td with text
    function td(text){
      const td = document.createElement('td');
      td.textContent = text;
      return td;
    }
    tr.appendChild(tdSel);
    tr.appendChild(td(when));
    tr.appendChild(td(trip));
    tr.appendChild(td(kind));
    tr.appendChild(td(comp));
    tr.appendChild(td(ass));
    tr.appendChild(td(note));
    unthreadedBody && unthreadedBody.appendChild(tr);
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

    const r = await fetch('/student-assessment-skills-exercises',{
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rows:[row] })
    });
    if(r.ok){
      // clear minimal fields and reload history
      f_component.value=''; f_assessment.value=''; f_followup_id.value=''; f_followup_exp.value='';
      await loadHistory(currentStudent.id);
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
      // optional: confirm
      try{
        const r = await fetch('/threads/create', {
          method: 'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ studentID: currentStudent.id, baseIds: ids })
        });
        const data = await r.json();
        if(!r.ok){ throw new Error(data && data.error ? data.error : 'Грешка при създаване на нишка'); }
        // refresh
        await loadHistory(currentStudent.id);
      }catch(e){
        alert('Неуспешно обединяване: ' + (e?.message||''));
      }
    });
  }
})();
