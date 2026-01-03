// public/threadHistory.js
(function(){
  let rowsCache = [];

  const threadSummaryBody = document.querySelector('#threadSummaryTable tbody');
  const threadDetailHeader = document.getElementById('threadDetailHeader');
  const threadDetailId = document.getElementById('threadDetailId');
  const threadDetailWrap = document.getElementById('threadDetailWrap');
  const threadDetailBody = document.querySelector('#threadDetailTable tbody');

  function setRows(rows){
    rowsCache = Array.isArray(rows) ? rows.slice() : [];
  }

  function renderSummary(){
    if (!threadSummaryBody) return;
    threadSummaryBody.innerHTML = '';
    const threaded = rowsCache.filter(x => (x.threadid || x.threadID));
    const byThread = new Map();
    for(const x of threaded){
      const t = (x.threadid ?? x.threadID) || '';
      const when = x.entrytime || x.entryTime || '';
      if(!byThread.has(t)) byThread.set(t, { count: 0, latest: when });
      const obj = byThread.get(t);
      obj.count += 1;
      if (when > obj.latest) obj.latest = when;
    }
    [...byThread.entries()].sort((a,b)=> a[0].localeCompare(b[0])).forEach(([t,info])=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t}</td><td>${info.count}</td><td>${info.latest}</td>`;
      tr.dataset.thread = t;
      tr.style.cursor = 'pointer';
      tr.title = 'Покажи историята на нишката';
      tr.addEventListener('click', ()=> showDetail(t));
      threadSummaryBody.appendChild(tr);
    });
  }

function showDetail(threadId){
  if (!threadId || !threadDetailBody) return;
  threadDetailBody.innerHTML = '';

  const rows = rowsCache.filter(x => (x.threadid || x.threadID) === threadId);

  // 1) Хронологично (стар -> нов)
  rows.sort((a, b) => {
    const ta = new Date(a.entrytime || a.entryTime || 0).getTime();
    const tb = new Date(b.entrytime || b.entryTime || 0).getTime();
    return ta - tb;
  });

  // 2) Root ред = този, към който НИКОЙ в нишката не сочи с followup_id
  const pointed = new Set(
    rows.map(r => Number(r.followup_id)).filter(Number.isFinite)
  );
  const rootRow = rows.find(r => {
    const rid = Number(r.id ?? r.ID);
    return Number.isFinite(rid) && !pointed.has(rid);
  }) || null;

  for (const x of rows){
    const tr = document.createElement('tr');

    // 3) Маркирай root реда
    if (rootRow) {
      const a = Number(x.id ?? x.ID);
      const b = Number(rootRow.id ?? rootRow.ID);
      if (Number.isFinite(a) && Number.isFinite(b) && a === b) {
        tr.classList.add('thread-root');
      }
    }

    const when  = x.entrytime || x.entryTime || '';
    const rowId = x.id ?? x.ID ?? '';
    const kind  = (x.issnippet || x.isSnippet) ? 'Умение' : 'Задача';
    const comp  = x.componentid ?? x.componentID ?? '';
    const ass   = x.assessment ?? '';
    const note  = (x.comment == null) ? '' : String(x.comment);
    const fup   = x.followup_id ? `← #${x.followup_id}` : '';

// Render row with EMPTY note cell (we make it editable below)
// Render row with EMPTY assessment + note cells (we make them editable below)
tr.innerHTML = `<td>${when}</td><td>${rowId}</td><td>${kind}</td><td>${comp}</td><td></td><td></td><td>${fup}</td>`;

// Make the assessment cell editable (5th column)
const assTd = tr.children[4];
if (assTd) {
  assTd.classList.add('cell-editable');
  assTd.setAttribute('contenteditable', 'true');
  assTd.setAttribute('spellcheck', 'false');
  assTd.textContent = (x.assessment == null) ? '' : String(x.assessment);
  assTd.dataset.prev = assTd.textContent;

  assTd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      assTd.blur();
    }
  });

  assTd.addEventListener('blur', async () => {
    const nextRaw = (assTd.textContent || '').trim();
    const prevRaw = (assTd.dataset.prev || '').trim();
    if (nextRaw === prevRaw) return;

    // normalize value: '' -> null, else int
    let nextVal = null;
    if (nextRaw !== '') {
      const n = parseInt(nextRaw, 10);
      if (!Number.isInteger(n)) {
        assTd.textContent = prevRaw;
        return;
      }
      // enforce 0..3
      nextVal = Math.max(0, Math.min(3, n));
    }

    // optimistic
    assTd.dataset.prev = (nextVal == null) ? '' : String(nextVal);
    assTd.textContent = assTd.dataset.prev;

    try {
      const idNum = Number(x.id ?? x.ID);
      if (!Number.isFinite(idNum)) throw new Error('Invalid row id');

      // Primary PATCH endpoint
      let r = await fetch(`/student-assessment-skills-exercises/${idNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment: nextVal })
      });

      // Fallback endpoint
      if (!r.ok) {
        r = await fetch(`/student-assessment-skills-exercises`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idNum, assessment: nextVal })
        });
        if (!r.ok) throw new Error('Save failed');
      }

      x.assessment = nextVal;
    } catch (e) {
      // revert on failure
      assTd.textContent = prevRaw;
      assTd.dataset.prev = prevRaw;
      alert('Неуспешен запис на оценката.');
    }
  });
}
// Make the note/comment cell editable (6th column)
const noteTd = tr.children[5];
if (noteTd) {
  noteTd.classList.add('cell-editable');
  noteTd.setAttribute('contenteditable', 'true');
  noteTd.setAttribute('spellcheck', 'false');
  noteTd.textContent = note;
  noteTd.dataset.prev = note;

  // Save on blur (only if changed)
  noteTd.addEventListener('blur', async () => {
    const next = (noteTd.textContent || '').trim();
    const prev = (noteTd.dataset.prev || '').trim();
    if (next === prev) return;

    // optimistic update
    noteTd.dataset.prev = next;

    try {
      const idNum = Number(x.id ?? x.ID);
      if (!Number.isFinite(idNum)) throw new Error('Invalid row id');

      // Primary PATCH endpoint
      let r = await fetch(`/student-assessment-skills-exercises/${idNum}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: next })
      });

      // Fallback endpoint (ако първият не съществува)
      if (!r.ok) {
        r = await fetch(`/student-assessment-skills-exercises`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idNum, comment: next })
        });
        if (!r.ok) throw new Error('Save failed');
      }

      // sync cache
      x.comment = next;
    } catch (e) {
      // revert on failure
      noteTd.textContent = prev;
      noteTd.dataset.prev = prev;
      alert('Неуспешен запис на бележката.');
    }
  });
}

threadDetailBody.appendChild(tr);
  }

  if (threadDetailId) threadDetailId.textContent = threadId;
  if (threadDetailHeader) threadDetailHeader.removeAttribute('hidden');
  if (threadDetailWrap) threadDetailWrap.removeAttribute('hidden');
  try { threadDetailHeader.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch(e) {}
}

  function init(){ /* reserved for future hooks */ }

  window.ThreadHistory = { setRows, renderSummary, showDetail, init };
})();