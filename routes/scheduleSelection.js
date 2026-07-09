const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust the path if needed
const csv = require("csv-parser");
const { Readable } = require("stream");

// Then define all routes here

// Helper to parse dates from client robustly
function parseClientDate(str) {
  if (!str && str !== 0) return new Date(NaN);
  if (typeof str === "string") {
    const s = str.trim();
    // 1) BG style: DD.MM.YYYY
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
      const [day, month, year] = s.split(".");
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }
    // 2) ISO date from <input type="date">: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T00:00:00`);
    }
    // 3) Slash variant: DD/MM/YYYY (treat as day-first)
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [day, month, year] = s.split("/");
      return new Date(`${year}-${month}-${day}T00:00:00`);
    }
    // 4) Fallback to native parser
    const d = new Date(s);
    return d;
  }
  // Non-string input; try native conversion
  return new Date(str);
}

function normalizeSubjectName(s) {
  return String(s || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// Robust resolver that trusts the client's term when valid (1/2),
// otherwise derives it from the provided semester boundaries, with month-based fallback
function resolveTerm(entry, sem1EndDate, sem2StartDate) {
  const n = Number(entry && entry.term);
  if (n === 1 || n === 2) return n; // trust client if present and valid

  // Derive by date
  const d = parseClientDate(entry && entry.date);
  const eTime = d instanceof Date ? d.getTime() : NaN;
  const s1Valid = (sem1EndDate instanceof Date) && !Number.isNaN(sem1EndDate.getTime());
  const s2Valid = (sem2StartDate instanceof Date) && !Number.isNaN(sem2StartDate.getTime());

  if (!Number.isNaN(eTime)) {
    if (s1Valid && eTime <= sem1EndDate.getTime()) return 1;
    if (s2Valid && eTime >= sem2StartDate.getTime()) return 2;

    // Fallback heuristic when boundaries are invalid or ambiguous:
    // Academic year assumption: Term 1 = Sep–Jan; Term 2 = Feb–Jun
    const m = d.getMonth(); // 0..11
    // Jan (0) and Sep..Dec (8..11) => Term 1; Feb..Jun (1..5) => Term 2; Jul/Aug default to Term 1
    if (!s1Valid && !s2Valid) {
      if (m === 0 || m >= 8 || m === 6 || m === 7) return 1; // Jan or Sep-Dec or Jul/Aug → 1
      return 2; // Feb–Jun → 2
    }

    // If one boundary is valid, bias accordingly
    if (s1Valid && !s2Valid) return (eTime <= sem1EndDate.getTime()) ? 1 : 2;
    if (!s1Valid && s2Valid) return (eTime < sem2StartDate.getTime()) ? 1 : 2;
  }
  return 1; // conservative fallback
}

// Helper for safe date logging
function fmtDateISO(d) {
  return (d instanceof Date && !Number.isNaN(d.getTime()))
    ? d.toISOString().slice(0, 10)
    : 'invalid';
}

// Helper to compute min/max date range of a planner (array of weeks with entries)
function rangeFromPlanner(planner) {
  let minT = Infinity;
  let maxT = -Infinity;
  if (Array.isArray(planner)) {
    for (const week of planner) {
      if (!week || !Array.isArray(week.entries)) continue;
      for (const e of week.entries) {
        if (!e || !e.date) continue;
        const t = new Date(e.date).getTime();
        if (Number.isNaN(t)) continue;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
    }
  }
  return {
    minDate: Number.isFinite(minT) ? new Date(minT) : null,
    maxDate: Number.isFinite(maxT) ? new Date(maxT) : null
  };
}

// Ensures the DistributionProgress table exists for persistent unit allocation cursor


function buildUnitFetcher(currentRows) {
  // Cache parsed CSV per progress key; keep a runtime cursor per progress key
  const unitCache = new Map();   // progressKey => units[]
  const unitCursor = new Map();  // progressKey => idx
  const keyBySubj = new Map();   // subj::term => progressKey (memoize match)

  const makeProgressKey = (row) => `${row.start_year}:${row.end_year}:${row.class}:${row.division}:${row.razpredelenie}`;

  async function loadCursor(row) {
    const q = await pool.query(
      `SELECT next_index FROM "distributionprogress"
       WHERE start_year=$1 AND end_year=$2 AND class=$3 AND division=$4 AND file=$5 LIMIT 1`,
      [row.start_year, row.end_year, row.class, row.division, row.razpredelenie]
    );
    return q.rows.length ? (Number(q.rows[0].next_index) || 0) : 0;
  }

  async function saveCursor(row, idx) {
    await pool.query(
      `INSERT INTO "distributionprogress" (start_year,end_year,class,division,file,next_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (start_year,end_year,class,division,file)
       DO UPDATE SET next_index=EXCLUDED.next_index, updated_at=now()`,
      [row.start_year, row.end_year, row.class, row.division, row.razpredelenie, idx]
    );
  }

  // getNextUnit keeps the original signature and behavior, but advances a persistent cursor
  const getNextUnit = async function(subject, term) {
    const subKey = normalizeSubjectName(subject);
    const termNum = Number(term);
    const subjTermKey = `${subKey}::${termNum}`;

    let progressKey = keyBySubj.get(subjTermKey);
    let match;
    if (!progressKey) {
      // Prefer exact subject+term match; if missing, fall back to any term for same subject
      match = currentRows.find(row =>
        normalizeSubjectName(`${row.class} ${row.division}`) === subKey &&
        Number(row.term) === termNum &&
        row.razpredelenie
      );
      if (!match) {
        match = currentRows.find(row =>
          normalizeSubjectName(`${row.class} ${row.division}`) === subKey &&
          row.razpredelenie
        );
      }
      if (!match) {
        console.warn("getNextUnit: no currentSchedule match for", { subject: subKey, term: termNum });
        return {};
      }
      progressKey = makeProgressKey(match);
      keyBySubj.set(subjTermKey, progressKey);
    } else {
      // find a representative row to use for saving cursor
      match = currentRows.find(r => makeProgressKey(r) === progressKey);
    }

    if (!unitCache.has(progressKey)) {
      try {
        const units = await parseDistributionFile(match.razpredelenie);
        unitCache.set(progressKey, Array.isArray(units) ? units : []);
        const savedIdx = await loadCursor(match);
        unitCursor.set(progressKey, savedIdx);
        console.log(`Progress load for ${progressKey}: next_index=${savedIdx}`);
      } catch (e) {
        console.error("getNextUnit: failed to parse", match.razpredelenie, e);
        unitCache.set(progressKey, []);
        unitCursor.set(progressKey, 0);
      }
    }

    const list = unitCache.get(progressKey) || [];
    const idx = unitCursor.get(progressKey) || 0;
    if (idx >= list.length) {
      console.warn("getNextUnit: exhausted units for", { subject: subKey, term: termNum, progressKey });
      return {};
    }

    const result = list[idx] || {};
    unitCursor.set(progressKey, idx + 1); // advance in-memory cursor
    return result;
  };

  // Attach a flush method to persist all in-memory cursors without altering call sites
  getNextUnit.flush = async function() {
    for (const row of currentRows) {
      if (!row.razpredelenie) continue;
      const pk = makeProgressKey(row);
      if (unitCursor.has(pk)) {
        const idx = unitCursor.get(pk) || 0;
        await saveCursor(row, idx);
        console.log(`Progress save for ${pk}: next_index=${idx}`);
      }
    }
  };

  return getNextUnit;
}
router.get("/classes/meta", async (req, res) => {
  const { subject } = req.query;
  if (!subject) return res.status(400).json({ error: "Missing subject" });

  try {
    const result = await pool.query(`
      SELECT "isModule" FROM "ClassesList_2025_2026"
      WHERE "Class" || ' ' || "Division" = $1
      LIMIT 1
    `, [subject]);

    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });

    res.json({ is_module: result.rows[0].isModule });
  } catch (err) {
    console.error("Meta query error:", err);
    res.status(500).json({ error: "Failed to fetch metadata" });
  }
});

router.get("/schedule/current-with-entries", async (req, res) => {
  try {
    // Only show data if a year has been selected (exists in currentSchedule)
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

    // Extract unique subjects
    const subjects = [...new Set(scheduleEntries.rows.map(e => e.subject))];

    // Map: subject (e.g., "11 А") => isModule
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
        // fail safe: isModuleMap stays empty
        console.error("Failed to fetch class meta for isModule:", metaErr);
      }
    }

    // --- fetch all rows from currentSchedule table for this year ---
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

// 2. GET /schedule/available-years
router.get("/schedule/available-years", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT start_year, end_year 
      FROM "scheduleentries"
      ORDER BY start_year DESC, end_year DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching available schedules:", err);
    res.status(500).json({ error: "Failed to fetch available schedules." });
  }
});

