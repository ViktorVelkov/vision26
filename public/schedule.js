

const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust if your DB connection is elsewhere

// Get schedule for the week
router.get("/schedule", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM schedule ORDER BY day, start_time");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching schedule");
  }
});

// Add a class to a specific day
router.post("/schedule", async (req, res) => {
  const { day, start_time, end_time, subject, class_id } = req.body;
  try {
    await pool.query(
      "INSERT INTO schedule (day, start_time, end_time, subject, class_id) VALUES ($1, $2, $3, $4, $5)",
      [day, start_time, end_time, subject, class_id]
    );
    res.status(201).send("Class added to schedule");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding class");
  }
});

module.exports = router;