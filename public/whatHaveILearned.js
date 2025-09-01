(function(){
  const selectEl = document.getElementById('classesSelect');
  const statusEl = document.getElementById('status');

  async function loadClasses(){
    try {
      statusEl.textContent = 'Зареждане на класове…';
      selectEl.innerHTML = '<option value="">Зареждане…</option>';
      selectEl.disabled = true;

      const res = await fetch('/classes');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const classes = await res.json(); // ["11 А", "11 Б", ...]

      // Populate
      selectEl.innerHTML = '<option value="">— Избери клас —</option>';
      for (const c of classes){
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        selectEl.appendChild(opt);
      }
      selectEl.disabled = false;
      statusEl.textContent = `Налични класове: ${classes.length}`;
      setSearchEnabled(true);
    } catch(err){
      console.error('loadClasses failed:', err);
      statusEl.textContent = 'Грешка при зареждане на класове.';
      selectEl.innerHTML = '<option value="">Грешка</option>';
      selectEl.disabled = true;
    }
  }

  // When user picks a class
  selectEl.addEventListener('change', () => {
    const val = selectEl.value;
    if (!val){
      statusEl.textContent = 'Моля, изберете клас.';
      return;
    }
    statusEl.textContent = `Избран клас: ${val}`;
    draftRow = null;
    // Тук може да извикаш други API-та, напр. /students?className=... 
    // fetch(`/students?className=${encodeURIComponent(val)}`) ...
  });

  document.addEventListener('DOMContentLoaded', loadClasses);

  // --- Search and results table logic ---
  const searchBtn = document.getElementById('searchLessonsBtn');
  const resultsTable = document.getElementById('lessonsTakenTable');
  const resultsBody = resultsTable.querySelector('tbody');
  const resultsWrap = document.getElementById('lessonsTakenWrap');
  const addBtn = document.getElementById('addLessonRowBtn');
  
  const toggleLogBtn = document.getElementById('toggleLogBtn');
  const logPanel = document.getElementById('logPanel');
  const closeLogBtn = document.getElementById('closeLogBtn');
  const logTbody = document.getElementById('logTbody');
  const logFilters = document.getElementById('logFilters');

  if (toggleLogBtn){
    toggleLogBtn.addEventListener('click', async ()=>{
      if (logPanel && logPanel.hasAttribute('hidden')) {
        await loadAssessmentLog();
        logPanel.removeAttribute('hidden');
      } else if (logPanel) {
        logPanel.setAttribute('hidden','');
      }
    });
  }
  if (closeLogBtn){
    closeLogBtn.addEventListener('click', ()=> logPanel && logPanel.setAttribute('hidden',''));
  }
  
  const yearPlanWrap = document.getElementById('yearPlanWrap');
  const addSkillBtn = document.getElementById('addSkillRowBtn');
  const openAssessBtn = document.getElementById('openAssessBtn');
  let currentSkillsTriplet = null; // remembers which triplet is loaded
  let currentLessonName = null; // remembers current lesson name
  const yearPlanTable = document.getElementById('yearPlanTable');
  const yearPlanBody = yearPlanTable ? yearPlanTable.querySelector('tbody') : null;

  const flash = (el, ok=true) => {
    el.classList.remove('flash-success','flash-error');
    void el.offsetWidth;
    el.classList.add(ok?'flash-success':'flash-error');
  };

  function setSearchEnabled(enabled){
    if (searchBtn) searchBtn.disabled = !enabled;
    // Add button remains enabled so user can add even with 0 results
  }
function renderLogRows(rows){
  if (!logTbody) return;
  logTbody.innerHTML = '';
  if (!Array.isArray(rows) || rows.length === 0){
    logTbody.innerHTML = '<tr><td colspan="4" class="muted">Няма записи</td></tr>';
    return;
  }
  for (const r of rows){
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td'); tdTime.textContent = r.timedat || r.timed_at || r.timedAt || '';
    const tdClass = document.createElement('td'); tdClass.textContent = r.class ?? '';
    const tdDiv   = document.createElement('td'); tdDiv.textContent   = r.class_division ?? '';
    const tdTrip  = document.createElement('td'); tdTrip.textContent  = r.lesson_tripplet ?? '';
    tr.append(tdTime, tdClass, tdDiv, tdTrip);
    logTbody.appendChild(tr);
  }
}

  async function loadAssessmentLog(){
    if (!logPanel) return;
    const cls = selectEl ? selectEl.value : '';
    const trip = currentSkillsTriplet || '';
    if (logFilters) logFilters.textContent = [cls||null, trip?`Triplet ${trip}`:null].filter(Boolean).join(' • ');
    const qs = new URLSearchParams();
    if (cls) qs.set('className', cls);
    if (trip) qs.set('triplet', trip);
    try{
      const r = await fetch('/assessment-log' + (qs.toString()?`?${qs.toString()}`:''));
      if (!r.ok) throw new Error('HTTP '+r.status);
      const rows = await r.json();
      renderLogRows(rows);
    }catch(e){ console.error('loadAssessmentLog failed:', e); renderLogRows([]); }
  }
    // Enable search when classes are loaded
    const origLoadClasses = loadClasses;
    loadClasses = async function(){
      await origLoadClasses();
      setSearchEnabled(!selectEl.disabled);
    };

  async function loadYearPlan(cls){
    if (!yearPlanWrap || !yearPlanBody) return;
    yearPlanBody.innerHTML = '';
    yearPlanWrap.hidden = true;
    try {
      const resp = await fetch(`/generatedyearplan?className=${encodeURIComponent(cls)}`);
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      const data = await resp.json();

      for (const r of data){
        const tr = document.createElement('tr');

        // Date
        const tdDate = document.createElement('td');
        const renderDate = (initial) => {
          const inp = document.createElement('input');
          inp.type = 'date';
          if (initial) inp.value = initial;
          inp.addEventListener('change', async () => {
            const v = inp.value; if (!v) return;
            try {
              const res = await fetch(`/generatedyearplan/${encodeURIComponent(r.id)}`, {
                method: 'PATCH', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ date: v })
              });
              if (!res.ok) throw new Error('HTTP '+res.status);
              await res.json(); r.date = v; tdDate.textContent = v; flash(tdDate,true);
            } catch(e){ console.error(e); flash(tdDate,false); }
          });
          return inp;
        };
        if (!r.date){ tdDate.appendChild(renderDate('')); }
        else { tdDate.textContent = r.date; tdDate.title = 'Double-click to edit'; tdDate.addEventListener('dblclick', () => { tdDate.innerHTML=''; tdDate.appendChild(renderDate(r.date)); }); }

        // Generic editable helper
        const editable = (text, field) => {
          const td = document.createElement('td');
          td.contentEditable = 'true';
          td.textContent = text ?? '';
          td.addEventListener('keydown', ev => { if (ev.key==='Enter'){ ev.preventDefault(); td.blur(); }});
          td.addEventListener('blur', async () => {
            const v = td.textContent.trim();
            if ((text ?? '') === v) return;
            try{
              const body = {}; body[field] = v;
              const res = await fetch(`/generatedyearplan/${encodeURIComponent(r.id)}`, {
                method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
              });
              if (!res.ok) throw new Error('HTTP '+res.status);
              await res.json(); flash(td,true); text = v; r[field] = v;
            }catch(e){ console.error(e); flash(td,false); }
          });
          return td;
        };

        const tdWeekday  = editable(r.weekday,   'weekday');
        const tdUnit     = editable(r.unit,      'unit');
        const tdUnitType = editable(r.unitetype, 'unitetype');

        const tdCreated = document.createElement('td');
        tdCreated.contentEditable = 'true';
        tdCreated.textContent = (r.lessonCreated===true||r.lessonCreated==='true'||r.lessonCreated==='1') ? 'true' : (r.lessonCreated??'');
        tdCreated.addEventListener('keydown', ev => { if (ev.key==='Enter'){ ev.preventDefault(); tdCreated.blur(); }});
        tdCreated.addEventListener('blur', async () => {
          let v = tdCreated.textContent.trim().toLowerCase();
          if (v==='1') v='true'; if (v==='0') v='false';
          try{
            const res = await fetch(`/generatedyearplan/${encodeURIComponent(r.id)}`, {
              method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ lessonCreated: v })
            });
            if (!res.ok) throw new Error('HTTP '+res.status);
            await res.json(); flash(tdCreated,true);
          }catch(e){ console.error(e); flash(tdCreated,false); }
        });

        const tdCode = editable(r.lessonCode, 'lessonCode');

        tr.append(tdDate, tdWeekday, tdUnit, tdUnitType, tdCreated, tdCode);
        yearPlanBody.appendChild(tr);
      }
      yearPlanWrap.hidden = data.length === 0;
    } catch(e){
      console.error('loadYearPlan failed:', e);
      yearPlanWrap.hidden = true;
    }
  }


