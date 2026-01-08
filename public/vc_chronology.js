// public/vc_chronology.js
// Dual-environment module:
// - Node.js: exports {create, update, remove} for audit logging (append-only JSON file)
// - Browser: window.VCChronology UI module for opening/rendering the log in a dedicated tab

(function(){
  // =========================
  // Browser (standalone page) module
  // =========================
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // This script is used ONLY by /vc_chronology.html (opened in a new tab).
    // It should NOT modify the main versionControl page.

    function fmtTime(ts){
      if (!ts) return '';
      const d = new Date(ts);
      if (isNaN(d)) return String(ts);
      return d.toLocaleString('bg-BG');
    }

    function describe(e){
      const parts = [];
      const type = String(e?.type || '').toLowerCase();
      const id = (e && e.id != null) ? e.id : '';

      // Common fields
      const studentID = (e && e.studentID != null) ? e.studentID : (e?.row?.studentID ?? null);
      const comp = (e && (e.componentID ?? e.componentId) != null)
        ? (e.componentID ?? e.componentId)
        : (e?.row?.componentID ?? '');
      const prev = (e && (e.previous_id ?? e.previousId) != null)
        ? (e.previous_id ?? e.previousId)
        : (e?.row?.previous_id ?? '');
      const thr = (e && e.threadID != null) ? e.threadID : (e?.row?.threadID ?? '');

      if (type) parts.push(`действие: ${type}`);
      if (id !== '') parts.push(`id: ${id}`);
      if (studentID != null && studentID !== '') parts.push(`ученик id: ${studentID}`);
      if (comp !== '') parts.push(`умение id: ${comp}`);
      if (prev !== '' && prev != null) parts.push(`prev: ${prev}`);
      if (thr) parts.push(`нишка: ${thr}`);

      // changes summary for updates
      if (type === 'update' && e?.changes && typeof e.changes === 'object') {
        const ch = e.changes;
        const touched = [];
        if (Object.prototype.hasOwnProperty.call(ch, 'comment')) touched.push('бележка');
        if (Object.prototype.hasOwnProperty.call(ch, 'assessment')) touched.push('оценка');
        if (Object.prototype.hasOwnProperty.call(ch, 'previous_id')) touched.push('previous');
        if (Object.prototype.hasOwnProperty.call(ch, 'threadID')) touched.push('нишка');
        if (touched.length) parts.push(`промени: ${touched.join('+')}`);
      }

      return parts.join(', ');
    }

    async function loadAll(){
      const table = document.getElementById('vcChronoTable');
      const hint = document.getElementById('vcHint');
      if (!table) return; // not on the standalone page

      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      if (hint) hint.textContent = 'Зареждане…';

      try {
        const r = await fetch('/vc-chronology-log', { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const arr = await r.json();
        const list = Array.isArray(arr) ? arr : [];

        if (list.length === 0) {
          if (hint) hint.textContent = 'Няма записи в хронологията.';
          return;
        }

        for (const e of list) {
          const tr = document.createElement('tr');
          const type = String(e?.type || '').toLowerCase();
          const action = (type === 'create') ? 'Създаване'
                       : (type === 'update') ? 'Промяна'
                       : (type === 'delete') ? 'Изтриване'
                       : (type || '—');
          tr.innerHTML = `
            <td>${fmtTime(e?.time)}</td>
            <td>${action}</td>
            <td style="text-align:left; white-space:normal;">${describe(e)}</td>
          `;
          tbody.appendChild(tr);
        }

        if (hint) hint.textContent = `Показани записи: ${list.length}`;
      } catch (err) {
        console.error('[vc_chronology] load failed:', err);
        if (hint) hint.textContent = 'Грешка при зареждане на хронологията.';
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadAll);
    } else {
      loadAll();
    }

    return; // stop here in browser
  }

  // =========================
  // Node.js (logger) module
  // =========================
  const fs = require('fs');
  const path = require('path');

  const LOG_FILE = path.join(__dirname, 'vc_chronology_log.json');

  function readLog(){
    try{
      if (!fs.existsSync(LOG_FILE)) return [];
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }catch{
      return [];
    }
  }

  function writeLog(arr){
    fs.writeFileSync(LOG_FILE, JSON.stringify(arr, null, 2), 'utf8');
  }

  function log(entry){
    const logArr = readLog();
    logArr.push({
      time: new Date().toISOString(),
      ...entry
    });
    writeLog(logArr);
  }

  module.exports = {
    create(data){
      log({ type: 'create', ...data });
    },
    update(data){
      log({ type: 'update', ...data });
    },
    remove(data){
      log({ type: 'delete', ...data });
    }
  };
})();