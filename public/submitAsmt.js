

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
    console.log("[SUBMIT]", {
      className,
      triplet,
      lessonId,
      skillNotes,
      addedTasks,
      generalNotes,
      skillScores
    });

    // Тук можеш да пращаш всяка структура поотделно към различни API endpoints
  });
});