// --- SHIMS (safe if already defined) ---
window.byId = window.byId || function(id){ return document.getElementById(id); };
window.escapeHtml = window.escapeHtml || function(s){
  s = (s==null ? '' : String(s));
  return s.replace(/[&<>"]+/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c] || c;
  });
};

// --- Student helpers derived from aw2 DOM ---
function getCurrentStudentId(){
  var card = document.querySelector('main.wrap .card');
  if (!card) return null;
  var sid = card.getAttribute('data-student-id');
  if (sid == null || sid === '') return null;
  return Number.isFinite(+sid) ? +sid : sid;
}
function getAllStudentIds(){
  var sel = document.getElementById('studentPicker');
  if (!sel) return [];
  var out = [];
  Array.prototype.forEach.call(sel.options || [], function(op){
    var v = op && op.value != null ? op.value : '';
    if (v === '') return;
    out.push(Number.isFinite(+v) ? +v : v);
  });
  return out;
}

// --- Tasks store ---
window.ADDED_TASKS = window.ADDED_TASKS || {};
function addTaskToStudent(sid, task){
  if (sid == null) return;
  if (!window.ADDED_TASKS[sid]) window.ADDED_TASKS[sid] = [];
  var arr = window.ADDED_TASKS[sid];
  if (!arr.some(function(t){ return t && t.key === task.key; })) arr.push(task);
}
function addTaskToAllStudents(task){ getAllStudentIds().forEach(function(sid){ addTaskToStudent(sid, task); }); }

// --- Undo stack & UI wiring ---
var __UNDO = [];
function pushAction(a){ __UNDO.push(a); updateUndoBtn(); }
function updateUndoBtn(){
  var btn = byId('undoBtn');
  if (!btn) return;
  btn.disabled = __UNDO.length === 0;
}
(function(){
  var btn = byId('undoBtn');
  if (!btn) return;
  btn.addEventListener('click', function(){
    if (!__UNDO.length) return;
    var a = __UNDO.pop();
    if (a && a.type === 'add-one'){
      var sid = a.studentId; var key = a.task && a.task.key;
      var arr = window.ADDED_TASKS[sid] || [];
      window.ADDED_TASKS[sid] = arr.filter(function(t){ return t.key !== key; });
      if (typeof window.renderSkillsForStudent === 'function') window.renderSkillsForStudent(getCurrentStudentId());
    } else if (a && a.type === 'add-all'){
      var keyAll = a.task && a.task.key;
      Object.keys(window.ADDED_TASKS).forEach(function(sid){
        window.ADDED_TASKS[sid] = (window.ADDED_TASKS[sid] || []).filter(function(t){ return t.key !== keyAll; });
      });
      if (typeof window.renderSkillsForStudent === 'function') window.renderSkillsForStudent(getCurrentStudentId());
    }
    updateUndoBtn();
  });
})();

// --- Build task from LEFT table row (exercises) ---
function makeTaskFromRow(tr){
  if (!tr) return null;
  var tds = tr.querySelectorAll('td');
  // Expected columns: [buttons], ID, RID, Page, №, cond, sol
  var idv  = tds[1] ? tds[1].textContent.trim() : '';
  var rid  = tds[2] ? tds[2].textContent.trim() : '';
  var page = tds[3] ? tds[3].textContent.trim() : '';
  var num  = tds[4] ? tds[4].textContent.trim() : '';
  var key  = 'ex:' + idv;
  return {
    key: key,
    kind: 'exercise',
    id: Number.isFinite(+idv) ? +idv : idv,
    resource: Number.isFinite(+rid) ? +rid : rid,
    page: Number.isFinite(+page) ? +page : page,
    number: Number.isFinite(+num) ? +num : num,
    label: (rid + '-' + page + '-' + num)
  };
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
                  getAllStudentIds().forEach(function(sid){ ensureForStudent(sid); });
                  pushAction({ type:'add-all', task: task });
                } else if (action === 'add-one'){
                  const cur = getCurrentStudentId();
                  if (cur != null) {
                    ensureForStudent(cur);
                    pushAction({ type:'add-one', task: task, studentId: cur });
                  }
                }
                const currentId = getCurrentStudentId();
                if (currentId && typeof window.renderSkillsForStudent === 'function') {
                  window.renderSkillsForStudent(currentId);
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
                  const cur = getCurrentStudentId();
                  if (cur != null) {
                    addTaskToStudent(cur, task);
                    pushAction({ type:'add-one', task, studentId: cur });
                  }
                }
                const currentId = getCurrentStudentId();
                if (currentId && typeof window.renderSkillsForStudent === 'function') window.renderSkillsForStudent(currentId);
              });
            }
            updateUndoBtn();
// --- Toggle show/hide for the left/right search tables panel
(function(){
  // --- Toggle show/hide for the left/right search tables panel
  var PANEL_ID = 'searchPanel';
  var BTN_ID   = 'toggleSearchPanelBtn';
  var SS_KEY   = 'aw2::searchPanelCollapsed'; // remember state in this tab only

  function getPanel(){ return document.getElementById(PANEL_ID); }
  function getBtn(){ return document.getElementById(BTN_ID); }
  function isCollapsed(panel){ return panel && panel.classList.contains('is-collapsed'); }

  function setCollapsed(panel, btn, collapsed){
    if (!panel) return;
    if (collapsed) panel.classList.add('is-collapsed');
    else panel.classList.remove('is-collapsed');
    if (btn){
      btn.textContent = collapsed ? '▸' : '▾';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('title', collapsed ? 'Покажи търсене' : 'Скрий търсене');
    }
    try { sessionStorage.setItem(SS_KEY, collapsed ? '1' : '0'); } catch(_){}
  }

  function restoreState(panel, btn){
    var raw = null;
    try { raw = sessionStorage.getItem(SS_KEY); } catch(_){}
    if (raw === null || typeof raw === 'undefined') {
      // No saved state → keep whatever the HTML has by default.
      // But sync the button UI to match current DOM state.
      var currentlyCollapsed = panel.classList.contains('is-collapsed');
      setCollapsed(panel, btn, currentlyCollapsed);
      return;
    }
    var collapsed = (raw === '1');
    setCollapsed(panel, btn, collapsed);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var panel = getPanel();
    var btn   = getBtn();
    if (!panel || !btn) return;

    // Initial restore
    restoreState(panel, btn);

    // Wire click
    btn.addEventListener('click', function(){
      var collapsed = !isCollapsed(panel);
      setCollapsed(panel, btn, collapsed);
    });
  });
})();