import { getCurrentSchedule, getWeeklyCurrent, savePlanner } from "./api.js";
import { qs, initDefaultDates, renderCurrentScheduleInfo, renderWeeklyScheduleInfo } from "./dom.js";
import { generateWeeklyPlanDebug } from "./planner.js";

function wireFormSubmit(){
  const form = document.getElementById("yearPlannerForm");
  if(!form) return;
  form.addEventListener("submit", (e)=>{
    e.preventDefault();
    // form data could be posted later if needed
  });
}

async function loadInfoBoxes(){
  try {
    const current = await getCurrentSchedule();
    renderCurrentScheduleInfo(current);
  } catch (e){
    console.error(e);
    const el = qs("currentScheduleInfo");
    if (el) el.textContent = "❌ Failed to load current schedule.";
  }

  try {
    const weekly = await getWeeklyCurrent();
    renderWeeklyScheduleInfo(weekly);
  } catch (e){
    console.error(e);
    const el = qs("weeklyScheduleInfo");
    if (el) el.textContent = "❌ Failed to load weekly schedule.";
  }
}

function readDates(){
  return {
    startDate: qs("startYearDate").value,
    endDate: qs("endYearDate").value,
    semester1End: qs("endSemester1").value,
    semester2Start: qs("startSemester2").value
  };
}

function openOutput(){
  return window.open("", "_blank");
}

function wireGenerateButtons(){
  const genAllBtn = qs("generatePlanBtn");
  if (genAllBtn) genAllBtn.addEventListener("click", async ()=>{
    const w = openOutput();
    try {
      const { startDate, endDate, semester1End, semester2Start } = readDates();
      if (!startDate || !endDate || !semester1End || !semester2Start) {
        alert("❗ Please fill in all dates."); w.close(); return;
      }
      const planner = await generateWeeklyPlanDebug({ startDate, endDate, semester1End, semester2Start });
      const result = await savePlanner(planner);
      w.document.write("<pre style='font-family: monospace;'>");
      w.document.write(`✅ ${result.message}\n\n`);
      planner.forEach((week, idx)=>{
        w.document.write(`📅 Week ${idx+1}\n`);
        week.entries.forEach(e=>{
          const dayName = new Date(e.date).toLocaleDateString('en-US', { weekday:'long' });
          w.document.write(`  ${e.date} (${dayName}): ${e.start_time}–${e.end_time} — ${e.subject}\n`);
        });
        w.document.write("\\n");
      });
      w.document.write("</pre>");
    } catch (err){
      alert("❌ Error saving planner: " + err.message);
      w.close();
    }});
  };
  