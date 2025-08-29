const express = require('express');
const router = express.Router();
router.use(express.json());
const pool = require('../db');
const path = require('path');
//const resourcesArray = Array.from(resourceIds);

// Helper function to update resources_used for a lesson by lessonId
/*
async function updateResourcesUsed(lessonId) {
  const sel = await dbq(`SELECT * FROM "Lessons" WHERE "lesson_id" = $1`, [lessonId]);
  if (!sel.rows.length) {
    console.log('[⚠️ No lesson found with id]', lessonId);
    return;
  }

  const lesson = sel.rows[0];
  const tokens = (lesson.exercises_ids || []).filter(x => x != null).map(String);
  const tripleRegex = /^0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)$/;
  const resourceIds = new Set();
  for (const tok of tokens) {
    const clean = String(tok)
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/[–—−‑‒]/g, '-')
      .trim();
    if (!clean) continue;
    if (/^\d+$/.test(clean)) {
      // Numeric: match by ID in Exercises
      const match = await dbq(
        `SELECT "ResourceID" FROM "Exercises" WHERE "ID" = $1`,
        [clean]
      );
      if (match.rows.length) {
        resourceIds.add(String(match.rows[0].ResourceID));
      }
    } else if (tripleRegex.test(clean)) {
      // rrr-ppp-nnn format
      const [resId, page, num] = clean.split('-').map(x => parseInt(x, 10));
      if (
        Number.isInteger(resId) &&
        Number.isInteger(page) &&
        Number.isInteger(num)
      ) {
        const match = await dbq(
          `SELECT "ResourceID" FROM "Exercises" WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3`,
          [resId, page, num]
        );
        if (match.rows.length) {
          resourceIds.add(String(match.rows[0].ResourceID));
        }
      }
    }
  }
  await dbq(
    `UPDATE "Lessons" SET "resources_used" = $1 WHERE "lesson_id" = $2`,
    [resourcesArray, lessonId]
  );
}
*/
async function dbq(sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    throw err;
  }
}

// Serve the static Lessons Library HTML
router.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'lessonsLibrary.html'));
});


