let fs, path;
if (typeof window === 'undefined') {
  fs = require('fs');
  path = require('path');
}


/**
 * Schedule generator
 *
 * Input:
 * - rows: scheduleentries rows from DB. Each row should contain at least:
 *   - weekday: number (0-6 or 1-7) OR string (e.g. 'Mon', 'Понеделник')
 *   - start_time: 'HH:MM' (or 'HH:MM:SS')
 *   - end_time:   'HH:MM' (or 'HH:MM:SS')
 *   - any other columns (subject, class, room, etc.) are carried through.
 * - termStart / termEnd: 'YYYY-MM-DD' (inclusive)
 * - holidays: collection of 'YYYY-MM-DD' dates to skip (works in browser)
 *
 * Output:
 * - array of "instances" (one per actual lesson occurrence), each containing:
 *   - date: 'YYYY-MM-DD'
 *   - weekday: normalized 0..6 (Mon..Sun)
 *   - start_time, end_time (as provided, normalized to HH:MM)
 *   - start_iso, end_iso (ISO strings in local time offset)
 *   - source: the original DB row
 *
 * @param {number} [args.useRecurrence=0] - when 1, honors recurrence (WEEKLY/BIWEEKLY) + week_parity
 * @param {string} [args.weekIndexBase='termStart'] - (reserved) week counting base; currently termStart-based
 * @returns {Array<Object>} schedule instances
 */



