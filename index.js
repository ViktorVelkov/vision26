// index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const multer = require("multer");
const fs = require("fs");
const scheduleRouter = require("./public/schedule");
const holidayRouter = require("./routes/holidays");
const upload = multer({ storage: multer.memoryStorage() });
const scheduleSelectionRouter = require("./routes/scheduleSelection");
const pool = require('./db');

app.use("/api", scheduleRouter);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/files', express.static('/Users/viktorvelkov/Documents'));
app.use("/holidays", holidayRouter);
app.use("/", scheduleSelectionRouter);
app.use('/lessons-calendar', require('./routes/lessonsCalendar'));
app.use('/lessons-library', require('./public/lessonsLibrary'));



/**
 * GET /lesson-skills?triplet=001001001
 * Returns all columns from "Snippets" for the given triplet.
 * Matches both the single-value "tripplet_lesson" and the array "lessons_in_tripplets".
 */
app.get('/lesson-skills', async (req, res) => {
  const triplet = req.query.triplet;
  if (!triplet) return res.status(400).json({ error: 'Missing triplet parameter' });
  try {
    const { rows } = await pool.query(
      `SELECT
         "id",
         "name",
         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
         "order",
         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
         "uslovie",
         "class"
       FROM "Snippets"
       WHERE ("tripplet_lesson" = $1::text)
          OR ($1::text = ANY ("lessons_in_tripplets"))
       ORDER BY "id" ASC`,
      [triplet]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error querying table Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /lesson-skills/:id
 * Updates any editable column of Snippets by id (except "id").
 * Expects body with one or more fields among:
 * name (text), keyWords (text[]), tripplet_lesson (text), associatedSnippet (int),
 * order (int), relatedTopic (text[]), lessons_in_tripplets (text[]),
 * associatedSnippets (int[]), uslovie (text), class (int)
 */
app.patch('/lesson-skills/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Helper casters
  const asTextArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const asIntArray  = (v) => Array.isArray(v) ? v.map(n=>parseInt(n,10)).filter(n=>Number.isInteger(n))
                                             : (typeof v === 'string' ? v.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isInteger(n)) : []);

  const allowed = {
    name:                { cast: null },
    keyWords:            { cast: 'text[]',   transform: asTextArray },
    tripplet_lesson:     { cast: null },
    associatedSnippet:   { cast: 'int' },
    order:               { cast: 'int' },
    relatedTopic:        { cast: 'text[]',   transform: asTextArray },
    lessons_in_tripplets:{ cast: 'text[]',   transform: asTextArray },
    associatedSnippets:  { cast: 'int[]',    transform: asIntArray },
    uslovie:             { cast: null },
    class:               { cast: 'int' }
  };

  const sets = [];
  const params = [];
  for (const [key, meta] of Object.entries(allowed)) {
    if (typeof req.body[key] === 'undefined') continue;
    let val = req.body[key];
    if (meta.transform) val = meta.transform(val);
    params.push(val);
    const idx = `$${params.length}`;
    if (meta.cast) {
      sets.push(`"${key}" = ${idx}::${meta.cast}`);
    } else {
      sets.push(`"${key}" = ${idx}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields provided' });

  params.push(id);
  const sql = `UPDATE "Snippets" SET ${sets.join(', ')} WHERE "id" = $${params.length}
               RETURNING "id","name",
                         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
                         "tripplet_lesson","associatedSnippet","order",
                         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
                         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
                         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
                         "uslovie","class"`;
  try {
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok:true, row: r.rows[0] });
  } catch (err) {
    console.error('Error updating Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /lesson-skills
 * Creates a new Snippets row. Body may contain any editable field; if `triplet`
 * is provided it will be used to prefill tripplet_lesson/lessons_in_tripplets.
 */
app.post('/lesson-skills', async (req, res) => {
  const body = req.body || {};
  const asTextArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const asIntArray  = (v) => Array.isArray(v) ? v.map(n=>parseInt(n,10)).filter(n=>Number.isInteger(n))
                                             : (typeof v === 'string' ? v.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isInteger(n)) : []);

  const triplet = body.triplet || body.tripplet_lesson || null;

  const cols = [
    'name','keyWords','tripplet_lesson','associatedSnippet','order',
    'relatedTopic','lessons_in_tripplets','associatedSnippets','uslovie','class'
  ];
  const vals = {
    name: body.name ?? null,
    keyWords: asTextArray(body.keyWords),
    tripplet_lesson: triplet ?? null,
    associatedSnippet: (body.associatedSnippet != null ? parseInt(body.associatedSnippet,10) : null),
    order: (body.order != null ? parseInt(body.order,10) : null),
    relatedTopic: asTextArray(body.relatedTopic),
    lessons_in_tripplets: (triplet ? asTextArray(body.lessons_in_tripplets || triplet) : asTextArray(body.lessons_in_tripplets)),
    associatedSnippets: asIntArray(body.associatedSnippets),
    uslovie: body.uslovie ?? null,
    class: (body.class != null ? parseInt(body.class,10) : null)
  };

  const params = [];
  const placeholders = [];
  const casts = {
    keyWords:'text[]', relatedTopic:'text[]', lessons_in_tripplets:'text[]', associatedSnippets:'int[]'
  };

  cols.forEach((c, i) => {
    params.push(vals[c]);
    const cast = casts[c] ? `::${casts[c]}` : '';
    placeholders.push(`$${i+1}${cast}`);
  });

  const sql = `INSERT INTO "Snippets" (${cols.map(c=>`"${c}"`).join(', ')})
               VALUES (${placeholders.join(', ')})
               RETURNING "id","name",
                         COALESCE(TO_JSON("keyWords"), '[]'::json)             AS "keyWords",
                         "tripplet_lesson","associatedSnippet","order",
                         COALESCE(TO_JSON("relatedTopic"), '[]'::json)         AS "relatedTopic",
                         COALESCE(TO_JSON("lessons_in_tripplets"), '[]'::json) AS "lessons_in_tripplets",
                         COALESCE(TO_JSON("associatedSnippets"), '[]'::json)   AS "associatedSnippets",
                         "uslovie","class"`;
  try {
    const r = await pool.query(sql, params);
    res.status(201).json({ ok:true, row: r.rows[0] });
  } catch (err) {
    console.error('Error inserting into Snippets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Настройка на връзката към PostgreSQL

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


app.post('/upload-a', upload.single("uploadedFileA"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded A.");
    console.log("Uploaded A:", req.file);
    res.send("✅ File A uploaded!");
});

app.post('/upload-b', upload.single("uploadedFileB"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded B.");
    console.log("Uploaded B:", req.file);
    res.send("✅ File B uploaded!");
});


// Примерен маркшрут за решенията на задачите. 
app.get('/upload', (req, res) => {
    res.sendFile(__dirname + '/public/exe_solutions.html');
});

// Примерен маршрут: взимане на всички домашни
app.get('/homeworks', async (req, res) => {
  try {
      const result = await pool.query('SELECT * FROM "Resources"');
      console.log(result.rows)
      res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/classes', async (req, res) => {
    try {
        const result = await pool.query('SELECT "Class", "Division" FROM "ClassesList_2025_2026"');

        const classes = result.rows.map(row => {
            const classValue = row.Class;    
            const divisionValue = row.Division; 
            return `${row["Class"]}${row["Division"] ? " " + row["Division"] : ""}`;
        });

        res.json(classes);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching classes');
    }
});

app.get('/lessons-taken', async (req, res) => {
  const className = req.query.className; // e.g., "11 А"
  if (!className) return res.status(400).json({ error: 'Missing className parameter' });

  // Parse grade and division (e.g., "11 А" -> 11, "А")
  const grade = parseInt(className, 10);
  const division = className.includes(' ')
    ? className.substring(className.indexOf(' ') + 1).trim()
    : '';

  // Build flexible patterns to match variations like "11 МодулА", "11-А", etc.
  // p1: exact or starts-with "11 А" (spaces optional)
  // p2: contains grade and division in order, with any text in between (e.g., "11 МодулА")
  const p1 = `${grade} ${division}`.trim();
  const p2 = `${grade}%${division}`.trim();

  try {
    const result = await pool.query(
      `SELECT 
         "id", 
         "class", 
         "name", 
         TO_CHAR("date", 'YYYY-MM-DD') AS "date", 
         "associatedLesson"
       FROM "lessons_taken"
       WHERE (
         ("class" ILIKE $1 || '%')
         OR ("class" ILIKE $2)
       )
       ORDER BY "date" DESC NULLS LAST, "id" DESC`,
      [p1, `%${p2}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error querying lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /lessons-taken/:id - update name, date, and/or associatedLesson
app.patch('/lessons-taken/:id', async (req, res) => {
  const { id } = req.params;
  const { name, date, associatedLesson } = req.body || {};

  if (!id) return res.status(400).json({ error: 'Missing id' });

  const sets = [];
  const params = [];

  if (typeof name === 'string') {
    params.push(name);
    sets.push(`"name" = $${params.length}`);
  }
  if (typeof associatedLesson === 'string' || typeof associatedLesson === 'number') {
    params.push(String(associatedLesson));
    sets.push(`"associatedLesson" = $${params.length}`);
  }
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    params.push(date);
    sets.push(`"date" = $${params.length}::date`);
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  params.push(id);

  const sql = `UPDATE "lessons_taken"
                 SET ${sets.join(', ')}
               WHERE "id" = $${params.length}
               RETURNING "id", "class", "name", TO_CHAR("date", 'YYYY-MM-DD') AS "date", "associatedLesson"`;

  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error('Error updating lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /lessons-taken - create new row
app.post('/lessons-taken', async (req, res) => {
  const { class: cls, name, date, associatedLesson } = req.body || {};
  if (!cls) return res.status(400).json({ error: 'Missing class' });
  if (!name && !associatedLesson && !date) {
    return res.status(400).json({ error: 'Provide at least one of name, date or associatedLesson' });
  }
  let dateParam = null;
  if (typeof date === 'string' && date.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    dateParam = date;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO "lessons_taken" ("class", "name", "date", "associatedLesson")
       VALUES ($1, $2, $3::date, $4)
       RETURNING "id", "class", "name", TO_CHAR("date", 'YYYY-MM-DD') AS "date", "associatedLesson"`,
      [cls, name || null, dateParam, associatedLesson || null]
    );
    res.status(201).json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error('Error inserting into lessons_taken:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /generatedyearplan?className=...
app.get('/generatedyearplan', async (req, res) => {
  const className = req.query.className;
  if (!className) return res.status(400).json({ error: 'Missing className parameter' });
  try {
    const { rows } = await pool.query(
      `SELECT 
         "id",
         TO_CHAR("date", 'YYYY-MM-DD') AS "date",
         "weekday",
         "unit",
         "unitetype",
         "lessonCreated",
         "lessonCode"
       FROM "generatedyearplan"
       WHERE "subject" = $1
       ORDER BY "date" ASC NULLS LAST, "id" ASC`,
      [className]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error querying generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /generatedyearplan/:id - update editable fields
app.patch('/generatedyearplan/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const { date, weekday, unit, unitetype, lessonCreated, lessonCode } = req.body || {};

  const sets = [];
  const params = [];

  if (typeof weekday === 'string') { params.push(weekday); sets.push(`"weekday" = $${params.length}`); }
  if (typeof unit === 'string') { params.push(unit); sets.push(`"unit" = $${params.length}`); }
  if (typeof unitetype === 'string') { params.push(unitetype); sets.push(`"unitetype" = $${params.length}`); }
  if (typeof lessonCode === 'string') { params.push(lessonCode); sets.push(`"lessonCode" = $${params.length}`); }
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD' });
    params.push(date); sets.push(`"date" = $${params.length}::date`);
  }
  if (typeof lessonCreated !== 'undefined') {
    // accept 'true'/'false'/'1'/'0' or boolean
    let val = lessonCreated;
    if (typeof val === 'string') {
      val = val.trim().toLowerCase();
      if (val === '1') val = true; else if (val === '0') val = false; else if (val === 'true') val = true; else if (val === 'false') val = false;
    }
    params.push(val === true);
    sets.push(`"lessonCreated" = $${params.length}::boolean`);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

  params.push(id);
  const sql = `UPDATE "generatedyearplan"
                 SET ${sets.join(', ')}
               WHERE "id" = $${params.length}
               RETURNING "id",
                         TO_CHAR("date", 'YYYY-MM-DD') AS "date",
                         "weekday","unit","unitetype","lessonCreated","lessonCode"`;
  try {
    const result = await pool.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    console.error('Error updating generatedyearplan:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get("/students/search", async (req, res) => {
    const name = req.query.name || "";
    console.log("Received search for:", name); // 🔍 log input

    try {
        const result = await pool.query(
            `SELECT "Students"."ID", "Students"."First_Name", "Students"."Sirname"
       FROM "Students"
       WHERE "Students"."First_Name" ILIKE $1 OR "Students"."Sirname" ILIKE $1
       ORDER BY "Students"."First_Name"`,
            [`%${name}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Search query failed:", err);
        res.status(500).json({ error: "Failed to fetch students" });
    }
});

app.get('/students', async (req, res) => {
    const className = req.query.className; // e.g., "11 Б"
    if (!className) return res.status(400).json({ error: 'Missing className parameter' });

    const cls = parseInt(className); // gets 11 from "11 А"
    const div = className.substring(className.indexOf(' ') + 1); // gets "А"

    console.log(`Parsed class: ${cls}, division: ${div}`);
    try {
        const result = await pool.query(
            `SELECT "ID" AS id, "First_Name" AS first_name, "Sirname" AS sirname FROM "Students" WHERE "Grade" = $1 AND "Division" = $2 ORDER BY "First_Name", "Sirname";`,
            [cls, div]
        );
       
        console.log(`🎓 Students retrieved for ${cls} ${div}:`, result.rows);

        res.json(result.rows);
    } catch (err) {
        console.error('Error querying students:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post("/submit-activity", async (req, res) => {
    const { activity } = req.body;

    if (!Array.isArray(activity)) {
        return res.status(400).json({ error: "Invalid format" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const entry of activity) {
            await client.query(
                `INSERT INTO "Activity_In_Class" ("Students_ID", "Date", "Activity_status")
         VALUES ($1, $2, $3)
         ON CONFLICT ("Students_ID", "Date")
         DO UPDATE SET "Activity_status" = EXCLUDED."Activity_status"`,
                [entry.student_id, entry.date, entry.mark]
            );
           
        }
        // Extract class info from request 
        const className = req.body.className || "Unknown";
        const date = req.body.activity?.[0]?.date || null; // or however you're extracting the activity date
        await client.query(
            `INSERT INTO "Class_Submission_Log" ("Class","Assigned_At") VALUES ($1,$2)`,
            [className,date]
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error saving activity:", err);
        res.status(500).json({ error: "Database error" });

    } finally {
        client.release();
    }
});



app.get("/submission-logs", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT "Class", 
             TO_CHAR("Assigned_At", 'YYYY-MM-DD') AS "assigned_at",
             TO_CHAR("Inserted_At", 'YYYY-MM-DD HH24:MI') AS "inserted_at"
      FROM "Class_Submission_Log"
      ORDER BY "Inserted_At" DESC
      LIMIT 20
    `);
        res.json(result.rows);
    } catch (err) {
        console.error("Failed to fetch submission logs:", err);
        res.status(500).json({ error: "Failed to fetch submission logs" });
    }
});


app.get("/resources/keywords", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT 
        r."ID", 
        r."KeyWords", 
        rt."Type" AS "SourceType"
      FROM 
        "Resources" r
      JOIN 
        "ResourceType" rt 
      ON 
        r."SourceType" = rt."ID"
      ORDER BY 
        r."KeyWords"
    `);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching keywords:", err);
        res.status(500).send("Error fetching resources.");
    }
});


app.post("/custom-upload", upload.fields([
  { name: "file1", maxCount: 1 },
  { name: "file2", maxCount: 1 }
]), async (req, res) => {
  const name = req.body.name; // Should be like '001_005_002'
  const baseDir = "/Users/viktorvelkov/Documents/AssignementConditions+Solutions";
  let renamed = false;

  if (!name) {
    return res.status(400).json({ error: "Missing file name." });
  }

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const savedFiles = [];
    let flag = true;

    let textFileFullPath = null;
    let solutionFileFullPath = null;

    const saveFile = (file, suffix) => {
      const ext = path.extname(file.originalname);
      const baseName = `${name}_${suffix}`;
      let fullPath = path.join(baseDir, baseName + ext);
      let counter = 1;

      // Avoid overwriting existing files
      while (fs.existsSync(fullPath)) {
        fullPath = path.join(baseDir, `${baseName}_${counter}${ext}`);
        counter++;
        renamed = true;
      }

      fs.writeFileSync(fullPath, file.buffer);
      if (suffix === 't') textFileFullPath = fullPath;
      if (suffix === 's') solutionFileFullPath = fullPath;
      savedFiles.push(path.basename(fullPath));
    };
 
    if (req.files.file1?.[0]) {
        saveFile(req.files.file1[0], 't'); // _t = assignment condition
        flag = false;
    }

    if (req.files.file2?.[0]) {
      saveFile(req.files.file2[0], 's'); // _s = solution 
    }

    if (savedFiles.length === 0) {
      return res.status(400).json({ error: "No files were uploaded." });
    }

// 🔁 Increment multiple_solutions if file was renamed (count > 1)
    if (renamed && flag) {
        try {
            const updateQuery = `
                UPDATE "Exercises"
                SET "multiple_solutions" = COALESCE("multiple_solutions", 1) + 1
                WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3
            `;
            await pool.query(updateQuery, [
                req.body.resourceID,
                req.body.page,
                req.body.number
                ]);
            console.log("🔁 multiple_solutions incremented.");
        } catch (err) {
            console.error("❌ Failed to increment multiple_solutions:", err);
        }
    }

    return res.status(200).json({
      message: "Upload complete.",
      savedFiles,
      text_filepath: textFileFullPath,
      solution_filepath: solutionFileFullPath
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "File saving failed." });
  }
});

app.post("/exercises", async (req, res) => {
    const {
        number,
        page,
        resourceID,
        difficulty,
        date_last_solved,
        for_revision,
        has_assignmentCondition,
        has_solution,
        commentsArray,
        text_filepath,
        solution_filepath
    } = req.body;
    
    console.log(solution_filepath);
    console.log(text_filepath);
    
    try {
    
        const result = await pool.query(
            `INSERT INTO "Exercises"
           ("Number", "Page", "ResourceID", "difficulty", "date_last_solved", "for_revision",
            "has_assignmentCondition", "has_solution", "comments", "text_filepath", "solution_filepath")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING "ID"`,
            [
                number,
                page,
                resourceID,
                difficulty,
                date_last_solved,
                for_revision,
                has_assignmentCondition,
                has_solution,
                commentsArray,
                text_filepath,
                solution_filepath
            ]
        );

         const exerciseId = result.rows[0].ID;

        // 2️⃣ Вмъкване и в exercises_snippets_relationship
        await client.query(
            `INSERT INTO "exercises_snippets_relationship" 
             ("resource", "number", "page")
             VALUES ($1, $2, $3)`,
            [resourceID, number, page]
        );

        await client.query("COMMIT");

        res.status(201).json({ id: exerciseId });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("DB insert error:", err);
        res.status(500).send("❌ Failed to insert into Exercises and relationship table");
    } finally {
        client.release();
    }
});
// Search relationships by relatedSnippet only
app.get('/exercises-rel/search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.json([]);

  // приемаме няколко ID-та, разделени със запетаи, интервали или ; 
  const ids = qRaw
    .split(/[\s,;]+/)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isInteger(n));

  if (!ids.length) return res.json([]);

  try {
    const { rows } = await pool.query(
      `SELECT "resource","number","page","relatedSnippet","comments"
         FROM "exercises_snippets_relationship"
         WHERE "relatedSnippet" = ANY($1::int[])
         ORDER BY "resource","relatedSnippet"
         LIMIT 200`,
      [ids]
    );
    res.json(rows);
  } catch (err) {
    console.error('exercises-rel/search failed:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /assessment-log — запис в таблица "assesment_log"
app.post('/assessment-log', async (req, res) => {
  const { class: rawClass, class_division, lesson_tripplet, className } = req.body || {};
  console.log('📥 /assessment-log payload:', req.body);

  // Парсиране на class от число или низ („11“, „11 А“)
  let cls = null;
  if (Number.isInteger(rawClass)) {
    cls = rawClass;
  } else if (typeof rawClass === 'string') {
    const m = rawClass.match(/\d+/);
    if (m) cls = parseInt(m[0], 10);
  } else if (typeof className === 'string') {
    const m = className.match(/\d+/);
    if (m) cls = parseInt(m[0], 10);
  }

  // Триплетът трябва да е непразен низ и да не е шаблон като ${...}
  let triplet = null;
  if (typeof lesson_tripplet === 'string') {
    const t = lesson_tripplet.trim();
    if (t && !(t.startsWith('${') && t.endsWith('}'))) triplet = t;
  }

  const div = (typeof class_division === 'string') ? class_division : '';

  // ❗ Строга валидация — НЕ записваме ако липсват стойности
  if (!Number.isInteger(cls) || !triplet) {
    console.warn('⚠️ /assessment-log validation failed:', { cls, triplet });
    return res.status(400).json({
      error: 'Invalid payload',
      details: { class_received: rawClass, parsed_class: cls, class_division: div, lesson_tripplet }
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO "assesment_log" ("timedAt","class","class_division","lesson_tripplet")
       VALUES (NOW(), $1, $2, $3)
       RETURNING "id",
                 TO_CHAR("timedAt", 'YYYY-MM-DD HH24:MI:SS') AS "timed_at",
                 "class","class_division","lesson_tripplet"`,
      [cls, div, triplet]
    );
    res.status(201).json({ ok: true, log: rows[0] });
  } catch (err) {
    console.error('Error inserting into assesment_log:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /assessment-log — list recent submissions (optional filters: className, triplet)
app.get('/assessment-log', async (req, res) => {
  const className = req.query.className || '';
  const triplet = req.query.triplet || '';
  // Parse class number and division
  let cls = null, div = '';
  if (className){
    cls = parseInt(className, 10);
    if (className.includes(' ')) div = className.substring(className.indexOf(' ') + 1).trim();
  }
  const where = [];
  const params = [];
  if (Number.isInteger(cls)) { params.push(cls); where.push(`"class" = $${params.length}`); }
  if (div) { params.push(div); where.push(`"class_division" ILIKE $${params.length}`); }
  if (triplet) { params.push(triplet); where.push(`"lesson_tripplet" = $${params.length}`); }

  const sql = `SELECT id,
                      TO_CHAR("timedAt", 'YYYY-MM-DD HH24:MI') AS timedAt,
                      "class","class_division","lesson_tripplet"
               FROM "assesment_log"
               ${where.length?('WHERE '+where.join(' AND ')):''}
               ORDER BY "timedAt" DESC, id DESC
               LIMIT 100`;
  try{
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }catch(err){
    console.error('GET /assessment-log failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch("/update-exercise", async (req, res) => {
  const { id, field, value } = req.body;

  const appendFields = ["comments", "date_last_solved", "for_revision"];
  const allowedFields = [
    "Difficulty",
    "multiple_solutions",
    "has_solution",
    "has_assignmentCondition",
    ...appendFields
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: "Invalid field" });
  }
  
  try {
    // let query, params;

    // if (appendFields.includes(field)) {
    //   // Detect type and cast accordingly
    //   let castType = "text";
    //   if (field === "date_last_solved" || field === "for_revision") {
    //       console.log(params);
    // if (field === "date_last_solved" || field === "for_revision") {
    // query = `
    //     UPDATE "Exercises"
    //     SET "${field}" = array_append(COALESCE("${field}", '{}'::date[]), $1::date)
    //     WHERE "ID" = $2 RETURNING *`;
    // params = [value, id];
    // }
    //   }
    // else if (field === "comments") {
    //     query = `
    //         UPDATE "Exercises"
    //         SET "comments" = $1::text[]
    //         WHERE "ID" = $2 RETURNING *`;
    //     params = [value, id];
    //     }
    //   else {
    //   console.log("can i get a heyo")
    //         query = `
    //     UPDATE "Exercises"
    //     SET "${field}" = $1
    //     WHERE "ID" = $2 RETURNING *`;
    //     params = [value, id];    }
    // } 
        let query, params;

        if (appendFields.includes(field)) {
        if (field === "date_last_solved" || field === "for_revision") {
            query = `
            UPDATE "Exercises"
            SET "${field}" = array_append(COALESCE("${field}", '{}'::date[]), $1::date)
            WHERE "ID" = $2 RETURNING *`;
            params = [value, id];
        } else if (field === "comments") {
            query = `
            UPDATE "Exercises"
            SET "comments" = $1::text[]
            WHERE "ID" = $2 RETURNING *`;
            params = [value, id];
        }
        } else {
        // All other fields, including has_assignmentCondition
        query = `
            UPDATE "Exercises"
            SET "${field}" = $1
            WHERE "ID" = $2 RETURNING *`;
        params = [value, id];
        }
            const result = await pool.query(query, params);
            res.json(result.rows[0]);
        } catch (err) {
            console.error("❌ DB update error:", err);
            res.status(500).json({ error: "Update failed" });
        }
        });

app.get("/exercise-details", async (req, res) => {
  const { resourceID, page, number } = req.query;

  if (!resourceID || !page || !number) {
    return res.status(400).json({ error: "Missing query parameters" });
  }

  try {
    const result = await pool.query(
      `SELECT 
            "ID", "Number", "Page", "ResourceID", "difficulty",
            ARRAY(
                SELECT TO_CHAR(d, 'YYYY-MM-DD')
                FROM UNNEST("date_last_solved") AS d
            ) AS "date_last_solved",
            ARRAY(
                SELECT TO_CHAR(r, 'YYYY-MM-DD')
                FROM UNNEST("for_revision") AS r
            ) AS "for_revision",
            "has_assignmentCondition", "has_solution", "comments", "multiple_solutions"
            FROM "Exercises"
            WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3`,
      [resourceID, page, number]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Exercise not found" });
    }
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Failed to retrieve exercise." });
  }
});

// Lightweight search by ID or triple (ResourceID-Page-Number OR Number-Page-ResourceID)
app.get('/exercises/search', async (req, res) => {
  const qRaw = (req.query.q || '').trim();
  if (!qRaw) return res.json([]);

  // helper
  const tripleRe = /^0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)[.\-_\s/–—−‑‒]+0*(\d+)$/;

  try {
    // Case 1: pure numeric -> treat as ID
    if (/^\d+$/.test(qRaw)) {
      const { rows } = await pool.query(
        `SELECT "ID","ResourceID","Page","Number",
                "has_assignmentCondition","has_solution","multiple_solutions",
                "text_filepath","solution_filepath"
           FROM "Exercises"
          WHERE "ID" = $1
          LIMIT 50`,
        [parseInt(qRaw, 10)]
      );
      return res.json(rows);
    }

    // Case 2: triple with separators
    const m = qRaw.match(tripleRe);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const c = parseInt(m[3], 10);
      const { rows } = await pool.query(
        `SELECT "ID","ResourceID","Page","Number",
                "has_assignmentCondition","has_solution","multiple_solutions",
                "text_filepath","solution_filepath"
           FROM "Exercises"
          WHERE ("ResourceID" = $1 AND "Page" = $2 AND "Number" = $3)
             OR ("Number" = $1 AND "Page" = $2 AND "ResourceID" = $3)
          LIMIT 50`,
        [a, b, c]
      );
      return res.json(rows);
    }

    // Otherwise return empty
    return res.json([]);
  } catch (err) {
    console.error('exercises/search failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post("/schedule/save", async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: "Invalid data format." });

  const query = `
    INSERT INTO "scheduleentries" (
      start_year, end_year, term, weekday, start_time, end_time, subject, recurrence, week_parity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const entry of entries) {
      const {
        start_year,
        end_year,
        term,
        weekday,
        start_time,
        end_time,
        subject,
        recurrence,
        week_parity
      } = entry;

      if (
        !start_year || !end_year || !term || !weekday ||
        !start_time || !end_time || !subject
      ) continue;

      await client.query(query, [
        start_year,
        end_year,
        term,
        weekday,
        start_time,
        end_time,
        subject,
        recurrence || "WEEKLY",
        week_parity || 1
      ]);
    }

    await client.query("COMMIT");
    res.json({ message: "Schedule saved successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error saving schedule:", err);
    res.status(500).json({ error: "Failed to save schedule." });
  } finally {
    client.release();
  }
});

