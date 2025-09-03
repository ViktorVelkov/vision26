// --- SHIMS (safe if already defined) ---
window.byId = window.byId || function (id) { return document.getElementById(id); };
window.escapeHtml = window.escapeHtml || function (s) {
    s = (s == null ? '' : String(s));
    return s.replace(/[&<>"]+/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c;
    });
};

// --- Student helpers derived from aw2 DOM ---
function getCurrentStudentId() {
    var card = document.querySelector('main.wrap .card');
    if (!card) return null;
    var sid = card.getAttribute('data-student-id');
    if (sid == null || sid === '') return null;
    return Number.isFinite(+sid) ? +sid : sid;
}

// --- Helpers to probe UI like sesStorage (read from .card[data-student-id]) ---
function __readCardSid(){
  var card = document.querySelector('main.wrap .card');
  if (!card) return null;
  var sidRaw = card.getAttribute('data-student-id');
  if (sidRaw == null || sidRaw === '') return null;
  return Number.isFinite(+sidRaw) ? +sidRaw : String(sidRaw);
}
function __dispatchChange(el){
  if (!el) return;
  var evt = new Event('change', {bubbles:true});
  el.dispatchEvent(evt);
}
function __probeCollectStudentIds(){
  return new Promise(function(resolve){
    var sel = document.getElementById('studentPicker');
    if (!sel || !sel.options || !sel.options.length){ resolve([]); return; }
    var opts = Array.prototype.slice.call(sel.options);
    var originalIndex = sel.selectedIndex;
    var acc = [];
    function step(i){
      if (i>=opts.length){
        if (originalIndex>=0){ sel.selectedIndex = originalIndex; __dispatchChange(sel); }
        var seen = new Set();
        var out = acc.filter(function(x){ var k = String(x); if (seen.has(k)) return false; seen.add(k); return true; });
        console.log('[ADD-ALL][probe] collected via card data-student-id ->', out);
        resolve(out);
        return;
      }
      sel.selectedIndex = i; __dispatchChange(sel);
      setTimeout(function(){
        var sid = __readCardSid();
        if (sid!=null) acc.push(sid);
        step(i+1);
      }, 0);
    }
    step(0);
  });
}
function getAllStudentIds() {
    // 1) Primary source — aw2 keeps a students array in memory; prefer that.
    function extractId(s){
        if (!s) return null;
        var idv = (s.id != null ? s.id : (s.sid != null ? s.sid : (s.studentId != null ? s.studentId : s.StudentID)));
        if (idv == null) return null;
        return Number.isFinite(+idv) ? +idv : String(idv);
    }
    function pickStudentsPool(){
        if (window.CLASS_INFO && Array.isArray(window.CLASS_INFO.students) && window.CLASS_INFO.students.length) return window.CLASS_INFO.students;
        if (Array.isArray(window.STUDENTS) && window.STUDENTS.length) return window.STUDENTS;
        if (Array.isArray(window.ALL_STUDENTS) && window.ALL_STUDENTS.length) return window.ALL_STUDENTS;
        if (Array.isArray(window.__STUDENTS) && window.__STUDENTS.length) return window.__STUDENTS;
        if (Array.isArray(window.STUDENTS_LIST) && window.STUDENTS_LIST.length) return window.STUDENTS_LIST;
        if (Array.isArray(window.LIST_OF_STUDENTS) && window.LIST_OF_STUDENTS.length) return window.LIST_OF_STUDENTS;
        return null;
    }

    var pool = pickStudentsPool();
    if (pool) {
        var ids = pool.map(extractId).filter(function(x){ return x !== null && x !== undefined && x !== ''; });
        // de-dupe while preserving order
        var seen = new Set();
        var uniq = ids.filter(function(x){ var k = String(x); if (seen.has(k)) return false; seen.add(k); return true; });
        console.log('[ADD-ALL] getAllStudentIds (pool) ->', uniq);
        return uniq;
    }

    // 2) Fallback — derive from #studentPicker options (value/data-* or name→ID mapping)
    var sel = document.getElementById('studentPicker');
    if (!sel) { console.log('[ADD-ALL] getAllStudentIds fallback: no picker'); return []; }

    function resolveIdFromName(name) {
        var p = pickStudentsPool();
        if (!p) return null;
        name = String(name||'').trim();
        for (var i=0;i<p.length;i++){
            var s = p[i]||{};
            var nm = String(s.name || s.fullname || s.FullName || s.display || s.studentName || '').trim();
            if (nm && nm === name) return extractId(s);
        }
        return null;
    }

    var out = [];
    Array.prototype.forEach.call(sel.options || [], function(op){
        if (!op) return;
        var v = (op.value != null ? String(op.value).trim() : '');
        if (!v) v = (op.getAttribute('data-sid') || '').trim();
        if (!v) v = (op.getAttribute('data-id') || '').trim();
        if (!v) v = (op.getAttribute('data-student-id') || '').trim();
        if (!v) {
            var nm = (op.textContent || op.innerText || '').trim();
            var m = resolveIdFromName(nm);
            if (m != null) out.push(m);
            return;
        }
        var isNumeric = Number.isFinite(Number(v));
        if (!isNumeric) {
            var mapped = resolveIdFromName(v);
            if (mapped != null) { out.push(mapped); return; }
        }
        var vn = Number(v);
        out.push(Number.isFinite(vn) ? vn : v);
    });
    console.log('[ADD-ALL] getAllStudentIds (fallback) ->', out);
    return out;
}

