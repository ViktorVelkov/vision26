const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { normalizeSubjectName } = require('./utils/dates');
const parseDistributionFile = require('./services/parseDistribution');

router.get("/schedule/preview-units", async (req, res) => {
  const { subject, term } = req.query;
  if (!subject || !term) return res.status(400).json({ error: "Missing subject or term" });

  try {
    const yearResult = await pool.query(`
      SELECT DISTINCT start_year, end_year
      FROM "currentSchedule"
      ORDER BY start_year DESC
      LIMIT 1
    `);
    if (yearResult.rows.length === 0) return res.status(404).json({ error: "No current year" });
    const { start_year, end_year } = yearResult.rows[0];

    const { rows: currentRows } = await pool.query(
      `SELECT class, division, term, razpredelenie FROM "currentSchedule"
       WHERE start_year = $1 AND end_year = $2`,
      [start_year, end_year]
    );

    const subKey = normalizeSubjectName(subject);
    const tnum = Number(term);
    let match = currentRows.find(r =>
      normalizeSubjectName(`${r.class} ${r.division}`) === subKey &&
      Number(r.term) === tnum && r.razpredelenie
    );
    if (!match) {
      match = currentRows.find(r => normalizeSubjectName(`${r.class} ${r.division}`) === subKey && r.razpredelenie);
    }
    if (!match) return res.status(404).json({ error: "No matching distribution file for that subject/term" });

    const units = await parseDistributionFile(match.razpredelenie);
    return res.json({
      file: match.razpredelenie,
      subject: subKey,
      term: tnum,
      count: units.length,
      sample: units.slice(0, 10)
    });
  } catch (err) {
    console.error("preview-units error:", err);
    res.status(500).json({ error: "Failed to preview units" });
  }
});

router.get("/schedule/preview-file", async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: "Missing file" });
  try {
    const safe = require('path').basename(file);
    const units = await parseDistributionFile(safe);
    res.json({ file: safe, count: units.length, sample: units.slice(0, 20) });
  } catch (err) {
    console.error("preview-file error:", err);
    res.status(500).json({ error: "Failed to parse file" });
  }
});

module.exports = router;