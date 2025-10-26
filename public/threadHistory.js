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
    rows.sort((a,b)=> String(b.entrytime||b.entryTime||'').localeCompare(String(a.entrytime||a.entryTime||'')));
    for(const x of rows){
      const tr = document.createElement('tr');
      const when = x.entrytime || x.entryTime || '';
      const trip = x.lessontriplet || x.lessonTriplet || '';
      const kind = (x.issnippet || x.isSnippet) ? 'Snippet' : 'Task';
      const comp = x.componentid ?? x.componentID ?? '';
      const ass = x.assessment ?? '';
      const note = x.comment || '';
      const fup = x.followup_id ? `#${x.followup_id}` : '';
      tr.innerHTML = `<td>${when}</td><td>${trip}</td><td>${kind}</td><td>${comp}</td><td>${ass}</td><td>${note}</td><td>${fup}</td>`;
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