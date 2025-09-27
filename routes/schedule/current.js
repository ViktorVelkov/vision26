const express = require('express');
const router = express.Router();
const pool = require('../../db');

router.get('/schedule/current', async (req, res) => {
  try {
    const yearResult = await pool.query(`
      SELECT DISTINCT start_year, end_year
      FROM "currentSchedule"
      ORDER BY start_year DESC
      LIMIT 1
    `);

    if (yearResult.rows.length === 0) {
      return res.json({ hasCurrent: false });
    }

    const { start_year, end_year } = yearResult.rows[0];

    const scheduleEntries = await pool.query(`
      SELECT *
      FROM "scheduleentries"
      WHERE start_year = $1 AND end_year = $2
      ORDER BY
        CAST((REGEXP_MATCHES(subject, '^\\d+'))[1] AS INTEGER),
        CASE
          WHEN weekday = 'Monday' THEN 1
          WHEN weekday = 'Tuesday' THEN 2
          WHEN weekday = 'Wednesday' THEN 3
          WHEN weekday = 'Thursday' THEN 4
          WHEN weekday = 'Friday' THEN 5
          ELSE 6
        END,
        start_time
    `, [start_year, end_year]);

    const subjects = [...new Set(scheduleEntries.rows.map(e => e.subject))];
    let isModuleMap = {};
    if (subjects.length > 0) {
      try {
        const metaResult = await pool.query(`
          SELECT "Class", "Division", "isModule"
          FROM "ClassesList_2025_2026"
          WHERE ("Class" || ' ' || "Division") = ANY($1)
        `, [subjects]);
        for (const row of metaResult.rows) {
          const key = `${row.Class} ${row.Division}`;
          isModuleMap[key] = row.isModule;
        }
      } catch (metaErr) {
        console.error("Failed to fetch class meta for isModule:", metaErr);
      }
    }

    const currentRows = await pool.query(
      `SELECT start_year, end_year, class, division, razpredelenie, term
       FROM "currentSchedule"
       WHERE start_year = $1 AND end_year = $2`,
      [start_year, end_year]
    );

    return res.json({
      hasCurrent: true,
      current: { start_year, end_year },
      entries: scheduleEntries.rows,
      isModuleMap,
      currentRows: currentRows.rows
    });
  } catch (err) {
    console.error("Error fetching current schedule:", err);
    res.status(500).json({ error: "Failed to fetch current schedule." });
  }
});

module.exports = router;