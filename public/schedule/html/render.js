// browser-side helpers
let selectedScheduleYear = null;
let scheduleYearReadyPromise = null;

function scheduleYearQueryString() {
  if (!selectedScheduleYear) return '';

  return `?start_year=${encodeURIComponent(selectedScheduleYear.start_year)}&end_year=${encodeURIComponent(selectedScheduleYear.end_year)}`;
}

async function loadScheduleYearOptions() {
  const select = document.getElementById('scheduleYearSelect');
  if (!select) return;

  try {
    const res = await fetch('/api/scheduleentries-years', { cache: 'no-store' });
    const years = await res.json();
    const safeYears = Array.isArray(years) ? years : [];

    select.innerHTML = safeYears.length
      ? safeYears.map(y => `<option value="${y.start_year}-${y.end_year}">${y.start_year}-${y.end_year}</option>`).join('')
      : '<option value="">Няма години</option>';

    if (safeYears.length) {
      selectedScheduleYear = {
        start_year: safeYears[0].start_year,
        end_year: safeYears[0].end_year
      };

      select.value = `${selectedScheduleYear.start_year}-${selectedScheduleYear.end_year}`;
    }

    select.addEventListener('change', () => {
      const [startRaw, endRaw] = select.value.split('-');
      const start = parseInt(startRaw, 10);
      const end = parseInt(endRaw, 10);

      selectedScheduleYear = Number.isInteger(start) && Number.isInteger(end)
        ? { start_year: start, end_year: end }
        : null;

      window.dispatchEvent(new CustomEvent('schedule-year-changed', {
        detail: selectedScheduleYear
      }));
    });
  } catch (err) {
    console.error('Failed to load schedule years:', err);
    select.innerHTML = '<option value="">Грешка</option>';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  scheduleYearReadyPromise = loadScheduleYearOptions();
});

export const scheduleByTerm = async t => {
  if (!selectedScheduleYear && scheduleYearReadyPromise) {
    await scheduleYearReadyPromise;
  }

  return fetch(`/api/scheduleentries/${t}${scheduleYearQueryString()}`)
    .then(r => r.json());
};

export const renderTableByTerm = (t, el) =>
  scheduleByTerm(t).then(rows => {
    if (!el) return;
    if (!rows || rows.length === 0) {
      el.innerHTML = '<div class="kv">Няма записи.</div>';
      return;
    }

    // Build column order: keep the first key, force weekday as 2nd, then the rest.
    const keys = Object.keys(rows[0] || {});
    const firstKey = keys[0] || 'id';
    const hasWeekday = keys.includes('weekday');
    const headers = hasWeekday
      ? [firstKey, 'weekday', ...keys.filter(k => k !== firstKey && k !== 'weekday')]
      : keys;
    const last = headers.pop();
    headers[0] = last;
    // Group rows by weekday
    const groups = new Map();
    rows.forEach(r => {
      const day = (r && r.weekday != null) ? String(r.weekday) : '—';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(r);
    });

    // If weekday is numeric, sort days numerically; otherwise keep insertion order.
    const groupKeys = Array.from(groups.keys());
    const allNumeric = groupKeys.every(k => /^\d+$/.test(k));
    if (allNumeric) groupKeys.sort((a, b) => Number(a) - Number(b));

    // Sort within each day by ordernumber first, then start_time
    groupKeys.forEach(day => {
      const arr = groups.get(day);
      if (!arr || !arr.length) return;

      arr.sort((a, b) => {
        const ao = a?.ordernumber == null || a?.ordernumber === '' ? 1e9 : Number(a.ordernumber);
        const bo = b?.ordernumber == null || b?.ordernumber === '' ? 1e9 : Number(b.ordernumber);
        if (ao !== bo) return ao - bo;

        return String(a?.start_time ?? '').localeCompare(String(b?.start_time ?? ''));
      });
    });

    const colSpan = headers.length;

    const headHtml = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;

    const bodyHtml = groupKeys.map(day => {
      const dayRows = groups.get(day) || [];
      const groupHeader = `
        <tr>
          <td colspan="${colSpan}" style="background:#f3f4f6;font-weight:600;">${day}</td>
        </tr>`;

      const rowsHtml = dayRows.map(r =>
        `<tr>${headers.map(h => `<td>${r[h] ?? ''}</td>`).join('')}</tr>`
      ).join('');

      return groupHeader + rowsHtml;
    }).join('');

    el.innerHTML = `<table>${headHtml}<tbody>${bodyHtml}</tbody></table>`;
  });