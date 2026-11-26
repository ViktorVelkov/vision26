


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

async function getNextDistributionTopic(client, subject, topicsMap) {
  const { classId, division } =
    parseClassDivisionFromSubject(subject);

  if (!Number.isInteger(classId) || !division) {
    throw new Error('Invalid subject: ' + subject);
  }

  const key = `${classId} ${division}`;
  const topics = topicsMap[key];

  if (!Array.isArray(topics)) {
    throw new Error('No distribution found for ' + key);
  }

  const result = await client.query(
    `SELECT class, division, file, next_index
     FROM distributionprogress
     WHERE class = $1
       AND division = $2
     FOR UPDATE`,
    [classId, division]
  );

  if (result.rows.length !== 1) {
    throw new Error(
      'Expected exactly one distribution progress row for ' + key
    );
  }

  const progress = result.rows[0];
  const nextIndex = Number(progress.next_index);

  if (
    !Number.isInteger(nextIndex) ||
    nextIndex < 0 ||
    nextIndex >= topics.length
  ) {
    throw new Error('No unused topics remaining for ' + key);
  }

  return {
    classId,
    division,
    file: progress.file,
    nextIndex,
    topic: topics[nextIndex]
  };
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

// Merge current into previous, shift subsequent lessons backward,
// and append the next unused distribution topic.
app.post(
  '/lessons-calendar/generatedyearplan/:id/merge-back-and-shift',
  async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const client = await pool.connect();

    try {
      const { buildTopicsMapFromCurrentSchedule } =
        require('./schedule/generator/raz_parser');

      const parsed = await buildTopicsMapFromCurrentSchedule({
        baseUrl: 'http://localhost:3001'
      });

      await client.query('BEGIN');

      const curRes = await client.query(
        `SELECT id, subject
         FROM "generatedyearplan"
         WHERE id = $1`,
        [id]
      );

      if (!curRes.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Row not found' });
      }

      const subject = curRes.rows[0].subject;

      const { rows } = await client.query(
        `SELECT id, subject, unit, unitetype, sectioninfo,
                notes, "lessonCode", "indexInFile"
         FROM "generatedyearplan"
         WHERE subject = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [subject]
      );

      const idx = rows.findIndex(r => Number(r.id) === id);

      if (idx <= 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'No previous slot available for merging'
        });
      }

      if (
        !String(rows[idx].unit ?? '').trim() ||
        !String(rows[idx - 1].unit ?? '').trim()
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Both current and previous lessons must contain a topic'
        });
      }

      const { classId, division } =
        parseClassDivisionFromSubject(subject);

      const key = `${classId} ${division}`;
      const topics = parsed.obj && parsed.obj[key];

      if (
        !Number.isInteger(classId) ||
        !division ||
        !Array.isArray(topics)
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Distribution not available for ' + subject
        });
      }

      const progressRes = await client.query(
        `SELECT class, division, file, next_index
         FROM distributionprogress
         WHERE class = $1 AND division = $2
         FOR UPDATE`,
        [classId, division]
      );

      if (progressRes.rows.length !== 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Expected exactly one progress row for ' + subject
        });
      }

      const progress = progressRes.rows[0];
      const nextIndex = Number(progress.next_index);

      if (
        !Number.isInteger(nextIndex) ||
        nextIndex < 0 ||
        nextIndex >= topics.length
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'No next unused topic in distribution'
        });
      }

      // Merge the current lesson into the previous slot.
      const merged = mergePayloads(
        payloadFromRow(rows[idx - 1]),
        payloadFromRow(rows[idx])
      );

      await client.query(
        `UPDATE "generatedyearplan"
         SET unit = $1,
             unitetype = $2,
             sectioninfo = $3,
             notes = $4,
             "lessonCode" = $5,
             "indexInFile" = NULL
         WHERE id = $6`,
        [
          merged.unit,
          merged.unitetype,
          merged.sectioninfo,
          merged.notes,
          merged.lessonCode,
          rows[idx - 1].id
        ]
      );

      // Pull all subsequent lessons backward, including empty slots.
      for (let j = idx; j < rows.length - 1; j++) {
        const src = rows[j + 1];

        await client.query(
          `UPDATE "generatedyearplan"
           SET unit = $1,
               unitetype = $2,
               sectioninfo = $3,
               notes = $4,
               "lessonCode" = $5,
               "indexInFile" = $6
           WHERE id = $7`,
          [
            src.unit ?? '',
            src.unitetype ?? '',
            src.sectioninfo ?? '',
            src.notes ?? '',
            src.lessonCode ?? '',
            src.indexInFile ?? null,
            rows[j].id
          ]
        );
      }

      // Fill the final slot with the next unused topic.
      const tail = rows[rows.length - 1];

      await client.query(
        `UPDATE "generatedyearplan"
         SET unit = $1,
             unitetype = '',
             sectioninfo = '',
             notes = '',
             "lessonCode" = '',
             "indexInFile" = $2
         WHERE id = $3`,
        [String(topics[nextIndex]), nextIndex, tail.id]
      );

      // Advance distribution progress exactly once.
      const updated = await client.query(
        `UPDATE distributionprogress
         SET next_index = next_index + 1
         WHERE class = $1
           AND division = $2
           AND file IS NOT DISTINCT FROM $3
           AND next_index = $4`,
        [classId, division, progress.file, nextIndex]
      );

      if (updated.rowCount !== 1) {
        throw new Error('Distribution progress update conflict');
      }

      await client.query('COMMIT');

      return res.json({
        ok: true,
        mergedInto: rows[idx - 1].id,
        shiftedFrom: id,
        filled: tail.id,
        next_index: nextIndex + 1
      });

    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      console.error('merge-back-and-shift failed:', e);
      return res.status(500).json({ error: 'DB error' });

    } finally {
      client.release();
    }
  }
);

  // 4) SHIFT-BACK-SEQUENCE  (btn-move-left "⟵")
// Pull subsequent lesson contents into the clicked empty slot.

app.post(
  '/lessons-calendar/generatedyearplan/:id/shift-back-sequence',
  async (req, res) => {

    const id = Number(req.params.id);

    logServer('shift-back-sequence:start', { id });

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: 'Invalid id'
      });
    }

    const client = await pool.connect();

    try {
      const { buildTopicsMapFromCurrentSchedule } =
        require('./schedule/generator/raz_parser');

      const parsed = await buildTopicsMapFromCurrentSchedule({
        baseUrl: 'http://localhost:3001'
      });

      const topicsMap = parsed.obj;

      await client.query('BEGIN');

      // 1. Find selected row.
      const curRes = await client.query(
        `SELECT id, subject
         FROM "generatedyearplan"
         WHERE id = $1`,
        [id]
      );

      if (!curRes.rows.length) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Row not found'
        });
      }

      const subject = curRes.rows[0].subject;

      // 2. Load the chronological sequence.
      const rows = await loadSubjectRows(client, subject);

      const idx = rows.findIndex(
        row => Number(row.id) === id
      );

      if (idx < 0) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Row not found in sequence'
        });
      }

      // 3. The clicked slot must be empty.
      const currentPayload = payloadFromRow(rows[idx]);

      if (String(currentPayload.unit || '').trim() !== '') {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'Current slot is not empty',
          reason: 'current-not-empty'
        });
      }

      // 4. Obtain the next unused distribution topic.
      const next = await getNextDistributionTopic(
        client,
        subject,
        topicsMap
      );

      // 5. Shift all subsequent payloads one position backward.
      // Empty slots are included.
      const payloads = rows.map(payloadFromRow);

      for (let i = idx; i < rows.length - 1; i++) {
        await writePayload(
          client,
          rows[i].id,
          payloads[i + 1]
        );
      }

      // 6. Fill the final slot with the next unused topic.
      const lastRow = rows[rows.length - 1];

      await writePayload(client, lastRow.id, {
        unit: String(next.topic),
        unitetype: '',
        sectioninfo: '',
        notes: '',
        lessonCode: '',
        indexInFile: next.nextIndex
      });

      // 7. Advance next_index exactly once.
      const updated = await client.query(
        `UPDATE distributionprogress
         SET next_index = next_index + 1
         WHERE class = $1
           AND division = $2
           AND file IS NOT DISTINCT FROM $3
           AND next_index = $4`,
        [
          next.classId,
          next.division,
          next.file,
          next.nextIndex
        ]
      );

      if (updated.rowCount !== 1) {
        throw new Error('Distribution progress update failed');
      }

      await client.query('COMMIT');

      logServer('shift-back-sequence:done', {
        id,
        subject,
        filled: lastRow.id,
        next_index: next.nextIndex + 1
      });

      return res.json({
        ok: true,
        subject,
        shiftedFrom: id,
        filled: lastRow.id,
        next_index: next.nextIndex + 1
      });

    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      logServer('shift-back-sequence:error', {
        id,
        error: e.message
      });

      console.error('shift-back-sequence failed:', e);

      return res.status(500).json({
        error: 'DB error'
      });

    } finally {
      client.release();
    }
  }
);

  // Export for internal use (testability, future use)
  module.exports.groupBySubject = groupBySubject;
};
