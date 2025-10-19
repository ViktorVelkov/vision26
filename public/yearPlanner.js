// ---- Year Planner bootstrap: defaults + info boxes ----
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt; }
function fmtDate(d){ return new Date(d).toISOString().slice(0,10); }

async function loadCurrentScheduleInfo(){
  try {
    const res = await fetch("/schedule/current");
    const data = await res.json();
    const box = document.getElementById("currentScheduleInfo");
    if (!box) return;
    if (!data.hasCurrent) { box.textContent = "⚠️ No current schedule set."; return; }
    const { current, currentRows } = data;
    let out = `📅 Year: ${current.start_year}–${current.end_year}\n\n`;
    if (Array.isArray(currentRows)) {
      currentRows.forEach(r => {
        out += `📘 Class ${r.class} ${r.division}, Term ${r.term}:\n`;
        out += `    Разпределение: ${r.razpredelenie}\n\n`;
      });
    }
    box.textContent = out;
  } catch (e){
    const box = document.getElementById("currentScheduleInfo");
    if (box) box.textContent = "❌ Failed to load current schedule.";
  }
}

async function loadWeeklyScheduleInfo(){
  try {
    const res = await fetch("/schedule/weekly-current");
    const data = await res.json();
    const box = document.getElementById("weeklyScheduleInfo");
    if (!box) return;
    if (!data.hasCurrent) { box.textContent = "⚠️ No weekly schedule available."; return; }
    let out = `📅 Year: ${data.current.start_year}–${data.current.end_year}\n\n`;
    data.weeklyRows.forEach(row => {
      out += `🗓️ ${row.weekday}, ${row.start_time}–${row.end_time} — ${row.subject} (Term ${row.term})\n`;
    });
    box.textContent = out;
  } catch (e){
    const box = document.getElementById("weeklyScheduleInfo");
    if (box) box.textContent = "❌ Failed to load weekly schedule.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Set sensible random-close defaults like the original HTML did
  const today = new Date();
  const start = addDays(today, Math.floor(Math.random()*30));
  const end   = addDays(start, Math.floor(Math.random()*60)+15);
  const duration = Math.round((end - start) / 86400000);
  const midOffset = Math.floor(duration/2 + (Math.random()*10 - 5));
  const sem1End = addDays(start, midOffset);
  const sem2Start = addDays(sem1End, Math.floor(Math.random()*7)+1);

  const s = document.getElementById("startYearDate");
  const e = document.getElementById("endYearDate");
  const s1= document.getElementById("endSemester1");
  const s2= document.getElementById("startSemester2");
  if (s) s.value = fmtDate(start);
  if (e) e.value = fmtDate(end);
  if (s1) s1.value = fmtDate(sem1End);
  if (s2) s2.value = fmtDate(sem2Start);

  // Load info panels
  loadCurrentScheduleInfo();
  loadWeeklyScheduleInfo();
});
const _genBtn = document.getElementById("generatePlanBtn");
if (_genBtn) _genBtn.addEventListener("click", () => {
  const outputWindow = window.open("", "_blank"); // Open tab immediately to avoid popup blockers

  // Duplicate function for debugging
  async function generateWeeklyPlanDebug({ startDate, endDate, semester1End, semester2Start }) {
    const holidays = await (await fetch("/holidays")).json();
    const weekly = await (await fetch("/schedule/weekly-current")).json();
    if (!weekly.hasCurrent) return [];
    const holidaySet = new Set(holidays);
    const startObj = new Date(startDate);
    const endLimit = new Date(endDate);
    // Normalize to include full days for boundary checks
    startObj.setHours(0, 0, 0, 0);
    endLimit.setHours(23, 59, 59, 999);
    // Preserve actual academic start
    const yearStart = new Date(startDate);
    yearStart.setHours(0, 0, 0, 0);
    
    // Find the first Monday on or after the academic start date
    const dow = yearStart.getDay();
    const daysToNextMonday = dow === 1 ? 0 : ((8 - dow) % 7);
    let cursor = new Date(yearStart);
    cursor.setDate(cursor.getDate() + daysToNextMonday);

    const plan = [];
    const addDays = (d,n) => { const dt=new Date(d); dt.setDate(dt.getDate()+n); return dt; };
    const getTerm = dStr => { const d=new Date(dStr);
      if (d <= new Date(semester1End)) return 1;
      if (d >= new Date(semester2Start)) return 2;
      return null;
    };
    const getWeekday = dStr =>
      new Date(dStr).toLocaleDateString("en-US",{weekday:"long"});
    let weekIndex = 1;
    while (cursor <= endLimit) {
      const weekEntries = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(cursor, i);
        if (date < yearStart || date > endLimit) continue;
        const dateStr = date.toISOString().slice(0, 10);
        if (holidaySet.has(dateStr)) continue;
        const term = getTerm(dateStr);
        if (!term) continue;
        const wd = getWeekday(dateStr);
        weekly.weeklyRows
          // Ignore r.term; decide term strictly by date boundaries
          .filter(r => r.weekday === wd)
          .forEach(r => {
            // --- BIWEEKLY handling (robust) ---
            const rec = (r.recurrence || "WEEKLY").toString().toUpperCase();
            const parityRequired = parseInt(r.week_parity, 10) || 1; // 1=A(odd), 2=B(even)
            if (rec === "BIWEEKLY") {
              const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
              if (currentParity !== parityRequired) {
                return; // skip this entry this week
              }
            }
            const startTimeParts = r.start_time.split(":").map(Number);
            const endTimeParts = r.end_time.split(":").map(Number);
            const startMinutes = startTimeParts[0] * 60 + startTimeParts[1];
            const endMinutes = endTimeParts[0] * 60 + endTimeParts[1];
            const duration = endMinutes - startMinutes;

            let segments = Math.ceil(duration / 40);
            let segmentStart = startMinutes;

            for (let s = 0; s < segments; s++) {
              let segmentEnd = Math.min(segmentStart + 40, endMinutes);
              const formatTime = mins => {
                const h = Math.floor(mins / 60).toString().padStart(2, "0");
                const m = (mins % 60).toString().padStart(2, "0");
                return `${h}:${m}`;
              };

              weekEntries.push({
                date: dateStr,
                start_time: formatTime(segmentStart),
                end_time: formatTime(segmentEnd),
                subject: r.subject,
                term: term
              });

              segmentStart = segmentEnd;
            }
          });
      }
      if (weekEntries.length) plan.push({weekOf:cursor.toISOString().slice(0,10),entries:weekEntries});
      cursor = addDays(cursor,7);
      weekIndex++;
    }
    return plan;
  }

  async function generateWeeklyPlan({ startDate, endDate, semester1End, semester2Start }) {
    const holidays = await (await fetch("/holidays")).json();
    const weekly = await (await fetch("/schedule/weekly-current")).json();
    if (!weekly.hasCurrent) return [];
    const holidaySet = new Set(holidays);
    const startObj = new Date(startDate);
    const endLimit = new Date(endDate);
    // Normalize to include full days for boundary checks
    startObj.setHours(0, 0, 0, 0);
    endLimit.setHours(23, 59, 59, 999);
    // Preserve actual academic start
    const yearStart = new Date(startDate);
    yearStart.setHours(0, 0, 0, 0);
    
    // Find the first Monday on or after the academic start date
    const dow = yearStart.getDay();
    const daysToNextMonday = dow === 1 ? 0 : ((8 - dow) % 7);
    let cursor = new Date(yearStart);
    cursor.setDate(cursor.getDate() + daysToNextMonday);

    const plan = [];
    const addDays = (d,n) => { const dt=new Date(d); dt.setDate(dt.getDate()+n); return dt; };
    const getTerm = dStr => { const d=new Date(dStr);
      if (d <= new Date(semester1End)) return 1;
      if (d >= new Date(semester2Start)) return 2;
      return null;
    };
    const getWeekday = dStr =>
      new Date(dStr).toLocaleDateString("en-US",{weekday:"long"});
    let weekIndex = 1;
    while (cursor <= endLimit) {
      const weekEntries = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(cursor, i);
        if (date < yearStart || date > endLimit) continue;
        const dateStr = date.toISOString().slice(0, 10);
        if (holidaySet.has(dateStr)) continue;
        const term = getTerm(dateStr);
        if (!term) continue;
        const wd = getWeekday(dateStr);
        weekly.weeklyRows
          // Ignore r.term; decide term strictly by date boundaries
          .filter(r => r.weekday === wd)
          .forEach(r => {
            // --- BIWEEKLY handling (robust) ---
            const rec = (r.recurrence || "WEEKLY").toString().toUpperCase();
            const parityRequired = parseInt(r.week_parity, 10) || 1; // 1=A(odd), 2=B(even)
            if (rec === "BIWEEKLY") {
              const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
              if (currentParity !== parityRequired) {
                return; // skip this entry this week
              }
            }
            const startTimeParts = r.start_time.split(":").map(Number);
            const endTimeParts = r.end_time.split(":").map(Number);
            const startMinutes = startTimeParts[0] * 60 + startTimeParts[1];
            const endMinutes = endTimeParts[0] * 60 + endTimeParts[1];
            const duration = endMinutes - startMinutes;

            let segments = Math.ceil(duration / 40);
            let segmentStart = startMinutes;

            for (let s = 0; s < segments; s++) {
              let segmentEnd = Math.min(segmentStart + 40, endMinutes);
              const formatTime = mins => {
                const h = Math.floor(mins / 60).toString().padStart(2, "0");
                const m = (mins % 60).toString().padStart(2, "0");
                return `${h}:${m}`;
              };

              weekEntries.push({
                date: dateStr,
                start_time: formatTime(segmentStart),
                end_time: formatTime(segmentEnd),
                subject: r.subject,
                term: term
              });

              segmentStart = segmentEnd;
            }
          });
      }
      if (weekEntries.length) plan.push({weekOf:cursor.toISOString().slice(0,10),entries:weekEntries});
      cursor = addDays(cursor,7);
      weekIndex++;
    }
    return plan;
  }

  (async () => {
    const startDate = document.getElementById("startYearDate").value;
    const endDate = document.getElementById("endYearDate").value;
    const semester1End = document.getElementById("endSemester1").value;
    const semester2Start = document.getElementById("startSemester2").value;
    function toISO(d) {
      const t = new Date(d);
      return (t instanceof Date && !Number.isNaN(t.getTime())) ? t.toISOString().slice(0,10) : '';
    }
    const semester1EndISO = toISO(semester1End);
    const semester2StartISO = toISO(semester2Start);

    if (!startDate || !endDate || !semester1End || !semester2Start) {
      alert("❗ Please fill in all dates.");
      return;
    }

    // Show selected range and boundaries in preview window
    outputWindow.document.write(`<pre style='font-family: monospace;'>`);
    outputWindow.document.write(`Selected range: ${startDate} → ${endDate}\n`);
    outputWindow.document.write(`Semester 1 ends: ${semester1End}\n`);
    outputWindow.document.write(`Semester 2 starts: ${semester2Start}\n\n`);

    const planner = await generateWeeklyPlanDebug({ startDate, endDate, semester1End, semester2Start });
    console.log("🧪 Generated planner:", JSON.stringify(planner, null, 2));

    // outputWindow.document.write("<pre style='font-family: monospace;'>"); // REMOVED this duplicate <pre> opening
    planner.forEach((week, index) => {
        outputWindow.document.write(`📅 Week ${index + 1}\n`);
         week.entries.forEach(entry => {
      outputWindow.document.write(`  ${entry.date}: ${entry.start_time}–${entry.end_time} — ${entry.subject} (Term ${entry.term})\n`);
    });
    outputWindow.document.write("\n");
  });
  outputWindow.document.write("</pre>");

    // --- Summary: Term 1 vs Term 2 counts ---
    try {
      const t1 = planner.reduce((a, w) => a + w.entries.filter(e => e.term === 1).length, 0);
      const t2 = planner.reduce((a, w) => a + w.entries.filter(e => e.term === 2).length, 0);
      outputWindow.document.write(`\n🧮 Summary: Term 1 = ${t1} slots, Term 2 = ${t2} slots\n\n`);
      // Last planned date diagnostic
      try {
        const allDates = planner.flatMap(w => w.entries.map(e => e.date));
        const lastPlanned = allDates.length ? allDates.sort().at(-1) : null;
        if (lastPlanned) {
          outputWindow.document.write(`Last planned date: ${lastPlanned}\n`);
        } else {
          outputWindow.document.write(`Last planned date: (none)\n`);
        }
        const endD = new Date(endDate);
        const sem2 = new Date(semester2Start);
        if (t2 === 0) {
          if (endD < sem2) {
            outputWindow.document.write(`⚠️ Your End Date (${endDate}) is BEFORE Semester 2 start (${semester2Start}), so everything is Term 1.\n`);
          } else {
            outputWindow.document.write(`⚠️ No Term 2 slots were generated. Check holidays, weekday matches, or that weekly rows exist for those days.\n`);
          }
        }
        outputWindow.document.write(`\n`);
      } catch (diagErr) {
        console.warn('Diagnostics failed:', diagErr);
      }
    } catch (e) {
      console.warn("Failed to compute term summary:", e);
    }

    // Save the generated plan (with units) into generatedyearplan
    await fetch("/schedule/generate-year-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planner, semester1End, semester2Start, semester1EndISO, semester2StartISO })
    });
    // Mirror the planner into yearplan table via new endpoint
    try {
      const mirrorRes = await fetch("/schedule/mirror-year-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planner, semester1End, semester2Start, semester1EndISO, semester2StartISO })
      });
      const mirrorResult = await mirrorRes.json();
      outputWindow.document.write(`\n🔁 Mirror: ${mirrorResult.message}`);

      // Fetch and display allocated units from yearplan for the chosen range
      try {
        const allocatedRes = await fetch(`/schedule/yearplan-range?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`);
        const allocated = await allocatedRes.json();
        outputWindow.document.write("\n\n📚 Allocated Units (from yearplan)\n");
        if (Array.isArray(allocated) && allocated.length) {
          allocated.forEach(row => {
            const d = row.date;
            const t = `${row.start_time}–${row.end_time}`;
            const subj = row.subject;
            const unit = row.unit || "—";
            const type = row.uniteType ? ` (Вид: ${row.uniteType})` : "";
            const sec = row.sectionInfo ? ` [седмица: ${row.sectionInfo}]` : "";
            outputWindow.document.write(`  ${d} ${t} — ${subj} — Unit: ${unit}${type}${sec}\n`);
          });
        } else {
          outputWindow.document.write("  (No allocated rows returned for this range)\n");
        }
      } catch (e) {
        outputWindow.document.write("\n⚠️ Failed to fetch allocated units.\n");
      }
    } catch (mirrorErr) {
      outputWindow.document.write(`\n❌ Mirror error: ${mirrorErr.message}`);
    }

        // … след mirror+диагностики:
    const subjects = [...new Set(planner.flatMap(w => w.entries.map(e => e.subject)))];

    for (const subj of subjects) {
      try {
        const r = await fetch('/schedule/apply-distribution-smart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: subj, start: startDate, end: endDate })
        });
        const j = await r.json();
        outputWindow.document.write(`\n📚 Distribution (smart) for ${subj}: updated ${j.updated || 0} rows`);
      } catch (e) {
        outputWindow.document.write(`\n⚠️ Distribution (smart) failed for ${subj}`);
      }
}
  })();

});

