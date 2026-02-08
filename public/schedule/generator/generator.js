// Minimal browser-side generator wrapper.
// Depends on algorithm.js being loaded in the page (window.ScheduleAlgorithm).

import { buildDistributionIndexMap } from './dist_progress_parser.js';

async function confirmAndResetIfNeeded({ wipeGeneratedYearPlan = true, wipeDistributionProgress = true } = {}) {
  // If user chose not to wipe anything, do nothing and do not prompt.
  if (!wipeGeneratedYearPlan && !wipeDistributionProgress) return;

  const r = await fetch('/api/generation/check-existing');
  if (!r.ok) throw new Error(await r.text());
  const info = await r.json();

  const gypCount = Number(info.generatedyearplan ?? 0);
  const dpCount = Number(info.distributionprogress ?? 0);

  // Only prompt if there is something to wipe (based on the chosen flags).
  const willTouchGyp = wipeGeneratedYearPlan && gypCount > 0;
  const willTouchDp = wipeDistributionProgress && dpCount > 0;
  if (!willTouchGyp && !willTouchDp) return;

  const lines = ['В базата вече има данни:'];
  if (willTouchGyp) lines.push(`generatedyearplan: ${gypCount}`);
  if (willTouchDp) lines.push(`distributionprogress: ${dpCount}`);
  lines.push('');
  lines.push('Да се изтрият ли избраните таблици и да се продължи?');

  if (!window.confirm(lines.join('\n'))) {
    throw new Error('Generation cancelled by user');
  }

  const r2 = await fetch('/api/generation/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wipeGeneratedYearPlan, wipeDistributionProgress })
  });
  if (!r2.ok) throw new Error(await r2.text());
}

async function persistDistributionProgress(progressMetaMap, progressMap) {
  const payload = [];

  for (const [key, next_index] of progressMap.entries()) {
    const meta = progressMetaMap.get(key);
    if (!meta) continue;

    payload.push({
      class: meta.class,
      division: meta.division ?? '',
      file: meta.file,
      next_index
    });
  }

  if (payload.length === 0) return;

  const r = await fetch('/api/distributionprogress/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    throw new Error(await r.text());
  }
}

function toHHMMSS(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (!s) return null;
  // Accept HH:MM or HH:MM:SS
  if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
  return s;
}

function weekdayToText(w) {
  if (w == null) return null;
  if (typeof w === 'string') return w;
  const map = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  return map[w] ?? null;
}

async function persistGeneratedYearPlan(assigned, term) {
  const arr = Array.isArray(assigned) ? assigned : [];
  if (arr.length === 0) return;

  const rows = arr.map(s => {
    const src = s.source || {};
    return {
      week_number: s.week_number ?? s.weekNumber ?? null,
      date: s.date,
      weekday: weekdayToText(s.weekday ?? src.weekday),
      start_time: toHHMMSS(s.start_time ?? src.start_time),
      end_time: toHHMMSS(s.end_time ?? src.end_time),
      subject: s.subject ?? src.subject,
      unit: s.unit ?? null,
      sectioninfo: (s.sectioninfo == null ? null : String(s.sectioninfo)),
      unitetype: s.unitetype ?? src.unitetype ?? null,
      notes: s.notes ?? null,
      duration: s.duration ?? src.duration ?? null,
      is_module: !!(s.is_module ?? src.is_module),
      term: term ?? src.term ?? null,
      fixedDate: !!(s.fixedDate ?? false),
      indexInFile: s.topic_index ?? null,
    };
  });

  const r = await fetch('/api/generatedyearplan/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  });

  if (!r.ok) {
    throw new Error(await r.text());
  }
}

async function fetchProgressMetaFromCurrentSchedule() {
  const r = await fetch('/api/current-schedule', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(await r.text());
  const rows = await r.json();

  const m = new Map(); // key -> { class, division, file }
  for (const row of rows) {
    const cls = String(row.class ?? '').trim();
    const div = String(row.division ?? '').trim();
    const file = row.razpredelenie;
    if (!cls || !file) continue;

    const key = div ? `${cls} ${div}` : cls;
    m.set(key, {
      class: Number(row.class),
      division: row.division ?? '',
      file
    });
  }
  return m;
}

function getAlg() {
  if (typeof window === 'undefined' || !window.ScheduleAlgorithm) {
    throw new Error('ScheduleAlgorithm is not loaded. Include algorithm.js before generator.js.');
  }
  return window.ScheduleAlgorithm;
}

function normalizeKeyFromSlot(slot) {
  const s = slot?.source || {};
  const subj = typeof s.subject === 'string' ? s.subject.trim() : '';
  if (subj) return subj;

  const cls = String(s.class ?? '').trim();
  const div = String(s.division ?? '').trim();
  return (cls + (div ? ' ' + div : '')).trim();
}

function extractTopicsForKey(topicsMap, key) {
  if (!topicsMap || !key) return null;
  const val = topicsMap[key];
  if (!val) return null;

  // Case A: array of strings
  if (Array.isArray(val) && (val.length === 0 || typeof val[0] === 'string')) {
    return val;
  }

  // Case A2: array of topic objects: [{ index, unit }, ...]
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] && 'unit' in val[0]) {
    return val;
  }

  // Case B: array of entries: [{..., topics:[...]}, ...]
  if (Array.isArray(val) && val.length > 0 && val[0] && Array.isArray(val[0].topics)) {
    return val[0].topics;
  }

  return null;
}