// --- Tasks store ---
window.ADDED_TASKS = window.ADDED_TASKS || {};
(function () {
    function storageKey() {
        var cls = (window.CLASS_INFO && window.CLASS_INFO.className) ? String(window.CLASS_INFO.className) : 'default-class';
        var trip = window.TRIPLET ? String(window.TRIPLET) : 'default-triplet';
        return 'aw2::added_tasks::' + cls + '::' + trip;
    }
    function load() { try { var raw = sessionStorage.getItem(storageKey()); return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; } }
    function saveNow() { try { sessionStorage.setItem(storageKey(), JSON.stringify(window.ADDED_TASKS || {})); } catch (_e) { } }
    var t = null; function saveDeb() { try { if (t) clearTimeout(t); } catch (_) { } t = setTimeout(saveNow, 80); }
    // initialize from storage if empty
    var loaded = load();
    if (!window.ADDED_TASKS || Object.keys(window.ADDED_TASKS).length === 0) window.ADDED_TASKS = loaded || {};
    window.__ADDED_TASKS_STORE__ = { saveNow: saveNow, saveDebounced: saveDeb, reload: function () { window.ADDED_TASKS = load() || {}; } };
})();
function addTaskToStudent(sid, task) {
    if (sid == null || !task) return;
    var key = task.key;
    var sidKey = String(sid); // normalize so writer/reader use identical keys
    if (!window.ADDED_TASKS[sidKey]) window.ADDED_TASKS[sidKey] = [];
    var arr = window.ADDED_TASKS[sidKey];
    if (!arr.some(function (t) { return t && t.key === key; })) arr.push(task);
    if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
}

function addTaskToAllStudents(task){
  function looksLikeNames(arr){
    return Array.isArray(arr) && arr.length && arr.every(function(x){
      return typeof x === 'string' && !/^\d+$/.test(x);
    });
  }
  var ids = getAllStudentIds();
  console.log('[ADD-ALL] addTaskToAllStudents() collected IDs:', ids, ' task:', task);
  if (!ids || !ids.length || looksLikeNames(ids)){
    return __probeCollectStudentIds().then(function(realIds){
      var use = (realIds && realIds.length) ? realIds
               : (function(){ var cur = getCurrentStudentId(); return cur!=null?[cur]:[]; })();
      use.forEach(function(sid){ addTaskToStudent(sid, task); });
      if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
    });
  }
  ids.forEach(function(sid){ addTaskToStudent(sid, task); });
  if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
  return Promise.resolve();
}

