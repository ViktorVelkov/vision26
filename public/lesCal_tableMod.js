
(function(){
  const addRowBtn = document.getElementById('addRowBtn');
  const tbody = document.getElementById('tbody');
  const statusEl = document.getElementById('status');
  if (!addRowBtn) return;

  async function createRow(initial = {}){
    try{
      const res = await fetch('/generatedyearplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initial)
      });
      if(!res.ok){
        const t = await res.text();
        throw new Error(`HTTP ${res.status} ${t}`);
      }
      return await res.json();
    }catch(err){
      console.error('Create failed:', err);
      if (statusEl) statusEl.textContent = 'Create failed. See console.';
      throw err;
    }
  }

  addRowBtn.addEventListener('click', async ()=>{
    if (statusEl) statusEl.textContent = 'Creating...';
    const today = new Date().toISOString().slice(0,10);
    const init = {
      week_number: window.currentWeek || 1,
      date: today,
      weekday: '',
      start_time: '00:00',
      end_time: '00:00',
      subject: '',
      unit: '',
      sectioninfo: '',
      unitetype: '',
      notes: '',
      duration: null,
      is_module: null,
      term: null,
      lessonCreated: null,
      lessonCode: ''
    };
    try{
      const created = await createRow(init);
      if (typeof window.loadData === 'function') {
        await window.loadData(window.currentWeek || 1);
      }
      const newId = created && created.id ? String(created.id) : null;
      if (newId){
        const rowEl = tbody.querySelector(`tr[data-id="${newId}"]`);
        if (rowEl && typeof window.flashSaved === 'function') window.flashSaved(rowEl);
        // Append delete button if not already present
        if (rowEl && !rowEl.querySelector('.deleteRowBtn')) {
          const td = document.createElement('td');
          const btn = document.createElement('button');
          btn.textContent = '🗑️';
          btn.className = 'deleteRowBtn';
          td.appendChild(btn);
          rowEl.appendChild(td);
        }
      }
      if (statusEl) statusEl.textContent = 'Row added';
    }catch(e){ /* error already shown */ }
  });

  // Delegate click for delete buttons
  tbody.addEventListener('click', async (e)=>{
    if (e.target && e.target.classList.contains('deleteRowBtn')) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = tr.dataset.id;
      if (!id) return;
      if (!confirm('Сигурни ли сте, че искате да изтриете този ред?')) return;
      try{
        const res = await fetch('/generatedyearplan/' + id, { method:'DELETE' });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`HTTP ${res.status} ${t}`);
        }
        tr.remove();
        if (statusEl) statusEl.textContent = 'Row deleted';
      }catch(err){
        console.error('Delete failed:', err);
        if (statusEl) statusEl.textContent = 'Delete failed. See console.';
      }
    }
  });
})();
