(function () {
  const tbody = document.getElementById('dailyLogBody');
  const addBtn = document.getElementById('addRowBtn');
  const checkDupBtn = document.getElementById('checkDupBtn');
  const saveBtn = document.getElementById('saveDailyBtn');
  const saveStatus = document.getElementById('saveStatus');
  let resources = []; // [{id,label}]

  function mkExistsBadge(kind, text){
    const span = document.createElement('span');
    span.className = 'existsBadge ' + kind;
    span.textContent = text;
    return span;
  }

  async function loadResources(){
    // You already have /resources/keywords -> returns "ID" and "KeyWords"
    const r = await fetch('/resources/keywords');
    const data = await r.json();

    resources = (Array.isArray(data) ? data : []).map(x => ({
      id: parseInt(x.ID ?? x.id, 10),
      label: String(x.KeyWords ?? x.keywords ?? x.keyWords ?? x.name ?? '').trim()
    })).filter(x => Number.isInteger(x.id) && x.label);

    resources.sort((a,b) => a.label.localeCompare(b.label, 'bg'));
  }

  function buildResourceSelect(){
    const sel = document.createElement('select');

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— избери —';
    sel.appendChild(opt0);

resources.forEach(r => {
  const opt = document.createElement('option');
  opt.value = String(r.id);
  opt.textContent = `${r.id} — ${r.label}`;   // ✅ ID преди името
  sel.appendChild(opt);
});

    return sel;
  }

  function addRow(prefill){
    const tr = document.createElement('tr');

    // 1) Number
    const tdNum = document.createElement('td');
    const inpNum = document.createElement('input');
    inpNum.type = 'text';
    inpNum.setAttribute('data-k', 'number');
    inpNum.placeholder = 'напр. 17а';
    inpNum.value = prefill?.number ?? '';
    tdNum.appendChild(inpNum);

    // 2) Page
    const tdPage = document.createElement('td');
    const inpPage = document.createElement('input');
    inpPage.type = 'number';
    inpPage.setAttribute('data-k', 'page');
    inpPage.min = '1';
    inpPage.step = '1';
    inpPage.placeholder = 'стр.';
    inpPage.value = (prefill?.page != null ? String(prefill.page) : '');
    tdPage.appendChild(inpPage);

    // 3) Resource
    const tdRes = document.createElement('td');
    const selRes = buildResourceSelect();
    selRes.setAttribute('data-k', 'resourceID');
    if (prefill?.resourceID != null) selRes.value = String(prefill.resourceID);
    tdRes.appendChild(selRes);

    // 4) Exists
    const tdExists = document.createElement('td');
    tdExists.appendChild(mkExistsBadge('b-unk', '…'));

    // 5) Session (1 or 2)
    const tdSession = document.createElement('td');
    const inpSession = document.createElement('input');
    
    inpSession.type = 'number';
    inpSession.setAttribute('data-k', 'session');
    inpSession.min = '1';
    inpSession.max = '2';
    inpSession.step = '1';
    inpSession.placeholder = '1 или 2';
    inpSession.value = (prefill?.session != null ? String(prefill.session) : '');
    tdSession.appendChild(inpSession);
    function validateSession(){
      const v = parseInt(String(inpSession.value||'').trim(), 10);
      if (!inpSession.value.trim()) {
        inpSession.style.borderColor = '#ddd';
        return;
      }
      if (v === 1 || v === 2) inpSession.style.borderColor = '#0a7';
      else inpSession.style.borderColor = '#c33';
    }
    inpSession.addEventListener('input', validateSession);
    validateSession();

    // 6) Solved
    const tdSolved = document.createElement('td');
    tdSolved.className = 'center';
    const chkSolved = document.createElement('input');
    chkSolved.type = 'checkbox';
    chkSolved.setAttribute('data-k', 'solved');
    chkSolved.checked = !!prefill?.solved;
    tdSolved.appendChild(chkSolved);

    // 7) Remove row (X)
    const tdRemove = document.createElement('td');
    tdRemove.className = 'center';
    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.textContent = '✕';
    btnRemove.title = 'Премахни този ред';
    btnRemove.style.border = '1px solid #ddd';
    btnRemove.style.background = '#fff';
    btnRemove.style.borderRadius = '999px';
    btnRemove.style.width = '28px';
    btnRemove.style.height = '28px';
    btnRemove.style.cursor = 'pointer';
    btnRemove.style.lineHeight = '1';
    btnRemove.style.fontSize = '14px';
    btnRemove.onclick = () => {
      tr.remove();
      setStatus('Редът е премахнат.');
    };
    tdRemove.appendChild(btnRemove);

    // Append in new order: num, page, res, exists, session, solved, remove
    tr.appendChild(tdNum);
    tr.appendChild(tdPage);
    tr.appendChild(tdRes);
    tr.appendChild(tdExists);
    tr.appendChild(tdSession);
    tr.appendChild(tdSolved);
    tr.appendChild(tdRemove);

    let reqSeq = 0;

    async function checkExists(){
      const number = (inpNum.value ?? '').toString().trim();
      const page = parseInt((inpPage.value ?? '').toString().trim(), 10);
      const resourceID = parseInt((selRes.value ?? '').toString().trim(), 10);

      if (!number || !Number.isInteger(page) || !Number.isInteger(resourceID)) {
        tdExists.innerHTML = '';
        tdExists.appendChild(mkExistsBadge('b-unk', '…'));
        tr.dataset.exerciseId = '';
        return;
      }

      const mySeq = ++reqSeq;

      tdExists.innerHTML = '';
      tdExists.appendChild(mkExistsBadge('b-unk', 'проверка…'));

      try{
        const url = `/exercises/exists?resourceID=${encodeURIComponent(resourceID)}&page=${encodeURIComponent(page)}&number=${encodeURIComponent(number)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (mySeq !== reqSeq) return; // stale response

        tdExists.innerHTML = '';

        if (!resp.ok || !data || data.ok === false) {
          tdExists.appendChild(mkExistsBadge('b-warn', 'грешка'));
          tr.dataset.exerciseId = '';
          return;
        }

        const count = parseInt(data.count ?? 0, 10) || 0;
        const ids = Array.isArray(data.ids) ? data.ids : [];

        if (count === 0) {
          tdExists.appendChild(mkExistsBadge('b-no', '❌ няма'));
          tr.dataset.exerciseId = '';
        } else if (count === 1) {
          tdExists.appendChild(mkExistsBadge('b-yes', '✅ има'));
          tr.dataset.exerciseId = String(ids[0] ?? '');
        } else {
          tdExists.appendChild(mkExistsBadge('b-warn', `⚠️ дубли (${count})`));
          tr.dataset.exerciseId = '';
        }
      }catch(_e){
        tdExists.innerHTML = '';
        tdExists.appendChild(mkExistsBadge('b-warn', 'грешка'));
        tr.dataset.exerciseId = '';
      }
    }

    // debounce
    let t = null;
    function scheduleCheck(){
      if (t) clearTimeout(t);
      t = setTimeout(checkExists, 300);
    }

    inpNum.addEventListener('input', scheduleCheck);
    inpPage.addEventListener('input', scheduleCheck);
    selRes.addEventListener('change', scheduleCheck);

    tbody.appendChild(tr);
    scheduleCheck();
  }
function setStatus(msg){
  if (!saveStatus) return;
  saveStatus.textContent = msg || '';
}

function clearDupHighlights(){
  Array.from(tbody.querySelectorAll('tr')).forEach(tr => tr.classList.remove('dupRow'));
}

function getRowsFromUI(){
  const out = [];
  const trs = Array.from(tbody.querySelectorAll('tr'));

  for (const tr of trs) {
    const number = (tr.querySelector('[data-k="number"]')?.value || '').toString().trim();
    const pageRaw = (tr.querySelector('[data-k="page"]')?.value || '').toString().trim();
    const resourceRaw = (tr.querySelector('[data-k="resourceID"]')?.value || '').toString().trim();
    const sessionRaw = (tr.querySelector('[data-k="session"]')?.value || '').toString().trim();
    const solved = !!tr.querySelector('[data-k="solved"]')?.checked;

    const page = parseInt(pageRaw, 10);
    const resource_id = parseInt(resourceRaw, 10);
    const session_no = sessionRaw ? parseInt(sessionRaw, 10) : null;

    const key = `${resource_id}|${page}|${number}`.toLowerCase();

    out.push({
      _tr: tr,
      number,
      page,
      resource_id,
      session_no,
      solved,
      exercise_id: tr.dataset.exerciseId ? parseInt(tr.dataset.exerciseId, 10) : null,
      _key: key
    });
  }
  return out;
}

function validateRowsForSave(rows){
  const errors = [];
  rows.forEach((r, idx) => {
    if (!r.number || !Number.isInteger(r.page) || !Number.isInteger(r.resource_id)) {
      errors.push(`Ред ${idx+1}: задължителни са №, страница и ресурс`);
    }
  });
  return errors;
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
  async function init(){
    try { await loadResources(); } catch(e){ console.error(e); }
    addRow(); // start with one empty row
  }

  if (checkDupBtn) {
  checkDupBtn.addEventListener('click', async () => {
    setStatus('Проверка за повторения…');
    clearDupHighlights();

    const rows = getRowsFromUI();
    const payloadRows = rows
      .filter(r => r.number && Number.isInteger(r.page) && Number.isInteger(r.resource_id))
      .map(r => ({ number: r.number, page: r.page, resource_id: r.resource_id }));

    if (!payloadRows.length) {
      setStatus('Няма достатъчно данни за проверка (въведи №, стр. и ресурс).');
      return;
    }

    try {
      const resp = await fetch('/daily-exe-log/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payloadRows })
      });

      const data = await resp.json();

      if (!resp.ok || !data || data.ok === false) {
        setStatus('Грешка при проверката.');
        return;
      }

      const dupSet = new Set((data.duplicates || [])
        .map(x => String(x.key || '').toLowerCase())
        .filter(Boolean)
      );

      let marked = 0;
      for (const r of rows) {
        if (!r.number || !Number.isInteger(r.page) || !Number.isInteger(r.resource_id)) continue;
        if (dupSet.has(r._key)) {
          r._tr.classList.add('dupRow');
          marked++;
        }
      }

      if (marked === 0) setStatus('Няма намерени повторения в предишни дни.');
      else setStatus(`Намерени повторения: ${marked}. (Оцветени в жълто)`);

    } catch (e) {
      console.error(e);
      setStatus('Грешка при проверката.');
    }
  });
}
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    setStatus('Записване…');

    const rows = getRowsFromUI();
    const errors = validateRowsForSave(rows);
    if (errors.length) {
      setStatus(errors.slice(0, 3).join(' | ') + (errors.length > 3 ? ` (+${errors.length-3})` : ''));
      alert('Има проблеми в редовете:\n\n' + errors.join('\n'));
      return;
    }

    const payload = {
      log_date: todayISO(),
      rows: rows.map(r => ({
        session_no: r.session_no,
        resource_id: r.resource_id,
        page: r.page,
        number: r.number,
        solved: r.solved,
        exercise_id: Number.isInteger(r.exercise_id) ? r.exercise_id : null
      }))
    };

    try {
      const resp = await fetch('/daily-exe-log/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (!resp.ok || !data || data.ok === false) {
        setStatus('Грешка при запис.');
        alert('Грешка при запис: ' + (data && data.error ? data.error : ('HTTP ' + resp.status)));
        return;
      }

      setStatus(`Записано: ${data.saved || 0} ред(а) за ${payload.log_date}.`);
    } catch (e) {
      console.error(e);
      setStatus('Грешка при запис.');
      alert('Грешка при запис. Виж конзолата.');
    }
  });
}
  addBtn.addEventListener('click', () => addRow());
  init();
})();