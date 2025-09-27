const express = require('express');
const router = express.Router();
const pool = require('../../db');

router.get('/schedule/available-years', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT start_year, end_year 
      FROM "scheduleentries"
      ORDER BY start_year DESC, end_year DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching available schedules:', err);
    res.status(500).json({ error: 'Failed to fetch available schedules.' });
  }
});

module.exports = router;