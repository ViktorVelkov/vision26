document.addEventListener("DOMContentLoaded", function(){
  const btn = document.getElementById("submitAssessBtn");
  if (!btn) return;

  btn.addEventListener("click", function(){
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

      // 1) Skills (KeySkills): from skillResults { sid: { keySkillId: {score, note} } }
      Object.keys(skillResults || {}).forEach(function(sid){
        const sidNum = normSid(sid);
        if (sidNum == null) return;
        const perSkill = skillResults[sid] || {};
        Object.keys(perSkill).forEach(function(skillId){
          const payload = perSkill[skillId] || {};
          rows.push({
            lessonTriplet: triplet,
            isSnippet: true,
            componentID: toIntOrNull(skillId), // skill id numeric part
            assessment: (payload.score ?? null),
            comment: (payload.note ?? null),
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
          rows.push({
            lessonTriplet: triplet,
            isSnippet: false,
            componentID: toIntOrNull(t && (t.id ?? (t.key || ''))),
            assessment: (typeof t.rating === 'number' ? t.rating : null),
            comment: (t && typeof t.note === 'string' ? t.note : null),
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