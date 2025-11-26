

// public/lesCal_tableMod.js
// Stable UI helpers for Lessons Calendar action buttons.
// This file contains only frontend UI logic (no server-side code) and avoids top-level async usage.

(function(){
  'use strict';

  // Build a map from normalized header names -> column index (0-based)
  function buildHeaderMap(){
    var map = {};
    var ths = document.querySelectorAll('table thead th');
    ths.forEach(function(th, idx){
      var raw = (th.getAttribute('data-field') || (th.dataset && th.dataset.field) || th.textContent || '').trim().toLowerCase();
      if (!raw) return;
      var key = raw.replace(/\s+/g,'').replace(/[^a-z0-9_]/g,'');
      var aliases = {
        unit: 'unit',
        unitetype: 'unitetype',
        sectioninfo: 'sectioninfo',
        notes: 'notes',
        lessoncode: 'lessonCode',
        lessoncreated: 'lessonCreated',
        weeknumber: 'week_number'
      };
      if (aliases[key]) map[aliases[key]] = idx;
      else map[key] = idx;
    });
    return map;
  }

  var __lesCalHeaderMap = null; // no longer used as cache; keep for backward compatibility
  function getHeaderMap(){ return buildHeaderMap(); }

  function payloadFromRow(r){
    return {
      unit: (r.unit||'').trim(),
      unitetype: (r.unitetype||'').trim(),
      sectioninfo: (r.sectioninfo||'').trim(),
      notes: (r.notes||'').trim(),
      lessonCode: (r.lessonCode||'').trim()
    };
  }

  // Update visible row in the table with provided payload (UI only)
  function updateRowUI(rowId, payload){
    var tr = document.querySelector('tr[data-id="' + rowId + '"]');
    if (!tr) return false;
    var hmap = getHeaderMap();
    var fields = ['unit','unitetype','sectioninfo','notes','lessonCode'];
    var touched = false;
    fields.forEach(function(field){
      if (!Object.prototype.hasOwnProperty.call(payload||{}, field)) return;
      var td = tr.querySelector('td[data-field="' + field + '"]');
      if (!td && typeof hmap[field] === 'number'){
        var nth = hmap[field] + 1;
        td = tr.querySelector('td:nth-child(' + nth + ')');
      }
      if (!td) return;
      var df = (td.getAttribute('data-field') || '').toLowerCase();
      if (df === 'subject') return;
      td.textContent = String(payload[field] == null ? '' : payload[field]);
      touched = true;
    });
    return touched;
  }

  function clearRowUI(rowId){
    return updateRowUI(rowId, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });
  }

  function persistWeekAndScroll(){
    try{
      sessionStorage.setItem('lesCal.lastWeek', String(window.currentWeek || 1));
      sessionStorage.setItem('lesCal.scrollY', String(window.scrollY || 0));
    }catch(_){/* noop */}
  }

  // Init
  var tbody = document.getElementById('tbody');
  var statusEl = document.getElementById('status');
  if (!tbody) { console.debug('[lesCal UI] tbody not found; aborting'); return; }
  console.debug('[lesCal UI] tableMod initialized');

  // Restore ONLY scroll here; week restore + initial load are handled by lessonsCalendar.html
  try{
    var savedScroll = parseInt(sessionStorage.getItem('lesCal.scrollY') || '', 10);
    if (Number.isFinite(savedScroll)) setTimeout(function(){ window.scrollTo(0, savedScroll); }, 0);
  }catch(e){}

  window.addEventListener('beforeunload', function(){
    try{
      sessionStorage.setItem('lesCal.lastWeek', String(window.currentWeek || 1));
      sessionStorage.setItem('lesCal.scrollY', String(window.scrollY || 0));
    }catch(_){}
  });

  function refreshAfterChange(targetWeek){
    var w;
    try {
      // Prefer explicit target week; otherwise keep currentWeek
      var cand = (typeof targetWeek === 'number' && !Number.isNaN(targetWeek)) ? targetWeek : currentWeek;
      w = Number.isFinite(cand) ? cand : (currentWeek || 1);
    } catch (_) {
      w = currentWeek || 1;
    }

    try {
      sessionStorage.setItem('lesCal.lastWeek', String(w));
      sessionStorage.setItem('lesCal.scrollY', String(window.scrollY || 0));
    } catch (_) {}

    // Always use the local loadData defined in this module; do not reload the page
    return loadData(w).then(function(){
      var weekInput = document.querySelector('#weekNumberInput, input[type="number"]');
      if (weekInput) weekInput.value = String(w);
      // Restore scroll position if saved
      var savedScroll = parseInt(sessionStorage.getItem('lesCal.scrollY') || '', 10);
      if (Number.isFinite(savedScroll)) window.scrollTo(0, savedScroll);
    });
  }

  // Create row wrapper
  function createRow(initial){
    return fetch('/generatedyearplan', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(initial||{}) })
      .then(function(res){ if (!res.ok) return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ' ' + t); }); return res.json(); });
  }

  var addRowBtn = document.getElementById('addRowBtn');
  if (addRowBtn){
    addRowBtn.addEventListener('click', function(){
      if (statusEl) statusEl.textContent = 'Creating...';
      var today = new Date().toISOString().slice(0,10);
      var init = { week_number: window.currentWeek || 1, date: today, weekday:'', start_time:'00:00', end_time:'00:00', subject:'', unit:'', sectioninfo:'', unitetype:'', notes:'', duration:null, is_module:null, term:null, lessonCreated:null, lessonCode:'' };
      createRow(init).then(function(created){
        if (typeof window.loadData === 'function'){
          try{ sessionStorage.setItem('lesCal.lastWeek', String(window.currentWeek || 1)); sessionStorage.setItem('lesCal.scrollY', String(window.scrollY || 0)); }catch(_){}
          return window.loadData(window.currentWeek || 1);
        }
      }).then(function(){ if (statusEl) statusEl.textContent = 'Row added'; }).catch(function(err){ /* handled in createRow */ });
    });
  } else { console.debug('[lesCal UI] addRowBtn not found'); }

  // delegated actions
  function apiFetch(path, body){
    return fetch(path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body||{}) });
  }

