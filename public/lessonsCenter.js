// lessonsCenter.js
(function(){
  const $ = (sel) => document.querySelector(sel);
  const snWrap = $('#sn_table_body');
  const thWrap = $('#th_table_body');
  const exWrap = $('#ex_table_body');

  const thAddInput = $('#th_add_id');
  const refWrap = $('#ref_table_body');
  const exAddInput = $('#ex_add_id');  const snippetInp = $('#snippetSearch');
  const snAddInput = $('#sn_add_id');
  const snippetBtn = $('#snippetSearchBtn');
  const completionsUl = $('#snippetCompletions');
  const lessonsTbody = $('#snippetLessons');

  let currentLessonId = null;
  let originalTheoryIds = [];
  let originalExerciseIds = [];
  const lastActions = new Map(); // lesson_id -> 'new' | 'updated'
  const badge = document.getElementById('editModeBadge');
  function setModeEditing(id){
    currentLessonId = id;
    if (badge){
      badge.textContent = id ? `Режим: редакция на #${id}` : 'Режим: нов запис';
      badge.classList.toggle('edit', !!id);
    }
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.textContent = id ? 'Обнови урока' : 'Запази урока';
  }



  function sameNumberList(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;

    return a.every((value, index) => Number(value) === Number(b[index]));
  }

  function snapshotCurrentLists() {
    originalTheoryIds = collectList(snWrap, false);
    originalExerciseIds = collectList(exWrap, false);
  }

  function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); } }

  // --- Drag & Drop helpers ---
  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.item:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: el };
      }
    }
    return closest.element;
  }
  function makeListDraggable(wrap){
    if (!wrap || wrap.__dndBound) return;
    wrap.__dndBound = true;
    wrap.addEventListener('dragstart', (e)=>{
      const item = e.target.closest('.item');
      if (!item || !wrap.contains(item)) return;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'drag'); } catch(_) {}
    });
    wrap.addEventListener('dragend', (e)=>{
      const item = e.target.closest('.item');
      if (item) item.classList.remove('dragging');
      persistOrderFor(wrap);
    });
    wrap.addEventListener('dragover', (e)=>{
      e.preventDefault();
      const after = getDragAfterElement(wrap, e.clientY);
      const dragging = wrap.querySelector('.item.dragging');
      if (!dragging) return;
      if (after == null) {
        wrap.appendChild(dragging);
      } else {
        wrap.insertBefore(dragging, after);
      }
    });
  }