// ---- Optional term-only generators (if buttons exist) ----
const _t1Btn = document.getElementById("generateTerm1Btn");
if (_t1Btn) _t1Btn.addEventListener("click", () => {
  const outputWindow = window.open("", "_blank");
  (async () => {
    const startDate = document.getElementById("startYearDate").value;
    const semester1End = document.getElementById("endSemester1").value;
    const semester2Start = document.getElementById("startSemester2").value;
    if (!startDate || !semester1End) { alert("❗ Попълни начална дата и край на първи срок."); outputWindow.close(); return; }
    const planner = await generateWeeklyPlanDebug({ startDate, endDate: semester1End, semester1End, semester2Start });
    try {
      const res = await fetch("/schedule/generate-year-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planner, semester1End, semester2Start, semester1EndISO: semester1End, semester2StartISO: semester2Start }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save planner");
      outputWindow.document.write("<pre style='font-family: monospace;'>");
      outputWindow.document.write(`✅ ${result.message} (Първи срок)\n\n`);
      planner.forEach((week, idx)=>{
        outputWindow.document.write(`📅 Week ${idx+1}\n`);
        week.entries.forEach(e=>{
          const dayName = new Date(e.date).toLocaleDateString('en-US', { weekday:'long' });
          outputWindow.document.write(`  ${e.date} (${dayName}): ${e.start_time}–${e.end_time} — ${e.subject}\n`);
        });
        outputWindow.document.write("\n");
      });
      outputWindow.document.write("</pre>");
    } catch (err){ alert("❌ Error saving Term 1 planner: " + err.message); outputWindow.close(); }
  })();
});