// 3. POST /schedule/set-current
router.post("/schedule/set-current", async (req, res) => {
  const { start_year, end_year, class: classNum, division, schedule } = req.body;

  if (!start_year || !end_year || !classNum || !division) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    await pool.query(`DELETE FROM "currentSchedule"`); // clear previous current
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


// --- Resource file listing and reading ---
const fs = require("fs");
const path = require("path");

router.get("/schedule/resources", (req, res) => {
  const folderPath = path.join(__dirname, "../разпределения");
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error("Failed to list resource files:", err);
      return res.status(500).json({ error: "Failed to list files" });
    }
    res.json(files.filter(f => /\.(txt|pdf|docx|md|pages|numbers|xls|xlsx|csv)$/i.test(f)));
  });
});

router.get("/schedule/resource-file", (req, res) => {
  const { name } = req.query;
  const safeName = path.basename(name);
  const fullPath = path.join(__dirname, "../разпределения", safeName);
  res.sendFile(fullPath);
});


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

function parseDistributionFile(filename) {
  return new Promise((resolve, reject) => {
    try {
      const filePath = path.join(__dirname, "../разпределения", filename);
      const content = fs.readFileSync(filePath, "utf-8");
      const header = (content.split(/\r?\n/)[0] || "");
      const commaCount = (header.match(/,/g) || []).length;
      const semiCount = (header.match(/;/g) || []).length;
      const sep = semiCount > commaCount ? ";" : ",";

      const results = [];
      Readable.from(content)
        .pipe(csv({ separator: sep }))
        .on("data", (data) => {
          results.push({
            week: parseInt(data["Учебна седмица"]) || null,
            unit: (data["Тема"] || "").trim() || null,
            uniteType: (data["Вид"] || "").trim() || null,
            notes: (data["Бележки"] || "").trim() || null
          });
        })
        .on("end", () => {
          console.log(`parseDistributionFile: sep='${sep}', rows=${results.length}, file=${filename}`);
          resolve(results);
        })
        .on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}
// Preview units for a given subject+term using currentSchedule mapping
// GET /schedule/preview-units?subject=9%20Ж&term=1
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
    // Prefer exact subject+term; fall back to any term for that subject if exact is missing
    let match = currentRows.find(r =>
      normalizeSubjectName(`${r.class} ${r.division}`) === subKey &&
      Number(r.term) === tnum &&
      r.razpredelenie
    );
    if (!match) {
      match = currentRows.find(r =>
        normalizeSubjectName(`${r.class} ${r.division}`) === subKey &&
        r.razpredelenie
      );
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

// GET /schedule/preview-file?file=filename.csv
router.get("/schedule/preview-file", async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: "Missing file" });
  try {
    const safe = path.basename(file);
    const units = await parseDistributionFile(safe);
    res.json({ file: safe, count: units.length, sample: units.slice(0, 20) });
  } catch (err) {
    console.error("preview-file error:", err);
    res.status(500).json({ error: "Failed to parse file" });
  }
});

// GET /schedule/yearplan-range?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/schedule/yearplan-range", async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: "Missing start or end" });
  try {
    const result = await pool.query(
      `SELECT week_number, date, weekday, start_time, end_time,
              subject, unit, sectionInfo, uniteType, notes, duration, term, is_module
       FROM "yearplan"
       WHERE date BETWEEN $1::date AND $2::date
       ORDER BY date ASC, start_time ASC`,
      [start, end]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching yearplan range:", err);
    res.status(500).json({ error: "Failed to fetch yearplan range" });
  }
});

