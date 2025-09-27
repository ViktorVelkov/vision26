const express = require('express');
const router = express.Router();
const pool = require('../../db');
const buildUnitFetcher = require('./services/unitFetcher');
const { parseClientDate, fmtDateISO, resolveTerm, rangeFromPlanner } = require('./utils/dates');

router.post("/schedule/generate-year-plan", async (req, res) => {
  const { planner, semester1End, semester2Start, semester1EndISO, semester2StartISO } = req.body;
  const sem1EndDate = parseClientDate(semester1EndISO || semester1End);
  const sem2StartDate = parseClientDate(semester2StartISO || semester2Start);
  if (!Array.isArray(planner)) return res.status(400).json({ error: "Invalid planner format." });

  try {
    const { rows: current } = await pool.query(`
      SELECT cs.*, cl."isModule"
      FROM "currentSchedule" cs
      LEFT JOIN "ClassesList_2025_2026" cl
        ON cs.class = cl."Class" AND cs.division = cl."Division"
    `);

    const getNextUnit = buildUnitFetcher(current);

    const allocations = [];
    let weekIndex = 1;

    for (const week of planner) {
      for (const entry of week.entries) {
        const computedTerm = resolveTerm(entry, sem1EndDate, sem2StartDate);
        entry.term = computedTerm;

        const recurrence = (entry.recurrence || "WEEKLY").toUpperCase();
        const parity = parseInt(entry.week_parity, 10) || 1;
        if (recurrence === "BIWEEKLY") {
          const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
          if (currentParity !== parity) continue;
        }

        const unitData = await getNextUnit(entry.subject, computedTerm);
        const [h1, m1] = (entry.start_time || "0:0").split(":").map(Number);
        const [h2, m2] = (entry.end_time   || "0:0").split(":").map(Number);
        const duration = (h2 * 60 + m2) - (h1 * 60 + m1);

        let isModuleFlag = false;
        try {
          const modRes = await pool.query(`
            SELECT "isModule"
            FROM "ClassesList_2025_2026"
            WHERE ("Class" || ' ' || "Division") = $1
            LIMIT 1
          `, [entry.subject]);
          if (modRes.rows.length > 0) isModuleFlag = !!modRes.rows[0].isModule;
        } catch (err) {
          console.error("Error fetching isModule for", entry.subject, err);
        }

        allocations.push({
          week_number: weekIndex,
          date: entry.date,
          weekday: new Date(entry.date).toLocaleDateString("en-US", { weekday: "long" }),
          start_time: entry.start_time,
          end_time: entry.end_time,
          subject: entry.subject,
          unit: unitData ? unitData.unit : null,
          sectionInfo: unitData ? unitData.week : null,
          uniteType: unitData ? unitData.uniteType : null,
          notes: unitData ? unitData.notes : null,
          duration,
          term: computedTerm,
          is_module: isModuleFlag
        });
      }
      weekIndex++;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of allocations) {
        await client.query(`
          INSERT INTO "generatedyearplan" (
            week_number, date, weekday, start_time, end_time,
            subject, unit, sectionInfo, uniteType, notes,
            duration, term, is_module
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `, [
          row.week_number,
          row.date,
          row.weekday,
          row.start_time,
          row.end_time,
          row.subject,
          row.unit,
          row.sectionInfo,
          row.uniteType,
          row.notes,
          row.duration,
          row.term,
          row.is_module
        ]);
      }
      const { maxDate } = rangeFromPlanner(planner);
      if (sem2StartDate instanceof Date && !Number.isNaN(sem2StartDate.getTime()) && maxDate instanceof Date && !Number.isNaN(maxDate.getTime())) {
        const sem2ISO = fmtDateISO(sem2StartDate);
        const maxISO = fmtDateISO(maxDate);
        await client.query(`
          UPDATE "generatedyearplan"
          SET term = 2
          WHERE date >= $1::date AND date <= $2::date
        `, [sem2ISO, maxISO]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (getNextUnit && typeof getNextUnit.flush === 'function') {
      await getNextUnit.flush();
    }
    res.json({
      message: `Planner saved successfully. Inserted ${allocations.length} rows into generatedyearplan.`,
      inserted: allocations.length
    });
  } catch (err) {
    console.error("Error saving GeneratedYearPlan:", err);
    res.status(500).json({ error: "Failed to save planner." });
  }
});

router.post("/schedule/mirror-year-plan", async (req, res) => {
  const { planner, semester1End, semester2Start, semester1EndISO, semester2StartISO } = req.body;
  const sem1EndDate = parseClientDate(semester1EndISO || semester1End);
  const sem2StartDate = parseClientDate(semester2StartISO || semester2Start);
  if (!Array.isArray(planner)) return res.status(400).json({ error: "Invalid planner format." });

  try {
    const client = await pool.connect();
    await client.query("BEGIN");
    let weekIndex = 1;

    const { rows: current } = await pool.query(`
      SELECT cs.*, cl."isModule"
      FROM "currentSchedule" cs
      LEFT JOIN "ClassesList_2025_2026" cl
        ON cs.class = cl."Class" AND cs.division = cl."Division"
    `);
    const getNextUnit = buildUnitFetcher(current);

    for (const week of planner) {
      for (const entry of week.entries) {
        const computedTerm = resolveTerm(entry, sem1EndDate, sem2StartDate);
        const recurrence = entry.recurrence || "WEEKLY";
        const parity = parseInt(entry.week_parity, 10) || 1;
        if (recurrence === "BIWEEKLY") {
          const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
          if (currentParity !== parity) continue;
        }
        const unitData = await getNextUnit(entry.subject, computedTerm);
        const [h1, m1] = entry.start_time.split(":").map(Number);
        const [h2, m2] = entry.end_time.split(":").map(Number);
        const duration = h2 * 60 + m2 - (h1 * 60 + m1);

        let isModuleFlag = false;
        try {
          const modRes = await pool.query(`
            SELECT "isModule"
            FROM "ClassesList_2025_2026"
            WHERE ("Class" || ' ' || "Division") = $1
            LIMIT 1
          `, [entry.subject]);
          if (modRes.rows.length > 0) isModuleFlag = modRes.rows[0].isModule;
        } catch (err) {
          console.error("Error fetching isModule for", entry.subject, err);
        }

        await client.query(`
          INSERT INTO "yearplan" (
            week_number, date, weekday, start_time, end_time,
            subject, unit, sectionInfo, uniteType, notes,
            duration, term, is_module
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `, [
          weekIndex,
          entry.date,
          new Date(entry.date).toLocaleDateString("en-US", { weekday: "long" }),
          entry.start_time,
          entry.end_time,
          entry.subject,
          unitData.unit || null,
          unitData.week || null,
          unitData.uniteType || null,
          unitData.notes || null,
          duration,
          computedTerm,
          isModuleFlag
        ]);
      }
      weekIndex++;
    }

    const { maxDate } = rangeFromPlanner(planner);
    if (sem2StartDate instanceof Date && !Number.isNaN(sem2StartDate.getTime()) && maxDate instanceof Date && !Number.isNaN(maxDate.getTime())) {
      const sem2ISO = fmtDateISO(sem2StartDate);
      const maxISO = fmtDateISO(maxDate);
      await client.query(`
        UPDATE "yearplan"
        SET term = 2
        WHERE date >= $1::date AND date <= $2::date
      `, [sem2ISO, maxISO]);
    }

    await client.query("COMMIT");
    if (getNextUnit && typeof getNextUnit.flush === 'function') await getNextUnit.flush();
    res.json({ message: "Mirror planner saved successfully." });
  } catch (err) {
    console.error("Error mirroring planner:", err);
    res.status(500).json({ error: "Failed to mirror planner." });
  }
});

module.exports = router;