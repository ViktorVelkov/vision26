/****
 * Fetch distribution progress and build a Map keyed by "<class> <division>".
 * Value is next_index from distributionprogress.
 *
 * Example key: "11 МодулА"
 * Example value: 7
 */

export async function buildDistributionIndexMap() {
  const res = await fetch('/api/distributionprogress', {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const rows = await res.json();

  const progressMap = new Map();      // key -> next_index
  const progressMetaMap = new Map();  // key -> { class, division, file }

  for (const row of rows) {
    const cls = String(row.class ?? '').trim();
    const div = String(row.division ?? '').trim();
    if (!cls) continue;

    const key = div ? `${cls} ${div}` : cls;

    progressMap.set(key, Number(row.next_index ?? 0));

    progressMetaMap.set(key, {
      class: Number(row.class),
      division: row.division ?? '',
      file: row.file
    });
  }

  return {
    progressMap,
    progressMetaMap
  };
}