tbody.addEventListener('click', function(e){
  var btn = (e.target && e.target.closest) ? e.target.closest('button') : null;
  if (!btn || !tbody.contains(btn)) return;
  // Едва тук блокирай default/propagation — само за истински бутон
  if (e && e.preventDefault) e.preventDefault();
  if (e && e.stopPropagation) e.stopPropagation();
    if (!btn || !tbody.contains(btn)) return;
    var tr = btn.closest('tr');
    var id = tr && tr.dataset && tr.dataset.id;
    if (!id) return;
    persistWeekAndScroll();
    console.debug('[lesCal UI] action click', { target: btn.className || btn.textContent, id: id });

    // shift-back (btn-move-left)
    if (btn.classList && btn.classList.contains('btn-move-left')){
      if (statusEl) statusEl.textContent = 'Processing…';
      persistWeekAndScroll();
      apiFetch('/lessons-calendar/generatedyearplan/' + encodeURIComponent(id) + '/shift-back-sequence', {})
        .then(function(res){
          if (res.status === 409) return res.json().then(function(data){
            // backend returns { error: 'Previous slot is not empty', reason: 'prev-not-empty', prevRowId, prevPreview }
            var msg = 'Предишният слот не е празен. Операцията не може да бъде извършена.';
            if (data && data.prevPreview) msg += '\n\nПредишен: ' + (data.prevPreview.unit || '(без тема)');
            alert(msg);
            if (statusEl) statusEl.textContent = 'Отказано';
            throw new Error('conflict');
          }); else return res;
        })
        .then(function(res){ if (!res || !res.ok) throw new Error('shift-back failed'); return res.json(); })
        .then(function(data){
          console.log('[lesCal UI] shift-back ok (prev := current, rest shifted)', { id: id, data: data });
          return refreshAfterChange(window.currentWeek);
        }).then(function(){ if (statusEl) statusEl.textContent = 'Готово'; })
        .catch(function(err){ if (String(err.message) !== 'conflict') { console.error(err); alert('Операцията не можа да се изпълни.'); if (statusEl) statusEl.textContent = 'Грешка'; } });
      return;
    }

    // push-next
    if (btn.classList && btn.classList.contains('btn-move-right')){
      if (statusEl) statusEl.textContent = 'Processing…';
      persistWeekAndScroll();
      apiFetch('/lessons-calendar/generatedyearplan/' + encodeURIComponent(id) + '/push-next', {})
        .then(function(res){
          if (res.status === 409) return res.json().then(function(data){
            var msg = 'Следващият слот не е празен.\n\nТекущ: ' + (data.current && data.current.unit ? data.current.unit : '(без тема)') + '\nСледващ: ' + (data.incoming && data.incoming.unit ? data.incoming.unit : '(без тема)') + '\n\nДа се слеят?';
            if (!confirm(msg)) { if (statusEl) statusEl.textContent = 'Отказано'; throw new Error('user-cancel'); }
            persistWeekAndScroll();
            return apiFetch('/lessons-calendar/generatedyearplan/' + encodeURIComponent(id) + '/push-next', { mergeIfConflict: true });
          }); else return res;
        })
        .then(function(res){ if (!res || !res.ok) throw new Error('push-next failed'); return res.json(); })
        .then(function(data){
          console.log('[lesCal UI] push-next ok', { id: id, data: data });
          if (data && data.movedTo && data.payloadNext) updateRowUI(data.movedTo, data.payloadNext);
          if (data && data.cleared) clearRowUI(data.cleared);
          // Refresh in-place on the same week (no full reload)
          return refreshAfterChange(window.currentWeek);
        })
        .then(function(){ if (statusEl) statusEl.textContent = 'Готово'; })
        .catch(function(err){ if (String(err.message) !== 'user-cancel') { console.error(err); alert('Операцията не можа да се изпълни.'); if (statusEl) statusEl.textContent = 'Грешка'; } });
      return;
    }

    // merge-back-sequence
    if (btn.classList && btn.classList.contains('btn-merge-prev')){
      if (statusEl) statusEl.textContent = 'Processing…';
      persistWeekAndScroll();
      apiFetch('/lessons-calendar/generatedyearplan/' + encodeURIComponent(id) + '/merge-back-sequence', {})
        .then(function(res){ if (!res.ok) throw new Error('merge-back failed'); return res.json(); })
        .then(function(data){
          console.log('[lesCal UI] merge-back ok', { id:id, data:data });
          if (data && data.updatedPrev && data.mergedInto) updateRowUI(data.mergedInto, data.updatedPrev);
          if (data && data.clearedCurrent) clearRowUI(data.clearedCurrent);
          return refreshAfterChange(window.currentWeek);
        })
        .then(function(){ if (statusEl) statusEl.textContent = 'Готово'; })
        .catch(function(err){ console.error(err); alert('Операцията не можа да се изпълни.'); if (statusEl) statusEl.textContent = 'Грешка'; });
      return;
    }

    // merge-next-keep
    if (btn.classList && btn.classList.contains('btn-merge-next')){
      if (statusEl) statusEl.textContent = 'Processing…';
      persistWeekAndScroll();
      apiFetch('/lessons-calendar/generatedyearplan/' + encodeURIComponent(id) + '/merge-next-keep', {})
        .then(function(res){ if (!res.ok) throw new Error('merge-next-keep failed'); return res.json(); })
        .then(function(data){
          console.log('[lesCal UI] merge-next-keep ok', { id:id, data:data });
          if (data && data.updatedNext && data.mergedInto) updateRowUI(data.mergedInto, data.updatedNext);
          if (data && data.clearedCurrent) clearRowUI(data.clearedCurrent);
          return refreshAfterChange(window.currentWeek);
        })
        .then(function(){ if (statusEl) statusEl.textContent = 'Готово'; })
        .catch(function(err){ console.error(err); alert('Операцията не можа да се изпълни.'); if (statusEl) statusEl.textContent = 'Грешка'; });
      return;
    }

    // delete
    if (btn.classList && btn.classList.contains('btn-delete')){
      if (!confirm('Delete this lesson?')) return;
      if (statusEl) statusEl.textContent = 'Deleting…';
      persistWeekAndScroll();
      fetch('/generatedyearplan/' + encodeURIComponent(id), { method:'DELETE' })
        .then(function(res){ if (!res.ok) throw new Error('delete failed'); if (typeof window.loadData === 'function') return window.loadData(window.currentWeek || 1); })
        .then(function(){ if (statusEl) statusEl.textContent = 'Row deleted'; })
        .catch(function(err){ console.error(err); alert('Delete failed'); if (statusEl) statusEl.textContent = 'Delete failed'; });
      return;
    }
  });

  // expose helpers globally for debugging
  window.lesCal_updateRowUI = updateRowUI;
  window.lesCal_clearRowUI = clearRowUI;
  window.lesCal_refreshAfterChange = refreshAfterChange;

})();
