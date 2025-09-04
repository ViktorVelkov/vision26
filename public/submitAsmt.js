

document.addEventListener("DOMContentLoaded", function(){
  const btn = document.getElementById("submitAssessBtn");
  if (!btn) return;

  btn.addEventListener("click", function(){
    // --- Lesson info ---
    const lessonId = document.getElementById("lessonBadge")?.textContent || null;
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

    // Тук можеш да пращаш всяка структура поотделно към различни API endpoints
  });
});