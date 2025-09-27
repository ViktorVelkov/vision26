const express = require('express');
const router = express.Router();
const pool = require('../../db');

router.post("/schedule/save-distribution", async (req, res) => {
  const { data } = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: "Invalid format" });

  try {
    const client = await pool.connect();
    await client.query("BEGIN");

    for (const row of data) {
      const { start_year, end_year, class: cls, division, term, razpredelenie } = row;
      await client.query(`
        INSERT INTO "currentSchedule" (start_year, end_year, class, division, term, razpredelenie)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (class, division, start_year, end_year)
        DO UPDATE SET razpredelenie = EXCLUDED.razpredelenie, term = EXCLUDED.term
      `, [start_year, end_year, cls, division, term, razpredelenie]);
    }

    await client.query("COMMIT");
    res.json({ message: "All distributions saved successfully." });
  } catch (err) {
    console.error("❌ Failed to save distribution:", err);
    res.status(500).json({ error: "Failed to save distribution." });
  }
});

module.exports = router;