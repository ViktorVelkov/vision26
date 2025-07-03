
// Call it on load
window.addEventListener("DOMContentLoaded", loadSubmissionLogs);

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.switch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Toggle active button styling
            document.querySelectorAll('.switch-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Get mode from button attribute
            const mode = btn.dataset.mode;
            console.log("Switched to mode:", mode);

            // Toggle section visibility
            document.getElementById('formSection').style.display = mode === 'form' ? 'block' : 'none';
            document.getElementById('summarySection').style.display = mode === 'summary' ? 'block' : 'none';
            

        

        });
    });
});



(async () => {

    try {
        const select = document.querySelector('select[name="className"]');

        const res = await fetch('http://localhost:3001/classes');

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new Error("Expected an array but got: " + JSON.stringify(data));
        }

        data.forEach((cls, i) => {
            const option = document.createElement('option');
            option.value = cls;
            option.textContent = cls;
            select.appendChild(option);
        });

    } catch (err) {
        console.error("🔥 Script failed:", err);
    }
})();

document.getElementById('fetchStudentsBtn').addEventListener('click', async () => {
    const selectedClass = document.querySelector('select[name="className"]').value;

    if (!selectedClass) {
        alert("Please select a class first.");
        return;
    }

    try {
        const response = await fetch(`http://localhost:3001/students?className=${encodeURIComponent(selectedClass)}`);
        const students = await response.json();

        const listDiv = document.getElementById('studentList');
        listDiv.innerHTML = ''; // clear previous

        if (students.length === 0) {
            listDiv.textContent = 'No students found.';
        } else {
            const ol = document.createElement('ol');
            students.forEach(s => {
                const li = document.createElement('li');
                li.dataset.id = s.id;
                // Append student info text
                li.append(`-- ${s.id} -- ${s.first_name} -- ${s.sirname} `);

                // Create <select> dropdown
                const select = document.createElement('select');
                select.name = `activity_${s.id}`;

                [0, 1, 2].forEach(val => {
                    const option = document.createElement('option');
                    option.value = val;
                    option.textContent = val;
                    select.appendChild(option);
                });

                li.appendChild(select);
                ol.appendChild(li);
            });
            listDiv.appendChild(ol);
        }
    } catch (err) {
        console.error("Error fetching students:", err);
    }
});

document.getElementById("submitActivityBtn").addEventListener("click", async () => {
  const date = document.querySelector('input[name="date"]').value;
  const rows = document.querySelectorAll("#studentList li");

  if (!date) {
    alert("Please select a date.");
    return;
  }

  const activityData = [];
  const className = document.querySelector('select[name="className"]').value;

  rows.forEach(row => {
    const studentId = parseInt(row.dataset.id, 10);
    const select = row.querySelector("select");
    const mark = parseInt(select.value, 10);

    activityData.push({
      student_id: studentId,
      date,
      mark
    });
  });

  try {
    const res = await fetch("/submit-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ className,activity: activityData })
    });

    if (res.ok) {
      alert("Activity submitted!");
    } else {
      alert("Failed to submit activity.");
    }
  } catch (err) {
    console.error("Submit error:", err);
    alert("Server error.");
  }
});

async function loadSubmissionLogs() {
    const logList = document.getElementById("logList");
    logList.innerHTML = "";

    try {
        const res = await fetch("/submission-logs");
        const logs = await res.json();

        logs.forEach(log => {
            const li = document.createElement("li");
            li.textContent = `Class: ${log.Class} | Assigned: ${log.assigned_at} | Submitted: ${log.inserted_at}`;
            logList.appendChild(li);
        });
    } catch (err) {
        console.error("Error loading submission logs:", err);
    }
}

async function loadSubmissionLogs() {
    const tableBody = document.getElementById("logTableBody");
    tableBody.innerHTML = ""; // Clear existing rows

    try {
        const res = await fetch("/submission-logs");
        const logs = await res.json();

        logs.forEach(log => {
            const row = document.createElement("tr");
            row.innerHTML = `
        <td>${log.Class}</td>
        <td>${log.assigned_at}</td>
        <td>${log.inserted_at}</td>
      `;
            tableBody.appendChild(row);
        });
    } catch (err) {
        console.error("Error loading logs:", err);
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const clearBtn = document.getElementById("clearSearchBtn");
    const searchInput = document.getElementById("searchInput");
    const resultsList = document.getElementById("searchResults");

    if (clearBtn && searchInput) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));
            if (resultsList) resultsList.innerHTML = "";
        });
    }
});