module.exports = router;

router.get("/schedule/by-year", async (req, res) => {
  const { start, end, term } = req.query;
  if (!start || !end) return res.status(400).json({ error: "Missing start or end year" });

  try {
    let query = `SELECT * FROM "scheduleentries" WHERE start_year = $1 AND end_year = $2`;
    const params = [start, end];

    if (term) {
      query += ` AND term = $3`;
      params.push(term);
    }

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching entries:", err);
    res.status(500).json({ error: "Failed to fetch entries." });
  }
});

// GET /schedule/weekly-current
router.get("/schedule/weekly-current", async (req, res) => {
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

    const weeklyRows = await pool.query(
      `SELECT weekday, start_time, end_time, subject, term, recurrence, week_parity
       FROM "scheduleentries"
       WHERE start_year = $1 AND end_year = $2
       ORDER BY 
         CASE 
           WHEN weekday = 'Monday' THEN 1
           WHEN weekday = 'Tuesday' THEN 2
           WHEN weekday = 'Wednesday' THEN 3
           WHEN weekday = 'Thursday' THEN 4
           WHEN weekday = 'Friday' THEN 5
           WHEN weekday = 'Saturday' THEN 6
           WHEN weekday = 'Sunday' THEN 7
         END,
         start_time`,
      [start_year, end_year]
    );

    res.json({
      hasCurrent: true,
      current: { start_year, end_year },
      weeklyRows: weeklyRows.rows
    });
  } catch (err) {
    console.error("Error fetching weekly current schedule:", err);
    res.status(500).json({ error: "Failed to fetch weekly current schedule." });
  }
});

