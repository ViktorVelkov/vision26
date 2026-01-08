document.querySelectorAll('#viewSwitch .switch-btn').forEach(btn => {    btn.addEventListener('click', () => {
    document.querySelectorAll('#viewSwitch .switch-btn').forEach(b => b.classList.remove('active'));        btn.classList.add('active');

        const mode = btn.getAttribute('data-mode');

        document.getElementById('uploadSection').style.display = mode === 'upload' ? 'block' : 'none';
        document.getElementById('manageSection').style.display = mode === 'manage' ? 'block' : 'none';
    });
});

// === Manage Records: search mode switch (tuple vs id) ===
let manageSearchMode = 'tuple';

function setManageSearchMode(mode) {
  manageSearchMode = (mode === 'id') ? 'id' : 'tuple';

  const btnTuple = document.getElementById('mrModeTuple');
  const btnId = document.getElementById('mrModeId');
  const tupleWrap = document.getElementById('tupleSearchFields');
  const idWrap = document.getElementById('idSearchField');

  if (btnTuple && btnId) {
    btnTuple.classList.toggle('active', manageSearchMode === 'tuple');
    btnId.classList.toggle('active', manageSearchMode === 'id');
  }

  if (tupleWrap) tupleWrap.style.display = (manageSearchMode === 'tuple') ? 'block' : 'none';
  if (idWrap) idWrap.style.display = (manageSearchMode === 'id') ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const btnTuple = document.getElementById('mrModeTuple');
  const btnId = document.getElementById('mrModeId');

  if (btnTuple) btnTuple.addEventListener('click', () => setManageSearchMode('tuple'));
  if (btnId) btnId.addEventListener('click', () => setManageSearchMode('id'));

  setManageSearchMode('tuple');
});

document.getElementById("fileClear1").addEventListener("click", async() => {
    document.getElementById("file1").value = "";
})

document.getElementById("fileClear2").addEventListener("click", async() => {
    document.getElementById("file2").value = "";
})

//
document.getElementById("clear_MR").addEventListener("click", async() => {
    resetManageForm();
    document.getElementById("searchBtnA").click();
});

// For uploadBtnB - 
document.getElementById("uploadBtnB").addEventListener("click", async () => {
    const name = document.getElementById("name").value.trim();
    const file1 = document.getElementById("file1").files[0];
    const file2 = document.getElementById("file2").files[0];

    if (!name) {
        alert("❌ Error: Name not generated.");
        return;
    }

    if (!file1 && !file2) {
        alert("❌ Error: No files uploaded to the form.");
        return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("resourceID", document.getElementById("keywordDropdown").value);
    formData.append("page", document.getElementById("Page").value);
    formData.append("number", document.getElementById("Number").value);

    if (file1) formData.append("file1", file1);
    if (file2) formData.append("file2", file2);

    try {
        const response = await fetch("/custom-upload", {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            alert("✅ Files uploaded successfully.");
            // Now that upload is successful, insert into DB
            await handleUploadAndInsert({
                textPath: result.text_filepath || null,
                solPath: result.solution_filepath || null
            });
        } else {
            alert("❌ Upload failed: " + (result.error || result.message));
        }

    } catch (err) {
        alert("❌ Upload failed: " + err.message);
    }
    // 
    resetUploadForm();
});


document.addEventListener("DOMContentLoaded", () => {
    function pad(value) {
        return value.toString().padStart(3, '0');
    }

    function generateFileName() {
        const source = document.getElementById("keywordDropdown")?.value || "";
        const page = document.getElementById("Page")?.value || "";
        const number = document.getElementById("Number")?.value || "";

        if (!source || !page || !number) return "";
        return `${pad(source)}_${pad(page)}_${pad(number)}`;
    }

    function updateNameAutomatically() {
        const nameField = document.getElementById("name");
        if (nameField) {
            nameField.value = generateFileName();
        }
    }

    // Trigger name update whenever any field changes
    ["keywordDropdown", "Page", "Number"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", updateNameAutomatically);
        }
    });

    // Also call once to populate on page load (if fields are pre-filled)
    updateNameAutomatically();
});

