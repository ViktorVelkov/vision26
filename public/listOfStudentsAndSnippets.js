

// public/listOfStudents.js
// public/listOfStudents.js
(function(){
  // --- Robust name and number extractors ---
  function pick(...vals){
    for (var i=0;i<vals.length;i++){ if (vals[i] != null && vals[i] !== '') return vals[i]; }
    return '';
  }
  // Scan dynamic keys for name parts if expected fields are missing
  function scanNameParts(st){
    if (!st) return {fn:'', ln:''};
    var fn = '', ln = '';
    try {
      var keys = Object.keys(st);
      keys.forEach(function(k){
        var v = st[k]; if (v == null) return;
        if (typeof v !== 'string') return;
        var lk = k.toLowerCase();
        if (!fn && /(first.*name|given)/.test(lk)) fn = v.trim();
        if (!ln && /(last.*name|family|surname)/.test(lk)) ln = v.trim();
      });
    } catch(_){}
    return {fn: fn, ln: ln};
  }
  function firstLastName(st){
    if (!st) return '';
    // Prefer explicit first/last keys
    var fn = pick(st.firstname, st.firstName, st.first_name, st.given_name, st.givenName);
    var ln = pick(
      st.lastname, st.lastName, st.last_name,
      st.family_name, st.familyName,
      st.surname, st.surname_bg, st.sirname,
      st.secondName, st.second_name,
      st.lname
    );
    // If either part is missing, try to discover from dynamic keys
    if (!fn || !ln){
      var scanned = scanNameParts(st);
      if (!fn && scanned.fn) fn = scanned.fn;
      if (!ln && scanned.ln) ln = scanned.ln;
    }
    var nm = (String(fn||'').trim() + ' ' + String(ln||'').trim()).trim();
    return nm;
  }
  function coalesceName(st){
    if (!st) return '';
    var nm = pick(st.name, st.fullName, st.full_name, st.studentName, st.student_name, st.displayName, st.display_name);
    if (!nm){
      var fn = pick(st.firstname, st.firstName, st.first_name);
      var ln = pick(st.lastname, st.lastName, st.last_name);
      nm = (fn || ln) ? (String(fn||'').trim() + ' ' + String(ln||'').trim()).trim() : '';
    }
    return String(nm||'').trim();
  }
  function getNumberInClass(st){
    if (!st) return null;
    var raw = pick(st.numberInClass, st.number_in_class, st.classNumber, st.number, st.no, st.index);
    var n = parseInt(raw,10);
    return Number.isFinite(n) ? n : null;
  }
  function toInt(v, d){
    var n = parseInt(v, 10);
    return Number.isFinite(n) ? n : (d == null ? null : d);
  }

  function fullName(st){
    var nm = firstLastName(st);
    if (!nm){
      // fallback to any single-field name variants
      nm = coalesceName(st);
    }
    return nm || 'Без име';
  }
  function displayNameWithNumber(st){
    var n = (st && st._numberInClass != null) ? st._numberInClass : getNumberInClass(st);
    var nm = (st && st._name) ? st._name : fullName(st);
    return (n != null ? ('№ ' + n + ' — ') : '') + nm;
  }

  async function fetchStudents(classInfo){
    try {
      if (!classInfo || !classInfo.className) return [];
      const res = await fetch('/students?className=' + encodeURIComponent(classInfo.className));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      return (arr || []).map(function(s){
        s = s || {};
        // normalize fields for downstream code
        s._name = fullName(s);
        s._numberInClass = getNumberInClass(s);
        s.id = toInt(s.id, s.id);
        return s;
      }).sort(function(a,b){
        const an = a._numberInClass == null ? 999999 : a._numberInClass;
        const bn = b._numberInClass == null ? 999999 : b._numberInClass;
        if (an !== bn) return an - bn;
        const anm = a._name, bnm = b._name;
        const cmp = anm.localeCompare(bnm);
        if (cmp) return cmp;
        return (toInt(a.id, 999999) - toInt(b.id, 999999));
      });
    } catch (e) {
      console.error('Грешка при зареждане на ученици:', e);
      return [];
    }
  }

  async function fetchSnippets(triplet){
    try {
      if (!triplet) return [];
      const res = await fetch('/lesson-skills?triplet=' + encodeURIComponent(triplet));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let arr = await res.json();
      arr = (arr || []).map(function(s){
        if (s && typeof s.name === 'string') s.name = s.name.replace(/\s*\(ID\s*\d+\)\s*$/i, '');
        return s;
      }).sort(function(a,b){
        const ao = Number.isFinite(+a.order) ? +a.order : 999999;
        const bo = Number.isFinite(+b.order) ? +b.order : 999999;
        if (ao !== bo) return ao - bo;
        return String(a.name||'').localeCompare(String(b.name||''));
      });
      return arr;
    } catch (e) {
      console.error('Грешка при зареждане на умения (snippets):', e);
      return [];
    }
  }

  function buildRatingPills(snippetKey){
    var html = '';
    for (var v=0; v<=3; v++){
      html += '<span class="pill pill--v' + v + '" data-val="' + v + '">' + v + '</span>';
    }
    var wrap = document.createElement('div');
    wrap.className = 'rating';
    wrap.setAttribute('data-snippet-id', snippetKey);
    wrap.innerHTML = html;
    return wrap;
  }

  function renderSnippetsInto(ulEl, snippets){
    ulEl.innerHTML = '';
    if (!Array.isArray(snippets) || snippets.length === 0){
      ulEl.innerHTML = '<li class="muted">Няма умения</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    snippets.forEach(function(sn){
      var li = document.createElement('li');
      var row = document.createElement('div'); row.className = 'skill-row';
      var name = document.createElement('div'); name.className = 'sk-name';
      name.textContent = (sn && sn.name) ? sn.name : '-';
      var sidSpan = document.createElement('span');
      sidSpan.className = 'sk-id';
      sidSpan.textContent = '(ID ' + String(sn && sn.id != null ? sn.id : '?') + ')';
      name.appendChild(sidSpan);
      var pills = buildRatingPills('id:' + sn.id);
      row.appendChild(name);
      row.appendChild(pills);
      li.appendChild(row);
      frag.appendChild(li);
    });
    ulEl.appendChild(frag);
  }

  // --- State & DOM cache ---
  var STATE = { students: [], snippets: [], idx: 0 };
  var el = {};

  function cacheDom(){
    el.wrap = document.querySelector('main.wrap');
    el.card = el.wrap ? el.wrap.querySelector('.card') : null;
    el.h2 = document.getElementById('studentName');
    el.hero = document.getElementById('hero');
    el.skillsList = document.getElementById('skillsList');
    el.notesTa = document.getElementById('studentNotes');
    el.meta = document.getElementById('metaCount');
    el.picker = document.getElementById('studentPicker');
    el.prevBtn = document.getElementById('prevBtn');
    el.nextBtn = document.getElementById('nextBtn');
  }

  function renderCurrent(){
    if (!el.h2 || !STATE.students.length) return;
    var i = Math.max(0, Math.min(STATE.idx, STATE.students.length-1));
    STATE.idx = i;
    var st = STATE.students[i];

    // Title & meta
    el.h2.textContent = displayNameWithNumber(st);
    if (el.card){
      el.card.setAttribute('data-student-id', String(st.id));
      el.card.setAttribute('data-student-name', fullName(st));
    }
    // Skills
    renderSnippetsInto(el.skillsList, STATE.snippets);

    // Picker & buttons state
    if (el.picker){ el.picker.value = fullName(st); }
    if (el.prevBtn) el.prevBtn.disabled = (i <= 0);
    if (el.nextBtn) el.nextBtn.disabled = (i >= STATE.students.length - 1);

    if (el.meta){ el.meta.textContent = 'Ученици: ' + STATE.students.length + ' • Показан: ' + (i+1); }
  }

  function gotoIndex(i){ STATE.idx = i; renderCurrent(); }
  function gotoNext(){ if (STATE.idx < STATE.students.length - 1) { STATE.idx++; renderCurrent(); } }
  function gotoPrev(){ if (STATE.idx > 0) { STATE.idx--; renderCurrent(); } }

  function wireNav(){
    if (el.prevBtn) el.prevBtn.addEventListener('click', function(){ gotoPrev(); });
    if (el.nextBtn) el.nextBtn.addEventListener('click', function(){ gotoNext(); });
    if (el.picker) el.picker.addEventListener('change', function(){
      var sel = String(this.value).trim();
      var idx = (STATE.students || []).findIndex(function(st){ return fullName(st).trim() === sel; });
      if (idx >= 0) gotoIndex(idx);
    });

    window.addEventListener('keydown', function(e){
      if (e.key === 'ArrowLeft') { e.preventDefault(); gotoPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); gotoNext(); }
    });
  }

  document.addEventListener('DOMContentLoaded', async function(){
    cacheDom();
    var classInfo = window.CLASS_INFO || null;
    var triplet   = window.TRIPLET || '';

    var results = await Promise.all([
      fetchStudents(classInfo),
      fetchSnippets(triplet)
    ]);
    STATE.students = results[0] || [];
    STATE.snippets = results[1] || [];

    // Debug aid
    try {
      console.log('[AW2] Loaded students:', STATE.students.length);
      if (STATE.students[0]) console.log('[AW2] First student sample keys:', Object.keys(STATE.students[0]));
    } catch(_){}

    if (!STATE.students.length){
      if (el.wrap){ el.wrap.innerHTML = '<div class="muted">Няма ученици за този клас.</div>'; }
      if (el.meta){ el.meta.textContent = 'Ученици: 0'; }
      return; // nothing else to render
    }

    // Populate picker once
    if (el.picker){
      el.picker.innerHTML = (STATE.students || []).map(function(st){
        return '<option value="' + fullName(st) + '">' + displayNameWithNumber(st) + '</option>';
      }).join('');
    }

    // Set lesson badge if available
    var lb = document.getElementById('lessonBadge');
    if (lb && window.LESSON){ lb.textContent = String(window.LESSON); }

    wireNav();
    renderCurrent();
  });
})();