router.post("/schedule/generate-year-plan", async (req, res) => {
  const { planner, semester1End, semester2Start, semester1EndISO, semester2StartISO } = req.body;
  console.log(`[GEN] RAW boundaries: semester1End='${semester1End}', semester2Start='${semester2Start}', ISO='${semester1EndISO}','${semester2StartISO}'`);
  const sem1EndDate = parseClientDate(semester1EndISO || semester1End);
  const sem2StartDate = parseClientDate(semester2StartISO || semester2Start);
  if (Number.isNaN(sem1EndDate.getTime()) || Number.isNaN(sem2StartDate.getTime())) {
    console.warn('[GEN] WARNING: Semester boundaries invalid; using month-based heuristic. s1End=', fmtDateISO(sem1EndDate), ' s2Start=', fmtDateISO(sem2StartDate));
  }
  if (!Array.isArray(planner)) return res.status(400).json({ error: "Invalid planner format." });

  try {
    // Load mapping for class/division → razpredelenie and isModule
    const { rows: current } = await pool.query(`
      SELECT cs.*, cl."isModule"
      FROM "currentSchedule" cs
      LEFT JOIN "ClassesList_2025_2026" cl
        ON cs.class = cl."Class" AND cs.division = cl."Division"
    `);

    const getNextUnit = buildUnitFetcher(current);

    // ---------- STEP 1: BUILD ALLOCATIONS IN MEMORY ----------
    const allocations = [];
    let weekIndex = 1;

    for (const week of planner) {
      for (const entry of week.entries) {
        // 1) Term resolution (client provided or by date)
        const computedTerm = resolveTerm(entry, sem1EndDate, sem2StartDate);
        entry.term = computedTerm; // ensure explicit
        console.log(`[GEN] TERM RESOLVED: ${entry.date} → ${computedTerm} (s1End=${fmtDateISO(sem1EndDate)}, s2Start=${fmtDateISO(sem2StartDate)})`);

        // 2) BIWEEKLY skip
        const recurrence = (entry.recurrence || "WEEKLY").toUpperCase();
        const parity = parseInt(entry.week_parity, 10) || 1; // 1 => Week A, 2 => Week B
        if (recurrence === "BIWEEKLY") {
          const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
          if (currentParity !== parity) {
            console.log(`SKIP (biweekly off-week): ${entry.date} ${entry.start_time}-${entry.end_time} — ${entry.subject} (Term ${computedTerm})`);
            continue;
          }
        }

        // 3) CSV unit selection
        const unitData = await getNextUnit(entry.subject, computedTerm);
        const pickedUnit = (unitData && Object.keys(unitData).length) ? unitData : null;

        // 4) Duration
        const [h1, m1] = (entry.start_time || "0:0").split(":").map(Number);
        const [h2, m2] = (entry.end_time   || "0:0").split(":").map(Number);
        const duration = (h2 * 60 + m2) - (h1 * 60 + m1);

        // 5) isModule lookup (safe)
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

        // 6) Push allocation (even if pickedUnit is null → will insert NULLs)
        const alloc = {
          week_number: weekIndex,
          date: entry.date,
          weekday: new Date(entry.date).toLocaleDateString("en-US", { weekday: "long" }),
          start_time: entry.start_time,
          end_time: entry.end_time,
          subject: entry.subject,
          unit: pickedUnit ? pickedUnit.unit : null,
          sectionInfo: pickedUnit ? pickedUnit.week : null,
          uniteType: pickedUnit ? pickedUnit.uniteType : null,
          notes: pickedUnit ? pickedUnit.notes : null,
          duration,
          term: computedTerm,
          is_module: isModuleFlag
        };

        allocations.push(alloc);

        // Debug line for visibility per-slot
        console.log(
          `ALLOC: ${alloc.date} ${alloc.start_time}-${alloc.end_time} — ${alloc.subject} (Term ${alloc.term}) → Unit: ${alloc.unit || "(none)"}${alloc.uniteType ? " ["+alloc.uniteType+"]" : ""}${alloc.sectionInfo ? " {week "+alloc.sectionInfo+"}" : ""}`
        );
      }
      weekIndex++;
    }

    console.log(`\nBuilt ${allocations.length} allocations total.`);
    const term1Count = allocations.filter(a => Number(a.term) === 1).length;
    const term2Count = allocations.filter(a => Number(a.term) === 2).length;
    console.log(`Term distribution → T1: ${term1Count}, T2: ${term2Count}`);

    // ---------- STEP 2: INSERT IN A SINGLE TRANSACTION ----------
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
      // --- Post-fix terms automatically (make sure sem2Start and range are valid) ---
      const { maxDate } = rangeFromPlanner(planner);
      if (sem2StartDate instanceof Date && !Number.isNaN(sem2StartDate.getTime()) && maxDate instanceof Date && !Number.isNaN(maxDate.getTime())) {
        const sem2ISO = fmtDateISO(sem2StartDate);
        const maxISO = fmtDateISO(maxDate);
        const r = await client.query(`
          UPDATE "generatedyearplan"
          SET term = 2
          WHERE date >= $1::date AND date <= $2::date
        `, [sem2ISO, maxISO]);
        console.log(`[GEN] Post-fix terms: set term=2 for ${r.rowCount} rows in generatedyearplan between ${sem2ISO} and ${maxISO}`);
      } else {
        console.warn('[GEN] Post-fix terms skipped (invalid sem2Start/maxDate).');
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
      inserted: allocations.length,
      term1: term1Count,
      term2: term2Count
    });
  } catch (err) {
    console.error("Error saving GeneratedYearPlan:", err);
    res.status(500).json({ error: "Failed to save planner." });
  }
});