export function assignTopicsToSlots(slots, topicsMap, progressMap) {
  const inSlots = Array.isArray(slots) ? slots : [];
  const outSlots = [];

  // Work on a copy so caller can keep the original
  const nextMap = new Map(progressMap instanceof Map ? progressMap : []);

  for (const slot of inSlots) {
    const key = normalizeKeyFromSlot(slot);
    const topics = extractTopicsForKey(topicsMap, key);

    const curIdx = Number(nextMap.get(key) ?? 0);

    let unit = null;
    let usedIdx = null; // 0-based index into topics array
    let sectioninfo = null; // numeric label (1-based) coming from topic.index when available

    if (topics && topics.length > 0 && curIdx >= 0 && curIdx < topics.length) {
      const item = topics[curIdx];

      // If topic items are objects: { index: 1, unit: '...' }
      if (item && typeof item === 'object' && 'unit' in item) {
        unit = item.unit ?? null;
        sectioninfo = (item.index == null || item.index === '') ? (curIdx + 1) : Number(item.index);
      } else {
        // Legacy: topic is a string
        unit = item;
        sectioninfo = curIdx + 1;
      }

      usedIdx = curIdx;
      nextMap.set(key, curIdx + 1);
    }

    outSlots.push({
      ...slot,
      unit,
      sectioninfo,
      topic_index: usedIdx,
    });
  }

  return { slots: outSlots, progressMap: nextMap };
}

export async function generateScheduleWithTopicsFromApi(args) {
  await confirmAndResetIfNeeded({
    wipeGeneratedYearPlan: !!args?.wipeGeneratedYearPlan,
    wipeDistributionProgress: !!args?.wipeDistributionProgress,
  });
  const slots = await generateScheduleFromApi(args);
console.log('--- TEST: buildDistributionIndexMap ---');

const disto = await buildDistributionIndexMap();

console.log(
  'IDX 11 МодулА =',
  disto.progressMap.get('11 МодулА')
);

console.log(
  'META 11 МодулА =',
  disto.progressMetaMap.get('11 МодулА')
);
  const [topicsMap, dist, metaFromCS] = await Promise.all([
    fetchTopicsMap(),
    buildDistributionIndexMap(),
    fetchProgressMetaFromCurrentSchedule(),
  ]);

  // Merge metadata: prefer existing distributionprogress meta when present, fallback to currentSchedule meta.
  const mergedMeta = new Map(metaFromCS);
  if (dist?.progressMetaMap instanceof Map) {
    for (const [k, v] of dist.progressMetaMap.entries()) {
      mergedMeta.set(k, v);
    }
  }

  const { slots: assigned, progressMap } =
    assignTopicsToSlots(slots, topicsMap, dist.progressMap);

  await persistDistributionProgress(mergedMeta, progressMap);

  await persistGeneratedYearPlan(assigned, args?.term);

  return assigned;
  
}

export async function generateScheduleFromApi({
  term,
  termStart,
  termEnd,
  useRecurrence = 0,
  baseWeekParity = 1,
  holidaysPath = '/Users/viktorvelkov/Documents/teacher-app-backend/holidays.txt',
  wipeGeneratedYearPlan = true,
  wipeDistributionProgress = true,
}) {
  const res = await fetch(`/api/scheduleentries/${term}`, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${txt || res.statusText}`);
  }

  const rows = await res.json();
  const alg = getAlg();

  return alg.generateSchedule({
    rows,
    termStart,
    termEnd,
    holidaysPath,
    useRecurrence,
    baseWeekParity,
  });
}


export async function fetchTopicsMap() {
  const r = await fetch('/api/distributions/topics-map', {
    headers: { Accept: 'application/json' },
  });

  if (!r.ok) {
    throw new Error(await r.text());
  }

  return r.json();
}