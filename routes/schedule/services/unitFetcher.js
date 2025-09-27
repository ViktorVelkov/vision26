const pool = require('../../../db');
const parseDistributionFile = require('./parseDistribution');
const { normalizeSubjectName } = require('../utils/dates');

function buildUnitFetcher(currentRows) {
  const unitCache = new Map();   // progressKey -> { mode: 'byTerm'|'single', all, byTerm: {1:[],2:[]} }
  const unitCursor = new Map();  // progressKey or progressKey::term -> index
  const keyBySubj = new Map();   // "8 A::1" -> progressKey

  const makeProgressKey = (row) => `${row.start_year}:${row.end_year}:${row.class}:${row.division}:${row.razpredelenie}`;

  async function loadCursor(row) {
    const q = await pool.query(
      `SELECT next_index FROM "distributionprogress"
       WHERE start_year=$1 AND end_year=$2 AND class=$3 AND division=$4 AND file=$5 LIMIT 1`,
      [row.start_year, row.end_year, row.class, row.division, row.razpredelenie]
    );
    return q.rows.length ? (Number(q.rows[0].next_index) || 0) : 0;
  }

  async function saveCursor(row, idx) {
    await pool.query(
      `INSERT INTO "distributionprogress" (start_year,end_year,class,division,file,next_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (start_year,end_year,class,division,file)
       DO UPDATE SET next_index=EXCLUDED.next_index, updated_at=now()`,
      [row.start_year, row.end_year, row.class, row.division, row.razpredelenie, idx]
    );
  }

  const getNextUnit = async function(subject, term) {
    const subKey = normalizeSubjectName(subject);
    const termNum = Number(term) || 1;
    const subjTermKey = `${subKey}::${termNum}`;

    let progressKey = keyBySubj.get(subjTermKey);
    let match;
    if (!progressKey) {
      match = currentRows.find(row =>
        normalizeSubjectName(`${row.class} ${row.division}`) === subKey &&
        row.razpredelenie
      );
      if (!match) {
        console.warn('getNextUnit: no currentSchedule match for', { subject: subKey, term: termNum });
        return {};
      }
      progressKey = makeProgressKey(match);
      keyBySubj.set(subjTermKey, progressKey);
    } else {
      match = currentRows.find(r => makeProgressKey(r) === progressKey);
    }

    if (!unitCache.has(progressKey)) {
      try {
        const units = await parseDistributionFile(match.razpredelenie, null); // no meta dependency
        const bothTermsFlag = !!(match.bothterms ?? match.bothTerms);

        // Detect if the parsed rows already carry term info (from autodetection or inside file)
        const hasPerRowTerm = units.some(u => u.term === 1 || u.term === 2);

        if (bothTermsFlag && hasPerRowTerm) {
          const byTerm = { 1: [], 2: [] };
          for (const u of units) {
            const t = (u.term === 1 || u.term === 2) ? u.term : 1;
            byTerm[t].push({ unit: u.unit, week: u.week, uniteType: u.uniteType, notes: u.notes });
          }
          unitCache.set(progressKey, { mode: 'byTerm', byTerm, all: [] });
          unitCursor.set(`${progressKey}::1`, await loadCursor(match));
          unitCursor.set(`${progressKey}::2`, await loadCursor(match));
        } else {
          // Either: bothTerms=false  OR  bothTerms=true but we couldn't detect term per row
          // In both cases, consume a single linear list across the year.
          const all = units.map(u => ({ unit: u.unit, week: u.week, uniteType: u.uniteType, notes: u.notes }));
          unitCache.set(progressKey, { mode: 'single', all, byTerm: {1:[],2:[]} });
          unitCursor.set(progressKey, await loadCursor(match));
        }
      } catch (e) {
        console.error('getNextUnit: parse failed', match.razpredelenie, e);
        unitCache.set(progressKey, { mode: 'single', all: [], byTerm: {1:[],2:[]} });
        unitCursor.set(progressKey, 0);
      }
    }

    const cache = unitCache.get(progressKey);
    if (cache.mode === 'byTerm') {
      const list = cache.byTerm[termNum] || [];
      const key  = `${progressKey}::${termNum}`;
      const idx  = unitCursor.get(key) || 0;
      if (idx >= list.length) return {};
      const result = list[idx] || {};
      unitCursor.set(key, idx + 1);
      return result;
    } else {
      const list = cache.all || [];
      const idx  = unitCursor.get(progressKey) || 0;
      if (idx >= list.length) return {};
      const result = list[idx] || {};
      unitCursor.set(progressKey, idx + 1);
      return result;
    }
  };

  getNextUnit.flush = async function() {
    for (const row of currentRows) {
      if (!row.razpredelenie) continue;
      const pk = makeProgressKey(row);
      if (!unitCache.has(pk)) continue;
      const cache = unitCache.get(pk);
      if (cache.mode === 'byTerm') {
        const idx1 = unitCursor.get(`${pk}::1`);
        const idx2 = unitCursor.get(`${pk}::2`);
        if (typeof idx1 === 'number') await saveCursor(row, idx1);
        if (typeof idx2 === 'number') await saveCursor(row, idx2);
      } else {
        const idx = unitCursor.get(pk);
        if (typeof idx === 'number') await saveCursor(row, idx);
      }
    }
  };

  return getNextUnit;
}

module.exports = buildUnitFetcher;