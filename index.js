// index.js
// index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
app.use(cors());
app.use(express.json());
// === Sticky Notes file storage ===
// POST /threads/create { studentID:number, baseIds:number[], threadID?:string }


// === Sticky Notes file storage ===
const STICKY_DIR = path.join(__dirname, 'sticky-notes');
try { fs.mkdirSync(STICKY_DIR, { recursive: true }); } catch(e) { console.warn('sticky dir mkdir failed:', e && e.message ? e.message : e); }
function stickyFileFromKey(key){
  const safe = (String(key||'default')).replace(/[^a-z0-9_-]+/gi,'-').slice(0,60) || 'default';
  return path.join(STICKY_DIR, safe + '.json');
}

// === Upload state (onlineUploaded, uploadCode) stored as local JSON under public ===
const UPLOAD_STATE_DIR = path.join(__dirname, 'public', 'lesson-upload-state');
try { fs.mkdirSync(UPLOAD_STATE_DIR, { recursive: true }); } catch(e) { console.warn('upload-state dir mkdir failed:', e && e.message ? e.message : e); }
const UPLOAD_STATE_FILE = path.join(UPLOAD_STATE_DIR, 'state.json');
function readUploadState(){
  try{
    if (!fs.existsSync(UPLOAD_STATE_FILE)) return {};
    const raw = fs.readFileSync(UPLOAD_STATE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  }catch(e){ console.warn('readUploadState failed:', e && e.message ? e.message : e); return {}; }
}
function writeUploadState(obj){
  try{
    fs.writeFileSync(UPLOAD_STATE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  }catch(e){ console.error('writeUploadState failed:', e); return false; }
}
// === Sticky Notes API: read/write checklist as a JSON file (no DB) ===
// GET /sticky-notes?key=<slug>  -> { items:[{text,done}] }
app.get('/sticky-notes', async (req, res) => {
  const key = req.query.key || 'default';
  const file = stickyFileFromKey(key);
  try {
    if (!fs.existsSync(file)) return res.json({ items: [] });
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return res.json({ items: [] });
    res.json({ items: data.items.map(x => ({ text: String(x.text||''), done: !!x.done })) });
  } catch (e) {
    console.error('GET /sticky-notes failed:', e);
    res.status(500).json({ error: 'Failed to read notes' });
  }
});

// === Upload state API ===
// GET /upload-state  -> returns a map: { [rowId]: { onlineUploaded: null|true|false, uploadCode: string } }
app.get('/upload-state', (req, res) => {
  const data = readUploadState();
  res.json(data);
});

// PATCH /upload-state/:id  body: { onlineUploaded?, uploadCode? }
app.patch('/upload-state/:id', (req, res) => {
  const id = String(req.params.id||'').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const body = req.body || {};
  const data = readUploadState();
  const cur = (data[id] && typeof data[id] === 'object') ? data[id] : {};

  if (Object.prototype.hasOwnProperty.call(body, 'onlineUploaded')) {
    let v = body.onlineUploaded;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1') v = true; else if (s === 'false' || s === '0') v = false; else v = null;
    } else if (typeof v !== 'boolean') {
      v = null; // normalize to tri-state
    }
    cur.onlineUploaded = v;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'uploadCode')) {
    cur.uploadCode = (typeof body.uploadCode === 'string') ? body.uploadCode : (body.uploadCode==null? '' : String(body.uploadCode));
  }

  data[id] = cur;
  if (!writeUploadState(data)) return res.status(500).json({ error: 'Failed to write state' });
  res.json({ ok:true, id, state: cur });
});

// POST /sticky-notes  body: { key, items:[{text,done}] }
app.post('/sticky-notes', async (req, res) => {
  const key = (req.body && req.body.key) || 'default';
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });
  const norm = items.map(x => ({ text: String((x && x.text) || ''), done: !!(x && x.done) }));
  const file = stickyFileFromKey(key);
  try {
    fs.writeFileSync(file, JSON.stringify({ items: norm }, null, 2), 'utf8');
    res.json({ ok: true, saved: norm.length });
  } catch (e) {
    console.error('POST /sticky-notes failed:', e);
    res.status(500).json({ error: 'Failed to save notes' });
  }
});
const multer = require("multer");
const scheduleRouter = require("./public/schedule");
const holidayRouter = require("./routes/holidays");
const upload = multer({ storage: multer.memoryStorage() });
const scheduleSelectionRouter = require("./routes/scheduleSelection");
const pool = require('./db');

/**
 * GET /snippet-ref
 * - /snippet-ref?id=<lesson_id>        -> Lessons info (backward compatible with existing UI)
 * - /snippet-ref?ids=1,2,3            -> Snippets uslovie for snippet ids (bulk)
 */
