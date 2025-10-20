

// lessonsCenter.js
(function(){
  const $ = (sel) => document.querySelector(sel);
  const theoryWrap = $('#theory_list');
  const exWrap = $('#ex_list');
  const snippetInp = $('#snippetSearch');
  const snippetBtn = $('#snippetSearchBtn');
  const completionsUl = $('#snippetCompletions');
  const lessonsTbody = $('#snippetLessons');

  let currentLessonId = null;
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

  function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); } }

  // Helper: fill form from a Lessons row (shared by all loaders)
  function fillFormFromRow(row){
    // Полета
    $('#tripplet_id').value = row.tripplet_id || '';
    $('#class').value = row.class != null ? row.class : '';
    $('#description').value = row.description || '';
    $('#url').value = row.url || '';
    $('#filepath').value = row.filepath || '';
    // Списъци
    setList(theoryWrap, (row.theory_snippets||[]));
    setList(exWrap, (row.exercises_ids||[]));

    // Flash highlight recently filled fields
    const toFlash = [
      $('#tripplet_id'), $('#class'), $('#description'), $('#url'), $('#filepath'),
      document.querySelector('#theory_list'), document.querySelector('#ex_list')
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

  // Helper: set a list (int[] or text[]) into the dynamic list UI
  function setList(wrap, arr){
    wrap.innerHTML = '';
    (arr||[]).forEach(val=>{
      const div = document.createElement('div');
      div.className = 'item';
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
    }
  }

  function addItem(wrap, type){
    const div = document.createElement('div');
    div.className = 'item';
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
  }

  $('#addTheory').addEventListener('click', ()=> addItem(theoryWrap, 'int'));
  $('#addEx').addEventListener('click', ()=> addItem(exWrap, 'text'));

  // init with one row each
  addItem(theoryWrap, 'int');
  addItem(exWrap, 'text');

  function collectList(wrap, toInt){
    const vals = Array.from(wrap.querySelectorAll('input'))
      .map(i => i.value.trim())
      .filter(Boolean);
    if (toInt) {
      return vals.map(v => parseInt(v,10)).filter(n => Number.isInteger(n));
    }
    return vals;
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
        tr.innerHTML = `<td>${row.lesson_id}</td>`+
                       `<td>${row.tripplet_id||''}</td>`+
                       `<td>${row.description||''}</td>`+
                       `<td>${row.class??''}</td>`;
        lessonsTbody.appendChild(tr);
      });
    }catch(e){ console.error(e); }
  }

  const debouncedSearch = debounce(()=> doSnippetSearch(snippetInp.value), 250);
  if (snippetInp) snippetInp.addEventListener('input', debouncedSearch);
  if (snippetBtn) snippetBtn.addEventListener('click', ()=> doSnippetSearch(snippetInp.value));

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
                        `<td title="${row.tripplet_id||''}">${row.tripplet_id||''}</td>`+
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
    if (form) form.reset();
    // reset dynamic lists to one blank row each
    theoryWrap.innerHTML = '';
    exWrap.innerHTML = '';
    addItem(theoryWrap,'int');
    addItem(exWrap,'text');
    // also clear the snippet search input and results
    if (snippetInp) snippetInp.value = '';
    if (completionsUl) completionsUl.innerHTML = '';
    if (lessonsTbody) lessonsTbody.innerHTML = '';
    // switch back to NEW mode
    setModeEditing(null);
  }

  $('#lessonForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const payload = {
      tripplet_id: $('#tripplet_id').value.trim() || null,
      class: $('#class').value ? parseInt($('#class').value,10) : null,
      description: $('#description').value.trim() || null,
      url: $('#url').value.trim() || null,
      filepath: $('#filepath').value.trim() || null,
      theory_snippets: collectList(theoryWrap, true),
      exercises_ids: collectList(exWrap, false)
    };

    const btn = $('#submitBtn');
    btn.disabled = true;
    const msg = $('#msg');
    msg.textContent = '';

    try{
      let r, text, data;
      if (currentLessonId){
        // Confirm overwrite
        if (!confirm(`Ще обновиш съществуващ урок #${currentLessonId}. Продължаваме?`)) { btn.disabled = false; return; }
        r = await fetch(`/lessons/${currentLessonId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        text = await r.text();
        try { data = JSON.parse(text); } catch(_){ data = null; }
        if(!r.ok){ throw new Error((data&&data.error) ? data.error : text || 'HTTP '+r.status); }
        msg.className = 'success';
        msg.textContent = `✅ Обновено (#${currentLessonId}).`;
        lastActions.set(currentLessonId, 'updated');
        clearForm();
      } else {
        r = await fetch('/lessons', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        text = await r.text();
        try { data = JSON.parse(text); } catch(_){ data = null; }
        if(!r.ok){ throw new Error((data&&data.error) ? data.error : text || 'HTTP '+r.status); }
        msg.className = 'success';
        msg.textContent = '✅ Урокът е записан.';
        if (data && data.lesson_id){ lastActions.set(data.lesson_id, 'new'); }
        clearForm();
      }
      fetchRecent();
    }catch(e){
      msg.className = 'error';
      msg.textContent = '❌ Грешка при запис: ' + (e.message||e);
      console.error(e);
    }finally{ btn.disabled = false; }
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
    if(!q){ return; }
    try{
      const r = await fetch(`/lessons/by-search?q=${encodeURIComponent(q)}`);
      if(!r.ok){ console.warn('No lesson for', q); return; }
      const row = await r.json();
      setModeEditing(row.lesson_id || null);
      fillFormFromRow(row);
    }catch(e){ console.error('loadBySearchValue failed', e); }
  }

  // Add listener for loadBySearchBtn
  const loadBtn = document.getElementById('loadBySearchBtn');
  if (loadBtn) loadBtn.addEventListener('click', loadBySearchValue);

})();