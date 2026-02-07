// Minimal browser-side generator wrapper.
// Depends on algorithm.js being loaded in the page (window.ScheduleAlgorithm).

function getAlg() {
  if (typeof window === 'undefined' || !window.ScheduleAlgorithm) {
    throw new Error('ScheduleAlgorithm is not loaded. Include algorithm.js before generator.js.');
  }
  return window.ScheduleAlgorithm;
}

/**
 * Fetches rows from /api/scheduleentries/:term and generates a schedule array.
 *
 * @param {Object} opts
 * @param {number} opts.term - 1 | 2 | 3
 * @param {string} opts.termStart - YYYY-MM-DD
 * @param {string} opts.termEnd - YYYY-MM-DD
 * @param {string} [opts.holidaysPath] - used only in Node (browser ignores file reading)
 * @returns {Promise<Array>} schedule instances
 */
export async function generateScheduleFromApi({
  term,
  termStart,
  termEnd,
  holidaysPath = '/Users/viktorvelkov/Documents/teacher-app-backend/holidays.txt',
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

  return alg.generateSchedule({ rows, termStart, termEnd, holidaysPath });
}