// Search API: search by source_token, section_token, lesson_token parsed from q
router.get('/search', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const normalized = q.replace(/[.\-_]/g, '_');
  const parts = normalized.split('_');

  if (parts.length !== 3) {
    return res.status(400).json({ error: 'Invalid search format. Use source_section_lesson format' });
  }

  const [source_token, section_token, lesson_token] = parts.map(Number);

  try {
    const result = await dbq(
      `SELECT * FROM "Lessons" WHERE source_token = $1 AND section_token = $2 AND lesson_token = $3`,
      [source_token, section_token, lesson_token]
    );

    return res.json({ rows: result.rows });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Inline update API: update a single column by id
router.patch('/update', async (req, res) => {
  try {
    const { id, idKey, column, value } = req.body || {};

    // Force id to a string for the text-to-text WHERE comparison
    const idParam = id != null ? String(id).trim() : null;

    if (id == null || !column) {
      return res.status(400).json({ error: 'Missing id or column.' });
    }

    const whereKey = idKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idKey) ? idKey : 'lesson_id';

    // Detect real column type for this column (handles exercises_ids being int[] or text[])
    let targetUdt = '';
    try {
      const meta = await dbq(
        `SELECT udt_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2`,
        ['Lessons', column]
      );
      if (meta.rows && meta.rows[0] && meta.rows[0].udt_name) targetUdt = meta.rows[0].udt_name; // e.g., _int4, _text
    } catch (_) {}

    const INT_ARRAY_COLUMNS = new Set(['theory_snippets', 'resources_used']);
    const EXERCISES_TEXT_ARRAY = 'exercises_ids';

    // Only allow simple SQL identifiers and forbid updating the primary key column itself
    const isSafeCol = /^[A-Za-z_][A-Za-z0-9_]*$/.test(column);
    if (!isSafeCol) {
      return res.status(400).json({ error: 'Invalid column name.' });
    }
    if (column.toLowerCase() === whereKey.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot edit the primary key column.' });
    }

    let sql;
    let params;

    if (INT_ARRAY_COLUMNS.has(column)) {
      const raw = value;

      // If blank -> NULL
      if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
        sql = `UPDATE "Lessons" SET "${column}" = NULL, "updated_at" = CURRENT_TIMESTAMP
               WHERE (${whereKey})::text = ($1)::text RETURNING *`;
        params = [idParam];
      } else {
        // Parse tokens preserving delete prefixes
        let tokens = [];
        if (Array.isArray(raw)) {
          tokens = raw.map(String);
        } else if (typeof raw === 'string') {
          const t = raw.trim().replace(/[{}\[\]]/g, '');
          if (t) tokens = t.split(',');
        } else {
          tokens = [String(raw)];
        }

        const delPrefix = /^(?:-+|!+|del:)\s*/i;
        const addInts = [];
        const delInts = [];
        let hasExplicitDelete = false;

        for (let tok of tokens) {
          if (!tok) continue;
          let s = String(tok).trim();
          if (!s) continue;

          let isDelete = false;
          if (delPrefix.test(s)) {
            s = s.replace(delPrefix, '').trim();
            isDelete = true;
            hasExplicitDelete = true;
          }
          const n = parseInt(s, 10);
          if (!Number.isNaN(n)) {
            if (isDelete) delInts.push(n);
            else addInts.push(n);
          }
        }

        // Read existing array
        let existing = [];
        try {
          const sel = await dbq(
            `SELECT "${column}"::int[] AS vals FROM "Lessons" WHERE (${whereKey})::text = ($1)::text`,
            [idParam]
          );
          if (sel.rowCount) existing = Array.isArray(sel.rows[0].vals) ? sel.rows[0].vals.filter(Number.isInteger) : [];
        } catch (_) {}

        let merged;
        if (hasExplicitDelete) {
          // Use add/remove semantics when a delete prefix is present
          const delSet = new Set(delInts);
          const afterDelete = existing.filter(v => !delSet.has(v));
          merged = Array.from(new Set([...afterDelete, ...addInts])).filter(Number.isInteger);
        } else {
          // No explicit deletes -> treat provided list as full replacement
          merged = Array.from(new Set(addInts)).filter(Number.isInteger);
        }

        sql = `UPDATE "Lessons" SET "${column}" = $1::int[], "updated_at" = CURRENT_TIMESTAMP
               WHERE (${whereKey})::text = ($2)::text RETURNING *`;
        params = [merged, idParam];
      }
    } else if (column === EXERCISES_TEXT_ARRAY) {
      // Handle exercises_ids as text[] while still validating/resolving against Exercises.
      // Accept tokens like "1,2,3" or composite tuples like "RID-Page-Number" (\n, ., _, /, space allowed).
      const raw = value;

      // If blank, set to NULL
      if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
        sql = `UPDATE "Lessons" SET "${column}" = NULL, "updated_at" = CURRENT_TIMESTAMP WHERE (${whereKey})::text = ($1)::text RETURNING *`;
        params = [idParam];
      } else {
        let tokens = [];
        if (Array.isArray(raw)) {
          tokens = raw.map(x => String(x));
        } else if (typeof raw === 'string') {
          const t = raw.trim().replace(/[{}\[\]]/g, '');
          if (t.length > 0) tokens = t.split(',');
        } else {
          tokens = [String(raw)];
        }

        const idCandidates = [];
        const compositeTriples = [];
        const tripleRegex = /^(\d+)[\.\-_/\s]+(\d+)[\.\-_/\s]+(\d+)$/;

        for (let tok of tokens) {
          if (!tok) continue;
          const s = String(tok).trim();
          if (!s) continue;
          const asInt = parseInt(s, 10);
          if (!Number.isNaN(asInt) && String(asInt) === s.replace(/^\+/, '')) {
            idCandidates.push(asInt);
            continue;
          }
          const m = s.match(tripleRegex);
          if (m) {
            compositeTriples.push({ rid: parseInt(m[1], 10), page: parseInt(m[2], 10), number: parseInt(m[3], 10), raw: s });
          }
        }

        // Resolve composite triples to exercise IDs using the unique key
        let resolvedIds = [];
        if (compositeTriples.length > 0) {
          const valuesParts = [];
          const valuesParams = [];
          let p = 1;
          for (const t of compositeTriples) {
            valuesParts.push(`($${p}, $${p + 1}, $${p + 2})`);
            valuesParams.push(t.rid, t.page, t.number);
            p += 3;
          }
          const sqlResolve = `
            WITH inp("ResourceID","Page","Number") AS (
              VALUES ${valuesParts.join(', ')}
            )
            SELECT e."ID", i."ResourceID", i."Page", i."Number"
            FROM inp i
            JOIN "Exercises" e
              ON e."ResourceID" = (i."ResourceID")::int
             AND e."Page"       = (i."Page")::int
             AND e."Number"     = (i."Number")::int;
          `;
          const { rows: resRows } = await dbq(sqlResolve, valuesParams);
          const foundMap = new Map(resRows.map(r => [`${r.ResourceID}|${r.Page}|${r.Number}`, r.ID]));
          for (const t of compositeTriples) {
            const key = `${t.rid}|${t.page}|${t.number}`;
            if (!foundMap.has(key)) {
              return res.status(400).json({ error: `Exercise not found for tuple (${t.rid}, ${t.page}, ${t.number})` });
            }
            resolvedIds.push(foundMap.get(key));
          }
        }

        // Combine and deduplicate IDs
        let finalIds = Array.from(new Set([...idCandidates, ...resolvedIds]))
          .filter(n => Number.isInteger(n) && n > 0)
          .map(n => String(n)); // store as text[] of IDs for consistency

        // --- Append mode: keep old values and append new ones ---
        // Detect if we have a companion column to store raw user-entered tokens
        let hasEnteredCol = false;
        try {
          const chkEntered = await dbq(
            `SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='Lessons' AND column_name='exercises_entered'`
          );
          hasEnteredCol = chkEntered.rowCount > 0;
        } catch (_) {}

        // Fetch current stored arrays for merging
        let existingIds = [];
        let existingEntered = [];
        try {
          const sel = await dbq(
            `SELECT "${column}"::text[] AS ids${hasEnteredCol ? ", COALESCE(\"exercises_entered\", ARRAY[]::text[]) AS entered" : ''}
               FROM "Lessons" WHERE (${whereKey})::text = ($1)::text`,
            [idParam]
          );
          if (sel.rowCount) {
            existingIds = Array.isArray(sel.rows[0].ids) ? sel.rows[0].ids.filter(x => x != null) : [];
            if (hasEnteredCol) {
              existingEntered = Array.isArray(sel.rows[0].entered) ? sel.rows[0].entered.filter(x => x != null) : [];
            }
          }
        } catch (e) {
          console.warn('[LessonsLibrary.update] could not read existing arrays:', e.message);
        }

        // Prepare raw tokens list (trim and keep original form the user typed)
        const rawTokens = (tokens || [])
          .map(t => String(t).trim())
          .filter(t => t.length > 0);
        // Prepare raw tokens list (trim and keep original form the user typed)
        const rawTokensAll = (tokens || [])
          .map(t => String(t).trim())
          .filter(t => t.length > 0);

        // Split into additions and deletions. Support prefixes: '-', '!', 'del:' (case-insensitive)
        const delPrefix = /^(?:-+|!+|del:)\s*/i;
        const addTokens = [];
        const delTokens = [];
        for (const tok of rawTokensAll) {
          if (delPrefix.test(tok)) {
            const core = tok.replace(delPrefix, '').trim();
            if (core) delTokens.push(core);
          } else {
            addTokens.push(tok);
          }
        }

        // Existing stored tokens (as strings)
        const existingTokens = Array.isArray(existingIds) ? existingIds.map(String) : [];

        // Helpers to normalize tokens for semantic deletion
        const tripleNorm = (s) => {
          const m = s.match(/^0*(\d+)[\.\-_/\\s]+0*(\d+)[\.\-_/\\s]+0*(\d+)$/);
          return m ? `${parseInt(m[1],10)}|${parseInt(m[2],10)}|${parseInt(m[3],10)}` : null;
        };
        const numVal = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : null);

        // --- Implicit deletions by omission ---------------------------------------
        // If the user overwrites the cell with a full list (no explicit '-' tokens),
        // treat tokens missing from the submitted list as deletions.
        try {
          const normalize = (s) => {
            const tn = tripleNorm(s);
            if (tn) return `T:${tn}`; // tagged triple
            const nv = numVal(s);
            if (nv != null) return `N:${nv}`; // tagged numeric
            return `S:${String(s)}`; // raw string token
          };
          const submittedSet = new Set(addTokens.map(normalize));
          const implicitDel = [];
          for (const exTok of existingTokens) {
            const exN = normalize(exTok);
            if (!submittedSet.has(exN)) implicitDel.push(exTok);
          }
          if (implicitDel.length) delTokens.push(...implicitDel);
        } catch (_) {}

const delExact = new Set(delTokens);
const delNums  = new Set(delTokens.map(numVal).filter(v => v != null));
const delTrip  = new Set(delTokens.map(tripleNorm).filter(v => v));

// Apply deletions to existing tokens (exact, numeric-equivalent, or triple-equivalent)
const afterDeleteTokens = [];
for (const tok of existingTokens) {
  const drop = delExact.has(tok)
    || (numVal(tok) != null && delNums.has(numVal(tok)))
    || (tripleNorm(tok) && delTrip.has(tripleNorm(tok)));
  if (!drop) afterDeleteTokens.push(tok);
}

// Mirror deletions to exercises_entered if present
let mergedEntered = existingEntered;
if (hasEnteredCol) {
  const filt = [];
  for (const tok of existingEntered) {
    const drop = delExact.has(tok)
      || (numVal(tok) != null && delNums.has(numVal(tok)))
      || (tripleNorm(tok) && delTrip.has(tripleNorm(tok)));
    if (!drop) filt.push(tok);
  }
  mergedEntered = filt;
}

// Additions: only tokens not already present after deletions
const existSetAfterDel = new Set(afterDeleteTokens);
const newUniqueTokens = addTokens.filter(tok => !existSetAfterDel.has(tok));
let mergedTokens = afterDeleteTokens.concat(newUniqueTokens);

        if (hasEnteredCol) {
          const enteredSet = new Set(existingEntered);
          mergedEntered = existingEntered.concat(addTokens.filter(x => !enteredSet.has(x)));
        }

        // If nothing stored yet and nothing typed now, write empty array for visibility
        if ((mergedTokens.length === 0) && (rawTokens.length === 0)) {
          if (targetUdt === '_int4') {
            sql = `UPDATE "Lessons" SET "${column}" = ARRAY[]::int[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($1)::text RETURNING *`;
            params = [idParam];
          } else {
            sql = `UPDATE "Lessons" SET "${column}" = ARRAY[]::text[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($1)::text RETURNING *`;
            params = [idParam];
          }
           const { rows } = await dbq(sql, params);
          return res.json({ ok: true, row: rows[0] });
        }

        // Validate ONLY the new tokens we plan to append
        let missingIds = [];
        if (newUniqueTokens.length > 0) {
          const numeric = [];
          const triples = [];
          const tripleRegex2 = /^(\d+)[\.-_/\s]+(\d+)[\.-_/\s]+(\d+)$/;

          for (const tok of newUniqueTokens) {
            const asInt = parseInt(tok, 10);
            if (!Number.isNaN(asInt) && String(asInt) === tok.replace(/^\+/, '')) {
              numeric.push(asInt);
            } else {
              const m2 = tok.match(tripleRegex2);
              if (m2) triples.push({ rid: parseInt(m2[1],10), page: parseInt(m2[2],10), number: parseInt(m2[3],10), raw: tok });
            }
          }

          // Numeric must exist
          if (numeric.length > 0) {
            const { rows: chk } = await dbq(
              `SELECT "ID" FROM "Exercises" WHERE "ID" = ANY($1::int[])`,
              [numeric]
            );
            const ok = new Set(chk.map(r => r.ID));
            const missingNum = numeric.filter(x => !ok.has(x));
            if (missingNum.length > 0) {
              console.warn('[LessonsLibrary.update][exercises_ids] skipping unknown numeric IDs:', missingNum);
              const badSet = new Set(missingNum.map(String));
              mergedTokens = mergedTokens.filter(tok => !badSet.has(tok));
              missingIds.push(...missingNum);
            }
          }

          // Tuples must resolve via unique key
          if (triples.length > 0) {
            const valuesParts = [];
            const valuesParams = [];
            let p = 1;
            for (const t of triples) { valuesParts.push(`($${p}, $${p+1}, $${p+2})`); valuesParams.push(t.rid, t.page, t.number); p += 3; }
            const sqlResolve2 = `
              WITH inp("ResourceID","Page","Number") AS ( VALUES ${valuesParts.join(', ')} )
              SELECT e."ID", i."ResourceID", i."Page", i."Number"
              FROM inp i
              JOIN "Exercises" e
                ON e."ResourceID" = (i."ResourceID")::int
               AND e."Page"       = (i."Page")::int
               AND e."Number"     = (i."Number")::int;
            `;
            const { rows: resRows2 } = await dbq(sqlResolve2, valuesParams);
            const okTriples = new Set(resRows2.map(r => `${r.ResourceID}|${r.Page}|${r.Number}`));
            const badTriples = triples.filter(t => !okTriples.has(`${t.rid}|${t.page}|${t.number}`));
            if (badTriples.length > 0) {
              const badSet2 = new Set(badTriples.map(t => t.raw));
              console.warn('[LessonsLibrary.update][exercises_ids] skipping unknown tuples:', [...badSet2]);
              mergedTokens = mergedTokens.filter(tok => !badSet2.has(tok));
            }
          }
        }

        // Always write the TOKENS as typed into the target column (text[] in your DB)
        if (targetUdt === '_int4') {
          // Fallback: if someone kept column as int[], cast numeric tokens, tuples already validated/dropped
          const numericOnly = mergedTokens.map(t => parseInt(t,10)).filter(n => Number.isInteger(n));
          if (hasEnteredCol) {
            sql = `UPDATE "Lessons" SET "${column}" = $1::int[], "exercises_entered" = $2::text[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($3)::text RETURNING *`;
            params = [numericOnly, mergedEntered, idParam];
          } else {
            sql = `UPDATE "Lessons" SET "${column}" = $1::int[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($2)::text RETURNING *`;
            params = [numericOnly, idParam];
          }
        } else {
          // Column is text[] (your case): store EXACT tokens as typed
          if (hasEnteredCol) {
            sql = `UPDATE "Lessons" SET "${column}" = $1::text[], "exercises_entered" = $2::text[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($3)::text RETURNING *`;
            params = [mergedTokens, mergedEntered, idParam];
          } else {
            sql = `UPDATE "Lessons" SET "${column}" = $1::text[], "updated_at" = CURRENT_TIMESTAMP
                   WHERE (${whereKey})::text = ($2)::text RETURNING *`;
            params = [mergedTokens, idParam];
          }
        }
      }
    } else {
      // Default scalar path (strings, numbers, dates, etc.)
      sql = `UPDATE "Lessons" SET "${column}" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE (${whereKey})::text = ($2)::text RETURNING *`;
      params = [value === '' ? null : value, idParam];
    }

    if (column === EXERCISES_TEXT_ARRAY) {
      if (typeof mergedEntered !== 'undefined') 
        console.log('[LessonsLibrary.update][exercises_ids] mergedEntered =', mergedEntered);
    }

    // Debug log to trace SQL and param types if an error occurs
    const { rows } = await dbq(sql, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Row not found.' });
    }


    const resp = { ok: true, row: rows[0] };
    if (typeof missingIds !== 'undefined') resp.missingIds = missingIds;
    res.json(resp);
  } catch (err) {
    console.error('Lessons inline update failed:', err);
    res.status(500).json({ error: 'Failed to update.' });
  }
});