function makeTableDraggable(tbody){
  if (!tbody || tbody.__dndBound) return;
  tbody.__dndBound = true;
  tbody.addEventListener('dragstart', (e)=>{
    const row = e.target.closest('tr.row-item');
    if (!row || !tbody.contains(row)) return;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'drag'); } catch(_) {}
  });
  tbody.addEventListener('dragend', (e)=>{
    const row = e.target.closest('tr.row-item');
    if (row) row.classList.remove('dragging');
    renumberExerciseRows();
    persistOrderFor(tbody);
  });
  tbody.addEventListener('dragover', (e)=>{
    e.preventDefault();
    const dragging = tbody.querySelector('tr.row-item.dragging');
    if (!dragging) return;
    const rows = Array.from(tbody.querySelectorAll('tr.row-item:not(.dragging)'));
    let after = null;
    for (const r of rows){
      const box = r.getBoundingClientRect();
      const offset = e.clientY - (box.top + box.height/2);
      if (offset < 0) { after = r; break; }
    }
    if (!after) tbody.appendChild(dragging); else tbody.insertBefore(dragging, after);
  });
}
async function persistOrderFor(wrap){
  try{
    let type = null;

    if (wrap === snWrap) type = 'snippet';
    if (wrap === thWrap) type = 'theorem';
    if (wrap === exWrap) type = 'exercise';

    if (!type) return;
    if (!currentLessonId) return;

    const ids = Array.from(wrap.querySelectorAll('tr.row-item'))
      .map(tr => parseInt(tr.dataset.id, 10))
      .filter(Number.isInteger);

    await fetch(`/lesson-scripted/${currentLessonId}/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: type, item_ids: ids })
    });

    console.log('[lessonsCenter] order persisted', { lesson: currentLessonId, type, ids });
  }catch(e){
    console.warn('persistOrderFor failed', e);
  }
}

  // Helper: fill form from a Lessons row (shared by all loaders)
  function fillFormFromRow(row){
    currentLessonId = row.lesson_id || currentLessonId;
    // Полета
    setFieldValue(row.lesson_id, 'lessonId', 'lesson_id');
    setFieldValue(row.name || '', 'name');
    setFieldValue(row.class != null ? row.class : '', 'lessonClass', 'class');
    setFieldValue(row.division || '', 'lessonDivision', 'division');
    setFieldValue(row.description || '', 'description');
    setFieldValue(row.description2 || '', 'description2');
    setFieldValue(row.url || '', 'url');
    setFieldValue(row.filepath || '', 'filepath');
    setFieldValue(row.tripplet_id || '', 'tripplet_id');
    setFieldValue(row.source_token != null ? row.source_token : '', 'source_token');
    setFieldValue(row.section_token != null ? row.section_token : '', 'section_token');
    setFieldValue(row.lesson_token != null ? row.lesson_token : '', 'lesson_token');
    if (row.lesson_id) {
      loadScriptedLists(row.lesson_id).catch(console.error);
    } else {
      // If no id, clear lists
      setSnippetsTable([]);
      setExercisesTable([]);
    }

    // Flash highlight recently filled fields
    const toFlash = [
      document.getElementById('name'),
      firstEl('lessonClass', 'class'),
      firstEl('lessonDivision', 'division'),
      document.getElementById('description'),
      document.getElementById('url'),
      document.getElementById('filepath'),
      document.getElementById('tripplet_id'),
      document.getElementById('source_token'),
      document.getElementById('section_token'),
      document.getElementById('lesson_token'),
      document.querySelector('#sn_table'),
      document.querySelector('#ex_table')
    ].filter(Boolean);
    toFlash.forEach(el => {
      el.classList.remove('flash-fill'); // restart animation if needed
      // force reflow
      void el.offsetWidth;
      el.classList.add('flash-fill');
      setTimeout(()=> el.classList.remove('flash-fill'), 1000);
    });

    setModeEditing(row.lesson_id || null);
    document.getElementById('lessonForm').scrollIntoView({behavior:'smooth'});
  }

  // Helper: load lists from lesson_scripted by lesson_id and populate the lists
async function loadScriptedLists(lessonId){
  console.log('[lessonsCenter] loadScriptedLists -> lesson_id=', lessonId);
  try{
    const r = await fetch(`/lesson-scripted/${lessonId}`);
    if (!r.ok) {
      await setSnippetsTable([]);
      await setExercisesTable([]);
      await updateRefTable();
      snapshotCurrentLists();
      return;
    }

    const d = await r.json();

    // Prefer server-provided snippet meta if present
    if (Array.isArray(d.snippets) && d.snippets.length) {
      snWrap.innerHTML = '';
      d.snippets.forEach((m, i) => {
        snWrap.appendChild(buildSnippetRow({
          snippet_id: m.snippet_id,
          timeInMinutes: m.timeInMinutes ?? 0,
          difficulty: m.difficulty ?? 0
        }, i));
      });
      makeTableDraggable(snWrap);
    } else {
      await setSnippetsTable(Array.isArray(d.theory_snippets) ? d.theory_snippets : []);
    }

    // Prefer server-provided exercise meta (timeInMinutes, difficulty)
    if (Array.isArray(d.exercises) && d.exercises.length) {
      exWrap.innerHTML = '';
      d.exercises.forEach((m, i) => {
        exWrap.appendChild(buildExerciseRow({
          exercise_id: m.exercise_id,
          timeInMinutes: m.timeInMinutes ?? 0,
          difficulty: m.difficulty ?? 0
        }, i));
      });
      makeTableDraggable(exWrap);
    } else {
      // Fallback: only IDs (will fetch meta separately)
      await setExercisesTable(Array.isArray(d.exercises_ids) ? d.exercises_ids : []);
    }

    await updateRefTable();
    snapshotCurrentLists();
  }catch(e){
    console.error('loadScriptedLists failed', e);
    await setSnippetsTable([]);
    await setExercisesTable([]);
    await updateRefTable();
    snapshotCurrentLists();
  }
}

  function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function truncateText(s, n){
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

async function fetchSnippetRefs(ids){
  if (!ids.length) return new Map();
  const r = await fetch(`/snippet-ref?ids=${ids.join(',')}`);
  if (!r.ok) return new Map();
  const arr = await r.json();
  return new Map(arr.map(x => [x.snippet_id, x]));
}

async function fetchExerciseRefs(ids){
  if (!ids.length) return new Map();
  const r = await fetch(`/exercise-ref?ids=${ids.join(',')}`);
  if (!r.ok) return new Map();
  const arr = await r.json();
  return new Map(arr.map(x => [x.exercise_id, x]));
}

function formatExercise(ref){
  if (!ref) return '';
  const p = ref.page ? `стр. ${ref.page}` : '';
  const n = ref.number ? `№ ${ref.number}` : '';

  const bookType = (ref.resource?.keyWords || '').trim();
  const authors  = (ref.resource?.authors  || '').trim();

  const src = [bookType, authors].filter(Boolean).join(' — ');
  return [src, p, n].filter(Boolean).join(' · ');
}

async function updateRefTable(){
  if (!refWrap) return;

  const snIds = [...snWrap.querySelectorAll('tr.row-item')]
    .map(r => +r.dataset.id).filter(Number.isInteger);

  const exIds = [...exWrap.querySelectorAll('tr.row-item')]
    .map(r => +r.dataset.id).filter(Number.isInteger);

  const [snMap, exMap] = await Promise.all([
    fetchSnippetRefs(snIds),
    fetchExerciseRefs(exIds)
  ]);

  refWrap.innerHTML = '';

  snIds.forEach(id => {
    const sn = snMap.get(id);
    const nm = (sn && sn.name) ? String(sn.name).trim() : '';
    const us = truncateText((sn && sn.uslovie) ? sn.uslovie : '', 200);
    const info = [nm, us].filter(Boolean).join(' — ');
    refWrap.insertAdjacentHTML('beforeend',
      `<tr><td>${id}</td><td>snippet</td><td>${escapeHtml(info)}</td></tr>`
    );
  });

  exIds.forEach(id => {
    const txt = formatExercise(exMap.get(id));
    refWrap.insertAdjacentHTML('beforeend',
      `<tr><td>${id}</td><td>exercise</td><td>${escapeHtml(txt)}</td></tr>`
    );
  });
}
// --- Snippet table rendering with meta (duration, difficulty)
async function fetchSnippetMetaBulk(ids){
  // Snippets meta идва от lesson_scripted (GET /lesson-scripted/:id връща snippets),
  // но за fallback при добавяне на нови IDs показваме 0.
  if (!ids || !ids.length) return [];
  return ids.map(id => ({ snippet_id:id, timeInMinutes:0, difficulty:0 }));
}

async function patchLessonScriptedSnippetMeta(lessonId, itemId, patch){
  if (!lessonId || !itemId) return;
  try{
    const r = await fetch(`/lesson-scripted/${lessonId}/item`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: 'theory', item_id: itemId, ...patch })
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      console.warn('patchLessonScriptedSnippetMeta not ok', r.status, t);
    }
  }catch(e){
    console.warn('patchLessonScriptedSnippetMeta failed', e);
  }
}



async function fetchTheoremRefs(ids){
  if (!ids.length) return new Map();

  const params = new URLSearchParams();
  params.set('ids', ids.join(','));

  const r = await fetch(`/theorem-ref?${params.toString()}`);
  if (!r.ok) return new Map();

  const arr = await r.json();
  return new Map(arr.map(x => [parseInt(x.ID, 10), x]));
}

function buildTheoremRow(meta, index){
  const tr = document.createElement('tr');
  tr.className = 'row-item';
  tr.draggable = true;
  tr.dataset.id = meta.theorem_id;

  const tdId = document.createElement('td');
  tdId.textContent = String(meta.theorem_id);

  const tdDur = document.createElement('td');
  const durInp = document.createElement('input');
  durInp.type = 'number';
  durInp.min = '0';
  durInp.step = '1';
  durInp.style.width = '100%';
  durInp.value = String(meta.timeInMinutes ?? 0);
  tdDur.appendChild(durInp);

  const tdDf = document.createElement('td');
  const dfInp = document.createElement('input');
  dfInp.type = 'number';
  dfInp.min = '0';
  dfInp.max = '3';
  dfInp.step = '1';
  dfInp.style.width = '100%';
  dfInp.value = String(meta.difficulty ?? 0);
  tdDf.appendChild(dfInp);

  const saveIfEditing = async () => {
    if (!currentLessonId) return;

    const t = parseInt(durInp.value, 10);
    let d = parseInt(dfInp.value, 10);

    if (!Number.isInteger(d) || d < 0) d = 0;
    if (d > 3) d = 3;
    dfInp.value = String(d);

    await patchLessonScriptedItemMeta(currentLessonId, 'theorem', meta.theorem_id, {
      timeInMinutes: Number.isFinite(t) ? t : 0,
      difficulty: Number.isFinite(d) ? d : 0
    });
  };

  durInp.addEventListener('blur', saveIfEditing);
  dfInp.addEventListener('blur', saveIfEditing);

  const tdAct = document.createElement('td');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rem';
  btn.textContent = '×';
  btn.title = 'Премахни теоремата';
  btn.addEventListener('click', () => {
    tr.remove();
    persistOrderFor(thWrap);
    updateRefTable();
  });

  tdAct.appendChild(btn);
  tr.append(tdId, tdDur, tdDf, tdAct);

  return tr;
}

async function setTheoremsTable(ids){
  thWrap.innerHTML = '';

  ids.forEach((id, i) => {
    thWrap.appendChild(buildTheoremRow({
      theorem_id: id,
      timeInMinutes: 0,
      difficulty: 0
    }, i));
  });

  makeTableDraggable(thWrap);
  updateRefTable();
}

function buildSnippetRow(meta, index){
  const tr = document.createElement('tr');
  tr.className = 'row-item';
  tr.draggable = true;
  tr.dataset.id = meta.snippet_id;

  const tdId  = document.createElement('td');
  tdId.className  = 'sid';
  tdId.textContent  = String(meta.snippet_id);

  const tdDur = document.createElement('td');
  tdDur.className = 'dur';
  const durInp = document.createElement('input');
  durInp.type = 'number';
  durInp.min = '0';
  durInp.step = '1';
  durInp.style.width = '100%';
  durInp.value = String(meta.timeInMinutes != null ? meta.timeInMinutes : 0);
  tdDur.appendChild(durInp);

  const tdDf  = document.createElement('td');
  tdDf.className  = 'diff';
  const dfInp = document.createElement('input');
  dfInp.type = 'number';
  dfInp.min = '0';
  dfInp.step = '1';
  dfInp.max = '3';
  dfInp.style.width = '100%';
  dfInp.value = String(meta.difficulty != null ? meta.difficulty : 0);
  tdDf.appendChild(dfInp);

  const saveIfEditing = async ()=>{
    if (!currentLessonId) return;
    const t = parseInt(durInp.value, 10);
    let d = parseInt(dfInp.value, 10);
    if (!Number.isInteger(d) || d < 0) d = 0;
    if (d > 3) d = 3;
    dfInp.value = String(d);
    await patchLessonScriptedSnippetMeta(currentLessonId, meta.snippet_id, {
      timeInMinutes: Number.isFinite(t) ? t : 0,
      difficulty: Number.isFinite(d) ? d : 0
    });
  };
  durInp.addEventListener('blur', saveIfEditing);
  dfInp.addEventListener('blur', saveIfEditing);

  const tdAct = document.createElement('td');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rem';
  btn.textContent = '×';
  btn.title = 'Премахни снипета';
  btn.addEventListener('click', ()=> {
    tr.remove();
    persistOrderFor(snWrap);
    updateRefTable();
  });
  tdAct.appendChild(btn);

  tr.append(tdId, tdDur, tdDf, tdAct);
  return tr;
}

async function setSnippetsTable(ids){
  snWrap.innerHTML = '';
  const metas = await fetchSnippetMetaBulk(ids);
  metas.forEach((m, i)=>{
    snWrap.appendChild(buildSnippetRow(m, i));
  });
  makeTableDraggable(snWrap);
  updateRefTable();
}
// --- Exercise table rendering with meta (duration, difficulty)
async function fetchExerciseMetaBulk(ids){
  if (!ids || !ids.length) return [];
  try{
    const r = await fetch(`/exercise-meta?ids=${encodeURIComponent(ids.join(','))}`);

    // If the meta endpoint fails, still render IDs (with 0 meta) so the table is never empty.
    if (!r.ok) {
      return ids.map(id => ({ exercise_id:id, timeInMinutes:0, duration_minutes:0, difficulty:0, comment:'' }));
    }

    const arr = await r.json();
    const safeArr = Array.isArray(arr) ? arr : [];
    const map = new Map(safeArr.map(row => [parseInt(row.exercise_id,10), row]));

    return ids.map(id => {
      const m = map.get(id);
      return {
        exercise_id: id,
        timeInMinutes: m ? (parseInt(m.duration_minutes,10) || 0) : 0,
        duration_minutes: m ? (parseInt(m.duration_minutes,10) || 0) : 0,
        difficulty: m ? (parseInt(m.difficulty,10) || 0) : 0,
        comment: m ? (m.comment || '') : ''
      };
    });
  }catch(e){
    console.warn('fetchExerciseMetaBulk failed', e);
    return ids.map(id => ({ exercise_id:id, timeInMinutes:0, duration_minutes:0, difficulty:0, comment:'' }));
  }
}

async function patchLessonScriptedExerciseMeta(lessonId, itemId, patch){
  if (!lessonId || !itemId) return;
  try{
    const r = await fetch(`/lesson-scripted/${lessonId}/item`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: 'exercise', item_id: itemId, ...patch })
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      console.warn('patchLessonScriptedExerciseMeta not ok', r.status, t);
    }
  }catch(e){
    console.warn('patchLessonScriptedExerciseMeta failed', e);
  }
}

function buildExerciseRow(meta, index){
  const tr = document.createElement('tr');
  tr.className = 'row-item';
  tr.draggable = true;
  tr.dataset.id = meta.exercise_id;

  const tdId  = document.createElement('td');
  tdId.className  = 'eid';
  tdId.textContent  = String(meta.exercise_id);

  const tdDur = document.createElement('td');
  tdDur.className = 'dur';
  const durInp = document.createElement('input');
  durInp.type = 'number';
  durInp.min = '0';
  durInp.step = '1';
  durInp.style.width = '100%';
  durInp.value = String(meta.timeInMinutes != null ? meta.timeInMinutes : (meta.duration_minutes != null ? meta.duration_minutes : 0));
  tdDur.appendChild(durInp);

  const tdDf  = document.createElement('td');
  tdDf.className  = 'diff';
  const dfInp = document.createElement('input');
  dfInp.type = 'number';
  dfInp.min = '0';
  dfInp.step = '1';
  dfInp.max = '3';
  dfInp.style.width = '100%';
  dfInp.value = String(meta.difficulty != null ? meta.difficulty : 0);
  tdDf.appendChild(dfInp);

  // Persist on blur (only when editing an existing lesson)
  const saveIfEditing = async ()=>{
    if (!currentLessonId) return;
    const t = parseInt(durInp.value, 10);
    let d = parseInt(dfInp.value, 10);
    if (!Number.isInteger(d) || d < 0) d = 0;
    if (d > 3) d = 3;
    dfInp.value = String(d);
    const patch = {
      timeInMinutes: Number.isFinite(t) ? t : 0,
      difficulty: Number.isFinite(d) ? d : 0
    };
    await patchLessonScriptedExerciseMeta(currentLessonId, meta.exercise_id, patch);
  };
  durInp.addEventListener('blur', saveIfEditing);
  dfInp.addEventListener('blur', saveIfEditing);

  const tdAct = document.createElement('td');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rem';
  btn.textContent = '×';
  btn.title = 'Премахни упражнението';
  btn.addEventListener('click', ()=> {
    tr.remove();
    persistOrderFor(exWrap);
    updateRefTable();
  });
  tdAct.appendChild(btn);

  tr.append(tdId, tdDur, tdDf, tdAct);
  return tr;
}

function renumberExerciseRows(){ /* no index column */ }

async function setExercisesTable(ids){
  exWrap.innerHTML = '';
  const metas = await fetchExerciseMetaBulk(ids);
  metas.forEach((m, i)=>{
    exWrap.appendChild(buildExerciseRow(m, i));
  });
  makeTableDraggable(exWrap);
  updateRefTable();
}
  // Helper: set a list (int[] or text[]) into the dynamic list UI
  function setList(wrap, arr){
    wrap.innerHTML = '';
    (arr||[]).forEach(val=>{
      const div = document.createElement('div');
      div.className = 'item';
      div.draggable = true;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = val;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rem';
      btn.textContent = '×';
      btn.addEventListener('click', ()=> div.remove());
      div.append(inp, btn);
      wrap.append(div);
    });
    if (!arr || arr.length === 0) {
      // Always at least one blank row
      const div = document.createElement('div');
      div.className = 'item';
      div.draggable = true;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = wrap === theoryWrap ? 'напр. 123' : 'напр. tag-1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rem';
      btn.textContent = '×';
      btn.addEventListener('click', ()=> div.remove());
      div.append(inp, btn);
      wrap.append(div);
      makeListDraggable(wrap);
    }
    makeListDraggable(wrap);
  }

  function addItem(wrap, type){
    const div = document.createElement('div');
    div.className = 'item';
    div.draggable = true;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = type === 'int' ? 'напр. 123' : 'напр. tag-1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rem';
    btn.textContent = '×';
    btn.addEventListener('click', ()=> div.remove());
    div.append(inp, btn);
    wrap.append(div);
    makeListDraggable(wrap);
  }

  $('#addTheory').addEventListener('click', async ()=>{
    const v = snAddInput && snAddInput.value ? parseInt(snAddInput.value,10) : NaN;
    if (!Number.isInteger(v) || v <= 0) return;

    // if already present -> do nothing
    const existing = Array.from(snWrap.querySelectorAll('tr.row-item'))
      .map(tr => parseInt(tr.dataset.id,10))
      .filter(Number.isInteger);
    if (existing.includes(v)) {
      snAddInput.value = '';
      return;
    }

    // Append ONLY the new row, keep existing inputs as-is (no rebuild)
    snWrap.appendChild(buildSnippetRow({ snippet_id: v, timeInMinutes: 0, difficulty: 0 }, snWrap.children.length));
    makeTableDraggable(snWrap);

    snAddInput.value = '';
    persistOrderFor(snWrap);
    updateRefTable();
  });
  $('#addEx').addEventListener('click', async ()=>{
    const v = exAddInput && exAddInput.value ? parseInt(exAddInput.value,10) : NaN;
    if (!Number.isInteger(v) || v <= 0) return;

    // if already present -> do nothing
    const existing = Array.from(exWrap.querySelectorAll('tr.row-item'))
      .map(tr => parseInt(tr.dataset.id,10))
      .filter(Number.isInteger);
    if (existing.includes(v)) {
      exAddInput.value = '';
      return;
    }

    // Fetch meta only for the NEW id (so we don't rebuild existing rows)
    const metas = await fetchExerciseMetaBulk([v]);
    const meta = (metas && metas[0]) ? metas[0] : { exercise_id: v, timeInMinutes: 0, duration_minutes: 0, difficulty: 0, comment: '' };

    exWrap.appendChild(buildExerciseRow(meta, exWrap.children.length));
    makeTableDraggable(exWrap);

    exAddInput.value = '';
    persistOrderFor(exWrap);
    updateRefTable();
  });

    // init: snippets/exercises tables start empty; render on load/add
    setSnippetsTable([]);
    setExercisesTable([]);
    
  function collectList(wrap, toInt){
    if (wrap === exWrap){
      return Array.from(exWrap.querySelectorAll('tr.row-item'))
        .map(tr => parseInt(tr.dataset.id,10))
        .filter(Number.isInteger);
    }
    if (wrap === snWrap){
      return Array.from(snWrap.querySelectorAll('tr.row-item'))
        .map(tr => parseInt(tr.dataset.id,10))
        .filter(Number.isInteger);
    }
    const vals = Array.from(wrap.querySelectorAll('input'))
      .map(i => i.value.trim())
      .filter(Boolean);
    if (toInt) {
      return vals.map(v => parseInt(v,10)).filter(Number.isInteger);
    }
    return vals.map(v => parseInt(v,10)).filter(Number.isInteger);
  }

  async function doSnippetSearch(q){
    const qTrim = String(q||'').trim();
    if(!qTrim){ completionsUl.innerHTML=''; lessonsTbody.innerHTML=''; return; }
    try{
      const r = await fetch(`/lessons/search-by-snippet?q=${encodeURIComponent(qTrim)}`);
      if(!r.ok){ completionsUl.innerHTML=''; lessonsTbody.innerHTML=''; return; }
      const data = await r.json();
      // completions
      completionsUl.innerHTML = '';
      (data.completions||[]).forEach(c=>{
        const li = document.createElement('li');
        li.innerHTML = `<a href="#" data-id="${c.id}">${c.id}</a> <small>${c.name?('— '+c.name):''}</small>`;
        li.querySelector('a').addEventListener('click', (e)=>{ e.preventDefault(); snippetInp.value=String(c.id); doSnippetSearch(String(c.id)); });
        completionsUl.appendChild(li);
      });
      // lessons
      lessonsTbody.innerHTML = '';
      (data.lessons||[]).forEach(row=>{
        const tr = document.createElement('tr');
        tr.innerHTML =
          `<td>${row.lesson_id}</td>`+
          `<td>${row.tripplet_id||''}</td>`+
          `<td>${row.name||''}</td>`+
          `<td>${row.class??''}</td>`+
          `<td>
            <button class="btn btn-small btn-snippet-info" data-snippet-id="${row.lesson_id}" type="button">Инфо</button>
          </td>`;
        lessonsTbody.appendChild(tr);
      });
      // Add info button listeners
      lessonsTbody.querySelectorAll('.btn-snippet-info').forEach(btn=>{
        btn.addEventListener('click', async (e)=>{
          const lessonId = btn.getAttribute('data-snippet-id');
          if (!lessonId) return;
          try{
            // Fetch snippet meta
            const r = await fetch(`/snippet-ref?id=${encodeURIComponent(lessonId)}`);
            if (!r.ok) { alert('Грешка при зареждане на инфо'); return; }
            const info = await r.json();
            // Render info table
            let html = '<table style="width:100%; border-collapse:collapse;">';
            html += '<tr><th>Поле</th><th>Стойност</th></tr>';
            Object.entries(info).forEach(([k,v])=>{
              html += `<tr><td>${k}</td><td>${v==null?'':v}</td></tr>`;
            });
            html += '</table>';
            // Show in modal or alert
            const w = window.open('', '', 'width=600,height=400');
            w.document.write('<html><head><title>Инфо за снипет</title></head><body>'+html+'</body></html>');
            w.document.close();
          }catch(e){ alert('Грешка при зареждане на инфо'); }
        });
      });
    }catch(e){ console.error(e); }
  }

  const debouncedSearch = debounce(()=> doSnippetSearch(snippetInp.value), 250);
  if (snippetInp) snippetInp.addEventListener('input', debouncedSearch);
  if (snippetBtn) snippetBtn.addEventListener('click', ()=> doSnippetSearch(snippetInp.value));



  function firstEl(...ids){
    for (const id of ids){
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function fieldValue(...ids){
    const el = firstEl(...ids);
    return el ? String(el.value || '').trim() : '';
  }

  function setFieldValue(value, ...ids){
    const el = firstEl(...ids);
    if (el) el.value = value ?? '';
  }

  function parseOptionalInt(value){
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  async function fetchRecent(){
    try{
      const r = await fetch('/lessons?limit=10');
      if(!r.ok) return;
      const rows = await r.json();
      const tb = document.querySelector('#recentTable tbody');
      tb.innerHTML = '';
      rows.forEach(row => {
        const tr = document.createElement('tr');
        const status = row.action || lastActions.get(row.lesson_id) || '';
        const statusHtml = status ? `<span class="status-tag ${status==='new'?'new':'updated'}">${status==='new'?'Добавен':'Обновен'}</span>` : '';
        tr.innerHTML = `<td>${row.lesson_id}</td>`+
                        `<td>${statusHtml}</td>`+
                        `<td title="${row.name||''}">${row.name||''}</td>`+
                        `<td title="${row.description||''}">${row.description||''}</td>`+
                        `<td>${row.class??''}</td>`+
                        `<td>${row.updated_at||''}</td>`;
        tb.appendChild(tr);
      });
    }catch(e){ console.error(e); }
  }

  fetchRecent();

  function clearForm(){
    const form = document.getElementById('lessonForm');
    ['lessonId','lesson_id','name','lessonClass','class','lessonDivision','division','description','description2','url','filepath','tripplet_id','source_token','section_token','lesson_token']  .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });    // reset dynamic lists to one blank row each
    snWrap.innerHTML = '';
    exWrap.innerHTML = '';

    setSnippetsTable([]);
    // also clear the snippet search input and results
    if (snippetInp) snippetInp.value = '';
    if (completionsUl) completionsUl.innerHTML = '';
    if (lessonsTbody) lessonsTbody.innerHTML = '';
    if (refWrap) refWrap.innerHTML = '';
    // switch back to NEW mode
    setModeEditing(null);
  }

  $('#lessonForm').addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const lessonIdFromField = parseOptionalInt(fieldValue('lessonId', 'lesson_id'));
      const targetLessonId = currentLessonId || lessonIdFromField;

      const payload = {
        name: fieldValue('name') || null,
        class: parseOptionalInt(fieldValue('lessonClass', 'class')),
        division: fieldValue('lessonDivision', 'division') || null,
        description: fieldValue('description') || null,
        description2: fieldValue('description2') || null,
        url: fieldValue('url') || null,
        filepath: fieldValue('filepath') || null,
        tripplet_id: fieldValue('tripplet_id') || null,
        source_token: parseOptionalInt(fieldValue('source_token')),
        section_token: parseOptionalInt(fieldValue('section_token')),
        lesson_token: parseOptionalInt(fieldValue('lesson_token')),
        theory_snippets: collectList(snWrap, false),
        exercises_ids: collectList(exWrap, false)
      };

    const btn = $('#submitBtn');
    btn.disabled = true;
    const msg = $('#msg');
    msg.textContent = '';

try {
  let r, text, data;

  if (targetLessonId) {
    if (!confirm(`Ще обновиш съществуващ урок #${targetLessonId}. Продължаваме?`)) {
      btn.disabled = false;
      return;
    }

    r = await fetch(`/lessons/${targetLessonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    text = await r.text();

    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    if (!r.ok) {
      throw new Error((data && data.error) ? data.error : text || 'HTTP ' + r.status);
    }

    msg.className = 'success';
    msg.textContent = `✅ Обновено (#${targetLessonId}).`;
    lastActions.set(targetLessonId, 'updated');
    clearForm();

  } else {
    r = await fetch('/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    text = await r.text();

    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    if (!r.ok) {
      throw new Error((data && data.error) ? data.error : text || 'HTTP ' + r.status);
    }

    msg.className = 'success';
    msg.textContent = '✅ Урокът е записан.';

    if (data && data.lesson_id) {
      lastActions.set(data.lesson_id, 'new');
    }

    clearForm();
  }

  fetchRecent();

} catch (e) {
  msg.className = 'error';
  msg.textContent = '❌ Грешка при запис: ' + (e.message || e);
  console.error(e);

} finally {
  btn.disabled = false;
} 
});

  // Reset handler to clear edit mode and blank lists
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn){
    resetBtn.addEventListener('click', ()=>{
      clearForm();
    });
  }

  // --- Loader by lesson_id (for future use, not yet in UI) ---
  async function loadLessonToForm(id){
    try{
      const r = await fetch(`/lessons/${id}`);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const row = await r.json();
      setModeEditing(row.lesson_id || null);
      fillFormFromRow(row);
    }catch(e){ console.error('loadLessonToForm failed', e); }
  }

  // Loader by snippetSearch value (bytext)
  async function loadBySearchValue(){
    const q = (snippetInp && snippetInp.value || '').trim();
    if(!q) return;

    clearForm();

    try{
      // 1) Намери урок по търсене (за да вземем lesson_id)
      const r1 = await fetch(`/lessons/by-search?q=${encodeURIComponent(q)}`);
      if (!r1.ok) { console.warn('No lesson for', q); return; }
      const found = await r1.json();
      if (!found || !found.lesson_id) return;

      // 2) Зареди ПЪЛНИЯ урок от snippet-ref (вкл. description2)
      const r2 = await fetch(`/snippet-ref?id=${encodeURIComponent(found.lesson_id)}`);
      if (!r2.ok) { console.warn('Failed to load full lesson', found.lesson_id); return; }
      const full = await r2.json();

      setModeEditing(full.lesson_id || null);
      fillFormFromRow(full);
    }catch(e){
      console.error('loadBySearchValue failed', e);
    }
  }

  // Add listener for loadBySearchBtn
  const loadBtn = document.getElementById('loadBySearchBtn');
  if (loadBtn) loadBtn.addEventListener('click', loadBySearchValue);

})();