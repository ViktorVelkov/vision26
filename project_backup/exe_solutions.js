document.querySelectorAll('.switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.switch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.getAttribute('data-mode');

        document.getElementById('uploadSection').style.display = mode === 'upload' ? 'block' : 'none';
        document.getElementById('manageSection').style.display = mode === 'manage' ? 'block' : 'none';
    });
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
            await handleUploadAndInsert();
        } else {
            alert("❌ Upload failed: " + (result.error || result.message));
        }

    } catch (err) {
        alert("❌ Upload failed: " + err.message);
    }
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

async function handleUploadAndInsert() {
    try {
        const file1 = document.getElementById("file1").files[0];
        const file2 = document.getElementById("file2").files[0];
        const commentsHereFromHTML = document.getElementById("comments").value.trim() || null;
        const dateLastSolvedInput = document.getElementById("dateLastSolved").value;
        const forRevisionInput = document.getElementById("dateForRevision").value;

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
            commentsArray: commentsHere 
        };
        const res = await fetch("/exercises", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(exerciseData)
        });

        if (!res.ok) throw new Error("Failed to insert exercise.");
        const result = await res.json();
        alert("✅ Exercise saved successfully: ID " + result.id);
    } catch (err) {
        alert("⚠️ Exercise already exists in the database.");
    }
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
    const resourceID = document.getElementById("keywordDropdown_MR").value;
    const page = document.getElementById("Page_MR").value;
    const number = document.getElementById("Number_MR").value;

    try {
        const res = await fetch(`/exercise-details?resourceID=${resourceID}&page=${page}&number=${number}`);;
        const data = await res.json();
        console.log(resourceID,page);
        const tbody = document.querySelector("#manageTable tbody");
        tbody.innerHTML = ""; // Clear existing rows
        
        [data].forEach((exercise) => {
            const row = document.createElement("tr");

            const solvedDates = (exercise.date_last_solved || [])
            .map(date => date.split("T")[0])
            .join(" -- ");
            const revisionDates = (exercise.for_revision || [])
            .map(date => date.split("T")[0])
            .join(" -- ");
            row.innerHTML = `
            <td>${exercise.ID}</td>
            <td>${exercise.Page || "empty"}</td>
            <td>${exercise.Number || "empty"}</td>
            <td>${exercise.ResourceID || "empty"}</td>
            <td>
                <div class="existingDates">${solvedDates}</div>
                <input type="date"
                    class="datePicker"
                    data-id="${exercise.ID}"
                    data-target="date_last_solved" />
            </td>
            <td <div class="existingDates">${revisionDates}</div>
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
            <td data-field="multiple_solutions"
                data-id="${exercise.ID}"
                contenteditable="true">
                ${exercise.multiple_solutions}
            </td>
            `;
            tbody.appendChild(row);
        });

    } catch (err) {
        console.error("❌ Error fetching exercises:", err);
        alert("❌ Could not fetch matching exercises.");
    }
});


document.getElementById("saveAllBtn").addEventListener("click", async () => {
  const editableCells = document.querySelectorAll("td[contenteditable='true'], input.datePicker");

  for (const cell of editableCells) {
    const id = cell.dataset.id;
    const field = cell.dataset.field || cell.dataset.target;
    const original = (cell.dataset.original || "").trim();

    let current = cell.tagName === "INPUT"
      ? cell.value.trim()                  // for <input type="date">
      : cell.textContent.trim();           // for contenteditable cells
    
    
    if (
    (field === "date_last_solved" || field === "for_revision") &&
    current.includes("T")
    ) {
      current = current.split("T")[0];
    }
    console.log(field);
    if (original === current || current === "") continue;
    // If no field or value present, skip
    if (!field || current === "") continue;

    // Skip if no change for standard fields
    if (field !== "comments" && field !== "date_last_solved" && field !== "for_revision" && original === current) continue;

       
    let value;
    console.log("Updating:", { id, field, value });
    // Format value based on field type
    if (field === "date_last_solved" || field === "for_revision" ) {
      value = [current]; // wrap in array for PostgreSQL date[]
    }
    else {
      value = current; // string or number for other fields
    }
   if (field === "comments") {
        let existingComments = [];

        try {
            existingComments = JSON.parse(cell.dataset.original || "[]");
        } catch (err) {
            console.error("Failed to parse original comments:", err);
            continue;
        }

        const currentComment = current.trim();

        // Avoid appending if empty or already in list
        if (!currentComment || existingComments.includes(currentComment)) {
            continue;
        }

        // Prepare value to send (only new comment)
        value = [currentComment];

        // Send to backend and wait
        try {
            const res = await fetch("/update-exercise", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, field, value })
            });

            if (!res.ok) throw new Error("Update failed for " + field);
            const updated = await res.json();
            console.log("✅ Updated:", field, updated);

            // ✅ Just append one new comment — no duplication
            existingComments.push(currentComment);
            cell.dataset.original = JSON.stringify(existingComments);
            cell.textContent = existingComments.join(", ");
        } catch (err) {
            console.error("❌ Update error:", err);
            alert(`Error: Update failed for ${field}`);
        }

        continue;
        }
        else {
            value = current; // string or number for other fields
         }
    

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
});

//Filepath is: /Users/viktorvelkov/Documents/Solutions+AssignementConditions-E.