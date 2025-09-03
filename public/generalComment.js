

// public/generalComment.js
// Локално съхранение на общия коментар (textarea #studentNotes) по УЧЕНИК (ID),
// неймспейснато по клас и триплет. Възстановява текста при смяна на картата.

(function(){
  // ---- Namespaced sessionStorage key
  function storageKey(){
    var cls = (window.CLASS_INFO && window.CLASS_INFO.className) ? String(window.CLASS_INFO.className) : 'default-class';
    var trip = window.TRIPLET ? String(window.TRIPLET) : 'default-triplet';
    return 'assess_generalnote::' + cls + '::' + trip;
  }

  // ---- Load / Save
  function loadAll(){
    try { var raw = sessionStorage.getItem(storageKey()); return raw ? JSON.parse(raw) : {}; } catch(_){ return {}; }
  }
  var NOTES = loadAll(); // форма: { [studentId]: "текст" }
  var __saveTimer = null;
  function saveDebounced(){
    try { if (__saveTimer) clearTimeout(__saveTimer); } catch(_){ }
    __saveTimer = setTimeout(function(){
      try { sessionStorage.setItem(storageKey(), JSON.stringify(NOTES || {})); } catch(_e){}
      try { console.log('[GNOTE] saved', storageKey(), NOTES); } catch(_){}
    }, 80);
  }

  // ---- Helpers
  function getCurrentSid(){
    var card = document.querySelector('main.wrap .card');
    if (!card) return null;
    var sidRaw = card.getAttribute('data-student-id');
    if (sidRaw == null || sidRaw === '') return null;
    return Number.isFinite(+sidRaw) ? +sidRaw : sidRaw;
  }
  function getNote(sid){ return typeof (NOTES && NOTES[sid]) === 'string' ? NOTES[sid] : ''; }
  function setNote(sid, val){ NOTES[sid] = String(val || ''); saveDebounced(); }
  function clearNote(sid){ if (!NOTES) return; delete NOTES[sid]; saveDebounced(); }

  // ---- Wire textarea
  var el = { ta: null };
  function cache(){ el.ta = document.getElementById('studentNotes'); }

  function applyToTextarea(){
    if (!el.ta) return;
    var sid = getCurrentSid();
    var v = sid != null ? getNote(sid) : '';
    el.ta.value = v || '';
    try { console.log('[GNOTE] apply sid=%o val=%o', sid, v); } catch(_){}
  }

  function wireInput(){
    if (!el.ta) return;
    el.ta.addEventListener('input', function(){
      var sid = getCurrentSid(); if (sid == null) return;
      var v = String(el.ta.value || '').trim();
      if (v) setNote(sid, v); else clearNote(sid);
      try { console.log('[GNOTE] input sid=%o val=%o', sid, v); } catch(_){}
    });
  }

  // ---- Observe student switches and skills re-render
  function observe(){
    var card = document.querySelector('main.wrap .card');
    if (!card || !window.MutationObserver) { applyToTextarea(); return; }
    var mo = new MutationObserver(function(muts){
      var attrChanged = muts.some(function(m){ return m.type==='attributes' && m.attributeName==='data-student-id'; });
      var listChanged = muts.some(function(m){ return m.type==='childList'; });
      if (attrChanged || listChanged) applyToTextarea();
    });
    mo.observe(card, { attributes:true, attributeFilter:['data-student-id'], childList:true, subtree:true });
  }

  document.addEventListener('DOMContentLoaded', function(){
    cache();
    wireInput();
    // Възстанови при стартиране и наблюдавай след това
    setTimeout(function(){ applyToTextarea(); observe(); }, 0);

    // Safety save on unload
    try {
      window.addEventListener('beforeunload', function(){
        try { sessionStorage.setItem(storageKey(), JSON.stringify(NOTES || {})); } catch(_e){}
      });
    } catch(_e){}
  });
})();