// Mini resources list: ID + KeyWords (limited)
router.get('/resources-min', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r."ID", r."KeyWords",
              rt."Type"  AS "SourceType",
              pr."Name"  AS "Press",
              pub."Name" AS "Publisher"
         FROM "Resources" r
         LEFT JOIN "ResourceType" rt ON rt."ID" = r."SourceType"
         LEFT JOIN "Press"        pr ON pr."ID" = r."Press"
         LEFT JOIN "Publisher"    pub ON pub."ID" = r."Publisher"
        ORDER BY r."ID" DESC
        LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error('Resources mini query failed:', err);
    res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

// Return photo URLs for exercises included in a given lesson
router.get('/lesson-exercise-photos', async (req, res) => {
  try {
    const { id, idKey } = req.query || {};
    const idParam = id != null ? String(id).trim() : null;
    if (!idParam) {
      return res.status(400).json({ error: 'Missing id.' });
    }
    const whereKey = idKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idKey) ? idKey : 'lesson_id';

    // Fetch exercises_ids as text[] from Lessons
    const sel = await dbq(
      `SELECT "exercises_ids"::text[] AS tokens
         FROM "Lessons"
        WHERE (${whereKey})::text = ($1)::text
        LIMIT 1`,
      [idParam]
    );
    if (!sel.rowCount) return res.json([]);
    const tokens = (sel.rows[0].tokens || []).filter(x => x != null).map(String);
    if (!tokens.length) return res.json([]);

    // Parse tokens into numeric IDs, triples, and tuple_key matches
    const idCandidates = [];
    const triples = [];
    // Allow leading zeros in each segment of triple (e.g. 09-03-002)
    // Accept all common dash-like Unicode separators: - (ASCII), – (en dash), — (em dash), − (minus sign), ‑ (non-breaking hyphen), ‒ (figure dash)
    const tripleRegex = /^0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)$/;
    const tupleKeyMatches = [];
    for (const tok of tokens) {
      // 🧪 DEBUG BLOCK
      const clean = String(tok)
        .replace(/^['"]+|['"]+$/g, '') // remove surrounding quotes
        .replace(/[–—−‑‒]/g, '-')        // normalize dash-like chars (optional, since regex now matches them)
        .trim();
      const m = clean.match(tripleRegex);
      if (!clean) continue;
      const n = parseInt(clean, 10);
      if (!Number.isNaN(n) && String(n) === clean.replace(/^\+/, '')) {
        idCandidates.push(n);
        continue;
      }
      if (m) {
        triples.push({ rid: parseInt(m[1], 10), page: parseInt(m[2], 10), number: parseInt(m[3], 10), raw: clean });
        continue;
      }
      // Only push to tupleKeyMatches if not triple
      // (But per new instructions, triples should not be pushed here)
      tupleKeyMatches.push(clean);
    }

    // Log triples array for debugging

    // For triples, resolve to IDs by direct column match
    let tripleResolved = [];
    if (triples.length > 0) {
      for (const t of triples) {
        const { rows: tRows } = await dbq(
          `SELECT "ID" 
             FROM "Exercises"
            WHERE "ResourceID" = $1
              AND "Page" = $2
              AND "Number" = $3`,
          [t.rid, t.page, t.number]
        );
        tripleResolved.push(...tRows.map(r => r.ID));
      }
    }

    // Resolve tupleKeyMatches (those tokens that are not numeric or triples)
    let tupleKeyResolved = [];
    // Remove any tokens that matched triple pattern from tupleKeyMatches
    // (already not pushed above, but let's be explicit)
    // Actually, with above logic, only non-triples and non-numeric tokens are in tupleKeyMatches.
    if (tupleKeyMatches.length > 0) {
      // Try to match tuple_key exactly (case-insensitive), cast to text before lower()
      const { rows: tkRows } = await dbq(
        `SELECT "ID"
           FROM "Exercises"
          WHERE lower(("tuple_key")::text) = ANY($1::text[])`,
        [tupleKeyMatches.map(s => s.toLowerCase())]
      );
      tupleKeyResolved = tkRows.map(r => r.ID);
    }

    // Merge tripleResolved into finalIds before deduplication
    let finalIds = Array.from(new Set([...idCandidates, ...tripleResolved, ...tupleKeyResolved]))
      .filter(n => Number.isInteger(n) && n > 0);

  
    if (finalIds.length === 0) return res.json([]);

    // Validate IDs exist
    const { rows: chk } = await dbq(
      `SELECT "ID" FROM "Exercises" WHERE "ID" = ANY($1::int[])`,
      [finalIds]
    );
    const ok = new Set(chk.map(r => r.ID));
    finalIds = finalIds.filter(x => ok.has(x));
    if (finalIds.length === 0) return res.json([]);

    // Fetch solution_filepath and text_filepath for each exercise
    const { rows } = await dbq(
      `SELECT e."ID" AS id,
              e."solution_filepath" AS solution_filepath,
              e."text_filepath" AS text_filepath
         FROM "Exercises" e
        WHERE e."ID" = ANY($1::int[])`,
      [finalIds]
    );

    // Logic to convert absolute filesystem paths to browser-accessible URLs
    const LOCAL_BASE_DIR = '/Users/viktorvelkov/Documents/'; // adjust as needed
    const PUBLIC_URL_PREFIX = '/files/';
    function toPublicUrl(filepath) {
      if (
        typeof filepath === 'string' &&
        filepath.startsWith('/') &&
        !filepath.startsWith('/files/') &&
        !/^https?:\/\//i.test(filepath)
      ) {
        // Remove the base dir if present
        if (filepath.startsWith(LOCAL_BASE_DIR)) {
          return PUBLIC_URL_PREFIX + filepath.substring(LOCAL_BASE_DIR.length);
        }
        // fallback: just return as is
        return filepath;
      }
      return filepath;
    }

    // Only return fields if not null, and transform filepaths to URLs if needed
    const result = (rows || []).map(row => {
      const out = { id: row.id };
      // Always check both fields and provide them if available (even if one is null)
      if (row.solution_filepath && String(row.solution_filepath).trim() !== '') {
        out.solution_filepath = toPublicUrl(row.solution_filepath);
      }
      if (row.text_filepath && String(row.text_filepath).trim() !== '') {
        out.text_filepath = toPublicUrl(row.text_filepath);
      }
      return out;
    }).filter(r => r.solution_filepath || r.text_filepath); // Only return if at least one image available
    res.json(result);
  } catch (err) {
    console.error('Fetch lesson exercise photos failed:', err);
    res.status(500).json({ error: 'Failed to fetch exercise photos.' });
  }
}); 


module.exports = router;
// POST /lessons: Save (insert or update) a lesson and auto-update resources_used - currently DEPRECATED
/* 
router.post('/lessons', async (req, res) => {
  try {
    // For demonstration, let's assume lesson data comes in req.body and we upsert by id (if present)
    // You may need to adjust this logic to fit your actual lesson schema
    const lesson = req.body;
    if (!lesson) return res.status(400).json({ error: 'Missing lesson data.' });

    // Destructure exercises_ids from the lesson data for logging
    const { exercises_ids } = lesson;

    let lessonId = lesson.id || lesson.ID; // Accept id or ID
    let isUpdate = !!lessonId;
    let row;

    if (isUpdate) {
      // Update existing lesson
      const updateCols = [];
      const params = [];
      let idx = 1;
      for (const [k, v] of Object.entries(lesson)) {
        if (k === 'id' || k === 'ID') continue;
        updateCols.push(`"${k}" = $${idx}`);
        params.push(v);
        idx++;
      }
      params.push(lessonId);
      const sql = `UPDATE "Lessons" SET ${updateCols.join(', ')}, "updated_at"=CURRENT_TIMESTAMP WHERE "id" = $${idx} RETURNING *`;
      const { rows } = await pool.query(sql, params);
      if (!rows.length) return res.status(404).json({ error: 'Lesson not found.' });
      row = rows[0];
      lessonId = row.id || row.ID;
    } else {
      // Insert new lesson
      const keys = Object.keys(lesson);
      const vals = keys.map(k => lesson[k]);
      const sql = `INSERT INTO "Lessons" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(', ')}) RETURNING *`;
      const { rows } = await pool.query(sql, vals);
      row = rows[0];
      lessonId = row.id || row.ID;
    }

    // Auto-update resources  _used after saving (direct function call, not HTTP)
    try {
      console.log('[➡️ Calling updateResourcesUsed after save]', lessonId);
      await updateResourcesUsed(lessonId);
    } catch (e) {
      console.error('[auto-update resources_used error]', e);
    }

    res.json({ ok: true, row });
  } catch (err) {
    console.error('Save lesson failed:', err);
    res.status(500).json({ error: 'Failed to save lesson.' });
  }
});

// Route to update resources_used based on exercises_ids tokens - currently DEPRECATED 
router.get('/resources-used', async (req, res) => {
  try {
    const { id, idKey } = req.query || {};
    const idParam = id != null ? String(id).trim() : null;
    if (!idParam) {
      return res.status(400).json({ error: 'Missing id.' });
    }
    const whereKey = idKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idKey) ? idKey : 'id';
    // Fetch exercises_ids as text[] from Lessons
    const sel = await dbq(
      `SELECT "exercises_ids"::text[] AS tokens
         FROM "Lessons"
        WHERE (${whereKey})::text = ($1)::text
        LIMIT 1`,
      [idParam]
    );
    if (!sel.rowCount) return res.json({ updated: false, reason: 'No lesson found' });
    const tokens = (sel.rows[0].tokens || []).filter(x => x != null).map(String);
    if (!tokens.length) {
      // If no tokens, clear resources_used
      await dbq(
        `UPDATE "Lessons" SET "resources_used" = NULL, "updated_at" = CURRENT_TIMESTAMP WHERE (${whereKey})::text = ($1)::text`,
        [idParam]
      );
      return res.json({ updated: true, resources_used: [] });
    }
    // Parse tokens and resolve to ResourceIDs
    const tripleRegex = /^0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)$/;
    const resourceIds = new Set();
    for (const tok of tokens) {
      const clean = String(tok)
        .replace(/^['"]+|['"]+$/g, '')
        .replace(/[–—−‑‒]/g, '-')
        .trim();
      if (!clean) continue;
      if (/^\d+$/.test(clean)) {
        // Numeric: match by ID in Exercises
        const match = await dbq(
          `SELECT "ResourceID" FROM "Exercises" WHERE "ID" = $1`,
          [clean]
        );
        if (match.rows.length) {
          resourceIds.add(String(match.rows[0].ResourceID));
        }
      } else if (tripleRegex.test(clean)) {
        // rrr-ppp-nnn format
        const [resId, page, num] = clean.split('-').map(x => parseInt(x, 10));
        if (
          Number.isInteger(resId) &&
          Number.isInteger(page) &&
          Number.isInteger(num)
        ) {
          const match = await dbq(
            `SELECT "ResourceID" FROM "Exercises" WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3`,
            [resId, page, num]
          );
          if (match.rows.length) {
            resourceIds.add(String(match.rows[0].ResourceID));
          }
        }
      }
    }
    const resourcesArray = Array.from(resourceIds).filter(x => x != null);
    await dbq(
      `UPDATE "Lessons" SET "resources_used" = $1 WHERE "lesson_id" = $2`,
      [resourcesArray, idParam]
    );
    res.json({ updated: true, resources_used: resourcesArray });
  } catch (err) {
    console.error('Failed to update resources_used:', err);
    res.status(500).json({ error: 'Failed to update resources_used.' });
  }
});
*/
   