let draftRow = null;

function createDraftRow(currentClass){
  if (draftRow && !document.body.contains(draftRow)) {
    draftRow = null;
  }
  if (draftRow) return; // prevent multiple drafts

  draftRow = document.createElement('tr');

  const tdId = document.createElement('td'); tdId.textContent = '—'; tdId.classList.add('muted');
  const tdClass = document.createElement('td'); tdClass.textContent = currentClass || ''; tdClass.classList.add('muted');

  const tdName = document.createElement('td');
  const inName = document.createElement('input'); inName.type = 'text'; inName.placeholder = 'Име'; tdName.appendChild(inName);

  const tdDate = document.createElement('td');
  const inDate = document.createElement('input'); inDate.type = 'date'; tdDate.appendChild(inDate);

  const tdAssoc = document.createElement('td');
  const inAssoc = document.createElement('input'); inAssoc.type = 'text'; inAssoc.placeholder = 'Свързан урок'; tdAssoc.appendChild(inAssoc);

  // Actions (Save/Cancel) row below the draft for clarity
  const actionsRow = document.createElement('tr');
  const actionsCell = document.createElement('td'); actionsCell.colSpan = 5;
  const wrap = document.createElement('div'); wrap.className = 'row-actions';
  const btnSave = document.createElement('button'); btnSave.textContent = 'Запази';
  const btnCancel = document.createElement('button'); btnCancel.textContent = 'Откажи';
  wrap.append(btnSave, btnCancel);
  actionsCell.appendChild(wrap);
  actionsRow.appendChild(actionsCell);

  draftRow.append(tdId, tdClass, tdName, tdDate, tdAssoc);

  // Place at top of table
  resultsBody.prepend(actionsRow);
  resultsBody.prepend(draftRow);

  btnCancel.addEventListener('click', () => {
    actionsRow.remove(); draftRow.remove(); draftRow = null;
  });

  btnSave.addEventListener('click', async () => {
    const cls = currentClass;
    if (!cls){ statusEl.textContent = 'Моля, изберете клас.'; return; }
    const payload = {
      class: cls,
      name: inName.value.trim() || null,
      date: inDate.value || null,
      associatedLesson: inAssoc.value.trim() || null
    };
    try {
      const res = await fetch('/lessons-taken', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();

      // remove draft rows
      actionsRow.remove();
      draftRow.remove();
      draftRow = null;

      // add the created row as live editable
      const r = j.row;
      const tr = document.createElement('tr');
      const tdId2 = document.createElement('td'); tdId2.textContent = r.id ?? '';
      const tdClass2 = document.createElement('td'); tdClass2.textContent = r.class ?? '';

      const tdName2 = document.createElement('td'); tdName2.contentEditable = 'true'; tdName2.textContent = r.name ?? '';
      tdName2.addEventListener('keydown', (ev) => { if (ev.key === 'Enter'){ ev.preventDefault(); tdName2.blur(); }});
      tdName2.addEventListener('blur', async () => {
        const v = tdName2.textContent.trim();
        if ((r.name ?? '') !== v){
          try{
            const u = await fetch(`/lessons-taken/${encodeURIComponent(r.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: v }) });
            if (!u.ok) throw new Error('HTTP '+u.status);
            await u.json(); r.name = v; flash(tdName2,true);
          }catch(e){ console.error(e); flash(tdName2,false); }
        }
      });

      const tdDate2 = document.createElement('td');
      const renderDateEditor2 = (initial) => {
        const inp = document.createElement('input'); inp.type = 'date'; if (initial) inp.value = initial;
        inp.addEventListener('change', async () => {
          const v = inp.value; if (!v) return;
          try{
            const u = await fetch(`/lessons-taken/${encodeURIComponent(r.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date: v }) });
            if (!u.ok) throw new Error('HTTP '+u.status);
            await u.json(); r.date = v; tdDate2.textContent = v; flash(tdDate2,true);
          }catch(e){ console.error(e); flash(tdDate2,false); }
        });
        return inp;
      };
      if (!r.date) { tdDate2.appendChild(renderDateEditor2('')); }
      else { tdDate2.textContent = r.date; tdDate2.title = 'Double-click to edit date'; tdDate2.addEventListener('dblclick', () => { tdDate2.innerHTML=''; tdDate2.appendChild(renderDateEditor2(r.date)); }); }

      const tdAssoc2 = document.createElement('td'); tdAssoc2.contentEditable = 'true'; tdAssoc2.textContent = r.associatedLesson ?? '';
      tdAssoc2.addEventListener('keydown', (ev) => { if (ev.key === 'Enter'){ ev.preventDefault(); tdAssoc2.blur(); }});
      tdAssoc2.addEventListener('blur', async () => {
        const v = tdAssoc2.textContent.trim();
        if ((r.associatedLesson ?? '') !== v){
          try{
            const u = await fetch(`/lessons-taken/${encodeURIComponent(r.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ associatedLesson: v }) });
            if (!u.ok) throw new Error('HTTP '+u.status);
            await u.json(); r.associatedLesson = v; flash(tdAssoc2,true);
            if (v) { currentLessonName = (r.name || '').trim() || currentLessonName; loadLessonSkills(v); }
          }catch(e){ console.error(e); flash(tdAssoc2,false); }        
        }
      });
      tdAssoc2.addEventListener('click', () => {
        const v = tdAssoc2.textContent.trim();
        if (v) { currentLessonName = (r.name || '').trim() || currentLessonName; loadLessonSkills(v); }
      });

      tr.append(tdId2, tdClass2, tdName2, tdDate2, tdAssoc2);
      resultsBody.prepend(tr);
      flash(tdId2,true);
      if (r.associatedLesson) {
        currentLessonName = (r.name || '').trim() || currentLessonName;
        loadLessonSkills(r.associatedLesson);
      }
    } catch (e) {
      console.error('Create lessons_taken failed:', e);
      alert('Неуспешно добавяне.');
    }
  });
}

if (addBtn){
  addBtn.addEventListener('click', () => {
    const cls = selectEl.value;
    if (!cls){ statusEl.textContent = 'Моля, изберете клас.'; return; }
    if (resultsWrap.hidden) { resultsWrap.hidden = false; }
    if (!resultsBody) return;
    createDraftRow(cls);
  });
}

  searchBtn.addEventListener('click', async () => {
    const cls = selectEl.value;
    if (!cls) {
      statusEl.textContent = 'Моля, изберете клас.';
      return;
    }
    try {
      // reset any stale draft row when a new search/class load happens
      draftRow = null;
      statusEl.textContent = 'Търсене…';
      resultsBody.innerHTML = '';
      resultsWrap.hidden = true;

      const res = await fetch(`/lessons-taken?className=${encodeURIComponent(cls)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();

      for (const r of rows){
        const tr = document.createElement('tr');
        const tdId = document.createElement('td'); tdId.textContent = r.id ?? '';
        const tdClass = document.createElement('td'); tdClass.textContent = r.class ?? '';

        // Helper to flash a cell with success/error animation
        const flashCell = (el, ok = true) => {
          el.classList.remove('flash-success', 'flash-error');
          void el.offsetWidth; // force reflow to restart animation
          el.classList.add(ok ? 'flash-success' : 'flash-error');
        };

        // Helper to save a single field via PATCH and flash result
        const saveField = async (rowId, field, value, cellEl) => {
          try {
            cellEl.classList.remove('error');
            const resUpd = await fetch(`/lessons-taken/${encodeURIComponent(rowId)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [field]: value })
            });
            if (!resUpd.ok) throw new Error('HTTP ' + resUpd.status);
            await resUpd.json();
            flashCell(cellEl, true);
          } catch (e) {
            console.error('Save failed:', e);
            flashCell(cellEl, false);
          }
        };

        // Name: contenteditable live
        const tdName = document.createElement('td');
        tdName.contentEditable = 'true';
        tdName.textContent = r.name ?? '';
        tdName.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); tdName.blur(); }
        });
        tdName.addEventListener('blur', () => {
          const v = tdName.textContent.trim();
          if ((r.name ?? '') !== v) {
            saveField(r.id, 'name', v, tdName);
            r.name = v;
          }
        });

        // Date: input type=date if empty, else contenteditable text which on double-click toggles to date input
        const tdDate = document.createElement('td');
        const renderDateEditor = (initial) => {
          const inp = document.createElement('input');
          inp.type = 'date';
          if (initial) inp.value = initial;
          inp.addEventListener('change', () => {
            const v = inp.value;
            if (!v) return;
            saveField(r.id, 'date', v, tdDate);
            r.date = v;
            tdDate.textContent = v;
            tdDate.classList.remove('muted');
            flashCell(tdDate, true);
          });
          return inp;
        };
        if (!r.date) {
          tdDate.appendChild(renderDateEditor(''));
        } else {
          tdDate.textContent = r.date;
          tdDate.title = 'Double-click to edit date';
          tdDate.addEventListener('dblclick', () => {
            tdDate.innerHTML = '';
            tdDate.appendChild(renderDateEditor(r.date));
          });
        }

        // Associated lesson: contenteditable live
        const tdAssoc = document.createElement('td');
        tdAssoc.contentEditable = 'true';
        tdAssoc.textContent = r.associatedLesson ?? '';
        tdAssoc.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); tdAssoc.blur(); }
        });
        tdAssoc.addEventListener('blur', () => {
          const v = tdAssoc.textContent.trim();
          if ((r.associatedLesson ?? '') !== v) {
            saveField(r.id, 'associatedLesson', v, tdAssoc);
            r.associatedLesson = v;
            if (v) { currentLessonName = (r.name || '').trim() || currentLessonName; loadLessonSkills(v); }
          }
        });
        tdAssoc.addEventListener('click', () => {
          const v = tdAssoc.textContent.trim();
          if (v) { currentLessonName = (r.name || '').trim() || currentLessonName; loadLessonSkills(v); }
        });

        tr.append(tdId, tdClass, tdName, tdDate, tdAssoc);
        resultsBody.appendChild(tr);
      }

      statusEl.textContent = rows.length ? `Намерени записи: ${rows.length}` : 'Няма записи за този клас.';
      resultsWrap.hidden = false;
      await loadYearPlan(cls);
      if (logPanel && !logPanel.hasAttribute('hidden')) {
        await loadAssessmentLog();
      }
    } catch(err){
      console.error('Search lessons_taken failed:', err);
      statusEl.textContent = 'Грешка при търсене.';
      resultsWrap.hidden = true;
    }
  });
// ---- LESSON SKILLS TABLE (for triplet) ----
const SKILLS_COLS = [
  {key:'id', label:'ID', editable:false, type:'text'},
  {key:'name', label:'Умение', editable:true, type:'text'},
  {key:'keyWords', label:'Ключови думи', editable:true, type:'arrayText'},
  {key:'order', label:'Подредба', editable:true, type:'int'},
  {key:'relatedTopic', label:'Свързани теми', editable:true, type:'arrayText'},
  {key:'lessons_in_tripplets', label:'Уроци (triplets)', editable:true, type:'arrayText'},
  {key:'associatedSnippets', label:'Other snippets (IDs)', editable:true, type:'arrayInt'},
  {key:'uslovie', label:'Текст', editable:true, type:'text'},
  {key:'class', label:'Клас', editable:true, type:'int'},
];

function toDisplay(value, type){
  if (type === 'arrayText' || type === 'arrayInt') return Array.isArray(value) ? value.join(', ') : (value ?? '');
  return value ?? '';
}
function fromDisplay(text, type){
  const t = (text||'').trim();
  if (type === 'arrayText') return t ? t.split(',').map(s=>s.trim()).filter(Boolean) : [];
  if (type === 'arrayInt') return t ? t.split(',').map(s=>parseInt(s.trim(),10)).filter(v=>!Number.isNaN(v)) : [];
  if (type === 'int') { const n = parseInt(t,10); return Number.isNaN(n) ? null : n; }
  return t;
}

async function loadLessonSkills(triplet){
  const tbody = document.getElementById('lessonSkillsBody');
  const wrap = document.getElementById('skillsWrap');
  const headRow = document.getElementById('lessonSkillsHeadRow');
  const toolbarTh = document.getElementById('skillsToolbarTh');
  if (!tbody || !headRow) return;
  currentSkillsTriplet = triplet;
  tbody.innerHTML = '';
  headRow.innerHTML = '';
  if (wrap) wrap.hidden = true;

  // Build header dynamically
  for (const col of SKILLS_COLS){
    const th = document.createElement('th'); th.textContent = col.label; headRow.appendChild(th);
  }
  if (toolbarTh) toolbarTh.colSpan = SKILLS_COLS.length;

  try {
    const resp = await fetch(`/lesson-skills?triplet=${encodeURIComponent(triplet)}`);
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();

    const makeCell = (row, col) => {
      const td = document.createElement('td');
      if (!col.editable){ td.textContent = toDisplay(row[col.key], col.type); return td; }
      td.contentEditable = 'true';
      td.textContent = toDisplay(row[col.key], col.type);
      td.addEventListener('keydown', ev => { if (ev.key==='Enter'){ ev.preventDefault(); td.blur(); }});
      td.addEventListener('blur', async () => {
        const newVal = fromDisplay(td.textContent, col.type);
        try{
          const r = await fetch(`/lesson-skills/${encodeURIComponent(row.id)}`, {
            method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [col.key]: newVal })
          });
          if (!r.ok) throw new Error('HTTP '+r.status);
          await r.json(); td.classList.remove('flash-error'); void td.offsetWidth; td.classList.add('flash-success');
        }catch(e){ console.error(e); td.classList.remove('flash-success'); void td.offsetWidth; td.classList.add('flash-error'); }
      });
      return td;
    };

    for (const row of data){
      const tr = document.createElement('tr');
      for (const col of SKILLS_COLS){ tr.appendChild(makeCell(row, col)); }
      tbody.appendChild(tr);
    }
    if (wrap) wrap.hidden = false;
  } catch(e){
    console.error('loadLessonSkills failed:', e);
    tbody.innerHTML = '<tr><td colspan="'+SKILLS_COLS.length+'" style="color:red">Грешка при зареждане</td></tr>';
    if (wrap) wrap.hidden = false;
  }
}

function createDraftSkillRow(){
  const tbody = document.getElementById('lessonSkillsBody');
  const wrap = document.getElementById('skillsWrap');
  if (!tbody || !currentSkillsTriplet) return;
  if (wrap) wrap.hidden = false;

  const draft = document.createElement('tr');
  const inputs = {};
  for (const col of SKILLS_COLS){
    const td = document.createElement('td');
    if (col.key === 'id') { td.textContent = '—'; td.classList.add('muted'); draft.appendChild(td); continue; }
    const inp = document.createElement('input');
    inp.type = 'text';
    if (col.key === 'lessons_in_tripplets') inp.value = currentSkillsTriplet; // will be parsed to array
    td.appendChild(inp); inputs[col.key] = {el: inp, type: col.type};
    draft.appendChild(td);
  }

  const actionsRow = document.createElement('tr');
  const actionsCell = document.createElement('td'); actionsCell.colSpan = SKILLS_COLS.length; const wrapDiv = document.createElement('div'); wrapDiv.className='row-actions';
  const btnSave = document.createElement('button'); btnSave.textContent='Запази';
  const btnCancel = document.createElement('button'); btnCancel.textContent='Откажи';
  wrapDiv.append(btnSave, btnCancel); actionsCell.appendChild(wrapDiv); actionsRow.appendChild(actionsCell);

  tbody.prepend(actionsRow); tbody.prepend(draft);

  btnCancel.addEventListener('click', ()=>{ actionsRow.remove(); draft.remove(); });
  btnSave.addEventListener('click', async ()=>{
    const payload = { triplet: currentSkillsTriplet };
    for (const [k, obj] of Object.entries(inputs)){
      const v = obj.el.value;
      payload[k] = fromDisplay(v, obj.type);
    }
    try{
      const r = await fetch('/lesson-skills', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      actionsRow.remove(); draft.remove();

      const tr = document.createElement('tr');
      for (const col of SKILLS_COLS){
        const td = document.createElement('td');
        if (!col.editable){ td.textContent = toDisplay(j.row[col.key], col.type); }
        else {
          td.contentEditable='true';
          td.textContent = toDisplay(j.row[col.key], col.type);
          td.addEventListener('blur', async ()=>{
            const newVal = fromDisplay(td.textContent, col.type);
            try{ const u = await fetch(`/lesson-skills/${j.row.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [col.key]: newVal }) }); if (!u.ok) throw new Error(); td.classList.add('flash-success'); }catch(_){ td.classList.add('flash-error'); }
          });
        }
        tr.appendChild(td);
      }
      tbody.prepend(tr);
    }catch(e){ console.error('Create skill failed:', e); alert('Неуспешно добавяне на умение.'); }
  });
}

if (addSkillBtn){
  addSkillBtn.addEventListener('click', ()=>{
    if (!currentSkillsTriplet){ alert('Не е избран урок (triplet). Кликни в клетката "Свързан урок" първо.'); return; }
    createDraftSkillRow();
  });
}
// ------------- Assessment window (cards) -------------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

async function openAssessmentWindow() {
  const cls = selectEl.value;
  if (!cls) { alert('Моля, изберете клас.'); return; }
  if (!currentSkillsTriplet) { alert('Няма избран урок (triplet). Кликни в „Свързан урок“.'); return; }

  try {
    // Load students and snippets in parallel
    const [stRes, snRes] = await Promise.all([
      fetch(`/students?className=${encodeURIComponent(cls)}`),
      fetch(`/lesson-skills?triplet=${encodeURIComponent(currentSkillsTriplet)}`)
    ]);
    if (!stRes.ok) throw new Error('HTTP ' + stRes.status);
    if (!snRes.ok) throw new Error('HTTP ' + snRes.status);
    const students = await stRes.json();       // [{id, first_name, sirname}]
    let snippets  = await snRes.json();        // [{name, order, ...}]

    // Normalize snippet names: strip any hard-coded trailing "(ID N)" that may have been embedded
    // in the name (e.g., when adding exercises). We keep exercise id visible via the separate ex-badge.
    snippets = (snippets || []).map(s => {
      if (s && typeof s.name === 'string') {
        s.name = s.name.replace(/\s*\(ID\s*\d+\)\s*$/i, '');
      }
      return s;
    });

    // sort snippets by "order" then by name
    snippets = (snippets || []).slice().sort((a,b)=>{
      const ao = Number.isFinite(+a.order) ? +a.order : 999999;
      const bo = Number.isFinite(+b.order) ? +b.order : 999999;
      if (ao !== bo) return ao - bo;
      return String(a.name||'').localeCompare(String(b.name||''));
    });

    // Serialize for the child window script
    const studentsJSON = JSON.stringify(students || []);
    const snippetsJSON = JSON.stringify(snippets || []);

    const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
    const lessonNameSafe = currentLessonName ? escapeHtml(currentLessonName) : '';
    const lessonBadge = lessonNameSafe ? ('<div class="badge">Урок: ' + lessonNameSafe + '</div>') : '';

    const html =  `
      <!doctype html>
      <html lang="bg">
      <head>
        <meta charset="utf-8" />
        <title>Оценяване — ${escapeHtml(cls)} — ${escapeHtml(currentSkillsTriplet)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>
          body{font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:16px;}
          header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap}
          .muted{color:#9aa0a6;font-style:italic}
          /* --- Assessment Log panel (hidden, toggled) --- */
          .log-toggle { margin-left:auto; }
          .log-panel { position:fixed; top:24px; right:24px; width:420px; max-height:70vh; overflow:auto; background:#fff; border:1px solid #e6e6e6; border-radius:10px; box-shadow:0 6px 22px rgba(0,0,0,.12); padding:10px; z-index:9999; }
          .log-panel[hidden] { display:none; }
          .log-panel header { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
          .log-panel h4 { margin:0; font-size:1rem; }
          .log-panel .close-btn { border:none; background:#f3f4f6; border-radius:6px; padding:4px 8px; cursor:pointer; }
          .log-table { width:100%; border-collapse:collapse; font-size:0.92rem; }
          .log-table th, .log-table td { padding:6px 8px; border-bottom:1px solid #eee; text-align:left; }
          .log-table thead th { position:sticky; top:0; background:#f9fafb; z-index:1; }
          .topline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
          .badge{background:#eef2ff;color:#3346d3;border-radius:6px;padding:2px 8px;font-weight:600;font-size:.8rem}
          .small{font-size:.78rem;color:#777}
          .nav{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
          .btn{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}
          .btn:disabled{background:#9bb3ff;cursor:not-allowed}
          .btn--ghost{background:#f3f6ff;color:#1f3bb3}
          .wrap{max-width:900px;margin:56px auto 0;display:flex;justify-content:center}
          .card{border:1px solid #e7e7e7;border-radius:12px;padding:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;max-width:720px;width:100%;}
          .card h2{margin:0 0 8px 0;font-size:1.25rem;text-align:center;font-weight:600;}
          .hero{height:40px;margin:-16px -16px 12px -16px;border-radius:12px 12px 0 0;background:#eef2ff;transition:background 200ms ease-in-out;filter:saturate(0.85) brightness(1.03);}
          .sub{font-size:.9rem;color:#666;margin-bottom:8px}
          ul.skills{list-style:none;padding-left:0;margin:0}
          .skills li{padding:6px 0;border-bottom:1px solid #f2f2f2}
          .skill-row{display:flex;align-items:center;gap:12px}
          .sk-name{flex:1;}
          .rating{display:inline-flex;gap:6px;align-items:center}
          .pill{min-width:28px;height:28px;border:1px solid #000;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-weight:600;cursor:pointer;user-select:none;color:#000;background:#fff}
          .pill:hover{background:#f3f4f6}
          .pill.is-active{background:#3b82f6;color:#fff;border-color:#3b82f6}
          .pill--v0.is-active{background:#ef4444;border-color:#ef4444;color:#fff}
          .pill--v1.is-active{background:#f59e0b;border-color:#f59e0b;color:#fff}
          .pill--v2.is-active{background:#3b82f6;border-color:#3b82f6;color:#fff}
          .pill--v3.is-active{background:#22c55e;border-color:#22c55e;color:#fff}
          /* Note field shown only for added tasks */
          .task-note{flex:1;min-width:160px;border:1px solid #d1d5db;border-radius:6px;padding:4px 6px;font:inherit}
          .task-note::placeholder{color:#94a3b8}
          /* Inline per-skill comment add button */
          .add-note-btn{border:none;background:transparent;cursor:pointer;font-weight:700;opacity:.5;transition:opacity .15s ease;padding:2px 6px;margin-left:4px}
          .add-note-btn:hover{opacity:1}
          .skill-inline-note{flex:1;min-width:160px;border:1px solid #d1d5db;border-radius:6px;padding:4px 6px;font:inherit}
          .skill-inline-note::placeholder{color:#94a3b8}
          .notes {margin-top:12px;display:flex;align-items:center;gap:10px;}
          .notes-label {margin:0;font-weight:600;color:#374151;white-space:nowrap;}
          .notes-ta{width:90%;min-height:1.8em;max-height:1.8em;resize:both;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font:inherit}          .notes-ta:focus{outline:none;box-shadow:0 0 0 3px rgba(59,130,246,.2);border-color:#3b82f6}
          .notes-status{margin-top:4px}
          .footer-hint{position:fixed;left:0;right:0;bottom:12px;text-align:center;color:#666;font-size:.85rem}
          .toolbar{display:flex;gap:8px;align-items:center}
          select{padding:6px 8px}
          /* --- Collapsible search panel styles --- */
          .search-panel{max-width:900px;margin:8px auto 0}
          .search-panel .sp-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
          .iconbtn{border:1px solid #d1d5db;background:#fff;border-radius:8px;min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
          .iconbtn:hover{background:#f3f4f6}
          .search-panel.is-collapsed .search-row{display:none}
          .search-row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin:8px auto 0;max-width:900px}
          .scol{flex:1 1 420px;min-width:320px;background:#fff;border:1px solid #e7e7e7;border-radius:12px;padding:10px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
          .scol header{display:flex;gap:8px;align-items:center;margin-bottom:8px}
          .scol input[type="text"]{flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px}
          .result-box{max-height:240px;overflow:auto;border:1px solid #e7e7e7;border-radius:8px;background:#fff}
          table.mini-table{width:100%;border-collapse:collapse}
          .mini-table thead th{position:sticky;top:0;background:#f7f7f7;z-index:1}
          .mini-table th,.mini-table td{padding:6px 8px;border-bottom:1px solid #eee;font-size:.9rem;text-align:left}
          .sk-id{font-size:.8rem;color:#94a3b8;margin-left:8px}
          /* --- Add/Assign buttons in left results --- */
          .add-cell{display:flex;gap:8px;align-items:center}
          .circle-btn{
            width:28px;height:28px;border:1px solid #cbd5e1;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;
            background:#fff;color:#111;font-weight:700;cursor:pointer
          }
          .circle-btn:hover{background:#f1f5f9}
          .circle-btn:active{transform:translateY(1px)}
          /* Hide duplicate ID column in the left search results (2nd column = ID) */
          #leftResultsTable thead th:nth-child(2),
          #leftResultsTable tbody td:nth-child(2){
            display:none;
          }
        </style>
      </head>
      <body>
        <header>
          <div class="topline">
            <div class="badge">${escapeHtml(cls)}</div>
            <div class="badge">Triplet: ${escapeHtml(currentSkillsTriplet)}</div>
            ${lessonBadge}
            <span class="small" id="metaCount"></span>
          </div>
          <div class="nav">
            <button id="prevBtn" class="btn btn--ghost" title="Предишен (←)">← Предишен</button>
            <button id="nextBtn" class="btn" title="Следващ (→)">Следващ →</button>
            <div class="toolbar">
              <label for="studentPicker" class="small">Към ученик:</label>
              <select id="studentPicker"></select>
            </div>
            <button id="undoBtn" class="btn btn--ghost" title="Отмени последното действие" disabled>Отмени</button>
            <button id="submitAssessBtn" class="btn btn--ghost">Подай</button>
          </div>
        </header>

        <section class="search-panel is-collapsed" id="searchPanel">
          <div class="sp-head">
            <button id="toggleSearchPanelBtn" class="iconbtn" title="Покажи/Скрий търсене">▸</button>
            <span class="sp-title small">Задачи</span>
          </div>
          <section class="search-row" id="assessmentSearchRow">
            <div class="scol" id="leftSearchCol">
              <header>
                <input id="leftSearchInput" type="text" placeholder="Търси… (по код)">
                <button id="leftSearchBtn" class="btn btn--ghost">Търси</button>
              </header>
              <div class="result-box">
                <table class="mini-table" id="leftResultsTable">
                  <thead><tr id="leftHead"></tr></thead>
                  <tbody id="leftBody"><tr><td class="muted">Няма резултати</td></tr></tbody>
                </table>
              </div>
            </div>

            <div class="scol" id="rightSearchCol">
              <header>
                <input id="rightSearchInput" type="text" placeholder="Търси… (по snippets)">
                <button id="rightSearchBtn" class="btn">Търси</button>
              </header>
              <div class="result-box">
                <table class="mini-table" id="rightResultsTable">
                  <thead><tr id="rightHead"></tr></thead>
                  <tbody id="rightBody"><tr><td class="muted">Няма резултати</td></tr></tbody>
                </table>
              </div>
            </div>
          </section>
        </section>

        <main class="wrap">
          <section class="card">
            <div id="hero" class="hero"></div>
            <h2 id="studentName">—</h2>
            <div class="sub">Списък с умения за оценяване:</div>
            <ul id="skillsList" class="skills"></ul>
            <div class="notes">
              <label for="studentNotes" class="notes-label">Коментари</label>
              <textarea id="studentNotes" class="notes-ta" rows="4" placeholder="Бележки за този ученик…"></textarea>
              <div id="notesStatus" class="notes-status small muted"></div>
            </div>
          </section>
        </main>
        <div class="footer-hint">Навигация: клавиши ← / → за предишен/следващ • Избор от падащото меню</div>
        <script>
          // ---- Build payload for submission ----
          function getClassParts(raw){
            const grade = parseInt(raw, 10);
            const division = raw.includes(' ')? raw.substring(raw.indexOf(' ')+1).trim() : '';
            return { grade: Number.isFinite(grade)? grade : null, division };
          }

          function collectStudentNotesMap(){
            const out = {};
            const students = (typeof STUDENTS !== 'undefined' && Array.isArray(STUDENTS)) ? STUDENTS : [];
            const ns = (typeof NOTES_NS !== 'undefined') ? NOTES_NS : 'notes:';
            students.forEach(st=>{ out[st.id] = (localStorage.getItem(ns + String(st.id)) || ''); });
            return out;
          }

          function collectTaskNotesMap(){
            const out = {};
            const students = (typeof STUDENTS !== 'undefined' && Array.isArray(STUDENTS)) ? STUDENTS : [];
            const added = (typeof ADDED_TASKS !== 'undefined' && ADDED_TASKS) ? ADDED_TASKS : {};
            students.forEach(st=>{
              const tasks = Array.isArray(added[st.id]) ? added[st.id] : [];
              const per = {};
              tasks.forEach(t=>{
                const tid = (t && (t.id != null ? t.id : t.key)) ?? '';
                const k = 'tasknotes:' + encodeURIComponent(cls) + ':' + encodeURIComponent(currentSkillsTriplet) + ':' + String(st.id) + ':' + String(tid);
                per[String(tid)] = localStorage.getItem(k) || '';
              });
              out[st.id] = per;
            });
            return out;
          }

          function collectScores(){
            // Safe access even if SCORES is not defined yet
            return (typeof SCORES !== 'undefined' && SCORES) ? SCORES : {};
          }
          
          (function(){
            const btnOrig = document.getElementById('submitAssessBtn');
            if (!btnOrig) return;

            // 1) махаме всички предишни слушатели, като клонираме бутона
            const submitBtn = btnOrig.cloneNode(true);
            btnOrig.replaceWith(submitBtn);
            // Detach from legacy scripts that still look up #submitAssessBtn
            submitBtn.id = 'submitAssessBtnFinal';
            const dummy = document.createElement('span'); dummy.id = 'submitAssessBtn'; dummy.style.display = 'none'; document.body.appendChild(dummy);

            // 2) guard – само една заявка
            let posting = false;

            submitBtn.addEventListener('click', async (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
              if (posting) return;
              posting = true;

              const parts = getClassParts('${escapeHtml(cls)}');
              const payload = {
                class: parts.grade,
                class_division: parts.division,
                lesson_tripplet: '${escapeHtml(currentSkillsTriplet)}'
              };

              console.log('➡️ submitting /assessment-log (single)', payload);

              const orig = submitBtn.textContent;
              submitBtn.disabled = true;
              submitBtn.textContent = 'Изпращам…';
              try {
                const r = await fetch('/assessment-log', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                await r.json();
                
                submitBtn.textContent = 'Подадено ✔';
                // Show alert and close the popup window after successful submission
                alert('Успешно подадено!');
                window.close();
              } catch (err) {
                console.error('Submit error:', err);
                alert('Грешка при подаване.');
                submitBtn.textContent = orig;
              } finally {
                posting = false;
                submitBtn.disabled = false;
                setTimeout(() => { submitBtn.textContent = orig; }, 1200);
              }
            });
          })();

         (function(){
            const STUDENTS = ${studentsJSON};
            const SNIPPETS = ${snippetsJSON};
            // Local HTML escaper for the child window scope (prevents broken attributes / stray backticks confusion)
            function escapeHtml(s){
              return String(s ?? '')
                .replace(/&/g,'&amp;')
                .replace(/</g,'&lt;')
                .replace(/>/g,'&gt;')
                .replace(/"/g,'&quot;')
                .replace(/'/g,'&#039;');
            }
            let idx = 0;
            let prevIdx = -1;

            const GRADIENTS = [
              'linear-gradient(90deg, #bfdbfe, #c7d2fe)',
              'linear-gradient(90deg, #c7d2fe, #f5d0fe)',
              'linear-gradient(90deg, #fbcfe8, #fecdd3)',
              'linear-gradient(90deg, #a7f3d0, #99f6e4)',
              'linear-gradient(90deg, #fef3c7, #fde68a)',
              'linear-gradient(90deg, #fed7aa, #fdba74)',
              'linear-gradient(90deg, #bae6fd, #bfdbfe)',
              'linear-gradient(90deg, #ddd6fe, #c7d2fe)',
              'linear-gradient(90deg, #e9d5ff, #ddd6fe)',
              'linear-gradient(90deg, #ffe4e6, #fecdd3)',
              'linear-gradient(90deg, #d1fae5, #bbf7d0)',
              'linear-gradient(90deg, #e0f2fe, #bae6fd)',
              'linear-gradient(90deg, #fef9c3, #fde68a)',
              'linear-gradient(90deg, #fae8ff, #e9d5ff)',
              'linear-gradient(90deg, #fce7f3, #fbcfe8)',
              'linear-gradient(90deg, #f5f5f5, #e5e7eb)',
              'linear-gradient(90deg, #f1f5f9, #e2e8f0)',
              'linear-gradient(90deg, #dbeafe, #e0e7ff)',
              'linear-gradient(90deg, #ccfbf1, #a7f3d0)',
              'linear-gradient(90deg, #fef2f2, #fee2e2)',
              'linear-gradient(90deg, #e0e7ff, #ddd6fe)',
              'linear-gradient(90deg, #bae6fd, #93c5fd)',
              'linear-gradient(90deg, #93c5fd, #a5b4fc)',
              'linear-gradient(90deg, #a5b4fc, #ddd6fe)',
              'linear-gradient(90deg, #99f6e4, #67e8f9)',
              'linear-gradient(90deg, #86efac, #bbf7d0)',
              'linear-gradient(90deg, #fef3c7, #fed7aa)',
              'linear-gradient(90deg, #fee2e2, #fecdd3)',
              'linear-gradient(90deg, #e2e8f0, #e5e7eb)',
              'linear-gradient(90deg, #e0f2fe, #cffafe)',
              'linear-gradient(90deg, #f1f5f9, #e0f2fe)',
              'linear-gradient(90deg, #f3e8ff, #e9d5ff)',
              'linear-gradient(90deg, #fde68a, #fed7aa)',
              'linear-gradient(90deg, #ffe4e6, #fbcfe8)',
              'linear-gradient(90deg, #f5f3ff, #ede9fe)',
              'linear-gradient(90deg, #ecfeff, #e0f2fe)',
              'linear-gradient(90deg, #f0fdf4, #dcfce7)',
              'linear-gradient(90deg, #fff7ed, #ffedd5)',
              'linear-gradient(90deg, #fefce8, #fef9c3)',
              'linear-gradient(90deg, #fae8ff, #f5d0fe)',
              'linear-gradient(90deg, #e0e7ff, #c7d2fe)',
              'linear-gradient(90deg, #dbeafe, #bfdbfe)',
              'linear-gradient(90deg, #fde2e2, #fecdd3)'
            ];
            let lastGradIdx = -1;
            function pickNextGradient(){
              if (GRADIENTS.length === 0) return '';
              if (GRADIENTS.length === 1) { lastGradIdx = 0; return GRADIENTS[0]; }
              let idx = lastGradIdx;
              // pick a random different index than the last used
              while (idx === lastGradIdx) {
                idx = Math.floor(Math.random() * GRADIENTS.length);
              }
              lastGradIdx = idx;
              return GRADIENTS[idx];
            }

            const byId = (id) => document.getElementById(id);
            const nameEl = byId('studentName');
            const heroEl = byId('hero');
            const listEl = byId('skillsList');
            const prevBtn = byId('prevBtn');
            const nextBtn = byId('nextBtn');
            const picker = byId('studentPicker');
            const metaCount = byId('metaCount');
            const undoBtn = byId('undoBtn');
            const ACTION_HISTORY = []; // stack of {type:'add-all'| 'add-one', task:{...}, studentId?}
           
            // ---- Notes (comments) per student, stored in localStorage (scoped by class + triplet) ----
            const notesTA = byId('studentNotes');
            const notesStatus = byId('notesStatus');
            const NOTES_NS = 'notes:' + encodeURIComponent('${escapeHtml(cls)}') + ':' + encodeURIComponent('${escapeHtml(currentSkillsTriplet)}') + ':';
            function currentStudentId(){ return (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null; }
            function notesKeyFor(id){ return NOTES_NS + String(id); }
            function loadNotesFor(id){
              if (!notesTA) return;
              const v = (id!=null) ? (localStorage.getItem(notesKeyFor(id)) || '') : '';
              notesTA.value = v;
              if (notesStatus) notesStatus.textContent = v ? 'Заредени бележки' : '';
            }
            let notesSaveTimer = null;
            function scheduleSaveNotes(){
              if (!notesTA) return;
              if (notesStatus) notesStatus.textContent = 'Запазване…';
              if (notesSaveTimer) clearTimeout(notesSaveTimer);
              notesSaveTimer = setTimeout(() => {
                const sid = currentStudentId();
                if (sid != null) {
                  try { localStorage.setItem(notesKeyFor(sid), notesTA.value || ''); } catch(_){}
                  if (notesStatus) notesStatus.textContent = 'Записано';
                }
              }, 500);
            }
            if (notesTA) {
              notesTA.addEventListener('input', scheduleSaveNotes);
            }

            // ---- Per-task notes ONLY for tasks that are added to the card(s) ----
            const TASK_NOTES_NS = 'tasknotes:' + encodeURIComponent('\${escapeHtml(cls)}') + ':' + encodeURIComponent('\${escapeHtml(currentSkillsTriplet)}') + ':';
            function taskKey(studentId, taskId){ return TASK_NOTES_NS + String(studentId) + ':' + String(taskId); }
            function taskIdFromLi(li){
              const explicit = li.getAttribute('data-ex-id') || li.dataset?.exId || li.dataset?.id;
              if (explicit) return explicit;
              const badge = li.querySelector('.ex-badge');
              const m = badge && badge.textContent ? badge.textContent.match(/\d+/) : null;
              if (m) return 'ex-' + m[0];
              const base = (li.querySelector('.sk-name')?.textContent || li.textContent || '').trim().slice(0,120);
              return 'text:' + base;
            }
            function attachNoteInput(li, studentId){
              const host = li.querySelector('.skill-row') || li;
              if (host.querySelector('input.task-note')) return;
              const input = document.createElement('input');
              input.type = 'text';
              input.className = 'task-note';
              input.placeholder = 'Snippets';
              const id = taskIdFromLi(li);
              const val = (studentId!=null) ? (localStorage.getItem(taskKey(studentId, id)) || '') : '';
              input.value = val;
              input.oninput = function(){
                if (studentId==null) return;
                try { localStorage.setItem(taskKey(studentId, id), input.value || ''); } catch(_){}
              };
              const ratingEl = host.querySelector('.rating');
              host.insertBefore(input, ratingEl || null);
            }
            if (listEl) {
              const observer = new MutationObserver((mutations)=>{
                const sid = currentStudentId();
                for (const m of mutations){
                  for (const n of m.addedNodes){
                    if (n && n.nodeType === 1 && n.tagName === 'LI') {
                      if (n.getAttribute('data-added-task') === '1') {
                        try { attachNoteInput(n, sid); } catch(_) {}
                      }
                    }
                  }
                }
              });
              observer.observe(listEl, { childList: true });
            }

            // Only refresh general notes; inputs for tasks are added when tasks are appended to the list
            (function(){
              const g = window;
              const origRender = g.renderSkillsForStudent;
              if (typeof origRender === 'function') {
                g.renderSkillsForStudent = function(studentId){
                  const r = origRender.apply(this, arguments);
                  // Only refresh general notes; inputs for tasks are added when tasks are appended to the list
                  loadNotesFor(studentId);
                  return r;
                };
              }
            })();

            // Fallback: refresh notes periodically to catch navigation changes
            setInterval(function(){
              const sid = currentStudentId();
              loadNotesFor(sid);
            }, 800);

            function updateUndoBtn(){
              if (undoBtn) undoBtn.disabled = ACTION_HISTORY.length === 0;
            }
            function pushAction(a){
              ACTION_HISTORY.push(a);
              updateUndoBtn();
            }
            function removeTaskFromStudent(sid, taskKey){
              const list = ADDED_TASKS[sid];
              if (!list) return;
              const i = list.findIndex(t => t.key === taskKey);
              if (i !== -1) list.splice(i,1);
            }
            function removeTaskFromAllStudents(taskKey){
              (STUDENTS || []).forEach(st => removeTaskFromStudent(st.id, taskKey));
            }
            function undoLastAction(){
              const a = ACTION_HISTORY.pop();
              if (!a) return;
              if (a.type === 'add-all'){
                removeTaskFromAllStudents(a.task.key);
              } else if (a.type === 'add-one'){
                if (a.studentId) removeTaskFromStudent(a.studentId, a.task.key);
              }
              updateUndoBtn();
              const currentId = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
              if (currentId) renderSkillsForStudent(currentId);
            }
            if (undoBtn){
              undoBtn.addEventListener('click', undoLastAction);
            }
            // Collapsible search panel toggle
            const searchPanel = byId('searchPanel');
            const toggleSearchPanelBtn = byId('toggleSearchPanelBtn');
            if (toggleSearchPanelBtn && searchPanel) {
              toggleSearchPanelBtn.addEventListener('click', function(){
                const collapsed = searchPanel.classList.toggle('is-collapsed');
                this.textContent = collapsed ? '▸' : '▾';
              });
            }

            // Left search UI (Exercises)
            const leftInput = byId('leftSearchInput');
            const leftBtn   = byId('leftSearchBtn');
            const leftHead  = byId('leftHead');
            const leftBody  = byId('leftBody');
            // Right search UI (Exercises–Snippets relationship)
            // Define with safe fallbacks so missing elements won't break the page
            const rightInput = byId('rightSearchInput') || null;
            const rightBtn   = byId('rightSearchBtn') || { addEventListener: () => {} };
            let rightHeadEl  = byId('rightHead');
            if (!rightHeadEl) rightHeadEl = document.createElement('tr');
            let rightBodyEl  = byId('rightBody');
            if (!rightBodyEl) rightBodyEl = document.createElement('tbody');
            // ---- RIGHT (relationships) search + buttons A/1 ----
            function setRightHeadVisible(visible){
              if (!rightHeadEl) return;
              rightHeadEl.style.display = visible ? '' : 'none';
              rightHeadEl.innerHTML = visible
                ? '<th>RID</th><th>Page</th><th>№</th><th>Свързан snippet</th><th>Бележки</th>'
                : '';
            }

            function renderRightRows(rows){
              if (!rightBodyEl) return;
              if (!rows || !rows.length){
                setRightHeadVisible(false);
                rightBodyEl.innerHTML = '<tr><td class="muted" colspan="5">Няма резултати</td></tr>';
                return;
              }
              setRightHeadVisible(true);
              rightBodyEl.innerHTML = rows.map(function(r){
                var rid  = (r.resource ?? r.Resource ?? r.resourceid ?? r.ResourceID ?? '');
                var page = (r.page ?? r.Page ?? '');
                var num  = (r.number ?? r.Number ?? '');
                var rel  = (r.relatedSnippet ?? r.relatedsnippet ?? '');
                var com  = (r.comments ?? '');
                return '<tr>'
                     + '<td>' + escapeHtml(String(rid))  + '</td>'
                     + '<td>' + escapeHtml(String(page)) + '</td>'
                     + '<td>' + escapeHtml(String(num))  + '</td>'
                     + '<td>' + escapeHtml(String(rel))  + '</td>'
                     + '<td>' + escapeHtml(String(com))  + '</td>'
                     + '</tr>';
              }).join('');
            }

            function doRightSearch(){
                if (!rightInput) { if (rightBodyEl) rightBodyEl.innerHTML=''; return; }
                const term = (rightInput.value || '').trim();
                if (!term) { renderRightRows([]); return; }

                // позволяваме няколко числа, разделени с , ; или интервали
                const ids = term.split(/[\s,;]+/)
                                .map(s => parseInt(s,10))
                                .filter(n => Number.isInteger(n));
                if (ids.length === 0) { renderRightRows([]); return; }

                const q = ids.join(','); // изпращаме ги събрани
                fetch('/exercises-rel/search?q=' + encodeURIComponent(q))
                  .then(r => r.ok ? r.json() : Promise.reject(r))
                  .then(rows => renderRightRows(Array.isArray(rows) ? rows : []))
                  .catch(() => renderRightRows([]));
             }

            // Build normalized task object for relationship triple (resource-page-number)
            function buildRelTask(resource, page, number){
              const r = parseInt(resource,10) || 0;
              const p = parseInt(page,10) || 0;
              const n = parseInt(number,10) || 0;
              const key = 'rel:' + r + '-' + p + '-' + n;
              return { key, kind:'exercise', resource:r, page:p, number:n, label:(r+'-'+p+'-'+n) };
            }

            // Delegate clicks from right result rows for Add All / Add One + push to undo history
            if (rightBodyEl) {
              rightBodyEl.addEventListener('click', function(ev){
                const btn = ev.target.closest('.circle-btn');
                if (!btn) return;

                const action = btn.dataset.action;
                const task = buildRelTask(btn.dataset.r, btn.dataset.p, btn.dataset.n);

                // Ensure data store exists
                window.ADDED_TASKS = window.ADDED_TASKS || {};
                function ensureForStudent(sid){
                  if (!window.ADDED_TASKS[sid]) window.ADDED_TASKS[sid] = [];
                  const arr = window.ADDED_TASKS[sid];
                  if (!arr.some(function(t){ return t.key === task.key; })) {
                    arr.push(task);
                  }
                }

                if (action === 'add-all'){
                  (STUDENTS || []).forEach(function(st){ ensureForStudent(st.id); });
                  if (typeof pushAction === 'function') pushAction({ type:'add-all', task: task });
                } else if (action === 'add-one'){
                  const cur = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
                  if (cur != null) {
                    ensureForStudent(cur);
                    if (typeof pushAction === 'function') pushAction({ type:'add-one', task: task, studentId: cur });
                  }
                }

                // Refresh current card
                const currentId = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
                if (currentId && typeof renderSkillsForStudent === 'function') {
                  renderSkillsForStudent(currentId);
                }
              });
            }

            // Bind handlers for right search
            if (rightBtn) rightBtn.addEventListener('click', doRightSearch);
            if (rightInput) rightInput.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') doRightSearch(); });

            function setLeftHeadVisible(visible){
              if (!leftHead) return;
              leftHead.style.display = visible ? '' : 'none';
              leftHead.innerHTML = visible
                ? '<th style="width:64px"></th><th>ID</th><th>RID</th><th>Page</th><th>№</th><th>Условие</th><th>Решение</th>'
                : '';
            }
            // --- REMOVE toPublicUrl and linkOrDash helpers entirely ---
            function renderLeftRows(rows){
              if (!leftBody) return;
              if (!rows || !rows.length){
                setLeftHeadVisible(false);
                leftBody.innerHTML = '<tr><td class="muted" colspan="7">Няма резултати</td></tr>';
                return;
              }
              setLeftHeadVisible(true);
              leftBody.innerHTML = rows.map(function(r){
                var idv  = (r.ID ?? r.id ?? '');
                var rid  = (r.ResourceID ?? r.resourceid ?? '');
                var page = (r.Page ?? r.page ?? '');
                var num  = (r.Number ?? r.number ?? '');
                var cond = (r.has_assignmentCondition ? '✔︎' : '—');
                var sol  = (r.has_solution ? '✔︎' : '—');
                var addCell = '<td class="add-cell" title="Добави упражнение">'
                            + '<button class="circle-btn circle-btn--all" data-action="add-all" data-ex-id="' + idv + '" title="Добави за всички">A</button>'
                            + '<button class="circle-btn circle-btn--one" data-action="add-one" data-ex-id="' + idv + '" title="Добави за този ученик">1</button>'
                            + '</td>';
                return '<tr>'
                     + addCell
                     + '<td>' + idv  + '</td>'
                     + '<td>' + rid  + '</td>'
                     + '<td>' + page + '</td>'
                     + '<td>' + num  + '</td>'
                     + '<td>' + cond + '</td>'
                     + '<td>' + sol  + '</td>'
                     + '</tr>';
              }).join('');
            }
            async function doLeftSearch(){
              if (!leftInput) return;
              const q = (leftInput.value || '').trim();
              if (!q){
                setLeftHeadVisible(false);
                leftBody.innerHTML = '<tr><td class="muted" colspan="6">Няма резултати</td></tr>';
                return;
              }
              try {
                const resp = await fetch('/exercises/search?q=' + encodeURIComponent(q));
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const rows = await resp.json();
                renderLeftRows(rows);
              } catch (e){
                console.error('left search failed:', e);
                setLeftHeadVisible(false);
                leftBody.innerHTML = '<tr><td class="muted" colspan="6">Грешка при търсене</td></tr>';
              }
            }
            if (leftBtn) leftBtn.addEventListener('click', doLeftSearch);
            if (leftInput) leftInput.addEventListener('keydown', e => {
              if (e.key === 'Enter') { e.preventDefault(); doLeftSearch(); }
            });
            // Hide headers by default; they appear only on non-empty results
            setLeftHeadVisible(false);
            const rightHead = byId('rightHead');
            if (rightHead) rightHead.style.display = 'none';
            if (leftBody) {
              leftBody.addEventListener('click', function(e){
                const btn = e.target.closest('.circle-btn');
                if (!btn) return;
                const tr = btn.closest('tr');
                const task = makeTaskFromRow(tr);
                if (!task) return;

                if (btn.dataset.action === 'add-all') {
                  addTaskToAllStudents(task);
                  pushAction({ type:'add-all', task });
                } else if (btn.dataset.action === 'add-one') {
                  const cur = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
                  if (cur) {
                    addTaskToStudent(cur, task);
                    pushAction({ type:'add-one', task, studentId: cur });
                  }
                }
                const currentId = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
                if (currentId) renderSkillsForStudent(currentId);
              });
            }
            updateUndoBtn();
            function escapeHtml(s){ return String(s ?? '')
              .replace(/&/g,'&amp;').replace(/</g,'&lt;')
              .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
              .replace(/'/g,'&#039;'); }
            const SCORES = {}; // { [studentId]: { [snippetId]: 0|1|2|3 } }

            // ------- Temporary tasks (exercises) attached to students -------
        const ADDED_TASKS = {}; // { [studentId]: [{ kind:'exercise', key:'ex-<ID>', label, id, rid, page, num }] }

        function addTaskToStudent(sid, task) {
          if (!sid || !task) return;
          if (!ADDED_TASKS[sid]) ADDED_TASKS[sid] = [];
          if (!ADDED_TASKS[sid].some(t => t.key === task.key)) {
            ADDED_TASKS[sid].push(task);
          }
        }
        function addTaskToAllStudents(task) {
          (STUDENTS || []).forEach(st => addTaskToStudent(st.id, task));
        }
      function makeTaskFromRow(tr) {
        if (!tr || !tr.children || tr.children.length < 5) return null;
        const id   = parseInt((tr.children[1].textContent || '').trim(), 10);
        const rid  = parseInt((tr.children[2].textContent || '').trim(), 10);
        const page = parseInt((tr.children[3].textContent || '').trim(), 10);
        const num  = parseInt((tr.children[4].textContent || '').trim(), 10);
        if (!Number.isInteger(id)) return null;
        const key   = 'ex-' + id;
        const label = \`Задача \${rid}-\${page}-\${num}\`;
        return { kind:'exercise', key, label, id, rid, page, num };
      }
            const getScore = (sid, snid) =>
              (SCORES[sid] && (typeof SCORES[sid][snid] !== 'undefined')) ? SCORES[sid][snid] : null;
            const setScore = (sid, snid, val) => {
              if (!SCORES[sid]) SCORES[sid] = {};
              SCORES[sid][snid] = val;
            };
            // --- clearScore helper ---
            const clearScore = (sid, snid) => { if (SCORES[sid]) { delete SCORES[sid][snid]; } };
            
            function fullName(st){
              const f = (st.first_name||'').trim();
              const s = (st.sirname||'').trim();
              const name = (f + ' ' + s).trim();
              return name || ('ID ' + st.id);
            }

            function renderSkillsForStudent(studentId){
                const extra = ADDED_TASKS[studentId] || [];
                const base = (SNIPPETS || []).map(s => ({
                  kind:'snippet',
                  key:'id:' + String(s.id),
                  label: String(s.name || \`Умение #\${s.id}\`)
                }));
                const items = base.concat(extra);

                if (!items.length){
                  listEl.innerHTML = '<li class="muted">Няма умения</li>';
                  return;
                }

                const html = items.map(it => {
                  const score = getScore(studentId, it.key);
                  const pills = [0,1,2,3].map(v => {
                    const act = (score === v) ? ' is-active' : '';
                    return \`<span class="pill pill--v\${v}\${act}" data-val="\${v}">\${v}</span>\`;
                  }).join('');
                  const name = escapeHtml(it.label || '-');
                  const liAttrs = (it.kind === 'exercise')
                    ? \` data-added-task="1" data-ex-id="\${escapeHtml(String(it.id ?? it.key ?? ''))}"\`
                    : '';
                  return \`<li\${liAttrs}>
                    <div class="skill-row">
                      <div class="sk-name">\${name} <span class="sk-id">(\${escapeHtml(it.key)})</span></div>
                      <div class="rating" data-snippet-id="\${it.key}">\${pills}</div>
                    </div>
                  </li>\`;
                }).join('');
                listEl.innerHTML = html;
              }

              // --- Toggle-aware click handler ---
              listEl.addEventListener('click', (e) => {
                  const pill = e.target.closest('.pill');
                  if (!pill) return;
                  const group = pill.closest('.rating');
                  if (!group) return;

                  const snid = group.dataset.snippetId; // string id ('id:123' or 'ex-15')
                  const val  = parseInt(pill.dataset.val, 10);
                  const curStudent = (STUDENTS && STUDENTS[idx]) ? STUDENTS[idx].id : null;
                  if (!curStudent) return;

                  const current = getScore(curStudent, snid);
                  if (current === val) {
                    // untick on second click
                    clearScore(curStudent, snid);
                    group.querySelectorAll('.pill').forEach(p => p.classList.remove('is-active'));
                  } else {
                    setScore(curStudent, snid, val);
                    group.querySelectorAll('.pill').forEach(p => p.classList.remove('is-active'));
                    pill.classList.add('is-active');
                  }
                });
              
            function render(){
              if (!STUDENTS.length){ nameEl.textContent='Няма студенти'; listEl.innerHTML=''; prevBtn.disabled = true; nextBtn.disabled = true; return; }
              if (idx < 0) idx = 0; if (idx >= STUDENTS.length) idx = STUDENTS.length - 1;
              const st = STUDENTS[idx];
              nameEl.textContent = fullName(st);
              renderSkillsForStudent(st.id);
              if (idx !== prevIdx) {
                const bg = pickNextGradient();
                if (heroEl) heroEl.style.background = bg;
                prevIdx = idx;
              }
              picker.value = String(idx);
              prevBtn.disabled = (idx === 0);
              nextBtn.disabled = (idx === STUDENTS.length - 1);
              metaCount.textContent = (idx+1) + ' / ' + STUDENTS.length + ' ученика' + (SNIPPETS.length ? (' • умения: ' + SNIPPETS.length) : '');
            }

            function goto(n){ idx = n; render(); }

            // init picker
            picker.innerHTML = STUDENTS.map((st, i)=> \`<option value="\${i}">\${fullName(st)}</option>\`).join('');
            picker.addEventListener('change', () => goto(parseInt(picker.value,10)));

            prevBtn.addEventListener('click', () => goto(Math.max(0, idx-1)));
            nextBtn.addEventListener('click', () => goto(Math.min(STUDENTS.length-1, idx+1)));

            window.addEventListener('keydown', (e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); nextBtn.click(); }
            });

            // ---- initial render ----
            try {
              if (picker && Array.isArray(STUDENTS) && STUDENTS.length) {
                picker.value = '0';
              }
              render();
            } catch (_e) {
              // swallow – if something fails here, UI will still be operable via controls
            }
// Submit button
const submitBtn = document.getElementById('submitAssessBtnFinal') || document.getElementById('submitAssessBtn');

if (submitBtn){
  submitBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();

    // Collect inline per-skill notes from all visible cards (fresh on submit)
    var skillNotes = {};
    var inps = document.querySelectorAll('.skill-inline-note');
    inps.forEach(function(inp){
      var val = (inp.value || '').trim();
      if (!val) return;
      var row  = inp.closest('.skill-row');
      var card = inp.closest('[data-student-id]');
      var stu  = card ? (card.getAttribute('data-student-id') || card.dataset.studentId) : '';
      var item = (row && row.getAttribute('data-item'))
              || ((row && row.querySelector('[data-item]')) ? row.querySelector('[data-item]').dataset.item : '')
              || ((row && row.querySelector('.sk-name')) ? row.querySelector('.sk-name').textContent.trim() : '');
      if (!stu || !item) return;
      if (!skillNotes[stu]) skillNotes[stu] = {};
      skillNotes[stu][item] = val;
    });

    var parts = getClassParts('${escapeHtml(cls)}');
    var payload = {
      class: parts.grade,
      class_division: parts.division,
      lesson_tripplet: '${escapeHtml(currentSkillsTriplet)}',
      details: {
        students: STUDENTS,
        scores: collectScores(),
        student_notes: collectStudentNotesMap(),
        task_notes: collectTaskNotesMap(),
        skill_notes: skillNotes
      }
    };

    var originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Изпращам…';

    try {
      var r = await fetch('/assessment-log', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var j = await r.json();

       // ==== SAFE PRINT (no template literals) ====
       // Success UI – keep it minimal and safe
       alert('Успешно подадено!');
       window.close();
     } catch (e) {
       console.error('Submit failed:', e);
       alert('Грешка при подаване.');
     } finally {
       submitBtn.disabled = false;
       submitBtn.textContent = originalText;
     }
   });
 }
             })();
         </script>
       </body>
       </html>
     `;
         
     // ---- Write popup HTML and finish ----
    try {
      const w = window.open('', 'assess-' + Date.now(), 'width=980,height=760');
      if (!w) { alert('Разрешете изскачащи прозорци и опитайте отново.'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (_) {
      alert('Неуспешно отваряне на прозореца за оценяване.');
    }
  } catch (err) {
    console.error('openAssessmentWindow failed:', err);
    alert('Грешка при отваряне на прозореца за оценяване.');
  }
}

// Hook the main Assess button
if (openAssessBtn) {
  openAssessBtn.addEventListener('click', openAssessmentWindow);
}

})();