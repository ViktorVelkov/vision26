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
  // expose live reference so other scripts (submit) can read it
window.__SKILL_SCORES__ = SCORES;
  function getComponentKeyFromRatingEl(ratingEl){
    if (!ratingEl) return null;
    // Prefer KeySkills / new attribute
    var k = ratingEl.getAttribute('data-component-id');
    if (k != null && String(k).trim() !== '') return String(k).trim();
    // Back-compat: legacy attribute
    var k2 = ratingEl.getAttribute('data-snippet-id');
    if (k2 != null && String(k2).trim() !== '') return String(k2).trim();
    return null;
  }
  function getScore(sid, key){
    return (SCORES[sid] && typeof SCORES[sid][key] !== 'undefined') ? SCORES[sid][key] : null;
  }
  function setScore(sid, key, val){
    if (!SCORES[sid]) SCORES[sid] = {};
    SCORES[sid][key] = val;
    saveScoresDebounced(SCORES);
  }
  function clearScore(sid, key){
    if (!SCORES[sid]) SCORES[sid] = {};
    SCORES[sid][key] = null; // keep the skill key; represent "no score" as null
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

  // Normalize potential student id values to numeric-id strings; return null if not numeric
  function __normSid(v){
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    var s = String(v).trim();
    return (/^\d+$/.test(s)) ? s : null;
  }

  // --- Seed helpers: map ALL skills to ALL students with null values initially
  function collectAllStudentIds(){
    // Prefer explicit class roster
    if (window.CLASS_INFO && Array.isArray(window.CLASS_INFO.students)){
      var ids = window.CLASS_INFO.students
        .map(function(s){ return (s && (s.id ?? s.sid ?? s.studentId)); })
        .map(__normSid)
        .filter(Boolean);
      if (ids.length) return ids;
    }
    // Fallback to global STUDENTS, if present
    if (Array.isArray(window.STUDENTS)){
      var ids2 = window.STUDENTS
        .map(function(s){ return (s && (s.id ?? s.sid ?? s.studentId)); })
        .map(__normSid)
        .filter(Boolean);
      if (ids2.length) return ids2;
    }
    // Try the student picker <select>
    var sel = document.getElementById('studentPicker');
    if (sel && sel.options && sel.options.length){
      var ids3 = Array.prototype.map.call(sel.options, function(o){ return __normSid(o && o.value); }).filter(Boolean);
      if (ids3.length) return ids3;
    }
    // Last resort: union of whatever we already know from any map — keep ONLY numeric-looking ids
    var union = new Set();
    [SCORES, window.ADDED_TASKS, window.__SKILL_NOTES__, window.__GENERAL_NOTES__].forEach(function(m){
      if (!m) return; Object.keys(m).forEach(function(k){ var n = __normSid(k); if (n) union.add(n); });
    });
    // Also include current visible card sid if numeric
    try { var cur = getCurrentCard(); var ncur = __normSid(cur && cur.sid); if (ncur) union.add(ncur); } catch(_e){}
    return Array.from(union);
  }
  function collectAllSkillIds(){
    var nodes = document.querySelectorAll('.rating');
    var ids = Array.prototype.map.call(nodes, function(n){
      return getComponentKeyFromRatingEl(n);
    }).filter(Boolean);
    return Array.from(new Set(ids));
  }
  function seedScoresAllNulls(){
    try {
      var students = collectAllStudentIds();
      var skills = collectAllSkillIds();
      if (!students || !students.length || !skills || !skills.length) return;
      students.forEach(function(sid){
        var k = __normSid(sid);
        if (!k) return; // skip non-numeric ids (e.g., names)
        if (!SCORES[k]) SCORES[k] = {};
        skills.forEach(function(sk){
          if (typeof SCORES[k][sk] === 'undefined') SCORES[k][sk] = null; // ensure presence with null
        });
      });
      saveScoresDebounced(SCORES);
    } catch (_e) { /* ignore */ }
  }

  // Прилага .is-active по запазените оценки върху видимата карта
  function applySavedScores(){
    var ctx = getCurrentCard();
    if (!ctx.card || ctx.sid == null) return;
    var sid = ctx.sid;
    var ratings = ctx.card.querySelectorAll('.rating');
    ratings.forEach(function(r){
      var key = getComponentKeyFromRatingEl(r);
      if (!key) return;
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
      var key = getComponentKeyFromRatingEl(rating);
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
      if (changed) { seedScoresAllNulls(); applySavedScores(); }
    });
    mo.observe(card, { attributes: true, attributeFilter: ['data-student-id'] });
    // Ако списъкът с умения се презаписва при навигация, може да има нужда и от observer за children:
    var skills = card.querySelector('#skillsList') || card;
    var mo2 = new MutationObserver(function(){ seedScoresAllNulls(); applySavedScores(); });
    mo2.observe(skills, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', function(){
    wireClicks();
    try {
      var __freshScores = loadScores();
      // mutate existing object to preserve external references
      try { Object.keys(SCORES).forEach(function(k){ delete SCORES[k]; }); } catch(_e){}
      if (__freshScores && typeof __freshScores === 'object') {
        try { Object.assign(SCORES, __freshScores); } catch(_e){}
      }
    } catch(_){ }
    // Ensure the full matrix (all students x all skills) exists with nulls before painting
    setTimeout(seedScoresAllNulls, 0);
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