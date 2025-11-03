

(function(){
  const qs = sel => document.querySelector(sel);
  const qsa = sel => Array.from(document.querySelectorAll(sel));
  const g = {
    wrap: qs('#pageGroup'),
    cls: qs('#g_class'),
    lessonSearch: qs('#g_lessonSearch'),
    loadBtn: qs('#g_load'),
    skillsUl: qs('#g_skills'),
    score: qs('#g_score'),
    assignBtn: qs('#g_assign'),
    selectAll: qs('#g_selectAll'),
    table: qs('#g_students'),
    tbody: qs('#g_students tbody')
  };
  // Add references to group action form elements
  g.g2 = {
    triplet: qs('#g2_triplet'),
    isSnippet: qs('#g2_isSnippet'),
    component: qs('#g2_component'),
    assessment: qs('#g2_assessment'),
    thread: qs('#g2_thread'),
    followupId: qs('#g2_followup_id'),
    followupExp: qs('#g2_followup_exp'),
    saveBtn: qs('#g2_saveActionBtn')
  };
  if (!g.wrap) return;

  // Populate class dropdown from backend /classes
  async function populateClasses(){
    try{
      const res = await fetch('/classes', { cache:'no-store' });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const classes = await res.json(); // array of strings like "11 А"
      if (Array.isArray(classes)){
        // Clear old options but keep placeholder
        if (g.cls && g.cls.tagName === 'SELECT'){
          g.cls.innerHTML = '<option value="">— избери клас —</option>';
          classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            g.cls.appendChild(opt);
          });
        }
      }
    }catch(e){ console.error('populateClasses failed', e); }
  }
  document.addEventListener('DOMContentLoaded', populateClasses);

  let currentClass = '';
  let currentTriplet = '';
  let skills = []; // [{id,name}]
  let students = []; // [{studentID,name,assessment,entryTime}]
  let selectedSkillId = null;

  async function fetchJSON(url){
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  async function searchLesson(q){
    const u = new URL('/lessons/search-by-snippet', location.origin);
    u.searchParams.set('q', q);
    const data = await fetchJSON(u.toString());
    if (data && data.lessons && data.lessons.length){
      const first = data.lessons[0];
      return first.tripplet_id;
    }
    return '';
  }

  function renderSkills(list){
    g.skillsUl.innerHTML = '';
    list.forEach(sk => {
      const li = document.createElement('li');
      li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.gap = '8px'; li.style.padding = '4px 0';
      const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'g_skill'; rb.value = sk.id;
      rb.addEventListener('change', ()=>{
        selectedSkillId = sk.id;
        syncGroupForm();
        if (currentTriplet && currentClass) loadStudentsForSkill();
      });
      const lbl = document.createElement('label'); lbl.textContent = `${sk.id} — ${sk.name || ''}`;
      lbl.style.cursor = 'pointer';
      li.appendChild(rb); li.appendChild(lbl);
      g.skillsUl.appendChild(li);
    });
  }

  function renderStudents(list){
    g.tbody.innerHTML = '';
    list.forEach(st => {
      const tr = document.createElement('tr');
      const tdSel = document.createElement('td');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className='g-pick'; cb.dataset.id = st.studentID;
      tdSel.appendChild(cb);
      const tdName = document.createElement('td'); tdName.textContent = st.name;
      const tdAss = document.createElement('td'); tdAss.textContent = (st.assessment==null? '—' : st.assessment);
      const tdTime = document.createElement('td'); tdTime.textContent = st.entryTime || '';
      tr.appendChild(tdSel); tr.appendChild(tdName); tr.appendChild(tdAss); tr.appendChild(tdTime);
      g.tbody.appendChild(tr);
    });
  }

  // Helper to sync group form fields to current selection
  function syncGroupForm(){
    if (!g.g2) return;
    if (g.g2.triplet)    g.g2.triplet.value = currentTriplet || '';
    if (g.g2.isSnippet)  g.g2.isSnippet.checked = true;
    if (g.g2.component)  g.g2.component.value = selectedSkillId ? String(selectedSkillId) : '';
    if (g.g2.assessment) g.g2.assessment.value = (g.score && g.score.value.trim() !== '' ? g.score.value.trim() : '');
  }

  async function loadSkills(){
    const u = new URL('/lesson-skills-merged', location.origin);
    u.searchParams.set('triplet', currentTriplet);
    const data = await fetchJSON(u.toString());
    // map minimal fields
    skills = (data||[]).map(r => ({ id: r.id, name: r.name }));
    renderSkills(skills);
    syncGroupForm();
  }

  async function loadStudentsForSkill(){
    if (!selectedSkillId) return;
    const u = new URL('/assessments/by-lesson-skill', location.origin);
    u.searchParams.set('triplet', currentTriplet);
    u.searchParams.set('componentID', String(selectedSkillId));
    u.searchParams.set('className', currentClass);
    students = await fetchJSON(u.toString());
    renderStudents(students);
  }

  async function doLoad(){
    currentClass = (g.cls.value || '').trim();
    let t = (g.lessonSearch.value || '').trim();
    if (!currentClass) { alert('Моля, въведи клас — напр. "9 Ж"'); return; }
    if (t){ currentTriplet = await searchLesson(t); }
    // If user typed a triplet directly or search didn't resolve, keep the input value
    if (!currentTriplet){ currentTriplet = t; }
    if (!currentTriplet){ alert('Моля, избери урок (триплет или source).'); return; }
    // Reflect the resolved triplet back in the single field
    g.lessonSearch.value = currentTriplet;
    await loadSkills();
    // clear students until a skill is chosen
    g.tbody.innerHTML = '';
    syncGroupForm();
  }

  async function assignNext(){
    if (!selectedSkillId){ alert('Избери умение.'); return; }
    const picks = qsa('#g_students .g-pick:checked').map(cb => parseInt(cb.dataset.id,10)).filter(Number.isInteger);
    if (picks.length === 0){ alert('Избери поне един ученик.'); return; }
    const scoreVal = g.score.value.trim();
    const score = scoreVal === '' ? null : parseInt(scoreVal,10);

    const rows = picks.map(id => ({
      lessonTriplet: currentTriplet,
      isSnippet: true,
      componentID: selectedSkillId,
      assessment: score,
      comment: '',
      studentID: id
    }));
    try{
      const r = await fetch('/student-assessment-skills-exercises', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rows })
      });
      if (!r.ok){ throw new Error('HTTP '+r.status); }
      await r.json();
      // refresh table to reflect assignments
      await loadStudentsForSkill();
      alert('Готово: добавено е следващо умение за '+picks.length+' ученици.');
    }catch(e){
      console.error(e);
      alert('Грешка при запис.');
    }
  }

  g.loadBtn && g.loadBtn.addEventListener('click', doLoad);
  g.assignBtn && g.assignBtn.addEventListener('click', assignNext);
  g.selectAll && g.selectAll.addEventListener('change', function(){
    const v = g.selectAll.checked;
    qsa('#g_students .g-pick').forEach(cb => { cb.checked = v; });
  });

  // Keep group assessment field in sync with score
  g.score && g.score.addEventListener('input', ()=>{
    if (g.g2 && g.g2.assessment) g.g2.assessment.value = g.score.value;
  });

  // Handler for submitting group action
  async function submitGroupAction(){
    if (!currentClass){ alert('Избери клас.'); return; }
    if (!currentTriplet){ alert('Избери урок.'); return; }
    if (!selectedSkillId && !(g.g2 && g.g2.component && g.g2.component.value)){
      alert('Избери умение.'); return;
    }
    const picks = qsa('#g_students .g-pick:checked').map(cb => parseInt(cb.dataset.id,10)).filter(Number.isInteger);
    if (picks.length === 0){ alert('Избери поне един ученик.'); return; }

    const trip = g.g2.triplet ? g.g2.triplet.value.trim() : currentTriplet;
    const isSn = g.g2.isSnippet ? !!g.g2.isSnippet.checked : true;
    const comp = g.g2.component && g.g2.component.value !== '' ? parseInt(g.g2.component.value,10) : (selectedSkillId||null);
    const scoreStr = g.g2.assessment ? g.g2.assessment.value.trim() : '';
    const score = scoreStr === '' ? null : parseInt(scoreStr,10);
    const thread = g.g2.thread ? g.g2.thread.value.trim() : '';
    const fuidStr = g.g2.followupId ? g.g2.followupId.value.trim() : '';
    const followId = fuidStr === '' ? null : parseInt(fuidStr,10);
    const note = g.g2.followupExp ? g.g2.followupExp.value : '';

    if (!trip){ alert('Липсва Triplet.'); return; }
    if (!Number.isInteger(comp)){ alert('Невалиден Компонент ID.'); return; }

    // Build base object for each student
    const baseRow = {
      lessonTriplet: trip,
      isSnippet: isSn,
      componentID: comp,
      assessment: score,
      comment: note || '',
      threadID: thread || null,
      followup_id: followId
    };

    const insertedIds = [];
    try{
      for (const studentID of picks) {
        const row = Object.assign({}, baseRow, { studentID });
        const r = await fetch('/student-assessment-skills-exercises', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ rows: [row] })
        });
        if (!r.ok) throw new Error('HTTP '+r.status);
        const resp = await r.json();
        // Collect inserted row id(s) if present
        if (resp && resp.rows && resp.rows[0] && resp.rows[0].id) {
          insertedIds.push(resp.rows[0].id);
        }
      }
      await loadStudentsForSkill();
      // clear only the optional fields
      if (g.g2.thread) g.g2.thread.value = '';
      if (g.g2.followupId) g.g2.followupId.value = '';
      if (g.g2.followupExp) g.g2.followupExp.value = '';
      let msg = 'Готово: записани са '+insertedIds.length+' реда.';
      if (insertedIds.length > 0) {
        msg += '\nIDs: ' + insertedIds.slice(0, 6).join(', ') + (insertedIds.length > 6 ? ', ...' : '');
      }
      alert(msg);
    }catch(e){
      console.error(e);
      alert('Грешка при запис.');
    }
  }
  if (g.g2 && g.g2.saveBtn) g.g2.saveBtn.addEventListener('click', submitGroupAction);
})();