// 8. POST /schedule/mirror-year-plan
router.post("/schedule/mirror-year-plan", async (req, res) => {
  const { planner, semester1End, semester2Start, semester1EndISO, semester2StartISO } = req.body;
  console.log(`[MIRROR] RAW boundaries: semester1End='${semester1End}', semester2Start='${semester2Start}', ISO='${semester1EndISO}','${semester2StartISO}'`);
  const sem1EndDate = parseClientDate(semester1EndISO || semester1End);
  const sem2StartDate = parseClientDate(semester2StartISO || semester2Start);
  if (Number.isNaN(sem1EndDate.getTime()) || Number.isNaN(sem2StartDate.getTime())) {
    console.warn('[MIRROR] WARNING: Semester boundaries invalid; using month-based heuristic. s1End=', fmtDateISO(sem1EndDate), ' s2Start=', fmtDateISO(sem2StartDate));
  }
  if (!Array.isArray(planner)) return res.status(400).json({ error: "Invalid planner format." });

  try {
    const client = await pool.connect();
    await client.query("BEGIN");
    let weekIndex = 1;
    let t1 = 0;
    let t2 = 0;

    const { rows: current } = await pool.query(`
      SELECT cs.*, cl."isModule"
      FROM "currentSchedule" cs
      LEFT JOIN "ClassesList_2025_2026" cl
        ON cs.class = cl."Class" AND cs.division = cl."Division"
    `);

    const getNextUnit = buildUnitFetcher(current);

    for (const week of planner) {
      for (const entry of week.entries) {
        // Determine term: prefer the entry.term computed on the client, fallback to date logic
        const computedTerm = resolveTerm(entry, sem1EndDate, sem2StartDate);
        if (computedTerm === 1) t1++;
        else if (computedTerm === 2) t2++;
        console.log(`[MIRROR] TERM RESOLVED: ${entry.date} → ${computedTerm} (s1End=${fmtDateISO(sem1EndDate)}, s2Start=${fmtDateISO(sem2StartDate)})`);
        // --- BIWEEKLY handling ---
        const recurrence = entry.recurrence || "WEEKLY";
        const parity = parseInt(entry.week_parity, 10) || 1;
        if (recurrence === "BIWEEKLY") {
          const currentParity = (weekIndex % 2) === 0 ? 2 : 1;
          if (currentParity !== parity) {
            continue; // skip this entry this week
          }
        }
        const unitData = await getNextUnit(entry.subject, computedTerm);
        // compute duration
        const [h1, m1] = entry.start_time.split(":").map(Number);
        const [h2, m2] = entry.end_time.split(":").map(Number);
        const duration = h2 * 60 + m2 - (h1 * 60 + m1);
        // compute isModule
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
        // insert into mirror table
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
    // --- Post-fix terms automatically (make sure sem2Start and range are valid) ---
    const { maxDate } = rangeFromPlanner(planner);
    if (sem2StartDate instanceof Date && !Number.isNaN(sem2StartDate.getTime()) && maxDate instanceof Date && !Number.isNaN(maxDate.getTime())) {
      const sem2ISO = fmtDateISO(sem2StartDate);
      const maxISO = fmtDateISO(maxDate);
      const r2 = await client.query(`
        UPDATE "yearplan"
        SET term = 2
        WHERE date >= $1::date AND date <= $2::date
      `, [sem2ISO, maxISO]);
      console.log(`[MIRROR] Post-fix terms: set term=2 for ${r2.rowCount} rows in yearplan between ${sem2ISO} and ${maxISO}`);
    } else {
      console.warn('[MIRROR] Post-fix terms skipped (invalid sem2Start/maxDate).');
    }
    console.log(`Mirror term distribution → T1: ${t1}, T2: ${t2}`);
    await client.query("COMMIT");
    if (getNextUnit && typeof getNextUnit.flush === 'function') {
      await getNextUnit.flush();
    }
    res.json({ message: "Mirror planner saved successfully.", term1: t1, term2: t2 });
  } catch (err) {
    console.error("Error mirroring planner:", err);
    res.status(500).json({ error: "Failed to mirror planner." });
  }
});
