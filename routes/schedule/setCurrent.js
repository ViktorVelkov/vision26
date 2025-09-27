const express = require('express');
const router = express.Router();
const pool = require('../../db');

router.post('/schedule/set-current', async (req, res) => {
  const { start_year, end_year, class: classNum, division, schedule } = req.body;
  if (!start_year || !end_year || !classNum || !division) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    await pool.query(`DELETE FROM "currentSchedule"`);
    await pool.query(`
      INSERT INTO "currentSchedule" (start_year, end_year, class, division, schedule)
      VALUES ($1, $2, $3, $4, $5)
    `, [start_year, end_year, classNum, division, schedule]);

    res.json({ message: "Current schedule set successfully." });
  } catch (err) {
    console.error("Error setting current schedule:", err);
    res.status(500).json({ error: "Failed to set current schedule." });
  }
});

module.exports = router;