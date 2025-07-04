// index.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
const multer = require("multer");
const fs = require("fs");

const upload = multer({ storage: multer.memoryStorage() });


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Настройка на връзката към PostgreSQL
const pool = new Pool({
  user: 'viktorvelkov',               // замени с твоето потребителско име
  host: 'localhost',
  database: 'viktorvelkov',        // замени с името на твоята база
  password: 'Errpass1',      // замени с паролата ти
  port: 5432
});
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
      savedFiles.push(path.basename(fullPath));
    };
 
    if (req.files.file1?.[0]) {
      saveFile(req.files.file1[0], 't'); // _t = assignment condition
    }

    if (req.files.file2?.[0]) {
      saveFile(req.files.file2[0], 's'); // _s = solution
    }

    if (savedFiles.length === 0) {
      return res.status(400).json({ error: "No files were uploaded." });
    }

// 🔁 Increment multiple_solutions if file was renamed (count > 1)
    if (renamed) {
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

    return res.status(200).json({ message: "Upload complete.", savedFiles });
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
        commentsArray
    } = req.body;
    
    console.log("inside exercises uploads");

    try {
    
        const result = await pool.query(
            `INSERT INTO "Exercises"
           ("Number", "Page", "ResourceID", "difficulty", "date_last_solved", "for_revision",
            "has_assignmentCondition", "has_solution","comments")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
                commentsArray
            ]
        );

        res.status(201).json({ id: result.rows[0].ID });
    } catch (err) {
        console.error("DB insert error:", err);
        res.status(500).send("❌ Failed to insert into Exercises");
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
    let query, params;

    if (appendFields.includes(field)) {
      // Detect type and cast accordingly
      let castType = "text";
      if (field === "date_last_solved" || field === "for_revision") {
        castType = "date";
      }

      query = `
        UPDATE "Exercises"
        SET "${field}" = array_append(COALESCE("${field}", '{}'), $1::${castType})
        WHERE "ID" = $2 RETURNING *`;
      params = [value, id];
    } else {
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
      `SELECT * FROM "Exercises" WHERE "ResourceID" = $1 AND "Page" = $2 AND "Number" = $3`,
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