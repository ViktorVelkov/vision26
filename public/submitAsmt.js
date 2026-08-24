document.addEventListener("DOMContentLoaded", function(){
  const btn = document.getElementById("submitAssessBtn");
  if (!btn) return;

btn.addEventListener("click", async function(){
      // --- Lesson info ---
    const lessonId = (Number.isInteger(window.CURRENT_LESSON_ID) ? window.CURRENT_LESSON_ID : null);
    const triplet = window.TRIPLET || null;
    const className = window.CLASS_INFO?.className || null;

    // --- Data arrays (поотделно) ---
    const skillNotes = window.__SKILL_NOTES__ || {};
    const addedTasks = window.ADDED_TASKS || {};
    const generalNotes = window.__GENERAL_NOTES__ || {}; 
    const skillScores = window.__SKILL_SCORES__ || {};

  // Обединение в един общ резултатен масив
    const skillResults = {};
    const allStudentIds = new Set([
      ...Object.keys(skillNotes),
      ...Object.keys(skillScores)
    ]);

    allStudentIds.forEach(sid => {
      skillResults[sid] = {};
      const notesForStudent = skillNotes[sid] || {};
      const scoresForStudent = skillScores[sid] || {};
      const allSkillIds = new Set([
        ...Object.keys(notesForStudent),
        ...Object.keys(scoresForStudent)
      ]);

      allSkillIds.forEach(skillId => {
        skillResults[sid][skillId] = {
          score: scoresForStudent[skillId] ?? null,
          note: notesForStudent[skillId] ?? null
        };
      });
    });

      console.log("Обединени резултати", skillResults);
      console.log("[SUBMIT]", {
        className,
        triplet,
        lessonId,
        skillNotes,
        addedTasks,
        generalNotes,
        skillScores,
        skillResults
      });

      // === Build DB rows for table: student_assessment_skills_exercises ===
      // Columns we fill: lessonTriplet (text), isSnippet (boolean), componentID (integer | null),
      //                  assessment (integer | null), comment (text | null), studentID (integer)
      function toIntOrNull(v){
        if (v === null || v === undefined || v === '') return null;
        // Accept numbers, numeric strings, or badge text like "Lesson ID: 8"
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        var m = String(v).match(/\d+/);
        if (!m) return null;
        var n = parseInt(m[0], 10);
        return Number.isFinite(n) ? n : null;
      }
      function normSid(sid){
        return toIntOrNull(sid);
      }

      const rows = [];

// 1) Skills (KeySkills): записваме само ако има оценка или бележка.
Object.keys(skillResults || {}).forEach(function(sid){
  const sidNum = normSid(sid);
  if (sidNum == null) return;

  const perSkill = skillResults[sid] || {};

  Object.keys(perSkill).forEach(function(skillId){
    const payload = perSkill[skillId] || {};

const scoreValue =
  (payload.score != null && String(payload.score).trim() !== '')
    ? parseInt(payload.score, 10)
    : null;

const hasScore =
  Number.isInteger(scoreValue) &&
  scoreValue >= 0 &&
  scoreValue <= 3;
      const hasNote =
      payload.note != null &&
      String(payload.note).trim() !== '';

    // Няма нито оценка, нито бележка -> не записваме ред.
    if (!hasScore && !hasNote) return;
    if (!/^\d+$/.test(String(skillId))) return;

    rows.push({
      lessonTriplet: triplet,
      isSnippet: true,
      componentID: parseInt(skillId, 10),
      assessment: hasScore ? scoreValue : null,
      comment: hasNote ? String(payload.note).trim() : null,
      studentID: sidNum
    });
  });
});

      // 2) Exercises (addedTasks): isSnippet=false, componentID=task.id, assessment=task.rating, comment=task.note
      Object.keys(addedTasks || {}).forEach(function(sid){
        const sidNum = normSid(sid);
        if (sidNum == null) return;
        const tasks = addedTasks[sid] || [];
        tasks.forEach(function(t){
        const ratingValue =
          (t && t.rating != null && String(t.rating).trim() !== '')
            ? parseInt(t.rating, 10)
            : null;

        const hasScore =
          Number.isInteger(ratingValue) &&
          ratingValue >= 0 &&
          ratingValue <= 3;
          const hasNote =
          t &&
          typeof t.note === 'string' &&
          t.note.trim() !== '';

        // Няма оценка и няма бележка -> не записваме задача.
        if (!hasScore && !hasNote) return;

        rows.push({
          lessonTriplet: triplet,
          isSnippet: false,
          componentID: toIntOrNull(
            t && (t.exerciseID ?? t.exerciseId ?? t.id)
          ),
          _exerciseResource: t && (t.resource ?? t.ResourceID ?? t.resourceId),
          _exercisePage: t && (t.page ?? t.Page),
          _exerciseNumber: t && (t.number ?? t.Number),
          assessment: hasScore ? ratingValue : null,
          comment: hasNote ? t.note.trim() : null,
          studentID: sidNum
        });
      });
      });

      // 3) General comments: isSnippet=false, componentID=NULL, assessment=NULL, comment=text
      Object.keys(generalNotes || {}).forEach(function(sid){
        const sidNum = normSid(sid);
        if (sidNum == null) return;
        const text = generalNotes[sid];
        if (text == null || String(text).trim() === '') return; // skip empty general notes
        rows.push({
          lessonTriplet: triplet,
          isSnippet: false,
          componentID: null, // per requirement: empty for comments
          assessment: null,
          comment: String(text),
          studentID: sidNum
        });
      });
      const exerciseLookupCache = new Map();

for (const row of rows) {
  // Интересуват ни само задачите.
  if (row.isSnippet !== false) continue;

  // Ако вече имаме истинско Exercises.ID, няма нужда от lookup.
  if (Number.isInteger(row.componentID)) continue;

  const rid = parseInt(row._exerciseResource, 10);
  const page = parseInt(row._exercisePage, 10);

  const number =
    row._exerciseNumber == null
      ? ''
      : String(row._exerciseNumber).trim();

  if (
    !Number.isInteger(rid) ||
    !Number.isInteger(page) ||
    !number
  ) {
    continue;
  }

  const cacheKey = rid + '|' + page;

  let matches = exerciseLookupCache.get(cacheKey);

  if (!matches) {
    try {
      const lookupResp = await fetch(
        '/exercises-rel/search-by-rid-page?rid=' +
        encodeURIComponent(String(rid)) +
        '&page=' +
        encodeURIComponent(String(page)),
        { cache: 'no-store' }
      );

      if (!lookupResp.ok) {
        const txt = await lookupResp.text().catch(() => '');

        console.error(
          '[SUBMIT] exercise lookup HTTP ' +
          lookupResp.status,
          txt
        );

        matches = [];
      } else {
        const data = await lookupResp.json();

        matches = Array.isArray(data)
          ? data
          : [];
      }
    } catch (e) {
      console.error(
        '[SUBMIT] exercise ID lookup failed:',
        e
      );

      matches = [];
    }

    exerciseLookupCache.set(cacheKey, matches);
  }

  const match = matches.find(function(x){
    const n = x && (x.number ?? x.Number);

    return (
      n != null &&
      String(n).trim() === number
    );
  });

  const resolvedId =
    match &&
    (
      match.exerciseID ??
      match.exerciseId ??
      match.ID ??
      match.id
    );

  const resolvedInt = parseInt(resolvedId, 10);

  if (Number.isInteger(resolvedInt)) {
    row.componentID = resolvedInt;
  }
}


for (let i = rows.length - 1; i >= 0; i--) {
  const row = rows[i];

  delete row._exerciseResource;
  delete row._exercisePage;
  delete row._exerciseNumber;

  // Ако задачата е оценена, но не успяхме
  // да намерим истинското Exercises.ID,
  // не я изпращаме като грешен запис.
  if (
    row.isSnippet === false &&
    row.assessment != null &&
    !Number.isInteger(row.componentID)
  ) {
    console.warn(
      '[SUBMIT] skipped exercise row without resolved Exercises.ID:',
      row
    );

    rows.splice(i, 1);
  }
}
      console.log('[DB] rows prepared:', rows);

      // === Send to backend (adjust URL to your API) ===
      // Expect server to insert into public.student_assessment_skills_exercises using nextval(seq) for id
      fetch('/student-assessment-skills-exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, lessonId })
      })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t))))
      .then(resp => {
        console.log('[DB] insert ok:', resp);
      })
      .catch(err => {
        console.error('[DB] insert failed:', err);
      });

    // Тук можеш да пращаш всяка структура поотделно към различни API endpoints
  });
});