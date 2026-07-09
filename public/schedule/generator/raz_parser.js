/**
 * Build a topics list per class/division based on DB table "currentSchedule".
 *
 * - Reads rows from currentSchedule: (class, division, razpredelenie)
 * - For each row, reads the CSV file from the distributions directory
 * - Parses topics ("unit") from the file
 * - Returns a Map (and also a plain object) where:
 *    key: "<class> <division>" (e.g. "11 МодулА", "9 Е")
 *    value: Array of topics (strings) in the order they appear in the file
 *
 * Note: This is server-side FS reading (NOT static serving).
 */

const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
// Node fetch helper (Node 18+ or fallback)
let _fetch;
try {
  _fetch = fetch;
} catch {
  _fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

async function streamToString(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function safeDistributionFileName(name) {
  const original = String(name || '').trim();
  const ext = path.extname(original).toLowerCase() || '.csv';

  const base = path.basename(original, ext)
    .replace(/[\/\\]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9А-Яа-я._-]/g, '')
    .slice(0, 120);

  return `${base || 'distribution'}${ext || '.csv'}`;
}

async function fetchCurrentScheduleRows(baseUrl = 'http://localhost:3001') {
  const r = await _fetch(`${baseUrl}/api/current-schedule`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function normalizeSubjectKey(cls, division) {
  const c = String(cls ?? '').trim();
  const d = String(division ?? '').trim();
  return (c + (d ? ' ' + d : '')).trim();
}

function parseDistributionCsv(rawText) {
  // Accept either ';' or ',' delimiter. Skip header rows.
  const txt = String(rawText || '').replace(/\uFEFF/g, ''); // remove BOM
  const lines = txt
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const out = [];

  for (const line of lines) {
    const parts = (line.includes(';') ? line.split(';') : line.split(','))
      .map(s => String(s).trim());

    // Expect at least: [index, topic, ...]
    if (parts.length < 2) continue;

    const tema = String(parts[1] || '').trim();

    // Skip headers like "Тема" or empty
    if (!tema) continue;
    if (/^тема$/i.test(tema)) continue;

    out.push(tema);
  }

  return out;
}

async function readTopicsFromFile(distributionsDir, fileName) {
  const safeName = safeDistributionFileName(fileName);

  if (
    process.env.R2_BUCKET &&
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  ) {
    try {
      const object = await r2.send(new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: `distributions/${safeName}`
      }));

      const raw = await streamToString(object.Body);
      return parseDistributionCsv(raw);
    } catch (e) {
      console.warn(`R2 distribution read failed for ${safeName}:`, e && e.message ? e.message : e);
    }
  }

  const csvPath = path.resolve(distributionsDir, safeName);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Distribution file not found in R2 or locally: ${safeName}`);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  return parseDistributionCsv(raw);
}

/**
 * @param {Object} args
 * @param {string} [args.distributionsDir] - directory containing the distribution files
 * @param {string} [args.baseUrl] - base URL for API requests
 * @returns {Promise<{ map: Map<string,string[]>, obj: Record<string,string[]>, setObj: Record<string,string[]> }>} 
 */
async function buildTopicsMapFromCurrentSchedule({
  distributionsDir = '/Users/viktorvelkov/Documents/teacher-app-backend/разпределения',
  baseUrl = 'http://localhost:3001',
} = {}) {
  const rows = await fetchCurrentScheduleRows(baseUrl);

  const map = new Map();

  for (const r of rows) {
    const key = normalizeSubjectKey(r.class, r.division);
    const fileName = r.razpredelenie;
    if (!key || !fileName) continue;

    // Read topics from the corresponding distribution file
    const topics = await readTopicsFromFile(distributionsDir, fileName);
    // Keep order as in file
    map.set(key, topics);
  }

  // Also provide plain objects for easier JSON usage
  const obj = {};
  const setObj = {};

  for (const [k, arr] of map.entries()) {
    obj[k] = Array.isArray(arr) ? arr : [];

    // optional: de-dup with Set but keep original order
    const seen = new Set();
    const uniq = [];
    for (const t of obj[k]) {
      const s = String(t).trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      uniq.push(s);
    }
    setObj[k] = uniq;
  }

  return { map, obj, setObj };
}

module.exports = {
  buildTopicsMapFromCurrentSchedule,
  parseDistributionCsv,
  normalizeSubjectKey,
};