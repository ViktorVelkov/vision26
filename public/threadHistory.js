// public/threadHistory.js
(function(){
  let rowsCache = [];
  let detailSortMode = 'entry'; // 'entry' | 'added'
  let lastThreadId = null;

  const threadSummaryBody = document.querySelector('#threadSummaryTable tbody');
  const threadDetailHeader = document.getElementById('threadDetailHeader');
  const threadDetailId = document.getElementById('threadDetailId');
  const threadDetailWrap = document.getElementById('threadDetailWrap');
  const threadDetailBody = document.querySelector('#threadDetailTable tbody');
  const threadDetailSort = document.getElementById('threadDetailSort');
  const threadDetailDateTh = document.querySelector('#threadDetailTable thead th'); // първата колона
 
 
 function updateDateHeaderLabel(){
  if (!threadDetailDateTh) return;
  threadDetailDateTh.textContent = (detailSortMode === 'added')
    ? 'Добавено в нишка'
    : 'Създадено';
}

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

  function parseTimeMs(v){
    if (!v) return 0;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  function getEntryMs(r){
    return parseTimeMs(r.entrytime || r.entryTime || r.entry_time);
  }
  function getAddedMs(r){
    return parseTimeMs(r.threadAddedAt || r.thread_added_at || r.threadAdded_at || r.thread_addedAt);
  }
  function hasAddedTime(r){
    const v = r.threadAddedAt || r.thread_added_at || r.threadAdded_at || r.thread_addedAt;
    return !!(v && String(v).trim() !== '');
  }
function showDetail(threadId){
  if (!threadId || !threadDetailBody) return;
  threadDetailBody.innerHTML = '';

  const rows = rowsCache.filter(x => (x.threadid || x.threadID) === threadId);

   lastThreadId = threadId;
   updateDateHeaderLabel();
    // 1) Подредба
    if (detailSortMode !== 'added') {
      // entryTime: стар -> нов
      rows.sort((a, b) => {
        const ta = getEntryMs(a);
        const tb = getEntryMs(b);
        if (ta !== tb) return ta - tb;
        return Number(a.id ?? a.ID ?? 0) - Number(b.id ?? b.ID ?? 0);
      });
    } else {
      // added mode: keep chronological where possible, but preserve Previous chain.
      // Rows without thread_added_at should remain visible; if they can't be placed via Previous,
      // they are treated as newest (pushed to the end).

      const getId = (r) => Number(r.id ?? r.ID);
      const getPrev = (r) => {
        const p = Number(r.followup_id);
        return Number.isFinite(p) ? p : null;
      };

      const ids = new Set();
      for (const r of rows) {
        const id = getId(r);
        if (Number.isFinite(id)) ids.add(id);
      }

      // Build graph: prev -> child (where child.followup_id = prev)
      const indeg = new Map();
      const out = new Map();
      const nodeById = new Map();
      for (const r of rows) {
        const id = getId(r);
        if (!Number.isFinite(id)) continue;
        nodeById.set(id, r);
        indeg.set(id, 0);
        out.set(id, []);
      }
      for (const r of rows) {
        const id = getId(r);
        if (!Number.isFinite(id)) continue;
        const prev = getPrev(r);
        if (prev == null) continue;
        if (!ids.has(prev)) continue; // prev outside this thread
        // edge prev -> id
        indeg.set(id, (indeg.get(id) || 0) + 1);
        out.get(prev)?.push(id);
      }

      // Comparator for "available" nodes:
      // 1) has added time first; earlier added time first
      // 2) if no added time -> treated as Infinity (newest, goes last)
      // 3) tie-break by entryTime then id
      function timeKey(r){
        if (hasAddedTime(r)) return getAddedMs(r);
        return Number.POSITIVE_INFINITY;
      }
      function cmpId(aId, bId){
        const a = nodeById.get(aId);
        const b = nodeById.get(bId);
        const ta = timeKey(a);
        const tb = timeKey(b);
        if (ta !== tb) return ta - tb;
        const ea = getEntryMs(a);
        const eb = getEntryMs(b);
        if (ea !== eb) return ea - eb;
        return aId - bId;
      }

      // Kahn topological sort with priority queue (implemented as sorted array)
      const avail = [];
      for (const [id, d] of indeg.entries()) {
        if (d === 0) avail.push(id);
      }
      avail.sort(cmpId);

      const orderedIds = [];
      while (avail.length) {
        const id = avail.shift();
        orderedIds.push(id);

        const kids = out.get(id) || [];
        for (const kid of kids) {
          indeg.set(kid, (indeg.get(kid) || 0) - 1);
          if (indeg.get(kid) === 0) {
            avail.push(kid);
          }
        }
        // keep avail ordered
        avail.sort(cmpId);
      }

      // If we detected a cycle or missing ids (shouldn't happen), fall back to stable sort:
      if (orderedIds.length !== nodeById.size) {
        rows.sort((a, b) => {
          const ha = hasAddedTime(a) ? 1 : 0;
          const hb = hasAddedTime(b) ? 1 : 0;
          if (ha !== hb) return hb - ha;
          const ta = hasAddedTime(a) ? getAddedMs(a) : Number.POSITIVE_INFINITY;
          const tb = hasAddedTime(b) ? getAddedMs(b) : Number.POSITIVE_INFINITY;
          if (ta !== tb) return ta - tb;
          const ea = getEntryMs(a);
          const eb = getEntryMs(b);
          if (ea !== eb) return ea - eb;
          return Number(a.id ?? a.ID ?? 0) - Number(b.id ?? b.ID ?? 0);
        });
      } else {
        // Rebuild rows in the computed order; keep any rows without numeric id (rare) at the end.
        const ordered = orderedIds.map(id => nodeById.get(id)).filter(Boolean);
        const noId = rows.filter(r => !Number.isFinite(getId(r)));
        rows.length = 0;
        rows.push(...ordered, ...noId);
      }
    }

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
    const when = (() => {
      if (detailSortMode === 'added') {
        const s = String(
          x.threadAddedAt ||
          x.thread_added_at ||
          x.threadAdded_at ||
          x.thread_addedAt ||
          ''
        ).trim();
        return s ? s : '— няма дата —';
      }

      const e = String(x.entrytime || x.entryTime || '').trim();
      return e ? e : '— няма дата —';
    })();
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

  function init(){
    if (!threadDetailSort) return;
    threadDetailSort.value = detailSortMode;
    updateDateHeaderLabel();
    threadDetailSort.addEventListener('change', ()=>{
      const v = String(threadDetailSort.value || '').trim();
      detailSortMode = (v === 'added') ? 'added' : 'entry';
      updateDateHeaderLabel();
      if (lastThreadId) showDetail(lastThreadId);
    });
  }
  window.ThreadHistory = {
    setRows,
    renderSummary,
    showDetail,
    init,
    get lastThreadId() {
      return lastThreadId;
    }
  };
})();