document.addEventListener("DOMContentLoaded", async () => {
    const dropdown = document.getElementById("keywordDropdown");

    try {
        const res = await fetch("/resources/keywords");
        const data = await res.json();

        data.forEach(resource => {
            const option = document.createElement("option");
            option.value = resource.ID; // or another identifier if needed
            option.textContent = `${resource.ID} -- ${resource.KeyWords} (${resource.SourceType})`;
            dropdown.appendChild(option);

        });
    } catch (err) {
        console.error("Error fetching resources:", err);
    }
    // second dropdown inside the management section
    populateManageResourcesDropdown()
});


const fileText = document.getElementById("file1");       // ✅ corresponds to "Качване на условие"
const fileSolution = document.getElementById("file2");   // ✅ corresponds to "Качване на решение"



// Upload logic
function submitFormWithFile(file) {
    const formData = new FormData();
    formData.append("uploadedFile", file);

    fetch("/upload", {
        method: "POST",
        body: formData,
    })
        .then((res) => res.text())
        .then((msg) => alert(msg))
        .catch((err) => console.error("Upload failed:", err));
}

async function handleUploadAndInsert(paths = {}) {
    const { textPath = null, solPath = null } = paths;

    // Helper: patch a single field via /update-exercise
    async function patchExerciseField(id, field, value) {
        const res = await fetch("/update-exercise", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, field, value })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            console.error('PATCH /update-exercise failed', { id, field, value, status: res.status, body: t });
            throw new Error(`Update failed for ${field} (HTTP ${res.status}): ${t}`);
        }
        return res.json();
    }

    // Helper: load existing exercise by tuple (resourceID/page/number)
    async function loadExistingByTuple(resourceID, page, number) {
        const url = `/exercise-details?resourceID=${encodeURIComponent(resourceID)}&page=${encodeURIComponent(page)}&number=${encodeURIComponent(number)}`;
        const res = await fetch(url);
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            console.warn('GET /exercise-details not ok', { url, status: res.status, body: t });
            return null;
        }
        const j = await res.json().catch(() => null);
        if (!j) {
            console.warn('GET /exercise-details returned non-JSON', { url });
            return null;
        }
        return j;
    }

    try {
        const file1 = document.getElementById("file1").files[0];
        const file2 = document.getElementById("file2").files[0];
        const commentsHereFromHTML = document.getElementById("comments").value.trim() || null;
        const dateLastSolvedInput = document.getElementById("dateLastSolved").value;
        const forRevisionInput = document.getElementById("dateForRevision").value;

        const textInput = document.getElementById("altText").value.trim();
        const solutionInput = document.getElementById("altSolution").value.trim();
        const textFilePath = textInput || textPath || null;
        const solutionFilePath = solutionInput || solPath || null;

        // NEW: read Topic (text) and KeyWords (comma-separated -> text[])
        const topicRaw = (document.getElementById('ex_topic')?.value || '').trim();
        const keyWordsRaw = (document.getElementById('ex_keywords')?.value || '').trim();
        const keyWordsArr = keyWordsRaw
            ? keyWordsRaw.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        const date_last_solved_array = dateLastSolvedInput ? [dateLastSolvedInput] : [];
        const for_revision_array = forRevisionInput ? [forRevisionInput] : [];
        const commentsHere = commentsHereFromHTML ? [commentsHereFromHTML] : [];

        const exerciseData = {
            number: document.getElementById("Number").value,
            page: document.getElementById("Page").value,
            resourceID: document.getElementById("keywordDropdown").value,
            difficulty: document.getElementById("difficulty").value,
            date_last_solved: date_last_solved_array || null,
            for_revision: for_revision_array || null,
            has_assignmentCondition: !!file1,
            has_solution: !!file2,
            commentsArray: commentsHere,
            text_filepath: textFilePath,
            solution_filepath: solutionFilePath,
            // NEW fields
            topic: topicRaw || null,
            keyWords: keyWordsArr
        };

        // 1) Try normal path: POST /exercises (returns {id, reused})
        let result = null;
        let newId = null;
        let reused = false;

        const res = await fetch("/exercises", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(exerciseData)
        });

        if (res.ok) {
            result = await res.json();
            newId = (result && (result.id ?? result.ID ?? result.exerciseID ?? (result.row && (result.row.id ?? result.row.ID)))) || null;
            reused = !!(result && result.reused);
            console.log('Insert /exercises result =', result, '=> newId =', newId, 'reused =', reused);
        } else {
            // 2) Fallback: if insert/find fails for any reason, try to load the existing row by tuple.
            const t = await res.text().catch(() => '');
            console.warn('POST /exercises not ok, falling back to /exercise-details. Status:', res.status, 'Body:', t);

            const existing = await loadExistingByTuple(exerciseData.resourceID, exerciseData.page, exerciseData.number);
            if (!existing || !existing.ID) {
                throw new Error(`Failed to insert/find exercise and could not load by tuple: ${t || ('HTTP ' + res.status)}`);
            }
            newId = parseInt(existing.ID, 10);
            reused = true;
            result = { id: newId, reused: true, fallback: true };
            console.log('Fallback existing exercise loaded => newId =', newId);
        }

        // If the exercise already exists, we do NOT stop.
        // Instead: load the existing row and, if the uploaded side is missing, update it.
        let updatedSomething = false;
        if (reused) {
            const existing = await loadExistingByTuple(exerciseData.resourceID, exerciseData.page, exerciseData.number);
            // existing may be null if endpoint fails; in that case we still try to patch blindly.

            const canTrustExisting = !!existing;
            const hasTextNow = canTrustExisting ? !!existing.has_assignmentCondition : false;
            const hasSolNow = canTrustExisting ? !!existing.has_solution : false;
            const textPathNow = canTrustExisting ? (existing.text_filepath || null) : null;
            const solPathNow = canTrustExisting ? (existing.solution_filepath || null) : null;

            // If we couldn't load the row, don't block the update — try to patch anyway.
            const needTextPatch = !!file1 && (!!textFilePath) && (!canTrustExisting || !hasTextNow || !textPathNow);
            const needSolPatch  = !!file2 && (!!solutionFilePath) && (!canTrustExisting || !hasSolNow || !solPathNow);

            if (!canTrustExisting) {
                console.warn('Could not load existing row via /exercise-details; will attempt PATCH anyway.', {
                    tuple: { resourceID: exerciseData.resourceID, page: exerciseData.page, number: exerciseData.number },
                    newId,
                    needTextPatch,
                    needSolPatch
                });
            }

            if (needTextPatch) {
                await patchExerciseField(newId, 'has_assignmentCondition', true);
                await patchExerciseField(newId, 'text_filepath', textFilePath);
                updatedSomething = true;
            }

            if (needSolPatch) {
                await patchExerciseField(newId, 'has_solution', true);
                await patchExerciseField(newId, 'solution_filepath', solutionFilePath);
                updatedSomething = true;
            }
            // If nothing needed updating, we still treat the action as successful.
        }

        // Try to persist extra fields (topic, keyWords) in case /exercises ignores them
        try {
            if (newId) {
                const r2 = await fetch(`/exercises/${newId}/extras`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: exerciseData.topic, keyWords: exerciseData.keyWords })
                });
                if (!r2.ok) {
                    const t = await r2.text();
                    console.warn('extras update not ok:', t);
                }
                // Fallback: if :id extras patch fails (or endpoint missing), try tuple-based extras update.
                if (!r2.ok) {
                    try {
                        await fetch(`/exercises/extras-by-tuple`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                resourceID: exerciseData.resourceID,
                                page: exerciseData.page,
                                number: exerciseData.number,
                                topic: exerciseData.topic,
                                keyWords: exerciseData.keyWords
                            })
                        });
                    } catch (_) {}
                }
            } else {
                console.warn('No newId from /exercises insert; extras not patched');
            }
        } catch (e) {
            console.warn('extras update failed:', e && e.message ? e.message : e);
        }

        if (reused) {
            if (updatedSomething) {
                alert(`✅ Упражнението вече съществуваше (ID ${newId}), но липсващото условие/решение беше добавено.`);
            } else {
                alert(`ℹ️ Упражнението вече съществуваше (ID ${newId}) и вече има качено условие/решение. Няма промяна.`);
            }
        } else {
            alert("✅ Exercise saved successfully" + (newId ? (": ID " + newId) : ''));
        }

    } catch (err) {
        console.error('handleUploadAndInsert failed (full):', err);
        alert("❌ Грешка при запис/ъпдейт: " + (err && err.message ? err.message : String(err)));
    }
}