function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function loadHolidaysTxt(filePath) {
  // Node-only helper (reads from filesystem).
  // In the browser this returns empty Set.
  if (!fs || !path) return new Set();
  if (!filePath) return new Set();
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return new Set();

  const txt = fs.readFileSync(absPath, 'utf8');
  return new Set(
    txt
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => isYmd(s))
  );
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeTime(t) {
  if (t == null) return null;
  const s = String(t);
  // Accept HH:MM or HH:MM:SS
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${pad2(hh)}:${pad2(mm)}`;
}

function parseYmdToDate(ymd) {
  // Create a Date in local time at midnight.
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateYmd(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function addDays(dt, days) {
  const d = new Date(dt.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// Normalize JS weekday: 0=Mon ... 6=Sun
function jsDowMon0(dt) {
  // JS: 0=Sun..6=Sat
  const js = dt.getDay();
  return (js + 6) % 7;
}

function normalizeWeekday(value, { mode = 'auto' } = {}) {
  // Returns 0..6 (Mon..Sun) or null if unknown.
  if (value == null) return null;

  // Numeric
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = value;
    // auto: accept 0..6 or 1..7
    if (mode === 'zeroBased' || (mode === 'auto' && n >= 0 && n <= 6)) return n;
    if (mode === 'oneBased' || (mode === 'auto' && n >= 1 && n <= 7)) return n - 1;
    return null;
  }

  const s = String(value).trim().toLowerCase();
  if (!s) return null;

  // English short
  const mapEn = {
    mon: 0, monday: 0,
    tue: 1, tues: 1, tuesday: 1,
    wed: 2, wednesday: 2,
    thu: 3, thur: 3, thurs: 3, thursday: 3,
    fri: 4, friday: 4,
    sat: 5, saturday: 5,
    sun: 6, sunday: 6,
  };

  // Bulgarian
  const mapBg = {
    'пон': 0, 'понеделник': 0,
    'вто': 1, 'вторник': 1,
    'сря': 2, 'сряда': 2,
    'чет': 3, 'четвъртък': 3, 'четвъртъкa': 3,
    'пет': 4, 'петък': 4,
    'съб': 5, 'събота': 5,
    'нед': 6, 'неделя': 6,
  };

  if (s in mapEn) return mapEn[s];
  if (s in mapBg) return mapBg[s];

  // If it's a string digit
  if (/^\d+$/.test(s)) {
    return normalizeWeekday(Number(s), { mode });
  }

  return null;
}

function combineDateAndTime(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Generate schedule instances for the term.
 *
 * @param {Object} args
 * @param {Array<Object>} args.rows - scheduleentries rows
 * @param {string} args.termStart - YYYY-MM-DD (inclusive)
 * @param {string} args.termEnd - YYYY-MM-DD (inclusive)
 * @param {Array<string>|Set<string>} [args.holidays] - collection of 'YYYY-MM-DD' dates to skip (works in browser)
 * @param {('auto'|'zeroBased'|'oneBased')} [args.weekdayMode='auto'] - how to interpret numeric weekday
 * @param {number} [args.useRecurrence=0] - when 1, honors recurrence (WEEKLY/BIWEEKLY) + week_parity
 * @param {string} [args.weekIndexBase='termStart'] - (reserved) week counting base; currently termStart-based
 * @returns {Array<Object>} schedule instances
 */
function generateSchedule({
  rows,
  termStart,
  termEnd,
  weekdayMode = 'auto',
  holidaysPath,
  holidays,
  useRecurrence = 0,
  baseWeekParity = 1
}) {
  if (!Array.isArray(rows)) throw new Error('generateSchedule: rows must be an array');
  if (!isYmd(termStart) || !isYmd(termEnd)) {
    throw new Error('generateSchedule: termStart/termEnd must be YYYY-MM-DD');
  }

  const start = parseYmdToDate(termStart);
  const end = parseYmdToDate(termEnd);
  if (start.getTime() > end.getTime()) throw new Error('generateSchedule: termStart must be <= termEnd');

  const msPerDay = 24 * 60 * 60 * 1000;
  const termStartMid = start.getTime();

  function mondayStartMs(localMidnightMs) {
    const dt = new Date(localMidnightMs);
    // JS getDay(): 0=Sun..6=Sat. Convert to Mon-based 0..6.
    const mon0 = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - mon0);
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
  }

  function weekIndexForDateYmd(ymd) {
    const dMid = parseYmdToDate(ymd).getTime();
    const w0 = mondayStartMs(termStartMid);
    const w1 = mondayStartMs(dMid);
    const weeks = Math.floor((w1 - w0) / (7 * msPerDay));
    return weeks + 1; // 1-based
  }

  function parityForWeekIndex(weekIndex) {
    // baseWeekParity defines the parity of weekIndex=1.
    // If baseWeekParity=1: 1,2,1,2...
    // If baseWeekParity=2: 2,1,2,1...
    return (((weekIndex - 1) + (baseWeekParity - 1)) % 2) + 1;
  }

  function normRecurrence(v) {
    if (v == null) return 'WEEKLY';
    const s = String(v).trim().toUpperCase();
    if (!s) return 'WEEKLY';
    if (s === 'WEEKLY') return 'WEEKLY';
    if (s === 'BIWEEKLY' || s === 'BI-WEEKLY' || s === 'BI_WEEKLY') return 'BIWEEKLY';
    return 'WEEKLY';
  }

  // Normalize + filter valid rows
  const normalized = rows
    .map((r) => {
      const weekday = normalizeWeekday(r?.weekday, { mode: weekdayMode });
      const start_time = normalizeTime(r?.start_time);
      const end_time = normalizeTime(r?.end_time);
      if (weekday == null || !start_time || !end_time) return null;
      return {
        source: r,
        weekday,
        start_time,
        end_time,
        recurrence: normRecurrence(r?.recurrence),
        week_parity: (r?.week_parity == null || r?.week_parity === '') ? null : Number(r.week_parity),
        ordernumber: (r?.ordernumber == null || r?.ordernumber === '') ? null : Number(r.ordernumber),
      };
    })
    .filter(Boolean);

  // Group by weekday for faster lookup
  const byDay = new Map();
  for (const row of normalized) {
    if (!byDay.has(row.weekday)) byDay.set(row.weekday, []);
    byDay.get(row.weekday).push(row);
  }

  // Sort ONLY inside each weekday by time (start_time, then end_time)
  for (const [wd, arr] of byDay.entries()) {
    arr.sort((a, b) => {
      const c1 = a.start_time.localeCompare(b.start_time);
      if (c1) return c1;
      const c2 = a.end_time.localeCompare(b.end_time);
      if (c2) return c2;
      return String(a?.source?.subject ?? '').localeCompare(String(b?.source?.subject ?? ''), 'bg', { sensitivity: 'base' });
    });
  }

  // Holidays can be provided directly (browser-friendly). Fallback to reading from filesystem (Node only).
  let holidaySet = new Set();
  if (holidays instanceof Set) {
    holidaySet = holidays;
  } else if (Array.isArray(holidays)) {
    holidaySet = new Set(holidays.filter(isYmd));
  } else {
    holidaySet = loadHolidaysTxt(holidaysPath) || new Set();
  }
  const out = [];

  for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    const ymd = formatDateYmd(d);

    // Skip holidays / vacations
    if (holidaySet.has(ymd)) continue;

    const wd = jsDowMon0(d);
    const dayRows = byDay.get(wd);
    if (!dayRows || dayRows.length === 0) continue;

    const wIdx = useRecurrence ? weekIndexForDateYmd(ymd) : null;
    const wParity = useRecurrence ? parityForWeekIndex(wIdx) : null;

    for (const rr of dayRows) {
      if (useRecurrence && rr.recurrence === 'BIWEEKLY') {
        const rowParity = (rr.week_parity === 1 || rr.week_parity === 2) ? rr.week_parity : 1;
        if (rowParity !== wParity) continue;
      }

      const startDt = combineDateAndTime(ymd, rr.start_time);
      const endDt = combineDateAndTime(ymd, rr.end_time);

      out.push({
        date: ymd,
        weekday: wd,
        start_time: rr.start_time,
        end_time: rr.end_time,
        start_iso: startDt.toISOString(),
        end_iso: endDt.toISOString(),
        source: rr.source,
      });
    }
  }

  // Final sort: by date, then time
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.start_time.localeCompare(b.start_time);
  });

  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    generateSchedule,
    normalizeWeekday,
    normalizeTime,
  };
}

// For ESM import compatibility in the browser (if bundled)
// eslint-disable-next-line no-undef
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-undef
  window.ScheduleAlgorithm = { generateSchedule, normalizeWeekday, normalizeTime };
}