const express = require('express');
const router = express.Router();

// Adjust this path if your pool export lives elsewhere
const pool = require('../db');

// In-memory cache & helper for editable columns (last two + lessonCreated)
let editableColsCache = null; // { cols: [col1, col2, ...], fetchedAt: number }

async function getEditableColumns(){
  const now = Date.now();
  if (editableColsCache && (now - editableColsCache.fetchedAt) < 5 * 60 * 1000){
    return editableColsCache.cols;
  }
  const sql = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generatedyearplan'
    ORDER BY ordinal_position
  `;
  const { rows } = await pool.query(sql);
  const ordered = rows.map(r => r.column_name);
  if (ordered.length < 2) throw new Error('generatedyearplan has fewer than two columns');
  const cols = ordered.slice(-2);
  // Always allow lessonCreated if present
  if (ordered.includes('lessonCreated') && !cols.includes('lessonCreated')){
    cols.push('lessonCreated');
  }
  // Always allow notes if present
  if (ordered.includes('notes') && !cols.includes('notes')){
    cols.push('notes');
  }
  editableColsCache = { cols, fetchedAt: now };
  return cols;
}

// GET /lessons-calendar/generatedyearplan
// Returns all columns from generatedyearplan with simple optional filters
router.get('/generatedyearplan', async (req, res) => {
  try {
    // Inputs: week (1..N), optional subject filter. If week missing/invalid → default 1
    const { week, week_number, subject } = req.query;
    const wkRaw = week ?? week_number;
    const wkInt = Number.isInteger(parseInt(wkRaw, 10)) && parseInt(wkRaw, 10) > 0
      ? parseInt(wkRaw, 10)
      : 1;

    // If subject is provided, use it consistently for anchoring min(date) and for final rows
    const hasSubject = typeof subject === 'string' && subject.trim() !== '';

    // Build SQL that anchors Week 1 to the ISO week (Mon..Sun) containing the FIRST lecture date
    // (optionally within the given subject), then selects the half-open range for the requested week.
    // We also exclude NULL dates and sort by date -> start_time for Mon→Fri order.
    const sql = `
      WITH base AS (
        SELECT "date"::date AS d
        FROM "generatedyearplan"
        WHERE "date" IS NOT NULL
        ${hasSubject ? 'AND "subject" ILIKE $1' : ''}
      ),
      m AS (
        SELECT MIN(d) AS min_date FROM base
      ),
      w AS (
        SELECT date_trunc('week', m.min_date::timestamp)::date AS week0_start
        FROM m
      )
      SELECT 
        g.id,
        TO_CHAR(g."date", 'YYYY-MM-DD') AS "date",
        g.weekday,
        g.unit,
        g.unitetype,
        g."lessonCreated",
        g."lessonCode",
        g.subject,
        g.start_time,
        g.end_time,
        g.notes,
        g.duration,
        g.is_module,
        g.week_number,
        g.term
      FROM "generatedyearplan" g, w
      WHERE g."date" IS NOT NULL
        AND g."date" >= (w.week0_start + (($${hasSubject ? 2 : 1} - 1) * INTERVAL '7 days'))
        AND g."date" <  (w.week0_start + ($${hasSubject ? 2 : 1} * INTERVAL '7 days'))
        ${hasSubject ? 'AND g."subject" ILIKE $1' : ''}
      ORDER BY g."date"::date ASC NULLS LAST,
               g."start_time" ASC NULLS LAST,
               g."id" ASC;
    `;

    const params = [];
    if (hasSubject) params.push(`%${subject}%`);
    params.push(wkInt);

    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching generatedyearplan (week-anchored):', err);
    return res.status(500).json({ error: 'Failed to fetch generatedyearplan.' });
  }
});

// GET /lessons-calendar/lessons
// Returns up to 200 lessons filtered by q across url/filepath/snippets
router.get('/lessons', async (req, res) => {
  const { q } = req.query;
  let whereSql = '';
  const params = [];

  if (!q || q.trim() === '') {
    return res.json([]);
  }
  if (q && q.trim() !== '') {
    params.push(`%${q}%`);
    // Search across these text columns, now also including lesson_bytext_id, all wrapped with COALESCE and cast lesson_bytext_id to text
    whereSql = `
      WHERE
        COALESCE(url, '') ILIKE $1
        OR COALESCE(filepath, '') ILIKE $1
        OR COALESCE(theory_snippets::text, '') ILIKE $1
        OR COALESCE(lesson_bytext_id::text, '') ILIKE $1
    `;
  }

  const sql = `
    SELECT url AS url, filepath AS filepath, theory_snippets, exercises_ids
    FROM "Lessons"
    ${whereSql}
    ORDER BY url NULLS LAST
    LIMIT 200
  `;

  try {
    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error searching lessons:', err);
    return res.status(500).json({ error: 'Failed to search lessons.' });
  }
});

// PATCH /lessons-calendar/generatedyearplan/:id
// Body: { column, value }
router.patch('/generatedyearplan/:id', async (req, res) => {
  const { id } = req.params;
  let { column, value } = req.body || {};

  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!column) return res.status(400).json({ error: 'Missing column' });

  try {
    const editableCols = await getEditableColumns();
    if (!editableCols.includes(column)){
      return res.status(400).json({ error: `Column not editable. Allowed: ${editableCols.join(', ')}` });
    }

    // Build safe, parameterized SQL. Column name is validated from whitelist.
    const sql = `UPDATE "generatedyearplan" SET "${column}" = $1 WHERE id = $2 RETURNING id, "${column}"`;
    const params = [value, id];
    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Row not found' });
    return res.json({ success: true, id: rows[0].id, column, value: rows[0][column] });
  } catch (err) {
    console.error('Error updating generatedyearplan:', err);
    return res.status(500).json({ error: 'Failed to update generatedyearplan.' });
  }
});

// === Utilities for calendar actions ===
// Shift lesson date by N days (can be negative)
// POST /lessons-calendar/generatedyearplan/:id/shift-date  { days: int }
router.post('/generatedyearplan/:id/shift-date', async (req, res) => {
  const { id } = req.params;
  const daysRaw = (req.body && req.body.days);
  const days = parseInt(daysRaw, 10);
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (!Number.isInteger(days)) return res.status(400).json({ error: 'Invalid days' });
  try {
    const sql = `UPDATE "generatedyearplan"
                 SET "date" = (CASE WHEN "date" IS NULL THEN NULL ELSE ("date"::date + ($1 * INTERVAL '1 day')) END)
                 WHERE id = $2
                 RETURNING id, TO_CHAR("date", 'YYYY-MM-DD') AS date;`;
    const { rows } = await pool.query(sql, [days, id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error('shift-date failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// Merge two lessons: source -> target, then delete source.
// Body: { sourceId, targetId, strategy?: 'append-notes'|'overwrite-empty' }
// - append-notes: notes = COALESCE(target.notes,'') || \n\n || COALESCE(source.notes,'')
// - overwrite-empty: copies non-null/empty fields from source into target only if target is null/empty
router.post('/generatedyearplan/merge', async (req, res) => {
  const { sourceId, targetId, strategy } = req.body || {};
  const sid = parseInt(sourceId, 10);
  const tid = parseInt(targetId, 10);
  if (!Number.isInteger(sid) || !Number.isInteger(tid) || sid === tid) {
    return res.status(400).json({ error: 'Invalid source/target id' });
  }
  const strat = (strategy === 'overwrite-empty') ? 'overwrite-empty' : 'append-notes';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch both rows
    const { rows: srcRows } = await client.query('SELECT * FROM "generatedyearplan" WHERE id = $1 FOR UPDATE', [sid]);
    const { rows: tgtRows } = await client.query('SELECT * FROM "generatedyearplan" WHERE id = $1 FOR UPDATE', [tid]);
    if (!srcRows.length || !tgtRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source or target not found' });
    }
    const src = srcRows[0];
    const tgt = tgtRows[0];

    // Build update set list depending on strategy
    const sets = [];
    const params = [];

    if (strat === 'append-notes') {
      // append notes text
      const newNotes = [tgt.notes || '', src.notes || ''].filter(Boolean).join('\n\n');
      params.push(newNotes);
      sets.push(`"notes" = $${params.length}`);
    } else {
      // overwrite-empty: copy selected textual/time fields if empty on target
      const candidates = ['unit','sectioninfo','unitetype','weekday','start_time','end_time','subject','lessonCode'];
      for (const col of candidates) {
        if ((tgt[col] == null || String(tgt[col]).trim() === '') && (src[col] != null && String(src[col]).trim() !== '')) {
          params.push(src[col]);
          sets.push(`"${col}" = $${params.length}`);
        }
      }
      // If target has no duration but source has
      if ((tgt.duration == null || Number.isNaN(tgt.duration)) && (src.duration != null)) {
        params.push(src.duration);
        sets.push(`"duration" = $${params.length}`);
      }
      // If target date is null but source has a date
      if ((tgt.date == null) && (src.date != null)) {
        params.push(src.date);
        sets.push(`"date" = $${params.length}`);
      }
      // Always combine notes too (appended) for traceability
      const newNotes2 = [tgt.notes || '', src.notes || ''].filter(Boolean).join('\n\n');
      params.push(newNotes2);
      sets.push(`"notes" = $${params.length}`);
    }

    if (sets.length) {
      params.push(tid);
      await client.query(`UPDATE "generatedyearplan" SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    // Delete source row
    await client.query('DELETE FROM "generatedyearplan" WHERE id = $1', [sid]);

    // Return updated target
    const { rows: finalRows } = await client.query('SELECT * FROM "generatedyearplan" WHERE id = $1', [tid]);

    await client.query('COMMIT');
    res.json({ ok: true, target: finalRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('merge failed:', err);
    res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});


// Shift a lesson along its subject's chronological sequence,
// moving the current lesson to the previous/next existing date,
// and shifting all subsequent lessons by the same delta to preserve order.
// POST /lessons-calendar/generatedyearplan/:id/shift-sequence
// Body: { dir: 'next' | 'prev' }
router.post('/generatedyearplan/:id/shift-sequence', async (req, res) => {
  const { id } = req.params;
  const dir = (req.body && String(req.body.dir || '').toLowerCase()) === 'prev' ? 'prev' : 'next';

  if (!id) return res.status(400).json({ error: 'Missing id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Lock the target row
    const { rows: targetRows } = await client.query(
      'SELECT id, subject, date::date AS date FROM "generatedyearplan" WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!targetRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Row not found' });
    }
    const t = targetRows[0];
    if (!t.date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot shift: row has NULL date' });
    }
    const subj = t.subject || '';

    // 2) Find neighbor date in the same subject sequence
    const neighborSql = dir === 'next'
      ? `SELECT date::date AS d FROM "generatedyearplan"
         WHERE subject IS NOT DISTINCT FROM $1 AND date::date > $2
         ORDER BY date::date ASC, start_time ASC NULLS LAST, id ASC
         LIMIT 1`
      : `SELECT date::date AS d FROM "generatedyearplan"
         WHERE subject IS NOT DISTINCT FROM $1 AND date::date < $2
         ORDER BY date::date DESC, start_time DESC NULLS LAST, id DESC
         LIMIT 1`;
    const { rows: neigh } = await client.query(neighborSql, [subj, t.date]);

    if (!neigh.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `No ${dir === 'next' ? 'next' : 'previous'} date in sequence for this subject` });
    }
    const neighborDate = neigh[0].d; // date

    // 3) Compute integer day delta
    const { rows: deltaRows } = await client.query('SELECT ($1::date - $2::date) AS dd', [neighborDate, t.date]);
    const deltaDays = parseInt(deltaRows[0].dd, 10);
    if (!Number.isInteger(deltaDays) || deltaDays === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Computed delta is zero or invalid' });
    }

    // 4) Shift the tail (current + all subsequent in chronological order)
    const updateSql = `
      UPDATE "generatedyearplan"
      SET "date" = ("date"::date + ($3 * INTERVAL '1 day'))
      WHERE subject IS NOT DISTINCT FROM $1
        AND "date" IS NOT NULL
        AND "date"::date >= $2::date
      RETURNING id, TO_CHAR("date", 'YYYY-MM-DD') AS date;
    `;
    const { rows: updated } = await client.query(updateSql, [subj, t.date, deltaDays]);

    await client.query('COMMIT');
    res.json({ ok: true, shifted: updated.length, deltaDays, dir, subject: subj });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('shift-sequence failed:', err);
    res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

// Merge current row with the NEXT lesson of the same subject, then
// shift the remaining tail BACK by the date gap so there is no empty slot.
// POST /lessons-calendar/generatedyearplan/:id/merge-next
// Body (optional): { strategy: 'append-notes' | 'overwrite-empty' }
router.post('/generatedyearplan/:id/merge-next', async (req, res) => {
  const { id } = req.params;
  const strategy = (req.body && req.body.strategy) === 'overwrite-empty' ? 'overwrite-empty' : 'append-notes';
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Lock current row (source)
    const { rows: srcRows } = await client.query(
      'SELECT * FROM "generatedyearplan" WHERE id = $1 FOR UPDATE', [id]
    );
    if (!srcRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source row not found' });
    }
    const src = srcRows[0];
    if (!src.date) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot merge: source has NULL date' });
    }

    // 2) Find NEXT row in the same subject sequence, lock it
    const nextSql = `
      SELECT * FROM "generatedyearplan"
       WHERE subject IS NOT DISTINCT FROM $1
         AND (
               (date::date >  $2::date)
            OR (date::date =  $2::date AND COALESCE(start_time, '00:00') > COALESCE($3::time, '00:00'))
            OR (date::date =  $2::date AND COALESCE(start_time, '00:00') = COALESCE($3::time, '00:00') AND id > $4)
         )
       ORDER BY date::date ASC, start_time ASC NULLS LAST, id ASC
       LIMIT 1
       FOR UPDATE`;
    const { rows: nxtRows } = await client.query(nextSql, [src.subject || '', src.date, src.start_time || null, src.id]);
    if (!nxtRows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No next lesson to merge with for this subject' });
    }
    const tgt = nxtRows[0];
    const oldNextDate = tgt.date; // remember original next date

    // 3) Build UPDATE for target per strategy
    const sets = [];
    const params = [];

    if (strategy === 'overwrite-empty') {
      const candidates = ['unit','sectioninfo','unitetype','weekday','start_time','end_time','subject','lessonCode'];
      for (const col of candidates) {
        const tv = tgt[col];
        const sv = src[col];
        if ((tv == null || String(tv).trim() === '') && (sv != null && String(sv).trim() !== '')) {
          params.push(sv);
          sets.push(`"${col}" = $${params.length}`);
        }
      }
      // duration
      if ((tgt.duration == null || Number.isNaN(tgt.duration)) && (src.duration != null)) {
        params.push(src.duration);
        sets.push(`"duration" = $${params.length}`);
      }
      // if target date empty (shouldn't), copy source date
      if ((tgt.date == null) && (src.date != null)) {
        params.push(src.date);
        sets.push(`"date" = $${params.length}`);
      }
      // notes appended for traceability
      const mergedNotes = [tgt.notes || '', src.notes || ''].filter(Boolean).join('\n\n');
      params.push(mergedNotes);
      sets.push(`"notes" = $${params.length}`);
    } else {
      // append-notes only
      const mergedNotes = [tgt.notes || '', src.notes || ''].filter(Boolean).join('\n\n');
      params.push(mergedNotes);
      sets.push(`"notes" = $${params.length}`);
    }

    if (sets.length) {
      params.push(tgt.id);
      await client.query(`UPDATE "generatedyearplan" SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    // 4) Delete the source row (we are merging it into next)
    await client.query('DELETE FROM "generatedyearplan" WHERE id = $1', [src.id]);

    // 5) Shift the TAIL (including target) BACK by the gap so that there is no empty slot
    // gap Δ = src.date - oldNextDate (likely negative). We need to move tail by Δ so target lands on src.date.
    const { rows: drows } = await client.query('SELECT ($1::date - $2::date) AS dd', [src.date, oldNextDate]);
    const deltaDays = parseInt(drows[0].dd, 10);
    if (Number.isInteger(deltaDays) && deltaDays !== 0) {
      await client.query(
        `UPDATE "generatedyearplan"
           SET "date" = ("date"::date + ($3 * INTERVAL '1 day'))
         WHERE subject IS NOT DISTINCT FROM $1
           AND "date" IS NOT NULL
           AND "date"::date >= $2::date`,
        [src.subject || '', oldNextDate, deltaDays]
      );
    }

    // Return final target (re-fetched with possibly updated date)
    const { rows: finalTgt } = await client.query('SELECT * FROM "generatedyearplan" WHERE id = $1', [tgt.id]);

    await client.query('COMMIT');
    res.json({ ok: true, mergedInto: finalTgt[0] || null, deltaDays: (Number.isInteger(deltaDays)? deltaDays : 0) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('merge-next failed:', err);
    res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

module.exports = router;