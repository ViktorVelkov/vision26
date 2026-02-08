


//
// public/lesCal_post.js
// Only the POST endpoints used by the Lessons Calendar extra action buttons
// (push-next, merge-back-sequence, merge-next-keep, shift-back-sequence) are defined here.

// --- helpers (scoped to this module) ---
/**
 * Group rows by subject and sort each group by id ASC.
 * @param {Array<{subject:string, id:number}>} rows
 * @returns {Object<string, Array>}
 */
function groupBySubject(rows) {
  if (!Array.isArray(rows)) return {};
  const groups = {};
  for (const row of rows) {
    const subj = (row && typeof row.subject === 'string') ? row.subject : '';
    if (!groups[subj]) groups[subj] = [];
    groups[subj].push(row);
  }
  for (const subj in groups) {
    groups[subj].sort((a, b) => (a.id||0)-(b.id||0));
  }
  return groups;
}

module.exports = function initLessonsCalendarActions(app, pool) {
  function logServer(action, info){
    try{
      const stamp = new Date().toISOString();
      console.log(`[lesCal] ${stamp} ${action}`, info || '');
    }catch(_e){/* noop */}
  }

  function mergePayloads(cur, next) {
    const units = [cur.unit, next.unit].map(s => (s || '').trim()).filter(Boolean);
    const mergedUnit = units.join(' / ');

    const sections = [cur.sectioninfo, next.sectioninfo].map(s => (s || '').trim()).filter(Boolean);
    const mergedSectioninfo = sections.join('\n');

    const notes = [cur.notes, next.notes].map(s => (s || '').trim()).filter(Boolean);
    const mergedNotes = notes.join('\n');

    const mergedUnitetype = cur.unitetype || next.unitetype || '';

    const codes = [cur.lessonCode, next.lessonCode]
      .map(s => (s || '').trim())
      .filter(Boolean)
      .flatMap(s => s.split(',').map(x => x.trim()))
      .filter(Boolean);
    const uniqueCodes = [...new Set(codes)];
    const mergedLessonCode = uniqueCodes.join(', ');

    return { unit: mergedUnit, unitetype: mergedUnitetype, sectioninfo: mergedSectioninfo, notes: mergedNotes, lessonCode: mergedLessonCode };
  }

  async function loadSubjectRows(client, subject){
    const { rows } = await client.query(
      `SELECT id, unit, unitetype, sectioninfo, notes, "lessonCode", subject, "fixedDate"
         FROM "generatedyearplan"
        WHERE subject = $1
        ORDER BY id ASC`,
      [subject]
    );
    return rows;
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

  // --- distribution progress sync ---

  function parseClassDivisionFromSubject(subject) {
    const s = String(subject || '').trim();
    // Examples: "9 Д", "11 МодулА", "12 ИС".
    // Take leading digits as class, rest as division.
    const m = s.match(/^\s*(\d+)\s*(.*)\s*$/);
    if (!m) return { classId: null, division: null };
    const classId = parseInt(m[1], 10);
    const division = (m[2] || '').trim();
    return { classId: Number.isInteger(classId) ? classId : null, division: division || null };
  }

  async function updateNextIndexForSubject(client, subject) {
    // Extract max numeric index from sectioninfo using regexp_matches.
    const { rows } = await client.query(`
      SELECT
        MAX((m)[1]::INTEGER) AS max_idx
      FROM "generatedyearplan" g
      JOIN LATERAL regexp_matches(g.sectioninfo, '\\d+', 'g') AS m ON TRUE
      WHERE g.subject = $1
        AND g.sectioninfo IS NOT NULL
        AND g.sectioninfo <> ''
    `, [subject]);

    const maxIdx = rows && rows[0] ? rows[0].max_idx : null;
    if (maxIdx === null) return;

    const parsed = parseClassDivisionFromSubject(subject);
    const classId = parsed.classId;
    const division = parsed.division;
    if (!Number.isInteger(classId) || !division) return;

    const upd = await client.query(
      `UPDATE distributionprogress
          SET next_index = $1
        WHERE class = $2
          AND division = $3`,
      [maxIdx, classId, division]
    );

    if (!upd.rowCount) {
      await client.query(
        `INSERT INTO distributionprogress(class, division, next_index)
         VALUES ($1, $2, $3)`,
        [classId, division, maxIdx]
      );
    }
  }

  // --- endpoints used by the extra action buttons ---

  // 1) PUSH-NEXT  (btn-move-right)
  // Moves the current lesson into the next slot. If the next slot is occupied,
  // shift the chain forward and drop the overflow at the end for this subject.
  app.post('/lessons-calendar/generatedyearplan/:id/push-next', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Load current row
      const curRes = await client.query(`SELECT * FROM "generatedyearplan" WHERE id = $1`, [id]);
      if (!curRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Current row not found' }); }
      const curRow = curRes.rows[0];


      // Load all rows for same subject ordered by id
      const listRes = await client.query(
        `SELECT id, subject, unit, unitetype, sectioninfo, notes, "lessonCode", "fixedDate"
           FROM "generatedyearplan"
          WHERE subject = $1
          ORDER BY id ASC`,
        [curRow.subject]
      );
      const rows = listRes.rows;

      const idx = rows.findIndex(r => r.id === id);
      if (idx < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Index not found' }); }
      if (idx >= rows.length - 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No next slot' }); }

      const curPayload  = payloadFromRow(rows[idx]);
      const nextPayload = payloadFromRow(rows[idx+1]);

      const isUnitEmpty = (p) => ((p.unit || '').trim().length === 0);

      // --- New logic: right-shift by one from idx+1 ---
      if (isUnitEmpty(nextPayload)) {
        // 1) If next slot is empty, write curPayload to next, clear current
        await writePayload(client, rows[idx+1].id, curPayload);
        await writePayload(client, rows[idx].id, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });

        await updateNextIndexForSubject(client, curRow.subject);

        await client.query('COMMIT');
        return res.json({ ok:true, movedTo: rows[idx+1].id, payloadNext: curPayload, cleared: rows[idx].id });
      } else {
        // 2) If next slot is occupied, build shallow array of payloads
        const payloads = rows.map(payloadFromRow);
        // Perform right-shift by one starting at idx+1
        for (let k = rows.length - 1; k >= idx + 2; k--) {
          await writePayload(client, rows[k].id, payloads[k-1]);
        }
        // Write curPayload into rows[idx+1]
        await writePayload(client, rows[idx+1].id, curPayload);
        // Clear current row (idx)
        await writePayload(client, rows[idx].id, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });
        // Clear tail (last row)
        const lastId = rows[rows.length - 1].id;
        await writePayload(client, lastId, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });

        await updateNextIndexForSubject(client, curRow.subject);

        await client.query('COMMIT');
        return res.json({
          ok: true,
          movedTo: rows[idx+1].id,
          cleared: rows[idx].id,
          tailCleared: lastId,
          shifted: true
        });
      }
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('push-next failed:', e);
      return res.status(500).json({ error: 'DB error' });
    } finally {
      client.release();
    }
  });

  // 2) MERGE-BACK-SEQUENCE  (btn-merge-prev "м<-")
  app.post('/lessons-calendar/generatedyearplan/:id/merge-back-sequence', async (req,res)=>{
    const id = parseInt(req.params.id, 10);
    logServer('merge-back-sequence:start', { id });
    if (!Number.isInteger(id)) return res.status(400).json({ error:'Invalid id' });
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const curRes = await client.query(`SELECT * FROM "generatedyearplan" WHERE id = $1`, [id]);
      if (!curRes.rows.length){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Row not found' }); }
      const curRow = curRes.rows[0];


      // Load all rows for the same subject ordered by id
      const rows = await loadSubjectRows(client, curRow.subject);
      const idx = rows.findIndex(r=>r.id === id);
      if (idx < 0){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Index not found' }); }
      if (idx === 0){ await client.query('ROLLBACK'); return res.status(400).json({ error:'No previous row to merge into' }); }

      const prevId = rows[idx-1].id;
      const prevP  = payloadFromRow(rows[idx-1]);
      const curP   = payloadFromRow(rows[idx]);

      // Merge CURRENT into PREVIOUS (keep order prev + cur)
      const updatedPrev = mergePayloads(prevP, curP);

      // 1) Write merged payload to PREVIOUS
      await writePayload(client, prevId, updatedPrev);

      // 2) Clear CURRENT row completely (including unitetype)
      const empty = { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' };
      await writePayload(client, rows[idx].id, empty);

      await updateNextIndexForSubject(client, curRow.subject);

      await client.query('COMMIT');
      logServer('merge-back-sequence:done', { mergedInto: prevId, clearedCurrent: rows[idx].id });
      return res.json({ ok:true, subject: curRow.subject, mergedInto: prevId, clearedCurrent: rows[idx].id, updatedPrev });
    }catch(e){
      await client.query('ROLLBACK');
      logServer('merge-back-sequence:error', { id, error: e && e.message ? e.message : String(e) });
      console.error('merge-back-sequence failed:', e);
      return res.status(500).json({ error:'DB error' });
    }finally{ client.release(); }
  });

  // 3) MERGE-NEXT-KEEP  (btn-merge-next "->м")
  app.post('/lessons-calendar/generatedyearplan/:id/merge-next-keep', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    logServer('merge-next-keep:start', { id });
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      // Load all rows for the same subject and find current index
      const curRes = await client.query(`SELECT * FROM "generatedyearplan" WHERE id = $1`, [id]);
      if (!curRes.rows.length){ await client.query('ROLLBACK'); return res.status(404).json({ error: 'Current row not found' }); }
      const curRow = curRes.rows[0];


      const rows = await loadSubjectRows(client, curRow.subject);
      const idx = rows.findIndex(r=>r.id === id);
      if (idx < 0){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Index not found' }); }
      if (idx >= rows.length - 1){ await client.query('ROLLBACK'); return res.status(400).json({ error:'No next row to merge' }); }

      // Merge CURRENT and NEXT into NEXT, leave CURRENT empty (no chain shifting)
      const curP  = payloadFromRow(rows[idx]);
      const nextP = payloadFromRow(rows[idx+1]);
      const mergedNext = mergePayloads(curP, nextP);
      const nextId = rows[idx+1].id;

      // Write merged payload to NEXT
      await writePayload(client, nextId, mergedNext);
      // Clear CURRENT row completely
      const empty = { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' };
      await writePayload(client, rows[idx].id, empty);

      await updateNextIndexForSubject(client, curRow.subject);

      await client.query('COMMIT');
      logServer('merge-next-keep:done', { mergedInto: nextId, clearedCurrent: rows[idx].id });
      return res.json({
        ok:true,
        subject: curRow.subject,
        mergedInto: nextId,
        clearedCurrent: rows[idx].id,
        updatedNext: mergedNext
      });
    }catch(e){
      await client.query('ROLLBACK');
      logServer('merge-next-keep:error', { id, error: e && e.message ? e.message : String(e) });
      console.error('merge-next-keep failed:', e);
      return res.status(500).json({ error: 'DB error' });
    }finally{ client.release(); }
  });

  // 4) SHIFT-BACK-SEQUENCE  (btn-move-left "⟵")
  // "<-": pull the whole chain one step back INCLUDING the current row.
  // Effect: prev := current, current := next, next := next+1, ..., last := empty.
  // Guard: operation allowed only if the immediate previous slot is empty.
  app.post('/lessons-calendar/generatedyearplan/:id/shift-back-sequence', async (req,res)=>{
    const id = parseInt(req.params.id, 10);
    logServer('shift-back-sequence:start', { id });
    if (!Number.isInteger(id)) return res.status(400).json({ error:'Invalid id' });
    const client = await pool.connect();
    try{
      await client.query('BEGIN');

      const curRes = await client.query(`SELECT id, subject, class, division FROM "generatedyearplan" WHERE id = $1`, [id]);
      if (!curRes.rows.length){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Row not found' }); }
      const subject = curRes.rows[0].subject;

      const curRow = curRes.rows[0];

      // Load all rows for this subject, ordered by id ASC
      const rows = await loadSubjectRows(client, subject);
      const idx = rows.findIndex(r=>r.id === id);
      if (idx < 0){ await client.query('ROLLBACK'); return res.status(404).json({ error:'Index not found' }); }
      if (idx === 0){ await client.query('ROLLBACK'); return res.status(400).json({ error:'No previous slot' }); }

      // Guard: previous slot must be empty (only `unit` is considered)
      const prevPayload = payloadFromRow(rows[idx-1]);
      const prevUnitEmpty = ((prevPayload.unit || '').trim().length === 0);
      if (!prevUnitEmpty){
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Previous slot is not empty (unit not empty)',
          reason: 'prev-not-empty',
          prevRowId: rows[idx-1].id,
          prevPreview: prevPayload
        });
      }

      // 1) prev := current
      const curPayload = payloadFromRow(rows[idx]);
      await writePayload(client, rows[idx-1].id, curPayload);

      // 2) For k = idx .. last-1: row[k] := row[k+1]
      for (let k = idx; k < rows.length - 1; k++){
        const src = payloadFromRow(rows[k+1]);
        await writePayload(client, rows[k].id, src);
      }

      // 3) Clear tail (last row)
      const lastId = rows[rows.length - 1].id;
      await writePayload(client, lastId, { unit:'', unitetype:'', sectioninfo:'', notes:'', lessonCode:'' });

      await updateNextIndexForSubject(client, subject);

      await client.query('COMMIT');
      logServer('shift-back-sequence:done', { movedPrev: rows[idx-1].id, tailCleared: lastId });
      return res.json({ ok:true, movedPrev: rows[idx-1].id, tailCleared: lastId });
    }catch(e){
      await client.query('ROLLBACK');
      logServer('shift-back-sequence:error', { id, error: e && e.message ? e.message : String(e) });
      console.error('shift-back-sequence failed:', e);
      return res.status(500).json({ error:'DB error' });
    }finally{ client.release(); }
  });

  // Export for internal use (testability, future use)
  module.exports.groupBySubject = groupBySubject;
};