// --- Undo stack & UI wiring ---
var __UNDO = [];
function pushAction(a) { __UNDO.push(a); updateUndoBtn(); }
function updateUndoBtn() {
    var btn = byId('undoBtn');
    if (!btn) return;
    btn.disabled = __UNDO.length === 0;
}
(function () {
    var btn = byId('undoBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        if (!__UNDO.length) return;
        var a = __UNDO.pop();
        if (a && a.type === 'add-one') {
            var sid = a.studentId; var key = a.task && a.task.key;
            var arr = window.ADDED_TASKS[sid] || [];
            window.ADDED_TASKS[sid] = arr.filter(function (t) { return t.key !== key; });
            if (typeof window.renderSkillsForStudent === 'function') window.renderSkillsForStudent(getCurrentStudentId());
        } else if (a && a.type === 'add-all') {
            var keyAll = a.task && a.task.key;
            Object.keys(window.ADDED_TASKS).forEach(function (sid) {
                window.ADDED_TASKS[sid] = (window.ADDED_TASKS[sid] || []).filter(function (t) { return t.key !== keyAll; });
            });
            if (typeof window.renderSkillsForStudent === 'function') window.renderSkillsForStudent(getCurrentStudentId());
        }
        updateUndoBtn();
    });
})();

// --- Build task from LEFT table row (exercises) ---
function makeTaskFromRow(tr) {
    if (!tr) return null;
    var tds = tr.querySelectorAll('td');
    // Expected columns: [buttons], ID, RID, Page, №, cond, sol
    var idv = tds[1] ? tds[1].textContent.trim() : '';
    var rid = tds[2] ? tds[2].textContent.trim() : '';
    var page = tds[3] ? tds[3].textContent.trim() : '';
    var num = tds[4] ? tds[4].textContent.trim() : '';
    var key = 'ex:' + idv;
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

function ensureTaskVisibleForCurrent(task) {
    try {
        var list = document.getElementById('addedTasksList');
        var empty = document.getElementById('addedTasksEmpty');
        var counter = document.getElementById('addedTasksCount');
        if (!list) return;

        var exId = task && (task.id != null ? String(task.id) : '');
        if (!exId) exId = (task && task.key) ? String(task.key) : '';
        if (list.querySelector('li[data-added-task="1"][data-ex-id="' + exId + '"]')) return;

        var li = document.createElement('li');
        li.setAttribute('data-added-task', '1');
        li.setAttribute('data-ex-id', exId);

        var label = (task && task.label) ? String(task.label) : (exId ? ('ex ' + exId) : '-');
        var name = document.createElement('div'); name.className = 'added-label'; name.textContent = label + ' ';
        var sidSpan = document.createElement('span'); sidSpan.className = 'sk-id'; sidSpan.textContent = '(ID ' + exId + ')';
        name.appendChild(sidSpan);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'remove-task';
        btn.setAttribute('data-action', 'remove');
        btn.setAttribute('data-key', task && task.key ? String(task.key) : '');
        btn.textContent = 'Премахни';

        li.appendChild(name);
        li.appendChild(btn);
        list.appendChild(li);

        if (empty) empty.style.display = 'none';
        if (counter) counter.textContent = String(list.querySelectorAll('li[data-added-task="1"]').length);
    } catch (_) { }
}

function applyAddedTasksToCurrentCard() {
    try {
        var list = document.getElementById('addedTasksList');
        var empty = document.getElementById('addedTasksEmpty');
        var counter = document.getElementById('addedTasksCount');
        if (!list) return;
        list.innerHTML = '';

        var sid = getCurrentStudentId();
        if (sid == null) { if (empty) empty.style.display = ''; if (counter) counter.textContent = '0'; return; }


        var tasks = (window.ADDED_TASKS && window.ADDED_TASKS[String(sid)]) || [];
        if (!Array.isArray(tasks) || !tasks.length) { if (empty) empty.style.display = ''; if (counter) counter.textContent = '0'; return; }

        tasks.forEach(function (t) { ensureTaskVisibleForCurrent(t); });
        if (counter) counter.textContent = String(tasks.length);
    } catch (_) { }
}

// Left search UI (Exercises)
const leftInput = byId('leftSearchInput');
const leftBtn = byId('leftSearchBtn');
const leftHead = byId('leftHead');
const leftBody = byId('leftBody');
// Right search UI (Exercises–Snippets relationship)
// Define with safe fallbacks so missing elements won't break the page
const rightInput = byId('rightSearchInput') || null;
const rightBtn = byId('rightSearchBtn') || { addEventListener: () => { } };
let rightHeadEl = byId('rightHead');
if (!rightHeadEl) rightHeadEl = document.createElement('tr');
let rightBodyEl = byId('rightBody');
if (!rightBodyEl) rightBodyEl = document.createElement('tbody');
// ---- RIGHT (relationships) search + buttons A/1 ----
function setRightHeadVisible(visible) {
    if (!rightHeadEl) return;
    rightHeadEl.style.display = visible ? '' : 'none';
    rightHeadEl.innerHTML = visible
        ? '<th>RID</th><th>Page</th><th>№</th><th>Свързан snippet</th><th>Бележки</th>'
        : '';
}

function renderRightRows(rows) {
    if (!rightBodyEl) return;
    if (!rows || !rows.length) {
        setRightHeadVisible(false);
        rightBodyEl.innerHTML = '<tr><td class="muted" colspan="5">Няма резултати</td></tr>';
        return;
    }
    setRightHeadVisible(true);
    rightBodyEl.innerHTML = rows.map(function (r) {
        var rid = (r.resource ?? r.Resource ?? r.resourceid ?? r.ResourceID ?? '');
        var page = (r.page ?? r.Page ?? '');
        var num = (r.number ?? r.Number ?? '');
        var rel = (r.relatedSnippet ?? r.relatedsnippet ?? '');
        var com = (r.comments ?? '');
        return '<tr>'
            + '<td>' + escapeHtml(String(rid)) + '</td>'
            + '<td>' + escapeHtml(String(page)) + '</td>'
            + '<td>' + escapeHtml(String(num)) + '</td>'
            + '<td>' + escapeHtml(String(rel)) + '</td>'
            + '<td>' + escapeHtml(String(com)) + '</td>'
            + '</tr>';
    }).join('');
}

function doRightSearch() {
    if (!rightInput) { if (rightBodyEl) rightBodyEl.innerHTML = ''; return; }
    const term = (rightInput.value || '').trim();
    if (!term) { renderRightRows([]); return; }

    // позволяваме няколко числа, разделени с , ; или интервали
    const ids = term.split(/[\s,;]+/)
        .map(s => parseInt(s, 10))
        .filter(n => Number.isInteger(n));
    if (ids.length === 0) { renderRightRows([]); return; }

    const q = ids.join(','); // изпращаме ги събрани
    fetch('/exercises-rel/search?q=' + encodeURIComponent(q))
        .then(r => r.ok ? r.json() : Promise.reject(r))
        .then(rows => renderRightRows(Array.isArray(rows) ? rows : []))
        .catch(() => renderRightRows([]));
}

// Build normalized task object for relationship triple (resource-page-number)
function buildRelTask(resource, page, number) {
    const r = parseInt(resource, 10) || 0;
    const p = parseInt(page, 10) || 0;
    const n = parseInt(number, 10) || 0;
    const key = 'rel:' + r + '-' + p + '-' + n;
    return { key, kind: 'exercise', resource: r, page: p, number: n, label: (r + '-' + p + '-' + n) };
}

// Delegate clicks from right result rows for Add All / Add One + push to undo history
if (rightBodyEl) {
    rightBodyEl.addEventListener('click', function (ev) {
        const btn = ev.target.closest('.circle-btn');
        if (!btn) return;

        const action = btn.dataset.action;
        const task = buildRelTask(btn.dataset.r, btn.dataset.p, btn.dataset.n);

        // Ensure data store exists
        window.ADDED_TASKS = window.ADDED_TASKS || {};
        function ensureForStudent(sid) {
            var sidKey = String(sid);
            if (!window.ADDED_TASKS[sidKey]) window.ADDED_TASKS[sidKey] = [];
            const arr = window.ADDED_TASKS[sidKey];
            if (!arr.some(function (t) { return t.key === task.key; })) {
                arr.push(task);
            }
        }

        let addedTask = false;
        if (action === 'add-all') {
            addTaskToAllStudents(task).then(function(){
                pushAction({ type: 'add-all', task: task });
                if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
                applyAddedTasksToCurrentCard();
            });
            addedTask = true;
        } else if (action === 'add-one') {
            const cur = getCurrentStudentId();
            if (cur != null) {
                ensureForStudent(cur);
                pushAction({ type: 'add-one', task: task, studentId: cur });
                addedTask = true;
            }
        }

        if (addedTask) {
            if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
            applyAddedTasksToCurrentCard();
        }

        const currentId = getCurrentStudentId();
        if (currentId && typeof window.renderSkillsForStudent === 'function') {
            window.renderSkillsForStudent(currentId);
        }
    });
}

// Bind handlers for right search
if (rightBtn) rightBtn.addEventListener('click', doRightSearch);
if (rightInput) rightInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doRightSearch(); });

