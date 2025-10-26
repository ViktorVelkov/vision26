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

  const unthreadedHeader = document.getElementById('unthreadedHeader');
  const threadsHeader = document.getElementById('threadsHeader');
  const newActionHeader = document.getElementById('newActionHeader');
  const historyToggleRow = document.getElementById('historyToggleRow');
  const studentArea = document.getElementById('studentArea');

  const closeThreadDetailBtn = document.getElementById('closeThreadDetailBtn');
  const threadDetailWrap = document.getElementById('threadDetailWrap');
  const threadDetailHeader = document.getElementById('threadDetailHeader');

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
  // Пълна хронология
  for(const x of rows){
    const tr = document.createElement('tr');
    const when = fmtDDMMYY(x.entrytime || x.entryTime || '');
    const trip = x.lessontriplet || x.lessonTriplet || '';
    const kind = (x.issnippet || x.isSnippet) ? 'Snippet' : 'Task';
    const comp = x.componentid ?? x.componentID ?? '';
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

  // Таблица „Без нишка“
  for(const x of unthreaded){
    const tr = document.createElement('tr');
    const when = fmtDDMMYY(x.entrytime || x.entryTime || '');
    const trip = x.lessontriplet || x.lessonTriplet || '';
    const kind = (x.issnippet || x.isSnippet) ? 'Snippet' : 'Task';
    const comp = x.componentid ?? x.componentID ?? '';
    const ass = x.assessment ?? '';
    const note = x.comment || '';
    tr.innerHTML = `<td>${when}</td><td>${trip}</td><td>${kind}</td><td>${comp}</td><td>${ass}</td><td>${note}</td>`;
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
})();
