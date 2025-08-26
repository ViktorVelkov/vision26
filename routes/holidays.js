const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const holidaysFile = path.join(__dirname, "..", "holidays.txt");

// GET all holidays
router.get("/", (req, res) => {
  fs.readFile(holidaysFile, "utf8", (err, data) => {
    if (err) return res.json([]);
    const dates = data.split("\n").filter(Boolean);
    res.json(dates);
  });
});

// POST add holiday
router.post("/add", (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).send("Date is required");

  fs.readFile(holidaysFile, "utf8", (err, data) => {
    const dates = err ? [] : data.split("\n").filter(Boolean);
    if (dates.includes(date)) return res.send("Already exists");
    dates.push(date);
    fs.writeFile(holidaysFile, dates.join("\n") + "\n", () => {
      res.send("✅ Added " + date);
    });
  });
});

// DELETE a holiday
router.delete("/delete", (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).send("Date is required");

  fs.readFile(holidaysFile, "utf8", (err, data) => {
    if (err) return res.status(500).send("Could not read file");
    const dates = data.split("\n").filter(Boolean).filter(d => d !== date);
    fs.writeFile(holidaysFile, dates.join("\n") + "\n", () => {
      res.send("❌ Deleted " + date);
    });
  });
});

// POST clear all holidays
router.post("/clear", (req, res) => {
  fs.writeFile(holidaysFile, "", () => {
    res.send("🧹 All holidays cleared");
  });
});

module.exports = router;