const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Readable } = require('stream');

/**
 * Parse a distribution CSV ("," or ";"), returning items with an optional `term` field.
 * If `meta` is provided from DB (distribution_meta), we tag rows with term using one of the modes:
 *  - split_mode = 'marker': supports 1 or 2 consecutive marker columns.
 *  - split_mode = 'line':   rows before t2_start_line → term 1, from that line onward → term 2
 *  - split_mode = 'week':   if week ∈ t1_weeks → term 1; if week ∈ t2_weeks → term 2
 * If NO meta is provided, we attempt a lightweight autodetection for marker rows using
 * common strings like 'TERM 1' / 'TERM 2' / 'Срок 1' / 'Срок 2' in columns 'Тема' or 'Вид'.
 * If nothing is detected, term stays null and the consumer decides (e.g. single cursor for the whole year).
 */
function parseDistributionFile(filename, meta) {
  return new Promise((resolve, reject) => {
    try {
      const filePath = path.join(__dirname, '../../разпределения', filename);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Auto-detect separator using header
      const header = (content.split(/\r?\n/)[0] || '');
      const commaCount = (header.match(/,/g) || []).length;
      const semiCount  = (header.match(/;/g) || []).length;
      const sep = semiCount > commaCount ? ';' : ',';

      const results = [];
      let currentTerm = null; // used for marker/line modes
      let lineNo = 0;

      // helpers for meta
      const splitMode     = meta && (meta.split_mode || meta.splitMode);
      const markerColumn  = meta && (meta.marker_column  || meta.markerColumn);
      const markerColumn2 = meta && (meta.marker_column2 || meta.markerColumn2);
      const t1Markers     = (meta && (meta.t1_markers    || meta.t1Markers))    || [];
      const t2Markers     = (meta && (meta.t2_markers    || meta.t2Markers))    || [];
      const t1Markers2    = (meta && (meta.t1_markers2   || meta.t1Markers2))   || null;
      const t2Markers2    = (meta && (meta.t2_markers2   || meta.t2Markers2))   || null;
      const t2StartLine   = meta && (meta.t2_start_line  || meta.t2StartLine);
      const t1Weeks       = (meta && (meta.t1_weeks      || meta.t1Weeks))      || [];
      const t2Weeks       = (meta && (meta.t2_weeks      || meta.t2Weeks))      || [];

      // Fallback autodetection config (when no meta)
      const autoDetect = !meta; // only if meta not provided
      const autoT1 = ['TERM 1', 'СРОК 1', 'СРОК I'];
      const autoT2 = ['TERM 2', 'СРОК 2', 'СРОК II'];

      const has = (arr = [], val = '') => {
        const up = String(val || '').toUpperCase();
        return arr.some(x => up.includes(String(x).toUpperCase()));
      };

      const matchTerm1 = (v1, v2) => {
        if (markerColumn2 && Array.isArray(t1Markers2) && Array.isArray(t1Markers)) {
          return has(t1Markers, v1) && has(t1Markers2, v2);
        }
        if (Array.isArray(t1Markers) && t1Markers.length) return has(t1Markers, v1);
        if (markerColumn2) return has(t1Markers, v1) || has(t1Markers, v2);
        return false;
      };
      const matchTerm2 = (v1, v2) => {
        if (markerColumn2 && Array.isArray(t2Markers2) && Array.isArray(t2Markers)) {
          return has(t2Markers, v1) && has(t2Markers2, v2);
        }
        if (Array.isArray(t2Markers) && t2Markers.length) return has(t2Markers, v1);
        if (markerColumn2) return has(t2Markers, v1) || has(t2Markers, v2);
        return false;
      };

      Readable.from(content)
        .pipe(csv({ separator: sep }))
        .on('data', (row) => {
          lineNo++;

          const week = row['Учебна седмица'] ?? row['sedmica'] ?? row['week'];
          const tema = row['Тема']            ?? row['tema']     ?? row['unit'] ?? row['Unit'];
          const vid  = row['Вид']             ?? row['vid']      ?? row['Тип']  ?? row['type'];
          const note = row['Бележки']         ?? row['notes']    ?? row['Бележка'] ?? row['note'];

          // --- Mode: line ---
          if (splitMode === 'line' && Number.isInteger(Number(t2StartLine))) {
            currentTerm = (lineNo >= Number(t2StartLine)) ? 2 : 1;
          }

          // --- Mode: marker (meta-defined)
          if (splitMode === 'marker' && markerColumn) {
            const v1 = row[markerColumn];
            const v2 = markerColumn2 ? row[markerColumn2] : undefined;
            if (matchTerm1(v1, v2)) { currentTerm = 1; return; } // marker row – do not emit
            if (matchTerm2(v1, v2)) { currentTerm = 2; return; }
          }

          // --- Fallback autodetection (no meta): look in common columns 'Тема'/'Вид'
          if (autoDetect) {
            const v1 = tema;
            const v2 = vid;
            if (has(autoT1, v1) || has(autoT1, v2)) { currentTerm = 1; return; }
            if (has(autoT2, v1) || has(autoT2, v2)) { currentTerm = 2; return; }
          }

          // Skip completely empty data rows
          const unitStr  = String(tema || '').trim();
          const typeStr  = String(vid  || '').trim();
          const notesStr = String(note || '').trim();
          if (!unitStr && !typeStr && !notesStr && !week) return;

          // --- Mode: week ---
          let term = currentTerm;
          if (splitMode === 'week') {
            const w = parseInt(week, 10);
            if (Array.isArray(t1Weeks) && t1Weeks.includes(w)) term = 1;
            if (Array.isArray(t2Weeks) && t2Weeks.includes(w)) term = 2;
          }

          results.push({
            week: week != null && String(week).trim() !== '' ? (parseInt(week, 10) || null) : null,
            unit: unitStr || null,
            uniteType: typeStr || null,
            notes: notesStr || null,
            term: term // may be null if meta/autodetect didn't determine
          });
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = parseDistributionFile;