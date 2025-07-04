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

            row.innerHTML = `
                <td>${exercise.ID}</td>
                <td>${exercise.Page}</td>
                <td>${exercise.Number}</td>
                <td>${exercise.ResourceID}</td>
                <td data-field="date_last_solved" data-id="${exercise.ID}" contenteditable="true">${(exercise.date_last_solved || []).join(", ")}</td>
                <td data-field="for_revision" data-id="${exercise.ID}" contenteditable="true">${(exercise.for_revision || []).join(", ")}</td>
                <td data-field="comments" data-id="${exercise.ID}" contenteditable="true">${(exercise.comments || []).join(", ")}</td>
                <td data-field="multiple_solutions" data-id="${exercise.ID}" contenteditable="true">${exercise.multiple_solutions}</td>
            `;

            tbody.appendChild(row);
        });

    } catch (err) {
        console.error("❌ Error fetching exercises:", err);
        alert("❌ Could not fetch matching exercises.");
    }
});

document.getElementById("saveAllBtn").addEventListener("click", async () => {
  const editableCells = document.querySelectorAll("td[contenteditable='true']");
  for (const cell of editableCells) {
    const id = cell.dataset.id;
    const field = cell.dataset.field;
    const original = (cell.dataset.original || "").trim();
    const current = (cell.textContent || "").trim();

    // Only proceed if value has changed
    if (original === current || current === "") continue;

    try {
      const res = await fetch("/update-exercise", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, field, value: current })
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


//Filepath is: /Users/viktorvelkov/Documents/Solutions+AssignementConditions-E.