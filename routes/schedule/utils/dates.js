function parseClientDate(str) {
  if (!str && str !== 0) return new Date(NaN);
  if (typeof str === "string") {
    const s = str.trim();
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
      const [day, month, year] = s.split(".");
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [day, month, year] = s.split("/");
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }
    return new Date(s);
  }
  return new Date(str);
}

function normalizeSubjectName(s) {
  return String(s || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTerm(entry, sem1EndDate, sem2StartDate) {
  const n = Number(entry && entry.term);
  if (n === 1 || n === 2) return n;

  const d = parseClientDate(entry && entry.date);
  const eTime = d instanceof Date ? d.getTime() : NaN;
  const s1Valid = (sem1EndDate instanceof Date) && !Number.isNaN(sem1EndDate.getTime());
  const s2Valid = (sem2StartDate instanceof Date) && !Number.isNaN(sem2StartDate.getTime());

  if (!Number.isNaN(eTime)) {
    if (s1Valid && eTime <= sem1EndDate.getTime()) return 1;
    if (s2Valid && eTime >= sem2StartDate.getTime()) return 2;
    const m = d.getMonth();
    if (!s1Valid && !s2Valid) {
      if (m === 0 || m >= 8 || m === 6 || m === 7) return 1; // Jan, Sep–Dec, Jul/Aug
      return 2; // Feb–Jun
    }
    if (s1Valid && !s2Valid) return (eTime <= sem1EndDate.getTime()) ? 1 : 2;
    if (!s1Valid && s2Valid) return (eTime < sem2StartDate.getTime()) ? 1 : 2;
  }
  return 1;
}

function fmtDateISO(d) {
  return (d instanceof Date && !Number.isNaN(d.getTime()))
    ? d.toISOString().slice(0, 10)
    : 'invalid';
}

function rangeFromPlanner(planner) {
  let minT = Infinity, maxT = -Infinity;
  if (Array.isArray(planner)) {
    for (const week of planner) {
      if (!week || !Array.isArray(week.entries)) continue;
      for (const e of week.entries) {
        if (!e || !e.date) continue;
        const t = new Date(e.date).getTime();
        if (Number.isNaN(t)) continue;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
    }
  }
  return {
    minDate: Number.isFinite(minT) ? new Date(minT) : null,
    maxDate: Number.isFinite(maxT) ? new Date(maxT) : null
  };
}

module.exports = { parseClientDate, normalizeSubjectName, resolveTerm, fmtDateISO, rangeFromPlanner };