function normalizePath(fp) {
  let s = (fp == null) ? '' : String(fp);
  s = s.trim();
  // Strip wrapping single/double quotes if the DB value includes them, e.g. '/Users/.../Scan 1.pdf'
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function getProxyUrl(fp) {
  const s = normalizePath(fp);
  if (!s) return '';
  return `/file-proxy?path=${encodeURIComponent(s)}`;
}

function getPreviewUrl(fp) {
  const s = normalizePath(fp);
  if (!s) return '';
  return `/file-preview?path=${encodeURIComponent(s)}`;
}

function isPdf(fp) {
  const s = normalizePath(fp).toLowerCase();
  return s.endsWith('.pdf');
}

function isImage(fp) {
  const s = normalizePath(fp).toLowerCase();
  return s.endsWith('.jpg') || s.endsWith('.jpeg') || s.endsWith('.png') || s.endsWith('.gif') || s.endsWith('.webp') || s.endsWith('.bmp');
}

function previewHtmlBig(fp) {
  if (!fp) {
    return '<div style="padding:20px;color:#777">— няма файл —</div>';
  }

  const openUrl = getProxyUrl(fp);     // original file
  const viewUrl = getPreviewUrl(fp);   // converted/previewable version when needed

  // PDF preview
  if (isPdf(fp)) {
    return `
      <div style="width:100%; height:100%; background:#fff;">
        <iframe src="${viewUrl}" style="width:100%; height:100%; border:0"></iframe>
      </div>
      <div style="padding:8px 12px; border-top:1px solid #e2e8f0;">
        <a href="${openUrl}" target="_blank" rel="noopener">Open</a>
      </div>
    `;
  }

  // Images (including TIFF/HEIC after conversion)
  return `
    <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#fff;">
      <img src="${viewUrl}" alt="preview" style="max-width:100%; max-height:100%; object-fit:contain;" />
    </div>
    <div style="padding:8px 12px; border-top:1px solid #e2e8f0;">
      <a href="${openUrl}" target="_blank" rel="noopener">Open</a>
    </div>
  `;
}

function previewHtml(fp) {
  if (!fp) return '<span style="color:#64748b;">—</span>';
  const url = getPreviewUrl(fp);

  if (isPdf(fp)) {
    return `
      <div style="width:260px; height:180px; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; background:#fff;">
        <iframe src="${url}" style="width:100%; height:100%; border:0;"></iframe>
      </div>
      <div style="margin-top:6px;"><a href="${getProxyUrl(fp)}" target="_blank" rel="noopener">Open</a></div>
    `;
  }

  if (isImage(fp)) {
    return `
      <div style="width:260px; height:180px; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; background:#fff; display:flex; align-items:center; justify-content:center;">
        <img src="${url}" alt="preview" style="max-width:100%; max-height:100%; object-fit:contain;" />
      </div>
      <div style="margin-top:6px;"><a href="${getProxyUrl(fp)}" target="_blank" rel="noopener">Open</a></div>
    `;
  }

  // TIFF and others: usually not previewable -> only link
  return `<a href="${getProxyUrl(fp)}" target="_blank" rel="noopener">Open</a>`;
}

async function populateManageResourcesDropdown() {
    try {
        const dropdown = document.getElementById("keywordDropdown_MR");
        if (!dropdown) {
            console.error("⛔ 'keywordDropdown_MR' not found.");
            return;
        }

        const res = await fetch("/resources/keywords");
        const data = await res.json();

        data.forEach(resource => {
            const option = document.createElement("option");
            option.value = resource.ID;
            option.textContent = `${resource.ID} -- ${resource.KeyWords} (${resource.SourceType})`;
            dropdown.appendChild(option);
        });
    } catch (err) {
        console.error("❌ Error populating manage section dropdown:", err);
    }
}

document.getElementById("searchBtnA").addEventListener("click", async () => {
  let url = "";

  // ===== MODE: SEARCH BY ID =====
  if (manageSearchMode === "id") {
    const idRaw = (document.getElementById("ExerciseID_MR")?.value || "").trim();
    const id = parseInt(idRaw, 10);

    if (!Number.isInteger(id)) {
      alert("❌ Въведи валидно ID на упражнението.");
      return;
    }

    url = `/exercise-by-id?id=${encodeURIComponent(id)}`;
  }

  // ===== MODE: SEARCH BY TUPLE =====
  else {
    const resourceID = (document.getElementById("keywordDropdown_MR")?.value || "").trim();
    const page = (document.getElementById("Page_MR")?.value || "").trim();
    const number = (document.getElementById("Number_MR")?.value || "").trim();

    if (!resourceID || !page || !number) {
      alert("❌ Попълни ресурс, страница и номер.");
      return;
    }

    url = `/exercise-details?resourceID=${encodeURIComponent(resourceID)}&page=${encodeURIComponent(page)}&number=${encodeURIComponent(number)}`;
  }

  try {
    const res = await fetch(url);

    if (!res.ok) {
      let msg = "Няма намерено упражнение.";
      try {
        const err = await res.json();
        if (err && err.error) msg = err.error;
      } catch (_) {}
      alert("❌ " + msg);
      return;
    }

    const exercise = await res.json();
    const tbody = document.querySelector("#manageTable tbody");
    tbody.innerHTML = "";

    const solvedDates = (exercise.date_last_solved || [])
      .map(d => String(d).split("T")[0])
      .join(" -- ");

    const revisionDates = (exercise.for_revision || [])
      .map(d => String(d).split("T")[0])
      .join(" -- ");

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${exercise.ID}</td>
      <td data-field="Page_MR">${exercise.Page || "empty"}</td>
      <td data-field="Number_MR">${exercise.Number || "empty"}</td>
      <td data-field="resourceID">${exercise.ResourceID || "empty"}</td>

      <td>
        <div class="existingDates">${solvedDates}</div>
        <input type="date"
          class="datePicker"
          data-id="${exercise.ID}"
          data-target="date_last_solved" />
      </td>

      <td>
        <div class="existingDates">${revisionDates}</div>
        <input type="date"
          class="datePicker"
          data-id="${exercise.ID}"
          data-target="for_revision" />
      </td>

      <td data-field="comments"
          data-id="${exercise.ID}"
          contenteditable="true"
          data-original='${JSON.stringify(exercise.comments || [])}'>
        ${(exercise.comments || []).join(", ")}
      </td>

      <td data-field="has_solution"
          data-id="${exercise.ID}"
          contenteditable="true"
          data-original="${exercise.has_solution}">
        ${exercise.has_solution}
      </td>

      <td data-field="has_assignmentCondition"
          data-id="${exercise.ID}"
          data-original="${exercise.has_assignmentCondition}">
        ${exercise.has_assignmentCondition}
        <input type="file"
          class="uploadInput_MR"
          data-id="${exercise.ID}" />
      </td>
          `;

    tbody.appendChild(row);
    // === BIG PREVIEWS BELOW TABLE ===
    const textBox = document.getElementById("previewTextBox");
    const solBox  = document.getElementById("previewSolutionBox");

    if (textBox) textBox.innerHTML = previewHtmlBig(exercise.text_filepath);
    if (solBox)  solBox.innerHTML  = previewHtmlBig(exercise.solution_filepath);

  } catch (err) {
    console.error("❌ Error fetching exercise:", err);
    alert("❌ Грешка при търсене.");
  }
});

document.getElementById("saveAllBtn").addEventListener("click", async () => {
    
    const editableCells = document.querySelectorAll("td[contenteditable='true'], input.datePicker,input.uploadInput_MR");
    for (const cell of editableCells) {
    // const id = cell.dataset.id;
    // const field = cell.dataset.field || cell.dataset.target;
    // const original = (cell.dataset.original || "").trim();
    //const fileInput = document.querySelector(`.uploadInput_MR[data-id="${id}"]`);    
    // let current = cell.tagName === "INPUT"
    //   ? cell.value.trim()                  // for <input type="date">
    //   : cell.textContent.trim();           // for contenteditable cells
    
    //new code snippet: 

    const td = cell.closest("td");
    const id = td?.dataset.id || cell.dataset.id;
    const field = td?.dataset.field || td?.dataset.target;
    const original = (td?.dataset.original || "").trim();

let current;
if (cell.tagName === "INPUT") {
  if (cell.type === "file") {
    current = cell.files.length > 0 ? "true" : "false";
  } else {
    current = cell.value.trim();
  }
} else {
  current = cell.textContent.trim();
}
    //


        console.log("Current is " + current );
        console.log("Field is " + field);
        //console.log("File input is " + fileInput);
    if(field === "has_assignmentCondition" && current == "true"){
        //
        function pad(value) {
        return value.toString().padStart(3, '0');
        }
        console.log("inside the if");
        const row = cell.closest("tr");
        const resourceID = row?.querySelector("td[data-field='resourceID']")?.textContent?.trim();
        const page = row?.querySelector("td[data-field='Page_MR']")?.textContent?.trim();
        const number = row?.querySelector("td[data-field='Number_MR']")?.textContent?.trim();  
        const fileInput = row.querySelector("input[type='file'].uploadInput_MR");

        console.log("ResourceID " + resourceID);
        console.log("Page " + page);
        console.log("Number " + number);
        console.log("File input is " + fileInput)

        const formData = new FormData();
        const name = `${pad(resourceID)}_${pad(page)}_${pad(number)}`
        console.log("Name is: " + name)
        
        formData.append("name", name);
        formData.append("resourceID", resourceID);
        formData.append("page", page);
        formData.append("number", number);

        if (fileInput?.files?.length > 0) {
        formData.append("file1", fileInput.files[0]);
        console.log("inside file check");       
        }       
         await fetch("/custom-upload", {
            method: "POST",
            body: formData,
        });
          current = current === "true";
          console.log(current);
    }
    if (
    (field === "date_last_solved" || field === "for_revision") &&
    current.includes("T")
    ) {
      current = current.split("T")[0];
    }

    // Force extraction of just date
    if (field === "date_last_solved" || field === "for_revision") {
    current = current.substring(0, 10); // Always keep just YYYY-MM-DD
    }

    if (original === current || current === "") continue;
    // If no field or value present, skip
    if (!field || current === "") continue;
       
    let value;

    if ((field === "date_last_solved" || field === "for_revision") && current.includes("T")) {
    current = current.split("T")[0];  // Keep only the date part
    }
    else if(field === "has_solution" || field === "has_assignmentCondition"){
        field === "has_solution" || field === "has_assignmentCondition"
    }
    else {
      value = current; 

    }
   if (field === "comments") {
        let existingComments = [];

        try {
            existingComments = JSON.parse(cell.dataset.original || "[]");
        } catch (err) {
            console.error("Failed to parse original comments:", err);
            continue;
        }

        // Turn raw comment text into array of clean strings
        const commentArray = current
        .split(",")
        .map(s => s.trim())
        .filter(s => s.length > 0);

        if (commentArray.length === 0) continue;

        // Replace entire comments array in DB
        value = commentArray;

        
        try {
            const res = await fetch("/update-exercise", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, field, value })
            });

            if (!res.ok) throw new Error("Update failed for " + field);
            const updated = await res.json();
            console.log("✅ Updated:", field, updated);

            cell.dataset.original = JSON.stringify(existingComments);
            //cell.textContent = existingComments.join(", ");
        } catch (err) {
            console.error("❌ Update error:", err);
            alert(`Error: Update failed for ${field}`);
        }

        continue;
        }
        else {
            value = current; // string or number for other fields
         }
    
         console.log("it gets all the way here")
    
    console.log("Field is (again) " + field);
    console.log("Value is (again) " + value);
    console.log("Updating:", { id, field, value });

    try {
      const res = await fetch("/update-exercise", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value })
      });

      if (!res.ok) throw new Error("Update failed for " + field);
      const updated = await res.json();
      console.log("✅ Updated:", field, updated);

      // Update original to prevent duplicate updates
      cell.dataset.original = current;
    } catch (err) {
      console.error("❌ Update error:", err);
      alert(`Error: Update failed for ${field}`);
    }
  }
  //cleanUp
    resetManageForm();
    document.getElementById("searchBtnA").click();

});

document.querySelectorAll(".datePicker").forEach(input => {
  input.addEventListener("change", () => {
    const targetField = input.dataset.target;
    const id = input.dataset.id;
    const cell = document.querySelector(
      `[data-field="${targetField}"][data-id="${id}"]`
    );

    const pickedDate = input.value;
    if (pickedDate && cell) {
      let existing = cell.textContent.trim();
      const updated = existing ? `${existing}, ${pickedDate}` : pickedDate;
      cell.textContent = updated;
    }

    // Optional: Clear picker value after adding
    input.value = "";
  });
});

function resetUploadForm() {
  document.getElementById("file1").value = "";
  document.getElementById("file2").value = "";
  document.getElementById("name").value = "";
  document.getElementById("Number").value = "";
  document.getElementById("Page").value = "";
  document.getElementById("classField").value = "";
  document.getElementById("keywordDropdown").selectedIndex = 0;
  document.getElementById("altText").value = "";
  document.getElementById("altSolution").value = "";
  document.getElementById("difficulty").selectedIndex = 0;
  document.getElementById("dateLastSolved").value = "";
  document.getElementById("dateForRevision").value = "";
  document.getElementById("comments").value = "";
  document.getElementById('ex_topic').value = "";
  document.getElementById('ex_keywords').value = "";
}

function resetManageForm() {
  document.getElementById("Number_MR").value = "";
  document.getElementById("Page_MR").value = "";
  document.getElementById("keywordDropdown_MR").selectedIndex = 0; // Resets dropdown to placeholder
  
//   document.getElementById("inputDateSolved").value = ""
//   document.getElementById("inputRevision").value = ""
//   document.getElementById("commentsID").value = ""
//   const tbody = document.getElementById("manageTable").querySelector("tbody") = ""
//     if(tbody) tbody.innerHTML = "";
const p1 = document.getElementById("previewTextBox");
const p2 = document.getElementById("previewSolutionBox");
if (p1) p1.innerHTML = "";
if (p2) p2.innerHTML = "";

}
//Filepath is: /Users/viktorvelkov/Documents/Solutions+AssignementConditions-E.