// DOM helpers & default dates
export function qs(id){ return document.getElementById(id); }
export function setText(el, txt){ if(el) el.textContent = txt; }

export function addDays(d, n){ const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt; }
export function fmtDate(d){ return new Date(d).toISOString().slice(0,10); }

export function initDefaultDates() {
  const startYearDate = qs("startYearDate");
  const endYearDate   = qs("endYearDate");
  const endSemester1  = qs("endSemester1");
  const startSemester2= qs("startSemester2");
  const today = new Date();
  const start = addDays(today, Math.floor(Math.random()*30));
  const end   = addDays(start, Math.floor(Math.random()*60)+15);
  const duration = Math.round((end - start) / 86400000);
  const midOffset = Math.floor(duration/2 + (Math.random()*10 - 5));
  const sem1End = addDays(start, midOffset);
  const sem2Start = addDays(sem1End, Math.floor(Math.random()*7)+1);

  startYearDate.value  = fmtDate(start);
  endYearDate.value    = fmtDate(end);
  endSemester1.value   = fmtDate(sem1End);
  startSemester2.value = fmtDate(sem2Start);
}

export function renderCurrentScheduleInfo(data){
  const infoBox = qs("currentScheduleInfo");
  if(!data.hasCurrent){ setText(infoBox, "⚠️ No current schedule set."); return; }
  const { current, currentRows } = data;
  let out = `📅 Year: ${current.start_year}–${current.end_year}\n\n`;
  if(Array.isArray(currentRows)){
    currentRows.forEach(row=>{
      out += `📘 Class ${row.class} ${row.division}, Term ${row.term}:\n`;
      out += `    Разпределение: ${row.razpredelenie}\n\n`;
    });
  }
  setText(infoBox, out);
}

export function renderWeeklyScheduleInfo(data){
  const box = qs("weeklyScheduleInfo");
  if(!data.hasCurrent){ setText(box, "⚠️ No weekly schedule available."); return; }
  let out = `📅 Year: ${data.current.start_year}–${data.current.end_year}\n\n`;
  data.weeklyRows.forEach(row=>{
    out += `🗓️ ${row.weekday}, ${row.start_time}–${row.end_time} — ${row.subject} (Term ${row.term})\n`;
  });
  setText(box, out);
}