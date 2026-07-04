(function(){
  const $ = (id) => document.getElementById(id);

  let currentTheoremId = null;
  
  function clearResults(){
    $('theoremsBody').innerHTML = '<tr><td colspan="3">Въведи параметър за търсене.</td></tr>';
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[ch]));
  }

  async function apiJson(url, options){
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }

    if (!res.ok) {
      throw new Error((data && data.error) ? data.error : text || ('HTTP ' + res.status));
    }

    return data;
  }

  function setMessage(type, text){
    const msg = $('msg');
    msg.className = type || '';
    msg.textContent = text || '';
  }

  function setMode(id){
    currentTheoremId = Number.isInteger(id) ? id : null;
    $('saveBtn').textContent = currentTheoremId ? `Обнови #${currentTheoremId}` : 'Запази';
  }

  function fillForm(row){
    const id = parseInt(row.ID, 10);
    $('theoremId').value = Number.isInteger(id) ? String(id) : '';
    $('theoremName').value = row.t_name || '';
    $('theoremDefinition').value = row.t_definition || '';
    setMode(Number.isInteger(id) ? id : null);
  }

function clearForm(){
  currentTheoremId = null;
  $('theoremId').value = '';
  $('theoremName').value = '';
  $('theoremDefinition').value = '';
  $('saveBtn').textContent = 'Запази';
  setMessage('', '');
  $('theoremName').focus();
}

  function renderRows(rows){
    const body = $('theoremsBody');
    body.innerHTML = '';

    if (!Array.isArray(rows) || rows.length === 0) {
      body.innerHTML = '<tr><td colspan="3">Няма намерени теореми.</td></tr>';
      return;
    }

    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="idCell">${esc(row.ID)}</td>
        <td>${esc(row.t_name)}</td>
        <td class="definitionCell">${esc(row.t_definition)}</td>
      `;
      tr.addEventListener('click', () => fillForm(row));
      body.appendChild(tr);
    });
  }

  async function searchTheorems(){
    const params = new URLSearchParams();
    const id = $('searchId').value.trim();
    const name = $('searchName').value.trim();
    const definition = $('searchDefinition').value.trim();

    if (id) params.set('id', id);
    if (name) params.set('name', name);
    if (definition) params.set('definition', definition);

    setMessage('', '');

    try {
      const qs = params.toString();
      const rows = await apiJson(`/theorems/search${qs ? '?' + qs : ''}`);
      renderRows(rows);
    } catch (e) {
      setMessage('error', 'Грешка при търсене: ' + (e.message || e));
      console.error(e);
    }
    }
  async function saveTheorem(ev){
    ev.preventDefault();

    const targetId = currentTheoremId;
    const payload = {
      t_name: $('theoremName').value.trim(),
      t_definition: $('theoremDefinition').value.trim()
    };

    if (!payload.t_name && !payload.t_definition) {
      setMessage('error', 'Въведи име или дефиниция.');
      return;
    }

    $('saveBtn').disabled = true;
    setMessage('', '');

    try {
      if (targetId) {
        await apiJson(`/theorems/${targetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        setMessage('success', `Теоремата #${targetId} е обновена.`);
      } else {
        const data = await apiJson('/theorems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        setMessage('success', `Създадена е теорема #${data.ID}.`);
        if (data && data.ID) {
          $('theoremId').value = String(data.ID);
          setMode(parseInt(data.ID, 10));
        }
      }

      await searchTheorems();
    } catch (e) {
      setMessage('error', 'Грешка при запис: ' + (e.message || e));
      console.error(e);
    } finally {
      $('saveBtn').disabled = false;
    }
  }

  $('searchBtn').addEventListener('click', searchTheorems);
      $('clearSearchBtn').addEventListener('click', () => {
      $('searchId').value = '';
      $('searchName').value = '';
      $('searchDefinition').value = '';
      clearResults();
  });
  ['searchId', 'searchName', 'searchDefinition'].forEach(id => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchTheorems();
    });
  });
  $('newBtn').addEventListener('click', clearForm);
  $('theoremForm').addEventListener('submit', saveTheorem);

  searchTheorems();
})();
