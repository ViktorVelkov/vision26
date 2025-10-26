// index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
// === Sticky Notes file storage ===
const STICKY_DIR = path.join(__dirname, 'sticky-notes');
try { fs.mkdirSync(STICKY_DIR, { recursive: true }); } catch(e) { console.warn('sticky dir mkdir failed:', e && e.message ? e.message : e); }
function stickyFileFromKey(key){
  const safe = (String(key||'default')).replace(/[^a-z0-9_-]+/gi,'-').slice(0,60) || 'default';
  return path.join(STICKY_DIR, safe + '.json');
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

app.use("/api", scheduleRouter);
app.use(cors());
app.use(express.json());
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
app.use('/files', express.static('/Users/viktorvelkov/Documents'));
app.use("/holidays", holidayRouter);
app.use("/", scheduleSelectionRouter);
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
 * GET /lesson-skills-merged?triplet=001001001
 * Returns Snippets for the given triplet, **union** with any Snippets whose IDs appear
 * in the "Lessons".theory_snippets for the lesson with this tripplet_id.
 * This version validates that theory_snippets IDs exist in Snippets and only returns existing ones.
 */
app.get('/lesson-skills-merged', async (req, res) => {
  const triplet = req.query.triplet;
  if (!triplet) return res.status(400).json({ error: 'Missing triplet parameter' });
  try {
    // 1) Load theory_snippets for the lesson (if any) and coerce to ints
    let theoryIds = [];
    try {
      const t = await pool.query(`SELECT theory_snippets FROM "Lessons" WHERE tripplet_id = $1 LIMIT 1`, [triplet]);
      if (t.rows && t.rows[0] && Array.isArray(t.rows[0].theory_snippets)) {
        theoryIds = t.rows[0].theory_snippets.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n));
      }
    } catch (e) {
      console.warn('lesson-skills-merged: theory_snippets query failed', e && e.message ? e.message : e);
    }

    // 2) Fail-safe: keep only IDs that exist in Snippets
    let validIds = [];
    if (theoryIds.length > 0) {
      try {
        const chk = await pool.query(`SELECT id FROM "Snippets" WHERE id = ANY($1::int[])`, [theoryIds]);
        validIds = chk.rows.map(r => r.id).filter(n => Number.isInteger(n));
      } catch (e) {
        console.warn('lesson-skills-merged: validate snippet ids failed', e && e.message ? e.message : e);
      }
    }

    // 3) Fetch Snippets by triplet match OR id in validated list
    const params = [triplet];
    const hasValid = validIds.length > 0;
    if (hasValid) params.push(validIds);

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
      WHERE (s."tripplet_lesson" = $1::text OR $1::text = ANY (s."lessons_in_tripplets"))
         ${hasValid ? ' OR s."id" = ANY($2::int[])' : ''}
      ORDER BY s."id" ASC`;

    const { rows } = await pool.query(sql, params);

    // 4) Deduplicate by id (in case of overlap)
    const seen = new Set();
    const merged = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }

    res.json(merged);
  } catch (err) {
    console.error('Error in /lesson-skills-merged:', err);
    res.status(500).json({ error: 'Internal server error' });
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

    // Enhanced SQL to support follow-up, thread, and follow-up explanation columns
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
  ("lessonTriplet","isSnippet","componentID","assessment","comment","studentID","followup_exp","followup_id","threadID","entryTime")
SELECT "lessonTriplet","isSnippet","componentID","assessment","comment","studentID","followup_exp","followup_id","threadID", NOW()
FROM src
RETURNING id,"lessonTriplet","isSnippet","componentID","assessment","comment","studentID","followup_exp","followup_id","threadID","entryTime";
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
                       : (r.id != null ? r.id : null))));
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

    console.log("POST /student-assessment-skills-exercises sample row:",
      Array.isArray(rows) && rows[0] ? rows[0] : null,
      "keys=", Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : []
    );
    console.log("normalized sample:", normRows[0], "keys=", Object.keys(normRows[0] || {}));

    const payloadJson = JSON.stringify(normRows);

    const result = await client.query(sql, [payloadJson]);

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

// POST /lessons — create a new lesson (only provided fields)
app.post('/lessons', async (req, res) => {
  const body = req.body || {};
  const fields = {
    tripplet_id: typeof body.tripplet_id === 'string' ? body.tripplet_id.trim() : null,
    description: typeof body.description === 'string' ? body.description.trim() : null,
    url: typeof body.url === 'string' ? body.url.trim() : null,
    filepath: typeof body.filepath === 'string' ? body.filepath.trim() : null,
    class: Number.isInteger(body.class) ? body.class : (typeof body.class === 'string' && body.class.trim()!=='' ? parseInt(body.class,10) : null),
    theory_snippets: Array.isArray(body.theory_snippets) ? body.theory_snippets.filter(n=>Number.isInteger(n)) : [],
    exercises_ids: Array.isArray(body.exercises_ids) ? body.exercises_ids.map(String) : []
  };

  // Dynamic insert: include only keys that have non-null / non-empty values
  const cols = [];
  const params = [];
  const placeholders = [];
  const casts = { theory_snippets:'integer[]', exercises_ids:'text[]' };

  Object.entries(fields).forEach(([k,v])=>{
    if (v === null) return;
    if (Array.isArray(v) && v.length === 0) return;
    cols.push(`"${k}"`);
    params.push(v);
    const cast = casts[k] ? `::${casts[k]}` : '';
    placeholders.push(`$${params.length}${cast}`);
  });

  if (cols.length === 0) {
    return res.status(400).json({ error: 'No fields provided' });
  }

  const sql = `INSERT INTO "Lessons" (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING lesson_id`;

  try{
    const r = await pool.query(sql, params);
    const newId = r.rows[0].lesson_id;
    try{ await pool.query('INSERT INTO lessons_actions(lesson_id, action) VALUES ($1, $2)', [newId, 'new']); }catch(_e){ console.error('log insert failed (new):', _e); }
    res.status(201).json({ ok:true, lesson_id: newId });
  }catch(err){
    console.error('POST /lessons failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// PATCH /lessons/:id — update provided fields only
app.patch('/lessons/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const body = req.body || {};
  const fields = {
    tripplet_id: typeof body.tripplet_id === 'string' ? body.tripplet_id.trim() : null,
    description: typeof body.description === 'string' ? body.description.trim() : null,
    url: typeof body.url === 'string' ? body.url.trim() : null,
    filepath: typeof body.filepath === 'string' ? body.filepath.trim() : null,
    class: Number.isInteger(body.class) ? body.class : (typeof body.class === 'string' && body.class.trim()!=='' ? parseInt(body.class,10) : null),
    theory_snippets: Array.isArray(body.theory_snippets) ? body.theory_snippets.filter(n=>Number.isInteger(n)) : undefined,
    exercises_ids: Array.isArray(body.exercises_ids) ? body.exercises_ids.map(String) : undefined
  };

  const sets = [];
  const params = [];
  const casts = { theory_snippets:'integer[]', exercises_ids:'text[]' };

  for (const [k,v] of Object.entries(fields)){
    if (typeof v === 'undefined') continue; // skip not provided arrays
    if (v === null) { sets.push(`"${k}" = NULL`); continue; }
    params.push(v);
    const cast = casts[k] ? `::${casts[k]}` : '';
    sets.push(`"${k}" = $${params.length}${cast}`);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No fields provided' });

  try{
    const sql = `UPDATE "Lessons" SET ${sets.join(', ')} WHERE lesson_id = $${params.length+1} RETURNING lesson_id`;
    params.push(id);
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    try{ await pool.query('INSERT INTO lessons_actions(lesson_id, action) VALUES ($1, $2)', [id, 'updated']); }catch(_e){ console.error('log insert failed (updated):', _e); }
    res.json({ ok:true, lesson_id: id });
  }catch(err){
    console.error('PATCH /lessons/:id failed:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /lessons/by-search?q=... — search lesson by source token prefix or tripplet prefix
app.get('/lessons/by-search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.status(400).json({ error: 'Missing q' });
  const digits = qRaw.replace(/\D+/g,'');
  const tripPref = qRaw;
  try{
    // Try source_token prefix first if we have digits
    if (digits) {
      const { rows } = await pool.query(`
        SELECT lesson_id, tripplet_id, description, class, url, filepath,
               theory_snippets, exercises_ids
          FROM "Lessons"
         WHERE CAST(source_token AS text) LIKE $1 || '%'
         ORDER BY updated_at DESC NULLS LAST, lesson_id DESC
         LIMIT 1`, [digits]);
      if (rows.length) return res.json(rows[0]);
    }
    // Fallback: tripplet_id prefix
    const { rows } = await pool.query(`
      SELECT lesson_id, tripplet_id, description, class, url, filepath,
             theory_snippets, exercises_ids
        FROM "Lessons"
       WHERE tripplet_id ILIKE $1 || '%'
       ORDER BY updated_at DESC NULLS LAST, lesson_id DESC
       LIMIT 1`, [tripPref]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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
      `SELECT l.lesson_id, l.tripplet_id, l.description, l.class
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

// Настройка на връзката към PostgreSQL

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