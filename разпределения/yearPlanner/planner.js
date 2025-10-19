import { getHolidays, getWeeklyCurrent } from "./api.js";

function toWeekday(dateStr){
  return new Date(dateStr).toLocaleDateString("en-US", { weekday:"long" });
}
function addDays(d, n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }

function termOf(dateStr, sem1End, sem2Start){
  const d = new Date(dateStr);
  if (d <= new Date(sem1End)) return 1;
  if (d >= new Date(sem2Start)) return 2;
  return null;
}

export async function generateWeeklyPlanBase({ startDate, endDate, semester1End, semester2Start }, debug=false){
  const holidays = await getHolidays();
  const weekly   = await getWeeklyCurrent();
  if(!weekly.hasCurrent) return [];
  const holidaySet = new Set(holidays);
  const start = new Date(startDate);
  const endLimit = new Date(endDate);
  const plan = [];
  const yearStart = new Date(startDate);
  yearStart.setHours(0,0,0,0);

  let cursor = new Date(startDate);
  const end = new Date(endDate);
  while (cursor <= end) {
    const weekEntries = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i);
      if (date < start || date > endLimit) continue;
      const dateStr = date.toISOString().slice(0,10);
      if (holidaySet.has(dateStr)) continue;

      const term = termOf(dateStr, semester1End, semester2Start);
      if (!term) continue;

      const wd = toWeekday(dateStr);

      weekly.weeklyRows
        .filter(r => r.weekday === wd && r.term === term)
        .forEach(r => {
          if (r.recurrence === "BIWEEKLY") {
            const startOfWeek = new Date(cursor);
            const academicWeekIndex = Math.floor((startOfWeek - yearStart) / (1000*60*60*24*7)) + 1;
            const currentParity = (academicWeekIndex % 2) === 0 ? 2 : 1;
            if (currentParity !== (parseInt(r.week_parity, 10) || 1)) return;
          }

          const [sh, sm] = r.start_time.split(":").map(Number);
          const [eh, em] = r.end_time.split(":").map(Number);
          const startMinutes = sh*60 + sm;
          const endMinutes   = eh*60 + em;
          const duration     = endMinutes - startMinutes;

          let segments = Math.ceil(duration / 40);
          let segmentStart = startMinutes;
          const formatTime = mins => `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`;

          for (let s = 0; s < segments; s++) {
            const segmentEnd = Math.min(segmentStart + 40, endMinutes);
            weekEntries.push({
              date: dateStr,
              start_time: formatTime(segmentStart),
              end_time: formatTime(segmentEnd),
              subject: r.subject
            });
            segmentStart = segmentEnd;
          }
        });
    }
    if (weekEntries.length) plan.push({ weekOf: cursor.toISOString().slice(0,10), entries: weekEntries });
    cursor = addDays(cursor, 7);
  }
  return plan;
}

export const generateWeeklyPlanDebug = (opts) => generateWeeklyPlanBase(opts, true);
export const generateWeeklyPlan      = (opts) => generateWeeklyPlanBase(opts, false);