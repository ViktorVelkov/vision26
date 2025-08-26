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
  const { from, to, subject, week, week_number } = req.query;

  const where = [];
  const params = [];

  if (from) {
    params.push(from);
    where.push(`date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`date <= $${params.length}::date`);
  }
  if (subject) {
    params.push(`%${subject}%`);
    where.push(`subject ILIKE $${params.length}`);
  }

  const wk = week ?? week_number;
  if (wk) {
    params.push(parseInt(wk, 10));
    where.push(`week_number = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM "generatedyearplan" ${whereSql} ORDER BY date, start_time`;

  try {
    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching generatedyearplan:', err);
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

module.exports = router;