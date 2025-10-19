// Fetch helpers
export async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export const getCurrentSchedule   = () => fetchJson("/schedule/current");
export const getWeeklyCurrent     = () => fetchJson("/schedule/weekly-current");
export const getHolidays          = () => fetchJson("/holidays");
export async function savePlanner(planner, extra={}) {
  const res = await fetch("/schedule/generate-year-plan", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ planner, ...extra })
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || "Failed to save planner");
  return data;
}