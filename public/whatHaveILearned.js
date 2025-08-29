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
  
  const yearPlanWrap = document.getElementById('yearPlanWrap');
  const addSkillBtn = document.getElementById('addSkillRowBtn');
  const openAssessBtn = document.getElementById('openAssessBtn');
  let currentSkillsTriplet = null; // remembers which triplet is loaded
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
            if (v) loadLessonSkills(v);
          }catch(e){ console.error(e); flash(tdAssoc2,false); }        
        }
      });
      tdAssoc2.addEventListener('click', () => {
        const v = tdAssoc2.textContent.trim();
        if (v) loadLessonSkills(v);
      });

      tr.append(tdId2, tdClass2, tdName2, tdDate2, tdAssoc2);
      resultsBody.prepend(tr);
      flash(tdId2,true);
      if (r.associatedLesson) {
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
            if (v) loadLessonSkills(v);
          }
        });
        tdAssoc.addEventListener('click', () => {
          const v = tdAssoc.textContent.trim();
          if (v) loadLessonSkills(v);
        });

        tr.append(tdId, tdClass, tdName, tdDate, tdAssoc);
        resultsBody.appendChild(tr);
      }

      statusEl.textContent = rows.length ? `Намерени записи: ${rows.length}` : 'Няма записи за този клас.';
      resultsWrap.hidden = false;
      await loadYearPlan(cls);
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

    // sort snippets by "order" then by name
    snippets = (snippets || []).slice().sort((a,b)=>{
      const ao = Number.isFinite(+a.order) ? +a.order : 999999;
      const bo = Number.isFinite(+b.order) ? +b.order : 999999;
      if (ao !== bo) return ao - bo;
      return String(a.name||'').localeCompare(String(b.name||''));
    });

    const skillList = snippets.map(s => `<li>${escapeHtml(s.name || '—')}</li>`).join('') || '<li class="muted">Няма умения</li>';

    const html = `
      <!doctype html>
      <html lang="bg">
      <head>
        <meta charset="utf-8" />
        <title>Оценяване — ${escapeHtml(cls)} — ${escapeHtml(currentSkillsTriplet)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>
          body{font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:16px;}
          header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
          .muted{color:#9aa0a6;font-style:italic}
          .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px;}
          .card{border:1px solid #e7e7e7;border-radius:10px; padding:12px;background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.04);}
          .card h3{margin:0 0 6px 0;font-size:1.05rem}
          .chips{list-style:disc; padding-left:18px; margin:6px 0 0 0; max-height:180px; overflow:auto;}
          .kicker{font-size:.9rem;color:#555}
          .sub{font-size:.85rem;color:#666}
          .topline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
          .badge{background:#eef2ff;color:#3346d3;border-radius:6px;padding:2px 8px;font-weight:600;font-size:.8rem}
          .small{font-size:.78rem;color:#777}
        </style>
      </head>
      <body>
        <header>
          <div class="topline">
            <div class="badge">${escapeHtml(cls)}</div>
            <div class="badge">Triplet: ${escapeHtml(currentSkillsTriplet)}</div>
            <span class="small">Студенти: ${(students||[]).length} • Умения: ${(snippets||[]).length}</span>
          </div>
          <div>
            <button onclick="window.print()">Печат</button>
          </div>
        </header>

        <div class="grid">
          ${(students||[]).map(st => {
            const full = escapeHtml(`${st.first_name ?? ''} ${st.sirname ?? ''}`.trim() || `ID ${st.id}`);
            return `
              <section class="card">
                <h3>${full}</h3>
                <div class="sub">Списък с умения за оценяване:</div>
                <ul class="chips">
                  ${skillList}
                </ul>
              </section>`;
          }).join('') || '<p class="muted">Няма студенти за избрания клас.</p>'}
        </div>
      </body>
      </html>
    `;
    const w = window.open('', '_blank');
    if (!w) { alert('Блокирано изскачащо прозорче. Разрешете pop-ups за този сайт.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    console.error('assessment window failed:', e);
    alert('Възникна грешка при зареждане на ученици/умения.');
  }
}

if (openAssessBtn) {
  openAssessBtn.addEventListener('click', openAssessmentWindow);
}

})();