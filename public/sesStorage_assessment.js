// public/sesStorage_assessment.js
// Логика за цветните "пилчета" (0–3):
// - управлява активния клас .is-active
// - пази стойности в in-memory карта SCORES
// - при смяна на ученик (картата сменя data-student-id) възстановява цветовете

(function(){
  // --- sessionStorage helpers (namespace per class + triplet)
  function storageKey(){
    var cls = (window.CLASS_INFO && window.CLASS_INFO.className) ? String(window.CLASS_INFO.className) : 'default-class';
    var trip = window.TRIPLET ? String(window.TRIPLET) : 'default-triplet';
    return 'assess_scores::' + cls + '::' + trip;
  }
  function loadScores(){
    try {
      var raw = sessionStorage.getItem(storageKey());
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch(_) { return {}; }
  }
  var __saveTimer = null;
  function saveScoresDebounced(data){
    try { if (__saveTimer) clearTimeout(__saveTimer); } catch(_){}
    __saveTimer = setTimeout(function(){
      try { sessionStorage.setItem(storageKey(), JSON.stringify(data || {})); }
      catch(e){ /* ignore quota */ }
    }, 50);
  }

  // --- SCORES persisted in sessionStorage: { [studentId]: { [snippetKey]: number } }
  var SCORES = loadScores();
  function getScore(sid, key){
    return (SCORES[sid] && typeof SCORES[sid][key] !== 'undefined') ? SCORES[sid][key] : null;
  }
  function setScore(sid, key, val){
    if (!SCORES[sid]) SCORES[sid] = {};
    SCORES[sid][key] = val;
    saveScoresDebounced(SCORES);
  }
  function clearScore(sid, key){
    if (!SCORES[sid]) return;
    delete SCORES[sid][key];
    if (Object.keys(SCORES[sid]).length === 0) delete SCORES[sid];
    saveScoresDebounced(SCORES);
  }

  // Намира текущата карта и studentId
  function getCurrentCard(){
    var card = document.querySelector('main.wrap .card');
    if (!card) return { card: null, sid: null };
    var sidRaw = card.getAttribute('data-student-id');
    var sid = sidRaw != null && sidRaw !== '' ? (Number.isFinite(+sidRaw) ? +sidRaw : sidRaw) : null;
    return { card: card, sid: sid };
  }

  // Прилага .is-active по запазените оценки върху видимата карта
  function applySavedScores(){
    var ctx = getCurrentCard();
    if (!ctx.card || ctx.sid == null) return;
    var sid = ctx.sid;
    var ratings = ctx.card.querySelectorAll('.rating[data-snippet-id]');
    ratings.forEach(function(r){
      var key = r.getAttribute('data-snippet-id');
      var saved = getScore(sid, key);
      r.querySelectorAll('.pill').forEach(function(p){ p.classList.remove('is-active'); });
      if (saved != null){
        var sel = r.querySelector('.pill[data-val="' + saved + '"]');
        if (sel) sel.classList.add('is-active');
      }
    });
  }

  // Делегирани кликове върху пилчетата (за текущата карта)
  function wireClicks(){
    var wrap = document.querySelector('main.wrap');
    if (!wrap) return;
    wrap.addEventListener('click', function(ev){
      var t = ev.target;
      if (!t || !t.classList || !t.classList.contains('pill')) return;
      var rating = t.closest('.rating');
      var key = rating ? rating.getAttribute('data-snippet-id') : null;
      if (!rating || !key) return;
      var v = parseInt(t.getAttribute('data-val'), 10);
      if (!Number.isFinite(v)) return;
      var ctx = getCurrentCard();
      if (ctx.sid == null) return;

      // ако кликнем върху вече активното пилче → изчисти оценката (toggle off)
      if (t.classList.contains('is-active')){
        rating.querySelectorAll('.pill').forEach(function(p){ p.classList.remove('is-active'); });
        clearScore(ctx.sid, key);
        return;
      }

      // иначе: визуално означи избора (само една активна в групата)
      rating.querySelectorAll('.pill').forEach(function(p){ p.classList.remove('is-active'); });
      t.classList.add('is-active');

      // запази новата стойност
      setScore(ctx.sid, key, v);
    });
  }

  // Следи за смяна на ученика (променя се data-student-id на .card)
  function observeStudentSwitch(){
    var card = document.querySelector('main.wrap .card');
    if (!card || !window.MutationObserver) { applySavedScores(); return; }
    var mo = new MutationObserver(function(muts){
      var changed = muts.some(function(m){ return m.type === 'attributes' && m.attributeName === 'data-student-id'; });
      if (changed) applySavedScores();
    });
    mo.observe(card, { attributes: true, attributeFilter: ['data-student-id'] });
    // Ако списъкът с умения се презаписва при навигация, може да има нужда и от observer за children:
    var skills = card.querySelector('#skillsList') || card;
    var mo2 = new MutationObserver(function(){ applySavedScores(); });
    mo2.observe(skills, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', function(){
    wireClicks();
    try { SCORES = loadScores(); } catch(_){}
    // Дай шанс на aw2 да дорендерира списъка, после маркирай
    setTimeout(applySavedScores, 0);
    observeStudentSwitch();
    try {
      window.addEventListener('beforeunload', function(){
        try { sessionStorage.setItem(storageKey(), JSON.stringify(SCORES || {})); } catch(_e){}
      });
    } catch(_e){}
  });
})();