function setLeftHeadVisible(visible) {
    if (!leftHead) return;
    leftHead.style.display = visible ? '' : 'none';
    leftHead.innerHTML = visible
        ? '<th style="width:64px"></th><th>ID</th><th>RID</th><th>Page</th><th>№</th><th>Условие</th><th>Решение</th>'
        : '';
}
// --- REMOVE toPublicUrl and linkOrDash helpers entirely ---
function renderLeftRows(rows) {
    if (!leftBody) return;
    if (!rows || !rows.length) {
        setLeftHeadVisible(false);
        leftBody.innerHTML = '<tr><td class="muted" colspan="7">Няма резултати</td></tr>';
        return;
    }
    setLeftHeadVisible(true);
    leftBody.innerHTML = rows.map(function (r) {
        var idv = (r.ID ?? r.id ?? '');
        var rid = (r.ResourceID ?? r.resourceid ?? '');
        var page = (r.Page ?? r.page ?? '');
        var num = (r.Number ?? r.number ?? '');
        var cond = (r.has_assignmentCondition ? '✔︎' : '—');
        var sol = (r.has_solution ? '✔︎' : '—');
        var addCell = '<td class="add-cell" title="Добави упражнение">'
            + '<button class="circle-btn circle-btn--all" data-action="add-all" data-ex-id="' + idv + '" title="Добави за всички">A</button>'
            + '<button class="circle-btn circle-btn--one" data-action="add-one" data-ex-id="' + idv + '" title="Добави за този ученик">1</button>'
            + '</td>';
        return '<tr>'
            + addCell
            + '<td>' + idv + '</td>'
            + '<td>' + rid + '</td>'
            + '<td>' + page + '</td>'
            + '<td>' + num + '</td>'
            + '<td>' + cond + '</td>'
            + '<td>' + sol + '</td>'
            + '</tr>';
    }).join('');
}
async function doLeftSearch() {
    if (!leftInput) return;
    const q = (leftInput.value || '').trim();
    if (!q) {
        setLeftHeadVisible(false);
        leftBody.innerHTML = '<tr><td class="muted" colspan="6">Няма резултати</td></tr>';
        return;
    }
    try {
        const resp = await fetch('/exercises/search?q=' + encodeURIComponent(q));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = await resp.json();
        renderLeftRows(rows);
    } catch (e) {
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
    leftBody.addEventListener('click', function (e) {
        const btn = e.target.closest('.circle-btn');
        if (!btn) return;
        const tr = btn.closest('tr');
        const task = makeTaskFromRow(tr);
        if (!task) return;

        if (btn.dataset.action === 'add-all') {
            console.log(task);
            addTaskToAllStudents(task).then(function(){
                pushAction({ type: 'add-all', task });
                if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
                applyAddedTasksToCurrentCard();
            });
        } else if (btn.dataset.action === 'add-one') {
            const cur = getCurrentStudentId();
            if (cur != null) {
                addTaskToStudent(cur, task);
                pushAction({ type: 'add-one', task, studentId: cur });
            }
            if (window.__ADDED_TASKS_STORE__) window.__ADDED_TASKS_STORE__.saveDebounced();
            applyAddedTasksToCurrentCard();
            const currentId = getCurrentStudentId();
            if (currentId && typeof window.renderSkillsForStudent === 'function') {
                window.renderSkillsForStudent(currentId);
            }
        }
    });
}
updateUndoBtn();
// --- Remove a task from the current student's list (panel button) ---
(function () {
    document.addEventListener('click', function (ev) {
        var btn = ev.target.closest && ev.target.closest('.remove-task');
        if (!btn) return;
        var sid = getCurrentStudentId(); if (sid == null) return;
        var key = btn.getAttribute('data-key') || '';
        var sidKey = String(sid);
        var arr = (window.ADDED_TASKS && window.ADDED_TASKS[sidKey]) ? window.ADDED_TASKS[sidKey] : [];
        window.ADDED_TASKS[sidKey] = arr.filter(function (t) { return (t && t.key) !== key; });
        if (window.ADDED_TASKS[sidKey] && window.ADDED_TASKS[sidKey].length === 0) delete window.ADDED_TASKS[sidKey];
        if (window.__ADDED_TASKS_STORE__) { window.__ADDED_TASKS_STORE__.saveNow(); }
        applyAddedTasksToCurrentCard();
    });

    // Repaint when current student changes
    document.addEventListener('DOMContentLoaded', function () {
        applyAddedTasksToCurrentCard();
        var card = document.querySelector('main.wrap .card');
        if (!card || !window.MutationObserver) return;
        var mo = new MutationObserver(function (muts) {
            var changed = muts.some(function (m) { return m.type === 'attributes' && m.attributeName === 'data-student-id'; });
            if (changed) setTimeout(applyAddedTasksToCurrentCard, 0);
        });
        mo.observe(card, { attributes: true, attributeFilter: ['data-student-id'] });
        var prev = document.getElementById('prevBtn');
        var next = document.getElementById('nextBtn');
        var pick = document.getElementById('studentPicker');
        if (prev) prev.addEventListener('click', function () { setTimeout(applyAddedTasksToCurrentCard, 0); });
        if (next) next.addEventListener('click', function () { setTimeout(applyAddedTasksToCurrentCard, 0); });
        if (pick) pick.addEventListener('change', function () { setTimeout(applyAddedTasksToCurrentCard, 0); });
    });
})();
// --- Toggle show/hide for the left/right search tables panel
(function () {
    // --- Toggle show/hide for the left/right search tables panel
    var PANEL_ID = 'searchPanel';
    var BTN_ID = 'toggleSearchPanelBtn';
    var SS_KEY = 'aw2::searchPanelCollapsed'; // remember state in this tab only

    function getPanel() { return document.getElementById(PANEL_ID); }
    function getBtn() { return document.getElementById(BTN_ID); }
    function isCollapsed(panel) { return panel && panel.classList.contains('is-collapsed'); }

    function setCollapsed(panel, btn, collapsed) {
        if (!panel) return;
        if (collapsed) panel.classList.add('is-collapsed');
        else panel.classList.remove('is-collapsed');
        if (btn) {
            btn.textContent = collapsed ? '▸' : '▾';
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.setAttribute('title', collapsed ? 'Покажи търсене' : 'Скрий търсене');
        }
        try { sessionStorage.setItem(SS_KEY, collapsed ? '1' : '0'); } catch (_) { }
    }

    function restoreState(panel, btn) {
        var raw = null;
        try { raw = sessionStorage.getItem(SS_KEY); } catch (_) { }
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

    document.addEventListener('DOMContentLoaded', function () {
        var panel = getPanel();
        var btn = getBtn();
        if (!panel || !btn) return;

        // Initial restore
        restoreState(panel, btn);

        // Wire click
        btn.addEventListener('click', function () {
            var collapsed = !isCollapsed(panel);
            setCollapsed(panel, btn, collapsed);
        });
    });
})();