const _t2Btn = document.getElementById("generateTerm2Btn");
if (_t2Btn) _t2Btn.addEventListener("click", () => {
  const outputWindow = window.open("", "_blank");
  (async () => {
    const endDate = document.getElementById("endYearDate").value;
    const semester1End = document.getElementById("endSemester1").value;
    const semester2Start = document.getElementById("startSemester2").value;
    if (!semester2Start || !endDate) { alert("❗ Попълни начало на втори срок и край на учебната година."); outputWindow.close(); return; }
    const planner = await generateWeeklyPlanDebug({ startDate: semester2Start, endDate, semester1End, semester2Start });
    try {
      const res = await fetch("/schedule/generate-year-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planner, semester1End, semester2Start, semester1EndISO: semester1End, semester2StartISO: semester2Start }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save planner");
      outputWindow.document.write("<pre style='font-family: monospace;'>");
      outputWindow.document.write(`✅ ${result.message} (Втори срок)\n\n`);
      planner.forEach((week, idx)=>{
        outputWindow.document.write(`📅 Week ${idx+1}\n`);
        week.entries.forEach(e=>{
          const dayName = new Date(e.date).toLocaleDateString('en-US', { weekday:'long' });
          outputWindow.document.write(`  ${e.date} (${dayName}): ${e.start_time}–${e.end_time} — ${e.subject}\n`);
        });
        outputWindow.document.write("\n");
      });
      outputWindow.document.write("</pre>");
    } catch (err){ alert("❌ Error saving Term 2 planner: " + err.message); outputWindow.close(); }
  })();
});