app.get('/snippet-ref', async (req, res) => {
  try {
    // Bulk: ids=1,2,3 -> fetch from "Snippets" by snippet id
    if (req.query.ids != null) {
      const raw = String(req.query.ids || '').trim();
      if (!raw) return res.json([]);

      const ids = raw.split(',')
        .map(s => parseInt(String(s).trim(), 10))
        .filter(Number.isInteger);
      if (!ids.length) return res.json([]);

      const { rows } = await pool.query(
        `SELECT s.id AS snippet_id,
               s.name AS name,
               s.uslovie AS uslovie
          FROM "Snippets" s
         WHERE s.id = ANY($1::int[])
         ORDER BY s.id ASC`,
        [ids]
      );

      return res.json(rows.map(r => ({
        snippet_id: r.snippet_id == null ? null : parseInt(r.snippet_id, 10),
        name: r.name == null ? '' : String(r.name),
        uslovie: r.uslovie == null ? '' : String(r.uslovie)
      })).filter(x => Number.isInteger(x.snippet_id)));
    }

    // Single: id=<lesson_id> -> fetch from "Lessons" (existing behavior)
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

   const { rows } = await pool.query(
  `SELECT lesson_id, name, tripplet_id, description, description2, class, url, filepath, source_token, section_token, lesson_token
     FROM "Lessons" WHERE lesson_id = $1 LIMIT 1`,
  [id]
);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('GET /snippet-ref failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

// --- Compatibility shim for lessons_scripted vs lesson_scripted ---
// Note: item_type may be 'theory', 'exercise', or 'snippet' (for theory/snippet rows).
(async function ensureLessonScriptedCompat(){
  try {
    const { rows: t1 } = await pool.query(`SELECT to_regclass('public.lessons_scripted') AS reg`);
    const existsPlural = !!(t1[0] && t1[0].reg);
    if (existsPlural) {
      // Create a compatibility VIEW so the rest of the code can use lesson_scripted transparently
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('v','m') AND n.nspname = 'public' AND c.relname = 'lesson_scripted'
          ) THEN
            EXECUTE 'CREATE VIEW public.lesson_scripted AS
                     SELECT id, lesson_id, item_type, item_id, position, added_at
                       FROM public.lessons_scripted';
          END IF;
        END
        $$;
      `);
      console.log('[compat] Using existing table "lessons_scripted" via VIEW "lesson_scripted".');
    } else {
      console.log('[compat] "lessons_scripted" not found, will ensure table "lesson_scripted".');
    }
  } catch (e) {
    console.error('ensureLessonScriptedCompat failed:', e);
  }
})();

// --- LESSON SCRIPTED: table + helpers (theory/exercises broken out per row) ---
// Table shape used:
// id bigserial PK, lesson_id int NOT NULL, item_type text NOT NULL CHECK (item_type IN ('theory','exercise')),
// item_id int NOT NULL, position int, added_at timestamp DEFAULT now()
// --- LESSON SCRIPTED: table + helpers (theory/exercises broken out per row) ---
(async function ensureLessonScripted(){
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_scripted (
        id        BIGSERIAL PRIMARY KEY,
        lesson_id INTEGER NOT NULL REFERENCES "Lessons"(lesson_id) ON DELETE CASCADE,
        item_type TEXT    NOT NULL CHECK (item_type IN ('theory','exercise')),
        item_id   INTEGER NOT NULL,
        position  INTEGER,
        added_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lscripted_lesson ON lesson_scripted(lesson_id);
      CREATE INDEX IF NOT EXISTS idx_lscripted_type_pos ON lesson_scripted(item_type, position);
      -- Editable per-exercise meta
      ALTER TABLE lesson_scripted
        ADD COLUMN IF NOT EXISTS "timeInMinutes" INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "difficulty"    INTEGER DEFAULT 0;
    `);
    // One-time migration: if table is empty, try to migrate from old array columns in Lessons
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM lesson_scripted`);
    if ((cnt[0] && cnt[0].n === 0)) {
      console.log('[migration] lesson_scripted empty — migrating from Lessons.theory_snippets / exercises_ids ...');
      // THEORY (integer[])
      await pool.query(`
        WITH src AS (
          SELECT lesson_id, theory_snippets
            FROM "Lessons"
           WHERE theory_snippets IS NOT NULL AND array_length(theory_snippets,1) IS NOT NULL
        )
        INSERT INTO lesson_scripted(lesson_id,item_type,item_id,position)
        SELECT s.lesson_id, 'theory', UNNEST(s.theory_snippets) AS item_id,
               GENERATE_SERIES(1, array_length(s.theory_snippets,1)) AS position
          FROM src s
      `);
      // EXERCISES (text[] -> try to cast to int; skip non-numeric)
      await pool.query(`
        WITH src AS (
          SELECT lesson_id, exercises_ids
            FROM "Lessons"
           WHERE exercises_ids IS NOT NULL AND array_length(exercises_ids,1) IS NOT NULL
        ),
        unn AS (
          SELECT lesson_id, UNNEST(exercises_ids) AS x, array_length(exercises_ids,1) AS len
            FROM src
        ),
        casted AS (
          SELECT lesson_id,
                 CASE WHEN TRIM(x) ~ '^[0-9]+$' THEN (TRIM(x))::int ELSE NULL END AS item_id,
                 ROW_NUMBER() OVER (PARTITION BY lesson_id ORDER BY (SELECT 1)) AS pos
            FROM unn
        )
        INSERT INTO lesson_scripted(lesson_id,item_type,item_id,position)
        SELECT lesson_id, 'exercise', item_id, pos
          FROM casted
         WHERE item_id IS NOT NULL
      `);
      console.log('[migration] lesson_scripted migration finished.');
    }
  } catch (e) {
    console.error('ensureLessonScripted failed:', e);
  }
})();

// Replace all scripted items for a lesson in one go.
async function replaceLessonScripted(lessonId, theoryIds, exerciseIds){
  if (!Number.isInteger(lessonId)) return;
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`DELETE FROM lesson_scripted WHERE lesson_id = $1`, [lessonId]);
    // Normalize → only integers
    const tIds = Array.isArray(theoryIds) ? theoryIds.map(n=>parseInt(n,10)).filter(Number.isInteger) : [];
    const eIds = Array.isArray(exerciseIds) ? exerciseIds.map(n=>parseInt(n,10)).filter(Number.isInteger) : [];
    // Insert theory
    for (let i = 0; i < tIds.length; i++) {
      await client.query(
        `INSERT INTO lesson_scripted(lesson_id,item_type,item_id,position)
         VALUES ($1,'theory',$2,$3)`,
        [lessonId, tIds[i], i + 1]
      );
    }

    // Insert exercises
    for (let i = 0; i < eIds.length; i++) {
      await client.query(
        `INSERT INTO lesson_scripted(lesson_id,item_type,item_id,position)
         VALUES ($1,'exercise',$2,$3)`,
        [lessonId, eIds[i], i + 1]
      );
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK');
    console.error('replaceLessonScripted failed:', e);
    throw e;
  }finally{
    client.release();
  }
}

// Helper to SELECT lesson with aggregated arrays from lesson_scripted
function lessonSelectWithAggregates(whereSQL, paramsSQL){
  return {
    sql: `
      SELECT 
        l.lesson_id,
        l.name,
        l.tripplet_id,
        l.description,
        l.class,
        l.url,
        l.filepath,
        l.source_token,
        l.section_token,
        l.lesson_token,
        COALESCE((
          SELECT ARRAY_AGG(s.item_id ORDER BY s.id)
            FROM lesson_scripted s
           WHERE s.lesson_id = l.lesson_id AND s.item_type = 'theory'
        ), '{}'::int[]) AS theory_snippets,
        COALESCE((
          SELECT ARRAY_AGG(s.item_id::text ORDER BY s.id)
            FROM lesson_scripted s
           WHERE s.lesson_id = l.lesson_id AND s.item_type = 'exercise'
        ), '{}'::text[]) AS exercises_ids
      FROM "Lessons" l
      WHERE ${whereSQL}
      ORDER BY l.updated_at DESC NULLS LAST, l.lesson_id DESC
      LIMIT 1`,
    params: paramsSQL
  };
}

// GET /lesson-scripted/:id  -> return arrays from lesson_scripted only (authoritative lists)
app.get('/lesson-scripted/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try{
    const t = await pool.query(
      `SELECT item_id, "timeInMinutes", "difficulty"
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type IN ('theory','snippet')
     ORDER BY id ASC`,
      [id]
    );
    const e = await pool.query(
      `SELECT item_id, "timeInMinutes", "difficulty"
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type = 'exercise'
     ORDER BY id ASC`,
      [id]
    );
    const theory = t.rows.map(r => parseInt(r.item_id,10)).filter(Number.isInteger);

    const snippets = t.rows
      .map(r => ({
        snippet_id: parseInt(r.item_id,10),
        timeInMinutes: (r.timeInMinutes != null ? parseInt(r.timeInMinutes,10) : 0) || 0,
        difficulty: (r.difficulty != null ? parseInt(r.difficulty,10) : 0) || 0
      }))
      .filter(x => Number.isInteger(x.snippet_id));

    const exercises_ids = e.rows
      .map(r => parseInt(r.item_id,10))
      .filter(Number.isInteger);

    const exercises = e.rows
      .map(r => ({
        exercise_id: parseInt(r.item_id,10),
        timeInMinutes: (r.timeInMinutes != null ? parseInt(r.timeInMinutes,10) : 0) || 0,
        difficulty: (r.difficulty != null ? parseInt(r.difficulty,10) : 0) || 0
      }))
      .filter(x => Number.isInteger(x.exercise_id));

    return res.json({ lesson_id: id, theory_snippets: theory, snippets, exercises_ids, exercises });
  }catch(err){
    console.error('GET /lesson-scripted/:id failed:', err);
    return res.status(500).json({ error: 'DB error' });
  }
});

/**
 * PATCH /lesson-scripted/:lessonId/reorder
 * Body: { item_type: 'theory' | 'exercise', item_ids: int[] }  // order in the array = desired order
 * For 'theory' we also cover rows saved as 'snippet'.
 */
app.patch('/lesson-scripted/:lessonId/reorder', async (req, res) => {
  const lessonId = parseInt(req.params.lessonId, 10);
  if (!Number.isInteger(lessonId)) return res.status(400).json({ error: 'Invalid lessonId' });
  const body = req.body || {};
  let itemType = String(body.item_type || '').trim().toLowerCase();
  if (!['theory','exercise'].includes(itemType)) return res.status(400).json({ error: 'item_type must be "theory" or "exercise"' });
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(n => parseInt(n,10)).filter(Number.isInteger) : [];

  // Allow empty list -> clears the section
  if (!itemIds.length) {
    const typeFilterSQL = (itemType === 'theory')
      ? `item_type IN ('theory','snippet')`
      : `item_type = 'exercise'`;
    try{
      await pool.query(`DELETE FROM lesson_scripted WHERE lesson_id = $1 AND ${typeFilterSQL}`, [lessonId]);
      return res.json({ ok:true, lesson_id: lessonId, item_type: itemType, count: 0 });
    }catch(e){
      console.error('PATCH /lesson-scripted/:lessonId/reorder (clear) failed:', e);
      return res.status(500).json({ error: 'DB error' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Try to update positions in-place if column exists
    const posColExists = true; // our table defines it; still keep a guard below
    // Normalize: for theory we accept both 'theory' and 'snippet'
    const typeFilterSQL = (itemType === 'theory')
      ? `item_type IN ('theory','snippet')`
      : `item_type = 'exercise'`;

    // Ensure uniqueness by (lesson_id, item_type set, item_id)
    // Update position using a CASE expression; if that fails (no column), fallback to delete+insert
    let idx = 1;
    const casePairs = itemIds.map(id => {
      const i = idx++;
      return `WHEN item_id = $${i} THEN ${i}`;
    }).join(' ');
    const params = [...itemIds, lessonId];

    // Always rewrite the section in the requested order (safe + supports new IDs)
    await client.query(`DELETE FROM lesson_scripted WHERE lesson_id = $1 AND ${typeFilterSQL}`, [lessonId]);
    for (let i = 0; i < itemIds.length; i++) {
      const idv = itemIds[i];
      await client.query(
        `INSERT INTO lesson_scripted(lesson_id, item_type, item_id, position)
         VALUES ($1, $2, $3, $4)`,
        [lessonId, itemType, idv, i + 1]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true, lesson_id: lessonId, item_type: itemType, count: itemIds.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('PATCH /lesson-scripted/:lessonId/reorder failed:', e);
    return res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /lesson-scripted/:lessonId/item
 * Body: { item_type:'exercise', item_id:int, timeInMinutes?:int, difficulty?:int }
 */
app.patch('/lesson-scripted/:lessonId/item', async (req, res) => {
  const lessonId = parseInt(req.params.lessonId, 10);
  if (!Number.isInteger(lessonId)) return res.status(400).json({ error: 'Invalid lessonId' });

  const body = req.body || {};
  const itemType = String(body.item_type || '').trim().toLowerCase();
  const itemId = parseInt(body.item_id, 10);
  if (!['exercise','theory'].includes(itemType) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: 'Invalid item_type or item_id' });
  }

  const t = (body.timeInMinutes != null) ? parseInt(body.timeInMinutes,10) : null;
  let d = (body.difficulty != null) ? parseInt(body.difficulty,10) : null;
  if (Number.isInteger(d)) {
    if (d < 0) d = 0;
    if (d > 3) d = 3;
  }

  const sets = [];
  const params = [];
  if (Number.isInteger(t)) { params.push(t); sets.push(`"timeInMinutes" = $${params.length}`); }
  if (Number.isInteger(d)) { params.push(d); sets.push(`"difficulty" = $${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields provided' });

  params.push(lessonId);
  params.push(itemId);

  // For theory, update both 'theory' and 'snippet'
  const typeWhere = (itemType === 'theory')
    ? `item_type IN ('theory','snippet')`
    : `item_type = 'exercise'`;

  try{
    const sql = `
      UPDATE lesson_scripted
         SET ${sets.join(', ')}
       WHERE lesson_id = $${params.length-1}
         AND ${typeWhere}
         AND item_id = $${params.length}
       RETURNING id, lesson_id, item_type, item_id, "timeInMinutes", "difficulty"`;
    const r = await pool.query(sql, params);
    if (!r.rowCount) return res.status(404).json({ error: 'Row not found' });
    return res.json({ ok:true, row: r.rows[0] });
  }catch(e){
    console.error('PATCH /lesson-scripted/:lessonId/item failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

// Safety shim: guard against accidental uses of a global `client`
if (typeof global.client === 'undefined') {
  global.client = {
    query: (...args) => pool.query(...args),
    release: () => {}
  };
}
// Ensure Exercises has extra columns for topic and keyWords
;(async function ensureExercisesExtraCols(){
  try{
    await pool.query(`
      ALTER TABLE "Exercises"
        ADD COLUMN IF NOT EXISTS "topic"   text,
        ADD COLUMN IF NOT EXISTS "keyWords" text[] DEFAULT '{}'::text[];
    `);
  }catch(e){
    console.error('ensureExercisesExtraCols failed:', e);
  }
})();
/**
 * POST /exercises
 * Body: { number, page, resourceID, difficulty, date_last_solved, for_revision,
 *         has_assignmentCondition, has_solution, commentsArray, text_filepath, solution_filepath }
 * Creates (or finds) an exercise by tuple_key (Page, Number, ResourceID) and returns { id }.
 */
app.post('/exercises', async (req, res) => {
  try {
    const b = req.body || {};
    const Page = parseInt(b.page, 10);
    const NumberVal = parseInt(b.number, 10);
    const ResourceID = parseInt(b.resourceID, 10);
    if (!Number.isInteger(Page) || !Number.isInteger(NumberVal) || !Number.isInteger(ResourceID)) {
      return res.status(400).json({ error: 'Invalid page/number/resourceID' });
    }

    const difficulty = (b.difficulty != null ? parseInt(b.difficulty,10) : null);
    const date_last_solved = Array.isArray(b.date_last_solved) ? b.date_last_solved : null;
    const for_revision = Array.isArray(b.for_revision) ? b.for_revision : null;
    const has_assignmentCondition = !!b.has_assignmentCondition;
    const has_solution = !!b.has_solution;
    const comments = Array.isArray(b.commentsArray) ? b.commentsArray.map(String) : null;
    const text_filepath = b.text_filepath || null;
    const solution_filepath = b.solution_filepath || null;

    // Try to find existing by tuple_key JSONB
    const findSql = `SELECT "ID" FROM "Exercises"
                     WHERE (tuple_key->>'Page')::int = $1
                       AND (tuple_key->>'Number')::int = $2
                       AND (tuple_key->>'ResourceID')::int = $3
                     ORDER BY "ID" DESC LIMIT 1`;
    const found = await pool.query(findSql, [Page, NumberVal, ResourceID]);
    if (found.rowCount > 0) {
      return res.json({ id: found.rows[0].ID, reused: true });
    }

    const cols = [
      '"Page"','"Number"','"ResourceID"','"difficulty"','"date_last_solved"','"for_revision"',
      '"has_assignmentCondition"','"has_solution"','"comments"','"text_filepath"','"solution_filepath"'
    ];
    const params = [
      Page,
      NumberVal,
      ResourceID,
      difficulty,
      date_last_solved,
      for_revision,
      has_assignmentCondition,
      has_solution,
      comments,
      text_filepath,
      solution_filepath
    ];
    const placeholders = params.map((_,i)=>`$${i+1}`);

    const insertSql = `INSERT INTO "Exercises" (${cols.join(',')})
                       VALUES (${placeholders.join(',')})
                       RETURNING "ID"`;

    const ins = await pool.query(insertSql, params);
    return res.json({ id: ins.rows[0].ID, reused: false });
  } catch (e) {
    console.error('POST /exercises failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});
/**
 * PATCH /exercises/:id/extras
 * Body: { topic?: string|null, keyWords?: string[] }
 */
app.patch('/exercises/:id/extras', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const topic = (typeof req.body.topic === 'string') ? req.body.topic.trim() : (req.body.topic === null ? null : undefined);
  const keyWords = Array.isArray(req.body.keyWords)
    ? req.body.keyWords.map(s => String(s).trim()).filter(Boolean)
    : (req.body.keyWords === null ? [] : undefined);

  const sets = [];
  const params = [];
  if (typeof topic !== 'undefined') { params.push(topic); sets.push(`"topic" = $${params.length}`); }
  if (typeof keyWords !== 'undefined') { params.push(keyWords); sets.push(`"keyWords" = $${params.length}::text[]`); }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields provided' });
  params.push(id);

  try{
    const sql = `UPDATE "Exercises" SET ${sets.join(', ')} WHERE "ID" = $${params.length} RETURNING "ID", "topic", "keyWords"`;
    const r = await pool.query(sql, params);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok:true, row: r.rows[0] });
  }catch(e){
    console.error('PATCH /exercises/:id/extras failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});
/**
 * PATCH /exercises/extras-by-tuple
 * Body: { resourceID:int|string, page:int|string, number:int|string, topic?:string|null, keyWords?:string[] }
 */
app.patch('/exercises/extras-by-tuple', async (req, res) => {
  try {
    const rID = parseInt(req.body.resourceID, 10);
    const pg = parseInt(req.body.page, 10);
    const num = parseInt(req.body.number, 10);
    if (!Number.isInteger(rID) || !Number.isInteger(pg) || !Number.isInteger(num)) {
      return res.status(400).json({ error: 'Invalid tuple (resourceID/page/number)' });
    }

    const topic = (typeof req.body.topic === 'string') ? req.body.topic.trim() : (req.body.topic === null ? null : undefined);
    const keyWords = Array.isArray(req.body.keyWords)
      ? req.body.keyWords.map(s => String(s).trim()).filter(Boolean)
      : (req.body.keyWords === null ? [] : undefined);

    const sets = [];
    const params = [];
    if (typeof topic !== 'undefined') { params.push(topic); sets.push(`"topic" = $${params.length}`); }
    if (typeof keyWords !== 'undefined') { params.push(keyWords); sets.push(`"keyWords" = $${params.length}::text[]`); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields provided' });

    params.push(pg);    // $N-2 Page
    params.push(num);   // $N-1 Number
    params.push(rID);   // $N   ResourceID

    const sql = `UPDATE "Exercises"
                   SET ${sets.join(', ')}
                 WHERE (tuple_key->>'Page')::int = $${params.length-2}
                   AND (tuple_key->>'Number')::int = $${params.length-1}
                   AND (tuple_key->>'ResourceID')::int = $${params.length}
                 RETURNING "ID","topic","keyWords"`;
    const r = await pool.query(sql, params);
    if (!r.rowCount) return res.status(404).json({ error: 'No exercise matched tuple_key' });
    return res.json({ ok:true, row: r.rows[0] });
  } catch (e) {
    console.error('PATCH /exercises/extras-by-tuple failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

/**
 * GET /exercise-ref?ids=1,2,3
 * Returns reference info for each exercise id:
 *  - Number, Page, ResourceID from "Exercises"
 *  - Authors/Edition/Year/SourceType/Grade/Publisher/Press from "Resources" (if present)
 */
app.get('/exercise-ref', async (req, res) => {
  try {
    const raw = String(req.query.ids || '').trim();
    if (!raw) return res.json([]);

    const ids = raw
      .split(',')
      .map(s => parseInt(String(s).trim(), 10))
      .filter(Number.isInteger);

    if (!ids.length) return res.json([]);

    const { rows } = await pool.query(
      `SELECT e."ID"         AS exercise_id,
              e."Number"     AS number,
              e."Page"       AS page,
              e."ResourceID" AS resourceid,
              r."Authors"    AS authors,
              r."KeyWords"   AS resource_keywords,
              r."Edition"    AS edition,
              r."Year"       AS year,
              r."SourceType" AS sourcetype,
              r."Grade"      AS grade,
              r."Publisher"  AS publisher,
              r."Press"      AS press
         FROM "Exercises" e
         LEFT JOIN "Resources" r ON r."ID" = e."ResourceID"
        WHERE e."ID" = ANY($1::int[])
        ORDER BY e."ID" ASC`,
      [ids]
    );

    return res.json(
      rows.map(r => ({
        exercise_id: r.exercise_id == null ? null : parseInt(r.exercise_id, 10),
        number: r.number == null ? null : String(r.number),
        page: r.page == null ? null : parseInt(r.page, 10),
        resourceid: r.resourceid == null ? null : parseInt(r.resourceid, 10),
        resource: {
          id: r.resourceid == null ? null : parseInt(r.resourceid, 10),
          keyWords: r.resource_keywords == null ? '' : String(r.resource_keywords),
          authors: r.authors == null ? null : String(r.authors),
          edition: r.edition == null ? null : parseInt(r.edition, 10),
          year: r.year == null ? null : parseInt(r.year, 10),
          sourcetype: r.sourcetype == null ? null : parseInt(r.sourcetype, 10),
          grade: r.grade == null ? null : parseInt(r.grade, 10),
          publisher: r.publisher == null ? null : parseInt(r.publisher, 10),
          press: r.press == null ? null : parseInt(r.press, 10)
        }
      })).filter(x => Number.isInteger(x.exercise_id))
    );
  } catch (e) {
    console.error('GET /exercise-ref failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}); 


// Ensure lessons_actions table exists at startup
(async function ensureLessonsActionsTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons_actions (
        id BIGSERIAL PRIMARY KEY,
        lesson_id INT NOT NULL REFERENCES "Lessons"(lesson_id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('new','updated')),
        at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lactions_at ON lessons_actions(at DESC);
      CREATE INDEX IF NOT EXISTS idx_lactions_lid ON lessons_actions(lesson_id);
    `);
  }catch(e){
    console.error('ensureLessonsActionsTable failed:', e);
  }
})();

// Ensure threads catalog table exists (unique thread names)
;(async function ensureThreadsTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT,
        created_by INT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  }catch(e){
    console.error('ensureThreadsTable failed:', e);
  }
})();
/**
 * POST /threads/create
 * Body: { studentID:number, baseIds:number[], threadID?:string }
 *
 * Safe-guard rules:
 *  - We keep a catalog table `threads(thread_id PK, ...)` and insert
 *    with ON CONFLICT DO NOTHING so duplicate names are never created.
 *  - The same thread name may be reused by many assessment rows.
 *  - Rows must belong to the provided student.
 */
app.post('/threads/create', async (req,res)=>{
  try{
    const body = req.body || {};
    const studentID = parseInt(body.studentID, 10);
    const baseIds = Array.isArray(body.baseIds) ? body.baseIds.map(n=>parseInt(n,10)).filter(Number.isFinite) : [];
    let incomingName = (typeof body.threadID === 'string') ? body.threadID.trim() : '';

    if (!Number.isFinite(studentID) || baseIds.length === 0){
      return res.status(400).json({ error: 'Missing studentID or baseIds' });
    }

    // Load rows and validate the student
    const { rows } = await pool.query(
      `SELECT id, "studentID", COALESCE(NULLIF(TRIM("threadID"),''), NULL) AS threadID
         FROM "student_assessment_skills_exercises"
        WHERE id = ANY($1::int[])`,
      [baseIds]
    );
    if (!rows.length) return res.status(404).json({ error: 'No rows found' });
    for (const r of rows){
      if (parseInt(r.studentID,10) !== studentID){
        return res.status(409).json({ error: `Row ${r.id} belongs to different student` });
      }
    }

    // Determine a name. If not supplied, compute deterministic name from student+ids
    let threadName = incomingName;
    if (!threadName){
      const sorted = [...new Set(rows.map(r=>parseInt(r.id,10)).filter(Number.isFinite))].sort((a,b)=>a-b);
      const hash = crypto.createHash('sha1').update(String(studentID)+'|'+sorted.join(',')).digest('hex').slice(0,12);
      threadName = `t-${studentID}-${hash}`;
    }

    // Safe-guard: register name once (no duplicates by name)
    await pool.query(
      `INSERT INTO threads(thread_id, created_by) VALUES ($1, $2)
       ON CONFLICT (thread_id) DO NOTHING`,
      [threadName, studentID]
    );

    // Assign the thread to the selected rows. Idempotent per row.
    const { rows: upd } = await pool.query(
      `UPDATE "student_assessment_skills_exercises"
          SET "threadID" = $2
        WHERE id = ANY($1::int[])
          AND ("threadID" IS NULL OR TRIM("threadID") = '' OR "threadID" = $2)
        RETURNING id`,
      [baseIds, threadName]
    );

    return res.json({ ok:true, threadID: threadName, assigned: upd.map(r=>r.id) });
  }catch(e){
    console.error('/threads/create failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

app.use("/api", scheduleRouter);
app.use(express.static(path.join(__dirname, 'public')));

// === Sticky Notes: append checked items to a per-key JSON lines log ===
// POST /sticky-notes/done-append  { key, text, at? }
app.post('/sticky-notes/done-append', (req, res) => {
  try {
    const key = (req.body && req.body.key ? String(req.body.key) : 'default')
      .replace(/[^a-z0-9_-]+/gi,'-')
      .slice(0,60) || 'default';
    const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
    const atIn = (req.body && req.body.at ? String(req.body.at) : null);
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // Format timestamp as DD.MM.YYYY HH:MM (24h)
    const d = atIn ? new Date(atIn) : new Date();
    const dd = String(d.getDate()).padStart(2,'0');
    const mo = String(d.getMonth() + 1).padStart(2,'0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const stamp = `${dd}.${mo}.${yyyy} ${hh}:${mi}`;

    const file = path.join(STICKY_DIR, `${key}.done.jsonl`); // JSON Lines per entry
    const obj = { at: stamp, text };
    fs.appendFileSync(file, JSON.stringify(obj) + "\n", 'utf8');
    return res.json({ ok: true, file, saved: obj });
  } catch (e) {
    console.error('POST /sticky-notes/done-append failed:', e);
    return res.status(500).json({ error: 'Failed to append' });
  }
});
app.use('/files', express.static('/Users/viktorvelkov/Documents', {
  setHeaders: (res, filePath) => {
    try {
      const fp = String(filePath || '').toLowerCase();
      if (fp.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
      }
    } catch (_) {}
  }
}));
app.use("/holidays", holidayRouter);
app.use("/", scheduleSelectionRouter);
require('./public/lesCal_post')(app, pool);
// All POST endpoints for calendar actions (push/merge etc.) are defined in ./public/lesCal_post.js below.
const { Pool } = require('pg');
// pool is already required above

// Helper: extract only the relevant payload fields from a generatedyearplan row
function extractPayload(row) {
  return {
    unit: (row.unit || '').trim(),
    unitetype: (row.unitetype || '').trim(),
    sectioninfo: (row.sectioninfo || '').trim(),
    notes: (row.notes || '').trim(),
    lessonCode: (row.lessonCode || '').trim()
  };
}

// Helper: check if any payload field is non-empty
function hasAnyContent(payload) {
  return !!(payload.unit || payload.unitetype || payload.sectioninfo || payload.notes || payload.lessonCode);
}

// Helper: merge two payloads for pull/merge actions
function mergePayloads(cur, next) {
  // unit: join non-empty with ' / '
  const units = [cur.unit, next.unit].map(s => (s || '').trim()).filter(Boolean);
  const mergedUnit = units.join(' / ');
  // sectioninfo: join with \n
  const sections = [cur.sectioninfo, next.sectioninfo].map(s => (s || '').trim()).filter(Boolean);
  const mergedSectioninfo = sections.join('\n');
  // notes: join with \n
  const notes = [cur.notes, next.notes].map(s => (s || '').trim()).filter(Boolean);
  const mergedNotes = notes.join('\n');
  // unitetype: prefer cur, else next
  const mergedUnitetype = cur.unitetype || next.unitetype || '';
  // lessonCode: join unique, non-empty, comma+space
  const codes = [cur.lessonCode, next.lessonCode]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .flatMap(s => s.split(',').map(x => x.trim()))
    .filter(Boolean);
  const uniqueCodes = [...new Set(codes)];
  const mergedLessonCode = uniqueCodes.join(', ');
  return {
    unit: mergedUnit,
    unitetype: mergedUnitetype,
    sectioninfo: mergedSectioninfo,
    notes: mergedNotes,
    lessonCode: mergedLessonCode
  };
}

// POST /lessons-calendar/generatedyearplan/:id/pull-next
app.post('/lessons-calendar/generatedyearplan/:id/pull-next', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const mergeIfConflict = req.body && req.body.mergeIfConflict === true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Load current row
    const { rows: curRows } = await client.query(
      `SELECT * FROM "generatedyearplan" WHERE id = $1`, [id]
    );
    if (!curRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Current row not found' });
    }
    const cur = curRows[0];
    // Find next row with same subject and id > currentId
    const { rows: nextRows } = await client.query(
      `SELECT * FROM "generatedyearplan"
        WHERE "subject" = $1 AND id > $2
        ORDER BY id ASC LIMIT 1`,
      [cur.subject, cur.id]
    );
    if (!nextRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No next row found' });
    }
    const next = nextRows[0];
    // Extract payloads
    const curPayload = extractPayload(cur);
    const nextPayload = extractPayload(next);
    const curHasContent = hasAnyContent(curPayload);
    const nextHasContent = hasAnyContent(nextPayload);
    // If both have content and not mergeIfConflict, return 409
    if (curHasContent && nextHasContent && !mergeIfConflict) {
      await client.query('ROLLBACK');
      return res.status(409).json({ current: curPayload, incoming: nextPayload });
    }
    // Compute new content for current row
    let finalPayload;
    if (!curHasContent || !nextHasContent) {
      // No conflict, just copy next into current
      finalPayload = { ...nextPayload };
    } else if (mergeIfConflict) {
      // Merge fields
      finalPayload = mergePayloads(curPayload, nextPayload);
    }
    // Update current row with finalPayload
    await client.query(
      `UPDATE "generatedyearplan"
         SET unit = $1, unitetype = $2, sectioninfo = $3, notes = $4, "lessonCode" = $5
       WHERE id = $6`,
      [finalPayload.unit, finalPayload.unitetype, finalPayload.sectioninfo, finalPayload.notes, finalPayload.lessonCode, cur.id]
    );
    // Clear next row's content
    await client.query(
      `UPDATE "generatedyearplan"
         SET unit = '', unitetype = '', sectioninfo = '', notes = '', "lessonCode" = ''
       WHERE id = $1`,
      [next.id]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, id: cur.id, movedFrom: next.id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('pull-next failed:', e);
    return res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

// POST /lessons-calendar/generatedyearplan/:id/merge-prev
app.post('/lessons-calendar/generatedyearplan/:id/merge-prev', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Load current row
    const { rows: curRows } = await client.query(
      `SELECT * FROM "generatedyearplan" WHERE id = $1`, [id]
    );
    if (!curRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Current row not found' });
    }
    const cur = curRows[0];
    // Find previous row with same subject and id < currentId
    const { rows: prevRows } = await client.query(
      `SELECT * FROM "generatedyearplan"
        WHERE "subject" = $1 AND id < $2
        ORDER BY id DESC LIMIT 1`,
      [cur.subject, cur.id]
    );
    if (!prevRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No previous row found' });
    }
    const prev = prevRows[0];
    // Extract payloads
    const curPayload = extractPayload(cur);
    const prevPayload = extractPayload(prev);
    // Always merge current into previous
    const mergedPayload = mergePayloads(prevPayload, curPayload);
    // Update previous row
    await client.query(
      `UPDATE "generatedyearplan"
         SET unit = $1, unitetype = $2, sectioninfo = $3, notes = $4, "lessonCode" = $5
       WHERE id = $6`,
      [mergedPayload.unit, mergedPayload.unitetype, mergedPayload.sectioninfo, mergedPayload.notes, mergedPayload.lessonCode, prev.id]
    );
    // Clear current row's content
    await client.query(
      `UPDATE "generatedyearplan"
         SET unit = '', unitetype = '', sectioninfo = '', notes = '', "lessonCode" = ''
       WHERE id = $1`,
      [cur.id]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, id: cur.id, mergedInto: prev.id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('merge-prev failed:', e);
    return res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

// PATCH /lessons-calendar/generatedyearplan/:id
// Update one or more allowed columns. Accepts old {column,value} or new {unit:...} shape.
app.patch('/lessons-calendar/generatedyearplan/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  // Allowed, kept in a Set for fast lookup
  const allowed = new Set([
    'week_number','date','weekday','start_time','end_time','subject','unit','unitetype','sectioninfo','notes','duration','is_module','lessonCreated','lessonCode'
  ]);

  const body = req.body || {};
  const sets = [];
  const params = [];

  // Backwards compatibility: old payload shape { column, value }
  if (typeof body.column === 'string') {
    const col = body.column.trim();
    if (!allowed.has(col)) {
      return res.status(400).json({
        error: 'Column not editable',
        allowed: Array.from(allowed)
      });
    }
    params.push(body.value);
    sets.push(`"${col}" = $${params.length}`);
  } else {
    // New shape: dynamic fields { unit: '...', notes: '...' }
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) continue;
      params.push(v);
      sets.push(`"${k}" = $${params.length}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields' });
  params.push(id);

  try {
    const sql = `UPDATE "generatedyearplan" SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`;
    const r = await pool.query(sql, params);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, row: r.rows[0] });
  } catch (e) {
    console.error('PATCH generatedyearplan failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});



// === NEW: Backward sequence operations for Lessons Calendar ===
// Helper to load ordered rows for same subject
async function loadSubjectRows(client, subject){
  const { rows } = await client.query(
    `SELECT id, unit, unitetype, sectioninfo, notes, "lessonCode", subject
       FROM "generatedyearplan"
      WHERE subject = $1
      ORDER BY id ASC`,
    [subject]
  );
  return rows;
}

function isEmptyPayload(p){
  return !((p.unit||'').trim() || (p.unitetype||'').trim() || (p.sectioninfo||'').trim() || (p.notes||'').trim() || (p.lessonCode||'').trim());
}

function payloadFromRow(r){
  return {
    unit: (r.unit||'').trim(),
    unitetype: (r.unitetype||'').trim(),
    sectioninfo: (r.sectioninfo||'').trim(),
    notes: (r.notes||'').trim(),
    lessonCode: (r.lessonCode||'').trim()
  };
}

async function writePayload(client, id, p){
  await client.query(
    `UPDATE "generatedyearplan"
        SET unit = $1, unitetype = $2, sectioninfo = $3, notes = $4, "lessonCode" = $5
      WHERE id = $6`,
    [p.unit||'', p.unitetype||'', p.sectioninfo||'', p.notes||'', p.lessonCode||'', id]
  );
}

// POST /lessons-calendar/generatedyearplan/:id/shift-back-sequence
// "<-": shift the whole chain one step back towards earlier rows.
// Effect: for subject group, for all rows up to current index, each row takes the content of the next row (j := j+1);
// current row becomes empty at the end. No dates are changed.
app.post('/lessons-calendar/generatedyearplan/:id/shift-back-sequence', async (req,res)=>{
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error:'Invalid id' });
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const curRes = await client.query(`SELECT id, subject FROM "generatedyearplan" WHERE id = $1`, [id]);
    if (!curRes.rows.length){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Row not found' }); }
    const subject = curRes.rows[0].subject;
    const rows = await loadSubjectRows(client, subject);
    const idx = rows.findIndex(r=>r.id === id);
    if (idx < 0){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Index not found' }); }

    // Guard: allow only if the immediate previous slot is empty (no lesson content)
    if (idx > 0) {
      const prevPayload = payloadFromRow(rows[idx-1]);
      if (!isEmptyPayload(prevPayload)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Previous slot is not empty',
          reason: 'prev-not-empty',
          prevRowId: rows[idx-1].id,
          prevPreview: prevPayload
        });
      }
    }

    // Backward shift: j from idx-1 down to 0, row[j] := row[j+1]
    for (let j = idx-1; j >= 0; j--) {
      const src = payloadFromRow(rows[j+1]);
      await writePayload(client, rows[j].id, src);
    }
    // clear current row
    await writePayload(client, rows[idx].id, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });

    await client.query('COMMIT');
    return res.json({ ok:true, shiftedUntil: rows[0]?.id || null, cleared: rows[idx].id });
  }catch(e){
    await client.query('ROLLBACK');
    console.error('shift-back-sequence failed:', e);
    return res.status(500).json({ error:'DB error' });
  }finally{ client.release(); }
});

app.use('/lessons-calendar', require('./routes/lessonsCalendar'));
app.use('/lessons-library', require('./public/lessonsLibrary'));

/**
 * GET /lesson-skills?triplet=001001001
 * Returns all columns from "Snippets" for the given triplet.
 * Matches both the single-value "tripplet_lesson" and the array "lessons_in_tripplets".
 */
app.get('/lesson-skills', async (req, res) => {
  const triplet = req.query.triplet;
  if (!triplet) return res.status(400).json({ error: 'Missing triplet parameter' });
  try {
    const { rows } = await pool.query(
      `SELECT
         "id",
         "name",
         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
         "order",
         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
         "uslovie",
         "class"
       FROM "Snippets"
       WHERE ("tripplet_lesson" = $1::text)
          OR ($1::text = ANY ("lessons_in_tripplets"))
       ORDER BY "id" ASC`,
      [triplet]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error querying table Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Lightweight Snippets endpoints used by versionControl.js to resolve componentID labels.
 * - GET /snippets/:id          -> single snippet {id,name,uslovie}
 * - GET /snippets/bulk?ids=1,2 -> array of {id,name,uslovie}
 * - GET /snippets?ids=1,2      -> same as bulk (fallback)
 */
app.get('/snippets/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      `SELECT "id","name","uslovie" FROM "Snippets" WHERE "id" = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('GET /snippets/:id failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

function parseIdsParam(q) {
  if (!q) return [];
  return String(q)
    .split(/[\s,;]+/)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isInteger(n));
}

async function fetchSnippetsByIds(ids, res) {
  if (!ids.length) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT "id","name","uslovie" FROM "Snippets" WHERE "id" = ANY($1::int[]) ORDER BY "id" ASC`,
      [ids]
    );
    return res.json(rows);
  } catch (e) {
    console.error('GET /snippets bulk failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
}

app.get('/snippets/bulk', async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  return fetchSnippetsByIds(ids, res);
});

// Fallback alias used by the frontend
app.get('/snippets', async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  return fetchSnippetsByIds(ids, res);
});

// Return tuple_key for Exercises by IDs – used when rendering Task rows in version control
app.get('/exercises/tuple-keys', async (req, res) => {
  const ids = parseIdsParam(req.query.ids);
  if (!ids.length) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT "ID" AS id, "tuple_key" FROM "Exercises" WHERE "ID" = ANY($1::int[]) ORDER BY "ID" ASC`,
      [ids]
    );
    return res.json(rows);
  } catch (e) {
    console.error('GET /exercises/tuple-keys failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

// Strict resolver: match by ALL provided basic fields (+ optional lesson_id / tripplet_id).
// Rule: if a field is present but empty -> require IS NULL in DB; if missing from query, ignore it.
// Supported fields: lesson_id/id, tripplet_id, name, class, description, url, filepath, source_token, section_token, lesson_token
async function resolveLessonIdByBasicsStrict(q) {
  const parts = [];
  const params = [];
  const pushTextEq = (col, v) => {
    if (v === '') { parts.push(`l."${col}" IS NULL`); return; }
    params.push(v);
    parts.push(`l."${col}" = $${params.length}`);
  };
  const pushIntEq = (col, v) => {
    if (v === '') { parts.push(`l."${col}" IS NULL`); return; }
    const n = parseInt(v, 10);
    if (!Number.isInteger(n)) return; // ignore invalid numbers
    params.push(n);
    parts.push(`l."${col}" = $${params.length}`);
  };

  // lesson_id / id (optional hard constraint)
  if (typeof q.lesson_id !== 'undefined' || typeof q.id !== 'undefined') {
    const raw = (q.lesson_id ?? q.id ?? '').toString().trim();
    if (raw === '') { parts.push(`l."lesson_id" IS NULL`); }
    else {
      const n = parseInt(raw, 10);
      if (Number.isInteger(n)) { params.push(n); parts.push(`l."lesson_id" = $${params.length}`); }
    }
  }

  // tripplet_id (special: compare dotted/undotted equally)
  if (typeof q.tripplet_id !== 'undefined') {
    const raw = (q.tripplet_id ?? '').toString().trim();
    if (raw === '') {
      parts.push(`l."tripplet_id" IS NULL`);
    } else {
      params.push(raw);
      parts.push(`(l."tripplet_id" = $${params.length} OR REPLACE(l."tripplet_id",'.','') = REPLACE($${params.length}::text,'.',''))`);
    }
  }

  // Text fields
  if (typeof q.name !== 'undefined')           pushTextEq('name',        (q.name??'').toString().trim());
  if (typeof q.description !== 'undefined')    pushTextEq('description', (q.description??'').toString().trim());
  if (typeof q.url !== 'undefined')            pushTextEq('url',         (q.url??'').toString().trim());
  if (typeof q.filepath !== 'undefined')       pushTextEq('filepath',    (q.filepath??'').toString().trim());

  // Integer token fields and class
  if (typeof q.class !== 'undefined')          pushIntEq('class',        (q.class??'').toString().trim());
  if (typeof q.source_token !== 'undefined')   pushIntEq('source_token', (q.source_token??'').toString().trim());
  if (typeof q.section_token !== 'undefined')  pushIntEq('section_token',(q.section_token??'').toString().trim());
  if (typeof q.lesson_token !== 'undefined')   pushIntEq('lesson_token', (q.lesson_token??'').toString().trim());

  if (!parts.length) return null; // nothing to match
  const whereClause = parts.join(' AND ');
  const sql = `
    SELECT l.lesson_id
      FROM "Lessons" l
     WHERE ${whereClause}
     ORDER BY l.updated_at DESC NULLS LAST, l.lesson_id DESC
     LIMIT 1`;
  const r = await pool.query(sql, params);
  const found = r.rows.length ? parseInt(r.rows[0].lesson_id,10) : null;
  console.log('[resolveBasicsStrict]', {
    input: q,
    where: whereClause,
    params,
    found
  });
  return found;
}

/**
 * GET /lesson-skills-merged
 * Returns Snippets for the lesson resolved by all provided basic fields (strict match).
 * Accepts any combination of: lesson_id/id, tripplet_id, name, class, description, url, filepath, source_token, section_token, lesson_token
 * Returns snippets for the lesson's theory_snippets, preserving order.
 */
app.get('/lesson-skills-merged', async (req, res) => {
  const q = req.query || {};
  try {
    // 1) Resolve lesson_id by ALL provided basics (+optional id/tripplet)
    const lessonId = await resolveLessonIdByBasicsStrict(q);
    if (!Number.isInteger(lessonId)) return res.json([]);

    // 2) Load theory IDs from lesson_scripted (ordered, 'theory' or 'snippet')
    const t = await pool.query(
      `SELECT item_id
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type IN ('theory','snippet')
     ORDER BY id ASC`,
      [lessonId]
    );
    const theoryIds = t.rows.map(r => parseInt(r.item_id,10)).filter(Number.isInteger);
    if (theoryIds.length === 0) return res.json([]);

    // 3) Validate and fetch exactly those snippets, preserving order
    const chk = await pool.query(`SELECT id FROM "Snippets" WHERE id = ANY($1::int[])`, [theoryIds]);
    const validIds = chk.rows.map(r => parseInt(r.id,10)).filter(Number.isInteger);
    if (validIds.length === 0) return res.json([]);

    const sql = `
      SELECT
         s."id",
         s."name",
         COALESCE(TO_JSON(s."keyWords"), '[]'::json)             AS "keyWords",
         s."order",
         COALESCE(TO_JSON(s."relatedTopic"), '[]'::json)         AS "relatedTopic",
         COALESCE(TO_JSON(s."lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
         COALESCE(TO_JSON(s."associatedSnippets"), '[]'::json)   AS "associatedSnippets",
         s."uslovie",
         s."class"
      FROM "Snippets" s
      WHERE s."id" = ANY($1::int[])
      ORDER BY array_position($1::int[], s."id") NULLS LAST, s."id" ASC`;
    const { rows } = await pool.query(sql, [validIds]);
    return res.json(rows);
  } catch (err) {
    console.error('Error in /lesson-skills-merged:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DEBUG: see theory ids resolved via lesson_scripted for a triplet
app.get('/debug/lesson-theory-ids', async (req, res) => {
  const triplet = (req.query.triplet || '').trim();
  if (!triplet) return res.status(400).json({ error: 'Missing triplet' });
  try{
    const l = await pool.query(`SELECT lesson_id FROM "Lessons" WHERE tripplet_id = $1 LIMIT 1`, [triplet]);
    if (!l.rows.length) return res.json({ lesson_id: null, theory_ids: [] });
    const lid = parseInt(l.rows[0].lesson_id,10);
    const t = await pool.query(
      `SELECT item_id
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type IN ('theory','snippet')
     ORDER BY id ASC`,
      [lid]
    );
    const ids = t.rows.map(r => parseInt(r.item_id,10)).filter(Number.isInteger);
    return res.json({ lesson_id: lid, theory_ids: ids });
  }catch(e){
    console.error('/debug/lesson-theory-ids failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

/**
 * PATCH /lesson-skills/:id
 * Updates any editable column of Snippets by id (except "id").
 * Expects body with one or more fields among:
 * name (text), keyWords (text[]), tripplet_lesson (text), associatedSnippet (int),
 * order (int), relatedTopic (text[]), lessons_in_tripplets (text[]),
 * associatedSnippets (int[]), uslovie (text), class (int)
 */
app.patch('/lesson-skills/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Helper casters
  const asTextArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const asIntArray  = (v) => Array.isArray(v) ? v.map(n=>parseInt(n,10)).filter(n=>Number.isInteger(n))
                                             : (typeof v === 'string' ? v.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isInteger(n)) : []);

  const allowed = {
    name:                { cast: null },
    keyWords:            { cast: 'text[]',   transform: asTextArray },
    tripplet_lesson:     { cast: null },
    associatedSnippet:   { cast: 'int' },
    order:               { cast: 'int' },
    relatedTopic:        { cast: 'text[]',   transform: asTextArray },
    lessons_in_tripplets:{ cast: 'text[]',   transform: asTextArray },
    associatedSnippets:  { cast: 'int[]',    transform: asIntArray },
    uslovie:             { cast: null },
    class:               { cast: 'int' }
  };

  const sets = [];
  const params = [];
  for (const [key, meta] of Object.entries(allowed)) {
    if (typeof req.body[key] === 'undefined') continue;
    let val = req.body[key];
    if (meta.transform) val = meta.transform(val);
    params.push(val);
    const idx = `$${params.length}`;
    if (meta.cast) {
      sets.push(`"${key}" = ${idx}::${meta.cast}`);
    } else {
      sets.push(`"${key}" = ${idx}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields provided' });

  params.push(id);
  const sql = `UPDATE "Snippets" SET ${sets.join(', ')} WHERE "id" = $${params.length}
               RETURNING "id","name",
                         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
                         "tripplet_lesson","associatedSnippet","order",
                         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
                         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
                         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
                         "uslovie","class"`;
  try {
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok:true, row: r.rows[0] });
  } catch (err) {
    console.error('Error updating Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /lesson-skills
 * Creates a new Snippets row. Body may contain any editable field; if `triplet`
 * is provided it will be used to prefill tripplet_lesson/lessons_in_tripplets.
 */
app.post('/lesson-skills', async (req, res) => {
  const body = req.body || {};
  const asTextArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const asIntArray  = (v) => Array.isArray(v) ? v.map(n=>parseInt(n,10)).filter(n=>Number.isInteger(n))
                                             : (typeof v === 'string' ? v.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isInteger(n)) : []);

  const triplet = body.triplet || body.tripplet_lesson || null;

  const cols = [
    'name','keyWords','tripplet_lesson','associatedSnippet','order',
    'relatedTopic','lessons_in_tripplets','associatedSnippets','uslovie','class'
  ];
  const vals = {
    name: body.name ?? null,
    keyWords: asTextArray(body.keyWords),
    tripplet_lesson: triplet ?? null,
    associatedSnippet: (body.associatedSnippet != null ? parseInt(body.associatedSnippet,10) : null),
    order: (body.order != null ? parseInt(body.order,10) : null),
    relatedTopic: asTextArray(body.relatedTopic),
    lessons_in_tripplets: (triplet ? asTextArray(body.lessons_in_tripplets || triplet) : asTextArray(body.lessons_in_tripplets)),
    associatedSnippets: asIntArray(body.associatedSnippets),
    uslovie: body.uslovie ?? null,
    class: (body.class != null ? parseInt(body.class,10) : null)
  };

  const params = [];
  const placeholders = [];
  const casts = {
    keyWords:'text[]', relatedTopic:'text[]', lessons_in_tripplets:'text[]', associatedSnippets:'int[]'
  };

  cols.forEach((c, i) => {
    params.push(vals[c]);
    const cast = casts[c] ? `::${casts[c]}` : '';
    placeholders.push(`$${i+1}${cast}`);
  });

  const sql = `INSERT INTO "Snippets" (${cols.map(c=>`"${c}"`).join(', ')})
               VALUES (${placeholders.join(', ')})
               RETURNING "id","name",
                         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
                         "tripplet_lesson","associatedSnippet","order",
                         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
                         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
                         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
                         "uslovie","class"`;
  try {
    const r = await pool.query(sql, params);
    const created = r.rows[0];

    // If the snippet is tied to a triplet, append its ID to Lessons.theory_snippets for that triplet
    if (triplet && created && Number.isInteger(created.id)) {
      try {
        await pool.query(
          `UPDATE "Lessons"
              SET theory_snippets = CASE
                    WHEN theory_snippets IS NULL THEN ARRAY[$1]::int[]
                    WHEN NOT ($1 = ANY(theory_snippets)) THEN theory_snippets || $1
                    ELSE theory_snippets
                  END
            WHERE tripplet_id = $2`,
          [created.id, triplet]
        );
      } catch (e) {
        console.warn('⚠️ Failed to append snippet to Lessons.theory_snippets:', e && e.message ? e.message : e);
      }
    }

    res.status(201).json({ ok:true, row: created });
  } catch (err) {
    console.error('Error inserting into Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// POST /student-assessment-skills-exercises — save detailed assessment rows
// Expects: { rows: [ {lessonTriplet,isSnippet,componentID,assessment,comment,studentID,threadID,followup_id,followup_exp} ] }
app.post('/student-assessment-skills-exercises', async (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Missing rows[]' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // New SQL: do not insert followup_exp nor followup_id into the new row
    const sql = `
WITH src AS (
  SELECT 
    COALESCE(NULLIF(TRIM(x->>'lessonTriplet'), ''), '')::text                AS "lessonTriplet",
    CASE 
      WHEN (x ? 'isSnippet') THEN 
        CASE LOWER(NULLIF(TRIM(x->>'isSnippet'), ''))
          WHEN 'true'  THEN TRUE
          WHEN '1'     THEN TRUE
          WHEN 'false' THEN FALSE
          WHEN '0'     THEN FALSE
          ELSE (x->>'isSnippet')::boolean
        END
      ELSE NULL
    END                                                             AS "isSnippet",
    NULLIF(TRIM(x->>'componentID'), '')::int                         AS "componentID",
    NULLIF(TRIM(x->>'assessment'),  '')::int                         AS "assessment",
    COALESCE(x->>'comment','')::text                                 AS "comment",
    NULLIF(TRIM(x->>'studentID'),  '')::int                          AS "studentID",
    COALESCE(NULLIF(TRIM(x->>'followup_exp'), ''), '')::text         AS "followup_exp",
    NULLIF(TRIM(x->>'followup_id'), '')::int                         AS "followup_id",
    NULLIF(TRIM(x->>'threadID'), '')::text                           AS "threadID"
  FROM jsonb_array_elements($1::jsonb) AS x
)
INSERT INTO "student_assessment_skills_exercises"
  ("lessonTriplet","isSnippet","componentID","assessment","comment","studentID","threadID","entryTime")
SELECT "lessonTriplet","isSnippet","componentID","assessment","comment","studentID","threadID", NOW()
FROM src
RETURNING id,"lessonTriplet","isSnippet","componentID","assessment","comment","studentID","threadID","entryTime";
`;

    // Normalize keys coming from client so fields have expected names and types
    const normRows = rows.map(function (r) {
      var lessonTriplet = r.lessonTriplet != null ? r.lessonTriplet
                        : (r.triplet != null ? r.triplet
                        : (r.lesson_tripplet != null ? r.lesson_tripplet : ""));
      var isSnippet = (typeof r.isSnippet !== "undefined") ? r.isSnippet
                    : (typeof r.is_snippet !== "undefined" ? r.is_snippet : null);
      var componentID = (r.componentID != null ? r.componentID
                       : (r.componentId != null ? r.componentId
                       : (r.component_id != null ? r.component_id
                       : null)));
      var assessment = (r.assessment != null ? r.assessment
                      : (r.score != null ? r.score : null));
      var comment = (typeof r.comment === "string" ? r.comment
                   : (typeof r.note === "string" ? r.note : ""));
      var studentID = (r.studentID != null ? r.studentID
                     : (r.studentId != null ? r.studentId
                     : (r.student_id != null ? r.student_id : null)));
      // Add followup_exp, followup_id, threadID normalization
      return {
        lessonTriplet: lessonTriplet != null ? String(lessonTriplet) : "",
        isSnippet: isSnippet,
        componentID: componentID == null ? null : componentID,
        assessment: assessment == null ? null : assessment,
        comment: comment || "",
        studentID: studentID == null ? null : studentID,
        followup_exp: (typeof r.followup_exp === 'string' ? r.followup_exp : ''),
        followup_id:  (r.followup_id != null ? parseInt(r.followup_id,10) : (r.parentId != null ? parseInt(r.parentId,10) : null)),
        threadID:     (typeof r.threadID === 'string' ? r.threadID: (typeof r.thread_id === 'string' ? r.thread_id : null))
        };
    });

    // Always route followup_exp into the NEW row's comment; base row should NOT receive it.
    for (const nr of normRows) {
      if (typeof nr.followup_exp === 'string' && nr.followup_exp.trim() !== '') {
        nr.comment = nr.followup_exp; // ensure the note goes to the inserted row
      }
      // Never carry followup_exp forward to base row update; we don't update base comment
      nr.followup_exp = '';
    }

    console.log("POST /student-assessment-skills-exercises sample row:",
      Array.isArray(rows) && rows[0] ? rows[0] : null,
      "keys=", Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : []
    );
    console.log("normalized sample:", normRows[0], "keys=", Object.keys(normRows[0] || {}));

    const payloadJson = JSON.stringify(normRows);

    const result = await client.query(sql, [payloadJson]);

    // After insert, if a payload row carried followup_id (meaning: new row is a follow-up to base row with that id),
    // then link the BASE row to the newly created row. The follow-up link lives on the base row.
    const inserted = result.rows || [];
    for (let i = 0; i < normRows.length; i++) {
      const baseId = normRows[i] && normRows[i].followup_id ? parseInt(normRows[i].followup_id, 10) : null;
      const newId  = inserted[i] && inserted[i].id ? parseInt(inserted[i].id, 10) : null;
      const sid    = normRows[i] && normRows[i].studentID ? parseInt(normRows[i].studentID, 10) : null;
      if (Number.isInteger(baseId) && Number.isInteger(newId)) {
        // NOTE: We ONLY link the base row to the new follow-up here.
        // We do NOT touch componentID/assessment/threadID/triplet/isSnippet on the base row.
        // Update only if the base row exists and currently has no follow-up set
        await client.query(
          `UPDATE "student_assessment_skills_exercises"
             SET "followup_id" = $2
           WHERE id = $1
             AND ("followup_id" IS NULL)`,
          [baseId, newId]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, inserted: result.rowCount, rows: result.rows });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('save student_assessment_skills_exercises failed:', e);
    res.status(500).json({ error: 'DB error' });
  } finally {
    client.release();
  }
});

// GET /student-assessment-skills-exercises?studentID=123
app.get('/student-assessment-skills-exercises', async (req, res) => {
  const sid = parseInt(req.query.studentID, 10);
  if (!Number.isInteger(sid)) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, "lessonTriplet","isSnippet","componentID","assessment","comment",
              "studentID","followup_exp","followup_id","threadID",
              TO_CHAR("entryTime", 'YYYY-MM-DD HH24:MI') AS entryTime
         FROM "student_assessment_skills_exercises"
        WHERE "studentID" = $1
        ORDER BY "entryTime" DESC, id DESC
        LIMIT 500`,
      [sid]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET student-assessment-skills-exercises failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});


// GET /lessons/by-grade?className=9 Ж  -> returns all Lessons for grade 9 (ignores division)
app.get('/lessons/by-grade', async (req, res) => {
  const className = (req.query.className || '').trim();
  if (!className) return res.status(400).json({ error: 'Missing className' });
  const grade = parseInt(className, 10);
  if (!Number.isInteger(grade)) return res.status(400).json({ error: 'Invalid className' });
  try {
    const { rows } = await pool.query(
      `SELECT lesson_id,
              tripplet_id,
              description,
              class,
              TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
         FROM "Lessons"
        WHERE class = $1
        ORDER BY updated_at DESC NULLS LAST, lesson_id DESC
        LIMIT 500`,
      [grade]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /lessons/by-grade failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});


// === LESSONS minimal API ===
// GET /lessons?limit=10
app.get('/lessons', async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit||'10',10)||10, 50));
  try{
    const { rows } = await pool.query(`
      SELECT la.lesson_id,
             l.tripplet_id,
             l.description,
             l.class,
             TO_CHAR(l.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
             la.action
        FROM lessons_actions la
        JOIN "Lessons" l ON l.lesson_id = la.lesson_id
       ORDER BY la.at DESC, la.id DESC
       LIMIT $1`, [limit]);
    res.json(rows);
  }catch(err){
    console.error('GET /lessons failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /lesson-scripted/:id  -> return arrays from lesson_scripted only (no Lessons columns)
app.get('/lesson-scripted/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try{
    const t = await pool.query(
      `SELECT ARRAY_AGG(item_id ORDER BY position) AS ids
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type = 'theory'`,
      [id]
    );
    const e = await pool.query(
      `SELECT ARRAY_AGG(item_id ORDER BY position) AS ids
         FROM lesson_scripted
        WHERE lesson_id = $1 AND item_type = 'exercise'`,
      [id]
    );
    const theory = (t.rows[0] && t.rows[0].ids) ? t.rows[0].ids.map(n=>parseInt(n,10)).filter(Number.isInteger) : [];
    const exercises = (e.rows[0] && e.rows[0].ids) ? e.rows[0].ids.map(n=>parseInt(n,10)).filter(Number.isInteger) : [];
    return res.json({ lesson_id: id, theory_snippets: theory, exercises_ids: exercises });
  }catch(err){
    console.error('GET /lesson-scripted/:id failed:', err);
    return res.status(500).json({ error: 'DB error' });
  }
});

app.post('/lessons', async (req, res) => {
  const body = req.body || {};
  const fields = {
    tripplet_id: typeof body.tripplet_id === 'string' ? body.tripplet_id.trim() : null,
    description: typeof body.description === 'string' ? body.description.trim() : null,
    url: typeof body.url === 'string' ? body.url.trim() : null,
    filepath: typeof body.filepath === 'string' ? body.filepath.trim() : null,
    class: Number.isInteger(body.class) ? body.class : (typeof body.class === 'string' && body.class.trim()!=='' ? parseInt(body.class,10) : null)
  };
  const cols = [];
  const params = [];
  const ph = [];
  Object.entries(fields).forEach(([k,v])=>{
    if (v === null) return;
    cols.push(`"${k}"`);
    params.push(v);
    ph.push(`$${params.length}`);
  });
  if (cols.length === 0) return res.status(400).json({ error: 'No fields provided' });
  const sql = `INSERT INTO "Lessons" (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING lesson_id`;
  try{
    const r = await pool.query(sql, params);
    const newId = r.rows[0].lesson_id;
    // Write details into lesson_scripted
    try{
      await replaceLessonScripted(newId, body.theory_snippets || [], body.exercises_ids || []);
    }catch(e){ console.warn('replaceLessonScripted on POST failed:', e && e.message ? e.message : e); }
    try{ await pool.query('INSERT INTO lessons_actions(lesson_id, action) VALUES ($1, $2)', [newId, 'new']); }catch(_e){ console.error('log insert failed (new):', _e); }
    res.status(201).json({ ok:true, lesson_id: newId });
  }catch(err){
    console.error('POST /lessons failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.patch('/lessons/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const body = req.body || {};
  const fields = {
    tripplet_id: typeof body.tripplet_id === 'string' ? body.tripplet_id.trim() : null,
    description: typeof body.description === 'string' ? body.description.trim() : null,
    url: typeof body.url === 'string' ? body.url.trim() : null,
    filepath: typeof body.filepath === 'string' ? body.filepath.trim() : null,
    class: Number.isInteger(body.class) ? body.class : (typeof body.class === 'string' && body.class.trim()!=='' ? parseInt(body.class,10) : null)
  };
  const sets = [];
  const params = [];
  for (const [k,v] of Object.entries(fields)){
    if (v === null) { sets.push(`"${k}" = NULL`); continue; }
    if (v === undefined) continue;
    params.push(v);
    sets.push(`"${k}" = $${params.length}`);
  }
  if (sets.length === 0 && !(Array.isArray(body.theory_snippets) || Array.isArray(body.exercises_ids))) {
    return res.status(400).json({ error: 'No fields provided' });
  }
  try{
    if (sets.length){
      const sql = `UPDATE "Lessons" SET ${sets.join(', ')} WHERE lesson_id = $${params.length+1} RETURNING lesson_id`;
      params.push(id);
      const r = await pool.query(sql, params);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    }
if (Array.isArray(body.theory_snippets) || Array.isArray(body.exercises_ids)) {
  console.log('[PATCH /lessons] replaceLessonScripted CALLED', {
    lessonId: id,
    theory: body.theory_snippets,
    exercises: body.exercises_ids
  });
  try{
    await replaceLessonScripted(id, body.theory_snippets || [], body.exercises_ids || []);
  }catch(e){
    console.warn('replaceLessonScripted on PATCH failed:', e && e.message ? e.message : e);
  }
}
    try{ await pool.query('INSERT INTO lessons_actions(lesson_id, action) VALUES ($1, $2)', [id, 'updated']); }catch(_e){ console.error('log insert failed (updated):', _e); }
    res.json({ ok:true, lesson_id: id });
  }catch(err){
    console.error('PATCH /lessons/:id failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/lessons/by-search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.status(400).json({ error: 'Missing q' });
  const digits = qRaw.replace(/\D+/g,'');
  try{
    if (digits) {
      const { sql, params } = lessonSelectWithAggregates(`CAST(l.source_token AS text) LIKE $1 || '%'`, [digits]);
      const a = await pool.query(sql, params);
      if (a.rows.length) return res.json(a.rows[0]);
    }
    const { sql, params } = lessonSelectWithAggregates(`l.tripplet_id ILIKE $1 || '%'`, [qRaw]);
    const b = await pool.query(sql, params);
    if (!b.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(b.rows[0]);
  }catch(err){
    console.error('GET /lessons/by-search failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /lessons/search-by-snippet?q=27001
// Returns { completions:[{id,name}], lessons:[{lesson_id,tripplet_id,description,class}] }
app.get('/lessons/search-by-snippet', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.json({ completions: [], lessons: [] });

  try {
    const params = [];
    const whereParts = [];
    const srcPrefix = qRaw.replace(/\D+/g, '');
    if (srcPrefix) { params.push(srcPrefix + '%'); whereParts.push(`CAST(l.source_token AS text) LIKE $${params.length}`); }
    if (qRaw) { params.push(qRaw + '%'); whereParts.push(`l.tripplet_id ILIKE $${params.length}`); }

    let completions = [];
    if (whereParts.length) {
      const sql = `
        SELECT DISTINCT l.tripplet_id AS id,
               COALESCE(l.description,'')   AS name
          FROM "Lessons" l
         WHERE ${whereParts.join(' OR ')}
         ORDER BY l.tripplet_id
         LIMIT 20`;
      const { rows } = await pool.query(sql, params);
      completions = rows;
    }

    const { rows: lessons } = await pool.query(
      `SELECT
         l.lesson_id,
         l.tripplet_id,
         l.description,
         l.class,
         COALESCE((SELECT ARRAY_AGG(s.item_id ORDER BY s.position)
                     FROM lesson_scripted s
                    WHERE s.lesson_id = l.lesson_id AND s.item_type='theory'), '{}'::int[]) AS theory_snippets,
         COALESCE((SELECT ARRAY_AGG(s.item_id::text ORDER BY s.position)
                     FROM lesson_scripted s
                    WHERE s.lesson_id = l.lesson_id AND s.item_type='exercise'), '{}'::text[]) AS exercises_ids
         FROM "Lessons" l
        WHERE (${whereParts.length ? whereParts.join(' OR ') : 'TRUE'})
        ORDER BY l.updated_at DESC NULLS LAST, l.lesson_id DESC
        LIMIT 200`,
      params
    );

    res.json({ completions, lessons });
  } catch (err) {
    console.error('search-by-snippet (by source/tripplet) failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});


// GET /assessments/by-lesson-skill?triplet=001001001&componentID=27001&className=11%20А
// Returns latest assessment per student for that lesson+skill, for the given class/division.
app.get('/assessments/by-lesson-skill', async (req, res) => {
  const triplet = (req.query.triplet||'').trim();
  const componentID = parseInt(req.query.componentID, 10);
  const className = (req.query.className||'').trim();
  if (!triplet || !Number.isInteger(componentID) || !className) {
    return res.status(400).json({ error: 'Missing triplet, componentID or className' });
  }
  // Parse class/division
  const cls = parseInt(className, 10);
  const div = className.includes(' ') ? className.substring(className.indexOf(' ')+1).trim() : '';
  if (!Number.isInteger(cls)) return res.status(400).json({ error: 'Invalid className' });
  try {
    // Students of the class
    const { rows: students } = await pool.query(
      `SELECT "ID" AS id, ("First_Name" || ' ' || "Sirname") AS name
         FROM "Students"
        WHERE "Grade" = $1 AND "Division" = $2
        ORDER BY "First_Name", "Sirname"`,
      [cls, div]
    );

    // Latest assessment per student for this triplet+componentID
    const { rows: asses } = await pool.query(
      `SELECT DISTINCT ON (s."studentID")
              s."studentID" AS id,
              s."assessment",
              TO_CHAR(s."entryTime", 'YYYY-MM-DD HH24:MI') AS entryTime
         FROM "student_assessment_skills_exercises" s
        WHERE s."lessonTriplet" = $1
          AND s."componentID" = $2
        ORDER BY s."studentID", s."entryTime" DESC, s.id DESC`,
      [triplet, componentID]
    );
    const byId = new Map(asses.map(r => [parseInt(r.id,10), r]));
    const out = students.map(st => {
      const hit = byId.get(parseInt(st.id,10));
      return {
        studentID: st.id,
        name: st.name,
        assessment: hit ? (hit.assessment==null? null : parseInt(hit.assessment,10)) : null,
        entryTime: hit ? hit.entryTime : null
      };
    });
    res.json(out);
  } catch (e) {
    console.error('GET /assessments/by-lesson-skill failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


app.post('/upload-a', upload.single("uploadedFileA"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded A.");
    console.log("Uploaded A:", req.file);
    res.send("✅ File A uploaded!");
});

app.post('/upload-b', upload.single("uploadedFileB"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded B.");
    console.log("Uploaded B:", req.file);
    res.send("✅ File B uploaded!");
});


// Примерен маркшрут за решенията на задачите. 
app.get('/upload', (req, res) => {
    res.sendFile(__dirname + '/public/exe_solutions.html');
});

// Примерен маршрут: взимане на всички домашни
app.get('/homeworks', async (req, res) => {
  try {
      const result = await pool.query('SELECT * FROM "Resources"');
      console.log(result.rows)
      res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/classes', async (req, res) => {
    try {
        const result = await pool.query('SELECT "Class", "Division" FROM "ClassesList_2025_2026"');

        const classes = result.rows.map(row => {
            const classValue = row.Class;    
            const divisionValue = row.Division; 
            return `${row["Class"]}${row["Division"] ? " " + row["Division"] : ""}`;
        });

        res.json(classes);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching classes');
    }
});

app.get('/lessons-taken', async (req, res) => {
  const className = req.query.className; // e.g., "11 А"
  if (!className) return res.status(400).json({ error: 'Missing className parameter' });

  // Parse grade and division (e.g., "11 А" -> 11, "А")
  const grade = parseInt(className, 10);
  const division = className.includes(' ')
    ? className.substring(className.indexOf(' ') + 1).trim()
    : '';

  // Build flexible patterns to match variations like "11 МодулА", "11-А", etc.
  // p1: exact or starts-with "11 А" (spaces optional)
  // p2: contains grade and division in order, with any text in between (e.g., "11 МодулА")
  const p1 = `${grade} ${division}`.trim();
  const p2 = `${grade}%${division}`.trim();

  try {
    const result = await pool.query(
      `SELECT 
         "id", 
         "class", 
         "name", 
         TO_CHAR("date", 'YYYY-MM-DD') AS "date", 
         "associatedLesson"
       FROM "lessons_taken"
       WHERE (
         ("class" ILIKE $1 || '%')
         OR ("class" ILIKE $2)
       )
       ORDER BY "date" DESC NULLS LAST, "id" DESC`,
      [p1, `%${p2}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error querying lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /lessons-taken/:id - update name, date, and/or associatedLesson
app.patch('/lessons-taken/:id', async (req, res) => {
  const { id } = req.params;
  const { name, date, associatedLesson } = req.body || {};

  if (!id) return res.status(400).json({ error: 'Missing id' });

  const sets = [];
  const params = [];

  if (typeof name === 'string') {
    params.push(name);
    sets.push(`"name" = $${params.length}`);
  }
  if (typeof associatedLesson === 'string' || typeof associatedLesson === 'number') {
    params.push(String(associatedLesson));
    sets.push(`"associatedLesson" = $${params.length}`);
  }
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    params.push(date);
    sets.push(`"date" = $${params.length}::date`);
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  params.push(id);

  const sql = `UPDATE "lessons_taken"
                 SET ${sets.join(', ')}
               WHERE "id" = $${params.length}
               RETURNING "id", "class", "name", TO_CHAR("date", 'YYYY-MM-DD') AS "date", "associatedLesson"`;

  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error('Error updating lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /lessons-taken - create new row
app.post('/lessons-taken', async (req, res) => {
  const { class: cls, name, date, associatedLesson } = req.body || {};
  if (!cls) return res.status(400).json({ error: 'Missing class' });
  if (!name && !associatedLesson && !date) {
    return res.status(400).json({ error: 'Provide at least one of name, date or associatedLesson' });
  }
  let dateParam = null;
  if (typeof date === 'string' && date.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    dateParam = date;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO "lessons_taken" ("class", "name", "date", "associatedLesson")
       VALUES ($1, $2, $3::date, $4)
       RETURNING "id", "class", "name", TO_CHAR("date", 'YYYY-MM-DD') AS "date", "associatedLesson"`,
      [cls, name || null, dateParam, associatedLesson || null]
    );
    res.status(201).json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error('Error inserting into lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /schedule/available-years-generated — unique academic years present in generatedyearplan
app.get('/schedule/available-years-generated', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH g AS (
        SELECT date::date AS d
        FROM "generatedyearplan"
        WHERE date IS NOT NULL
      )
      SELECT
        CASE WHEN EXTRACT(MONTH FROM d) >= 9
             THEN EXTRACT(YEAR FROM d)::int
             ELSE (EXTRACT(YEAR FROM d)::int - 1)
        END AS start_year,
        CASE WHEN EXTRACT(MONTH FROM d) >= 9
             THEN EXTRACT(YEAR FROM d)::int + 1
             ELSE EXTRACT(YEAR FROM d)::int
        END AS end_year,
        COUNT(*) AS lessons_count
      FROM g
      GROUP BY 1,2
      HAVING COUNT(*) > 0
      ORDER BY start_year DESC;
    `);
    res.json(rows);
  } catch (e) {
    console.error('available-years-generated failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /generatedyearplan?className=...

app.get('/generatedyearplan', async (req, res) => {
  const className = req.query.className;
  if (!className) return res.status(400).json({ error: 'Missing className parameter' });
  try {
    const { rows } = await pool.query(
      `SELECT 
         "id",
         TO_CHAR("date", 'YYYY-MM-DD') AS "date",
         "weekday",
         "unit",
         "unitetype",
         "lessonCreated",
         "lessonCode"
       FROM "generatedyearplan"
       WHERE "subject" = $1
       ORDER BY "date" ASC NULLS LAST, "id" ASC`,
      [className]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error querying generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /generatedyearplan/:id - update editable fields
app.patch('/generatedyearplan/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Destructure all possible fields from body
  const {
    date,
    weekday,
    unit,
    unitetype,
    lessonCreated,
    lessonCode,
    subject,
    start_time,
    end_time,
    sectioninfo,
    notes,
    duration,
    is_module,
    week_number,
    term
  } = req.body || {};

  const sets = [];
  const params = [];

  if (typeof weekday === 'string') { params.push(weekday); sets.push(`"weekday" = $${params.length}`); }
  if (typeof unit === 'string') { params.push(unit); sets.push(`"unit" = $${params.length}`); }
  if (typeof unitetype === 'string') { params.push(unitetype); sets.push(`"unitetype" = $${params.length}`); }
  if (typeof lessonCode === 'string') { params.push(lessonCode); sets.push(`"lessonCode" = $${params.length}`); }
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD' });
    params.push(date); sets.push(`"date" = $${params.length}::date`);
  }
  if (typeof lessonCreated !== 'undefined') {
    // accept 'true'/'false'/'1'/'0' or boolean
    let val = lessonCreated;
    if (typeof val === 'string') {
      val = val.trim().toLowerCase();
      if (val === '1') val = true; else if (val === '0') val = false; else if (val === 'true') val = true; else if (val === 'false') val = false;
    }
    params.push(val === true);
    sets.push(`"lessonCreated" = $${params.length}::boolean`);
  }

  // ==== New fields logic ====
  if (typeof subject === 'string') {
    params.push(subject);
    sets.push(`"subject" = $${params.length}`);
  }
  if (typeof start_time === 'string') {
    params.push(start_time);
    sets.push(`"start_time" = $${params.length}::time`);
  }
  if (typeof end_time === 'string') {
    params.push(end_time);
    sets.push(`"end_time" = $${params.length}::time`);
  }
  if (typeof sectioninfo === 'string') {
    params.push(sectioninfo);
    sets.push(`"sectioninfo" = $${params.length}`);
  }
  if (typeof notes === 'string') {
    params.push(notes);
    sets.push(`"notes" = $${params.length}`);
  }
  if (typeof duration === 'number' && !Number.isNaN(duration)) {
    params.push(duration);
    sets.push(`"duration" = $${params.length}`);
  }
  if (typeof is_module !== 'undefined') {
    let v = is_module;
    if (typeof v === 'string') {
      v = v.trim().toLowerCase();
      if (v === '1') v = true;
      else if (v === '0') v = false;
      else if (v === 'true') v = true;
      else if (v === 'false') v = false;
    }
    params.push(v === true);
    sets.push(`"is_module" = $${params.length}::boolean`);
  }

  // ==== Inserted logic for week_number and term ====
  if (typeof week_number !== 'undefined') {
    let v = week_number;
    if (typeof v === 'string') v = parseInt(v, 10);
    if (!Number.isNaN(v)) {
      params.push(v);
      sets.push(`"week_number" = $${params.length}`);
    }
  }

  if (typeof term !== 'undefined') {
    let v = term;
    if (typeof v === 'string') v = parseInt(v, 10);
    if (!Number.isNaN(v)) {
      params.push(v);
      sets.push(`"term" = $${params.length}`);
    }
  }
  // ==== End inserted logic ====

  if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

  params.push(id);
  const sql = `UPDATE "generatedyearplan"
                 SET ${sets.join(', ')}
               WHERE "id" = $${params.length}
               RETURNING "id",
                         TO_CHAR("date", 'YYYY-MM-DD') AS "date",
                         "weekday","unit","unitetype","lessonCreated","lessonCode"`;
  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error('Error updating generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /generatedyearplan - create new row
app.post('/generatedyearplan', async (req, res) => {
  const {
    week_number,
    date,
    weekday,
    start_time,
    end_time,
    subject,
    unit,
    sectioninfo,
    unitetype,
    notes,
    duration,
    is_module,
    term,
    lessonCreated,
    lessonCode
  } = req.body || {};

  try {
    const sql = `
      INSERT INTO "generatedyearplan"
      ("week_number","date","weekday","start_time","end_time","subject",
       "unit","sectioninfo","unitetype","notes","duration","is_module",
       "term","lessonCreated","lessonCode")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING "id",
                TO_CHAR("date", 'YYYY-MM-DD') AS "date",
                "weekday","unit","unitetype","lessonCreated","lessonCode";
    `;
    const params = [
      week_number || null,
      date || null,
      weekday || null,
      start_time || null,
      end_time || null,
      subject || null,
      unit || null,
      sectioninfo || null,
      unitetype || null,
      notes || null,
      duration || null,
      is_module || null,
      term || null,
      lessonCreated != null ? lessonCreated : null,
      lessonCode || null
    ];
    const { rows } = await pool.query(sql, params);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error inserting into generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /generatedyearplan/:id - delete row
app.delete('/generatedyearplan/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const result = await pool.query(
      'DELETE FROM "generatedyearplan" WHERE "id" = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error('Error deleting from generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
 

app.get("/students/search", async (req, res) => {
    const name = req.query.name || "";
    console.log("Received search for:", name); // 🔍 log input

    try {
        const result = await pool.query(
            `SELECT "Students"."ID", "Students"."First_Name", "Students"."Sirname"
       FROM "Students"
       WHERE "Students"."First_Name" ILIKE $1 OR "Students"."Sirname" ILIKE $1
       ORDER BY "Students"."First_Name"`,
            [`%${name}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Search query failed:", err);
        res.status(500).json({ error: "Failed to fetch students" });
    }
});

app.get('/students', async (req, res) => {
    const className = req.query.className; // e.g., "11 Б"
    if (!className) return res.status(400).json({ error: 'Missing className parameter' });

    const cls = parseInt(className); // gets 11 from "11 А"
    const div = className.substring(className.indexOf(' ') + 1); // gets "А"

    console.log(`Parsed class: ${cls}, division: ${div}`);
    try {
        const result = await pool.query(
            `SELECT "ID" AS id, "First_Name" AS first_name, "Sirname" AS sirname FROM "Students" WHERE "Grade" = $1 AND "Division" = $2 ORDER BY "First_Name", "Sirname";`,
            [cls, div]
        );
       
        console.log(`🎓 Students retrieved for ${cls} ${div}:`, result.rows);

        res.json(result.rows);
    } catch (err) {
        console.error('Error querying students:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post("/submit-activity", async (req, res) => {
    const { activity } = req.body;

    if (!Array.isArray(activity)) {
        return res.status(400).json({ error: "Invalid format" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const entry of activity) {
            await client.query(
                `INSERT INTO "Activity_In_Class" ("Students_ID", "Date", "Activity_status")
         VALUES ($1, $2, $3)
         ON CONFLICT ("Students_ID", "Date")
         DO UPDATE SET "Activity_status" = EXCLUDED."Activity_status"`,
                [entry.student_id, entry.date, entry.mark]
            );
           
        }
        // Extract class info from request 
        const className = req.body.className || "Unknown";
        const date = req.body.activity?.[0]?.date || null; // or however you're extracting the activity date
        await client.query(
            `INSERT INTO "Class_Submission_Log" ("Class","Assigned_At") VALUES ($1,$2)`,
            [className,date]
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error saving activity:", err);
        res.status(500).json({ error: "Database error" });

    } finally {
        client.release();
    }
});



app.get("/submission-logs", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT "Class", 
             TO_CHAR("Assigned_At", 'YYYY-MM-DD') AS "assigned_at",
             TO_CHAR("Inserted_At", 'YYYY-MM-DD HH24:MI') AS "inserted_at"
      FROM "Class_Submission_Log"
      ORDER BY "Inserted_At" DESC
      LIMIT 20
    `);
        res.json(result.rows);
    } catch (err) {
        console.error("Failed to fetch submission logs:", err);
        res.status(500).json({ error: "Failed to fetch submission logs" });
    }
});


app.get("/resources/keywords", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT 
        r."ID", 
        r."KeyWords", 
        rt."Type" AS "SourceType"
      FROM 
        "Resources" r
      JOIN 
        "ResourceType" rt 
      ON 
        r."SourceType" = rt."ID"
      ORDER BY 
        r."KeyWords"
    `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching keywords:", err);
        res.status(500).send("Error fetching resources.");
    }
});


app.post("/custom-upload", upload.fields([
  { name: "file1", maxCount: 1 },
  { name: "file2", maxCount: 1 }
]), async (req, res) => {
  const name = req.body.name; // Should be like '001_005_002'
  const baseDir = "/Users/viktorvelkov/Documents/AssignementConditions+Solutions";
  let renamed = false;

  if (!name) {
    return res.status(400).json({ error: "Missing file name." });
  }

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const savedFiles = [];
    let flag = true;

    let textFileFullPath = null;
    let solutionFileFullPath = null;

    const saveFile = (file, suffix) => {
      const ext = path.extname(file.originalname);
      const baseName = `${name}_${suffix}`;
      let fullPath = path.join(baseDir, baseName + ext);
      let counter = 1;

      // Avoid overwriting existing files
      while (fs.existsSync(fullPath)) {
        fullPath = path.join(baseDir, `${baseName}_${counter}${ext}`);
        counter++;
        renamed = true;
      }

      fs.writeFileSync(fullPath, file.buffer);
      if (suffix === 't') textFileFullPath = fullPath;
      if (suffix === 's') solutionFileFullPath = fullPath;
      savedFiles.push(path.basename(fullPath));
    };
 
    if (req.files.file1?.[0]) {
        saveFile(req.files.file1[0], 't'); // _t = assignment condition
        flag = false;
    }

    if (req.files.file2?.[0]) {
      saveFile(req.files.file2[0], 's'); // _s = solution 
    }

    if (savedFiles.length === 0) {
      return res.status(400).json({ error: "No files were uploaded." });
    }

// 🔁 Increment multiple_solutions if file was renamed (count > 1)
    if (renamed && flag) {
        try {
            const updateQuery = `
                UPDATE "Exercises"
                SET "multiple_solutions" = COALESCE("multiple_solutions", 1) + 1
                WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3
            `;
            await pool.query(updateQuery, [
                req.body.resourceID,
                req.body.page,
                req.body.number
                ]);
            console.log("🔁 multiple_solutions incremented.");
        } catch (err) {
            console.error("❌ Failed to increment multiple_solutions:", err);
        }
    }

    return res.status(200).json({
      message: "Upload complete.",
      savedFiles,
      text_filepath: textFileFullPath,
      solution_filepath: solutionFileFullPath
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "File saving failed." });
  }
});

app.post("/exercises", async (req, res) => {
    const {
        number,
        page,
        resourceID,
        difficulty,
        date_last_solved,
        for_revision,
        has_assignmentCondition,
        has_solution,
        commentsArray,
        text_filepath,
        solution_filepath
    } = req.body;
    
    console.log(solution_filepath);
    console.log(text_filepath);
    
    try {
    
        const result = await pool.query(
            `INSERT INTO "Exercises"
           ("Number", "Page", "ResourceID", "difficulty", "date_last_solved", "for_revision",
            "has_assignmentCondition", "has_solution", "comments", "text_filepath", "solution_filepath")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING "ID"`,
            [
                number,
                page,
                resourceID,
                difficulty,
                date_last_solved,
                for_revision,
                has_assignmentCondition,
                has_solution,
                commentsArray,
                text_filepath,
                solution_filepath
            ]
        );

         const exerciseId = result.rows[0].ID;

        // 2️⃣ Вмъкване и в exercises_snippets_relationship
        await client.query(
            `INSERT INTO "exercises_snippets_relationship" 
             ("resource", "number", "page")
             VALUES ($1, $2, $3)`,
            [resourceID, number, page]
        );

        await client.query("COMMIT");

        res.status(201).json({ id: exerciseId });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("DB insert error:", err);
        res.status(500).send("❌ Failed to insert into Exercises and relationship table");
    } finally {
        client.release();
    }
});
// Search relationships by relatedSnippet only
app.get('/exercises-rel/search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.json([]);

  // приемаме няколко ID-та, разделени със запетаи, интервали или ; 
  const ids = qRaw
    .split(/[\s,;]+/)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isInteger(n));

  if (!ids.length) return res.json([]);

  try {
    const { rows } = await pool.query(
      `SELECT "resource","number","page","relatedSnippet","comments"
         FROM "exercises_snippets_relationship"
         WHERE "relatedSnippet" = ANY($1::int[])
         ORDER BY "resource","relatedSnippet"
         LIMIT 200`,
      [ids]
    );
    res.json(rows);
  } catch (err) {
    console.error('exercises-rel/search failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /assessment-log — запис в таблица "assesment_log"
app.post('/assessment-log', async (req, res) => {
  const { class: rawClass, class_division, lesson_tripplet, className } = req.body || {};
  console.log('📥 /assessment-log payload:', req.body);

  // Парсиране на class от число или низ („11“, „11 А“)
  let cls = null;
  if (Number.isInteger(rawClass)) {
    cls = rawClass;
  } else if (typeof rawClass === 'string') {
    const m = rawClass.match(/\d+/);
    if (m) cls = parseInt(m[0], 10);
  } else if (typeof className === 'string') {
    const m = className.match(/\d+/);
    if (m) cls = parseInt(m[0], 10);
  }

  // Триплетът трябва да е непразен низ и да не е шаблон като ${...}
  let triplet = null;
  if (typeof lesson_tripplet === 'string') {
    const t = lesson_tripplet.trim();
    if (t && !(t.startsWith('${') && t.endsWith('}'))) triplet = t;
  }

  const div = (typeof class_division === 'string') ? class_division : '';

  // ❗ Строга валидация — НЕ записваме ако липсват стойности
  if (!Number.isInteger(cls) || !triplet) {
    console.warn('⚠️ /assessment-log validation failed:', { cls, triplet });
    return res.status(400).json({
      error: 'Invalid payload',
      details: { class_received: rawClass, parsed_class: cls, class_division: div, lesson_tripplet }
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO "assesment_log" ("timedAt","class","class_division","lesson_tripplet")
       VALUES (NOW(), $1, $2, $3)
       RETURNING "id",
                 TO_CHAR("timedAt", 'YYYY-MM-DD HH24:MI:SS') AS "timed_at",
                 "class","class_division","lesson_tripplet"`,
      [cls, div, triplet]
    );
    res.status(201).json({ ok: true, log: rows[0] });
  } catch (err) {
    console.error('Error inserting into assesment_log:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /assessment-log — list recent submissions (optional filters: className, triplet)
app.get('/assessment-log', async (req, res) => {
  const className = req.query.className || '';
  const triplet = req.query.triplet || '';
  // Parse class number and division
  let cls = null, div = '';
  if (className){
    cls = parseInt(className, 10);
    if (className.includes(' ')) div = className.substring(className.indexOf(' ') + 1).trim();
  }
  const where = [];
  const params = [];
  if (Number.isInteger(cls)) { params.push(cls); where.push(`"class" = $${params.length}`); }
  if (div) { params.push(div); where.push(`"class_division" ILIKE $${params.length}`); }
  if (triplet) { params.push(triplet); where.push(`"lesson_tripplet" = $${params.length}`); }

  const sql = `SELECT id,
                      TO_CHAR("timedAt", 'YYYY-MM-DD HH24:MI') AS timedAt,
                      "class","class_division","lesson_tripplet"
               FROM "assesment_log"
               ${where.length?('WHERE '+where.join(' AND ')):''}
               ORDER BY "timedAt" DESC, id DESC
               LIMIT 100`;
  try{
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }catch(err){
    console.error('GET /assessment-log failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch("/update-exercise", async (req, res) => {
  const { id, field, value } = req.body;

  const appendFields = ["comments", "date_last_solved", "for_revision"];
  const allowedFields = [
    "Difficulty",
    "multiple_solutions",
    "has_solution",
    "has_assignmentCondition",
    ...appendFields
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }
  
  try {
    // let query, params;

    // if (appendFields.includes(field)) {
    //   // Detect type and cast accordingly
    //   let castType = "text";
    //   if (field === "date_last_solved" || field === "for_revision") {
    //       console.log(params);
    // if (field === "date_last_solved" || field === "for_revision") {
    // query = `
    //     UPDATE "Exercises"
    //     SET "${field}" = array_append(COALESCE("${field}", '{}'::date[]), $1::date)
    //     WHERE "ID" = $2 RETURNING *`;
    // params = [value, id];
    // }
    //   }
    // else if (field === "comments") {
    //     query = `
    //         UPDATE "Exercises"
    //         SET "comments" = $1::text[]
    //         WHERE "ID" = $2 RETURNING *`;
    //     params = [value, id];
    //     }
    //   else {
    //   console.log("can i get a heyo")
    //         query = `
    //     UPDATE "Exercises"
    //     SET "${field}" = $1
    //     WHERE "ID" = $2 RETURNING *`;
    //     params = [value, id];    }
    // } 
        let query, params;

        if (appendFields.includes(field)) {
        if (field === "date_last_solved" || field === "for_revision") {
            query = `
            UPDATE "Exercises"
            SET "${field}" = array_append(COALESCE("${field}", '{}'::date[]), $1::date)
            WHERE "ID" = $2 RETURNING *`;
            params = [value, id];
        } else if (field === "comments") {
            query = `
            UPDATE "Exercises"
            SET "comments" = $1::text[]
            WHERE "ID" = $2 RETURNING *`;
            params = [value, id];
        }
        } else {
        // All other fields, including has_assignmentCondition
        query = `
            UPDATE "Exercises"
            SET "${field}" = $1
            WHERE "ID" = $2 RETURNING *`;
        params = [value, id];
        }
            const result = await pool.query(query, params);
            res.json(result.rows[0]);
        } catch (err) {
            console.error("❌ DB update error:", err);
            res.status(500).json({ error: "Update failed" });
        }
        });

app.get("/exercise-details", async (req, res) => {
  const { resourceID, page, number } = req.query;

  if (!resourceID || !page || !number) {
    return res.status(400).json({ error: "Missing query parameters" });
  }

  try {
    const result = await pool.query(
      `SELECT 
            "ID", "Number", "Page", "ResourceID", "difficulty",
            ARRAY(
                SELECT TO_CHAR(d, 'YYYY-MM-DD')
                FROM UNNEST("date_last_solved") AS d
            ) AS "date_last_solved",
            ARRAY(
                SELECT TO_CHAR(r, 'YYYY-MM-DD')
                FROM UNNEST("for_revision") AS r
            ) AS "for_revision",
            "has_assignmentCondition", "has_solution", "comments", "multiple_solutions"
            FROM "Exercises"
            WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3`,
      [resourceID, page, number]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Exercise not found" });
    }
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Failed to retrieve exercise." });
  }
});

// Lightweight search by ID or triple (ResourceID-Page-Number OR Number-Page-ResourceID)
app.get('/exercises/search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.json([]);

  // helper
  const tripleRe = /^0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)$/;

  try {
    // Case 1: pure numeric -> treat as ID
    if (/^\d+$/.test(qRaw)) {
      const { rows } = await pool.query(
        `SELECT "ID","ResourceID","Page","Number",
                "has_assignmentCondition","has_solution","multiple_solutions",
                "text_filepath","solution_filepath"
           FROM "Exercises"
          WHERE "ID" = $1
          LIMIT 50`,
        [parseInt(qRaw, 10)]
      );
      return res.json(rows);
    }

    // Case 2: triple with separators
    const m = qRaw.match(tripleRe);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const c = parseInt(m[3], 10);
      const { rows } = await pool.query(
        `SELECT "ID","ResourceID","Page","Number",
                "has_assignmentCondition","has_solution","multiple_solutions",
                "text_filepath","solution_filepath"
           FROM "Exercises"
          WHERE ("ResourceID" = $1 AND "Page" = $2 AND "Number" = $3)
             OR ("Number" = $1 AND "Page" = $2 AND "ResourceID" = $3)
          LIMIT 50`,
        [a, b, c]
      );
      return res.json(rows);
    }

    // Otherwise return empty
    return res.json([]);
  } catch (err) {
    console.error('exercises/search failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post("/schedule/save", async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "Invalid data format." });

  const query = `
    INSERT INTO "scheduleentries" (
      start_year, end_year, term, weekday, start_time, end_time, subject, recurrence, week_parity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const entry of entries) {
      const {
        start_year,
        end_year,
        term,
        weekday,
        start_time,
        end_time,
        subject,
        recurrence,
        week_parity
      } = entry;

      if (
        !start_year || !end_year || !term || !weekday ||
        !start_time || !end_time || !subject
      ) continue;

      await client.query(query, [
        start_year,
        end_year,
        term,
        weekday,
        start_time,
        end_time,
        subject,
        recurrence || "WEEKLY",
        week_parity || 1
      ]);
    }

    await client.query("COMMIT");
    res.json({ message: "Schedule saved successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error saving schedule:", err);
    res.status(500).json({ error: "Failed to save schedule." });
  } finally {
    client.release();
  }
});

// GET /schedule/available-years-scheduleentries — само уникални start_year–end_year от scheduleentries
app.get('/schedule/available-years-scheduleentries', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT
        start_year::int AS start_year,
        end_year::int   AS end_year
      FROM "scheduleentries"
      WHERE start_year IS NOT NULL
        AND end_year   IS NOT NULL
      ORDER BY start_year DESC, end_year DESC;
    `);
    res.json(rows);
  } catch (e) {
    console.error('available-years-scheduleentries failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});


// POST /schedule/apply-distribution-smart
// Body: { subject, start, end }
// Чете CSV от 'разпределения/<razpredelenie>' според currentSchedule за subject.
// Колони: 1) Учебна седмица (число), 2) Тема -> unit, 3) Вид -> unitetype.
// Разпределя по week_number: за всеки ред от generatedyearplan в дадена седмица се взима
// следваща тема за същата седмица. sectioninfo се попълва “Седмица X, №k”.
app.post('/schedule/apply-distribution-smart', async (req, res) => {
  const { subject, start, end } = req.body || {};
  if (!subject || !start || !end) {
    return res.status(400).json({ error: 'Missing subject/start/end' });
  }

  try {
    // 1) файл от currentSchedule
    const cs = await pool.query(
      `SELECT "razpredelenie"
         FROM "currentSchedule"
        WHERE ("class" || ' ' || COALESCE("division", '')) = $1
        LIMIT 1`,
      [subject]
    );
    const fileName = cs.rows?.[0]?.razpredelenie;
    if (!fileName) {
      return res.status(404).json({ error: `No razpredelenie for subject ${subject}` });
    }

    // 2) прочит на CSV/Numbers-експорт
    const csvPath = path.join(__dirname, 'разпределения', fileName);
    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({ error: `CSV not found: ${csvPath}` });
    }
    let raw = fs.readFileSync(csvPath, 'utf8').replace(/\uFEFF/g, ''); // махни BOM
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // очакваме хедър в първия ред; ще го прескочим ако първата колона не е число
    const csv = [];
    for (const line of lines) {
      const parts = (line.includes(';') ? line.split(';') : line.split(',')).map(s => s.trim());
      if (parts.length < 2) continue;
      const tema = parts[1] || '';
      const vid  = (parts[2] || '').toUpperCase();

      // Пропускаме хедъра или редове с "Тема" в колоната
      if (!tema || /^тема$/i.test(tema)) continue;

      csv.push({ unit: tema, unitetype: vid });
    }
    if (csv.length === 0) {
      return res.status(400).json({ error: 'CSV parsed but contains no usable rows (check delimiter and columns)' });
    }

    // 3) вземи редовете от generatedyearplan за subject в диапазона
    const { rows: plan } = await pool.query(
      `SELECT id, TO_CHAR("date",'YYYY-MM-DD') AS d, "start_time"
       FROM "generatedyearplan"
       WHERE "subject" = $1
         AND "date" BETWEEN $2::date AND $3::date
       ORDER BY "date","start_time","id"`,
      [subject, start, end]
    );
    if (plan.length === 0) {
      return res.json({ ok: true, updated: 0, note: 'No generated rows in range' });
    }

    // ---- Sequential assignment logic ----
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Prepare lesson list in order of appearance
      const lessons = csv.filter(r => r.unit).map(r => ({
        unit: r.unit,
        unitetype: r.unitetype
      }));

      let idx = 0;
      let updated = 0;

      // Assign each CSV lesson sequentially to generatedyearplan
      for (const row of plan) {
        if (idx >= lessons.length) break;
        const { unit, unitetype } = lessons[idx];
        const sectioninfo = `№${idx + 1}`;
        const isModule = /модул/i.test(unit) || /модул/i.test(unitetype);

        await client.query(`
          UPDATE "generatedyearplan"
            SET "unit" = $1,
                "unitetype" = NULLIF($2,'')::text,
                "sectioninfo" = $3,
                "is_module" = CASE WHEN $4 THEN TRUE ELSE "is_module" END
          WHERE id = $5
        `, [unit, unitetype, sectioninfo, isModule, row.id]);

        idx++;
        updated++;
      }

      await client.query('COMMIT');
      console.log(`Sequentially assigned ${updated} lessons from CSV`);
      res.json({ ok: true, updated, totalSlots: plan.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('apply-distribution-smart failed:', e);
      return res.status(500).json({ error: 'DB error applying distribution' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('apply-distribution-smart error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// GET /student-threads?studentID=123  -> списък с налични нишки за ученика
app.get('/student-threads', async (req, res) => {
  const sid = parseInt(req.query.studentID, 10);
  if (!Number.isInteger(sid)) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT "threadID"
         FROM "student_assessment_skills_exercises"
        WHERE "studentID" = $1 AND "threadID" IS NOT NULL AND "threadID" <> ''
        ORDER BY "threadID" ASC
        LIMIT 500`,
      [sid]
    );
    res.json(rows.map(r => r.threadid || r.threadID));
  } catch (e) {
    console.error('GET /student-threads failed:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /student-threads/new { studentID } -> генерира нов thread: <ID>-<10 знака>
app.post('/student-threads/new', express.json(), async (req, res) => {
  const sid = parseInt((req.body||{}).studentID, 10);
  if (!Number.isInteger(sid)) return res.status(400).json({ error: 'Invalid studentID' });
  const rand = [...Array(10)].map(() => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return chars[Math.floor(Math.random()*chars.length)];
  }).join('');
  const thread = `${sid}-${rand}`;
  // няма нужда от запис в БД – нишката ще „живее“ когато се използва за първи път
  res.json({ thread });
});

// POST /threads/create { studentID:number, baseIds:number[], threadID?:string }
app.post('/threads/create', async (req, res) => {
  const { studentID, baseIds, threadID } = req.body || {};
  const sid = parseInt(studentID, 10);
  const ids = Array.isArray(baseIds) ? baseIds.map(n=>parseInt(n,10)).filter(Number.isInteger) : [];
  if (!Number.isInteger(sid) || ids.length === 0) {
    return res.status(400).json({ error: 'Missing studentID or baseIds' });
  }
  // Generate thread id if missing: <studentID>-<10alnum>
  function randomKey(len){
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s=''; for(let i=0;i<len;i++) s += abc[Math.floor(Math.random()*abc.length)];
    return s;
  }
  const tid = (typeof threadID === 'string' && threadID.trim() !== ''
              ? threadID.trim()
              : `${sid}-${randomKey(10)}`);

  // recursive closure of follow-ups chain restricted to this student
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const sql = `
      WITH RECURSIVE chain AS (
        SELECT id, "followup_id"
          FROM "student_assessment_skills_exercises"
         WHERE "studentID" = $1 AND id = ANY($2::int[])
        UNION ALL
        SELECT s.id, s."followup_id"
          FROM "student_assessment_skills_exercises" s
          JOIN chain c ON s."followup_id" = c.id
         WHERE s."studentID" = $1
      )
      UPDATE "student_assessment_skills_exercises" AS t
         SET "threadID" = $3
        FROM (SELECT id FROM chain) u
       WHERE t.id = u.id
       RETURNING t.id;`;
    const r = await client.query(sql, [sid, ids, tid]);
    await client.query('COMMIT');
    return res.json({ ok:true, threadID: tid, updatedIds: r.rows.map(x=>x.id) });
  }catch(e){
    await client.query('ROLLBACK');
    console.error('threads/create failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }finally{
    client.release();
  }
});

// =========================
// Lessons Library Updated API
// =========================

// Convert absolute local paths (under /Users/viktorvelkov/Documents) to a public URL served by:
// app.use('/files', express.static('/Users/viktorvelkov/Documents'))
function toPublicFileUrl(p){
  const v = (p == null) ? '' : String(p).trim();
  if (!v) return null;

  // Already a web URL or already mapped
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/files/')) return v;

  const base = '/Users/viktorvelkov/Documents';
  if (v.startsWith(base)) {
    const rest = v.slice(base.length);
    return '/files' + (rest.startsWith('/') ? rest : '/' + rest);
  }

  // If it is a relative path, return as-is for now
  return v;
}

// GET /api/lessons  -> list lessons for lessonsLibraryUpdated_index.js
app.get('/api/lessons', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lesson_id, name, filepath, url, description, description2
         FROM "Lessons"
        ORDER BY updated_at DESC NULLS LAST, lesson_id DESC
        LIMIT 1000`
    );

    // Normalize paths to public URLs when possible
    const normalized = rows.map(r => {
      const fileUrl = toPublicFileUrl(r.url || r.filepath);
      return {
        lesson_id: r.lesson_id,
        name: r.name,
        description: r.description,
        description2: r.description2,
        // UI uses (url ?? filepath) to open a file.
        // If url is empty, put mapped filepath into url so the button works.
        url: (r.url && String(r.url).trim()) ? String(r.url).trim() : (fileUrl || null),
        filepath: r.filepath ? String(r.filepath) : null
      };
    });

    return res.json(normalized);
  } catch (e) {
    console.error('GET /api/lessons failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/lessons/:id/photos -> exercise photos for a lesson
app.get('/api/lessons/:id/photos', async (req, res) => {
  try {
    const lessonId = parseInt(req.params.id, 10);
    if (!Number.isInteger(lessonId)) return res.status(400).json({ error: 'Invalid lesson id' });

    const { rows } = await pool.query(
      `SELECT
         ls.position,
         e."ID" AS exercise_id,
         e.text_filepath,
         e.solution_filepath
       FROM lesson_scripted ls
       JOIN "Exercises" e ON e."ID" = ls.item_id
       WHERE ls.lesson_id = $1
         AND ls.item_type = 'exercise'
       ORDER BY ls.position ASC NULLS LAST, ls.id ASC`,
      [lessonId]
    );

    const out = rows.map(r => ({
      position: r.position,
      exercise_id: r.exercise_id,
      text: toPublicFileUrl(r.text_filepath),
      solution: toPublicFileUrl(r.solution_filepath)
    }));

    return res.json(out);
  } catch (e) {
    console.error('GET /api/lessons/:id/photos failed:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});