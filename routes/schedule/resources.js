const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/schedule/resources', (req, res) => {
  const folderPath = path.join(__dirname, '../../разпределения');
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error("Failed to list resource files:", err);
      return res.status(500).json({ error: "Failed to list files" });
    }
    res.json(files.filter(f => /\.(txt|pdf|docx|md|pages|numbers|xls|xlsx|csv)$/i.test(f)));
  });
});

router.get('/schedule/resource-file', (req, res) => {
  const { name } = req.query;
  const safeName = path.basename(name || '');
  const fullPath = path.join(__dirname, '../../разпределения', safeName);
  res.sendFile(fullPath);
});

module.exports = router;