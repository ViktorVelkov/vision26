// public/find-weird-catch.js
const fs = require('fs');
const f = process.argv[2] || './public/whatHaveILearned.js';
const s = fs.readFileSync(f,'utf8');

// махаме коментари, за да не лъжат
function strip(src){
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
    .replace(/'([^'\\]|\\[\s\S])*'/g, m => ' '.repeat(m.length))
    .replace(/"([^"\\]|\\[\s\S])*"/g, m => ' '.repeat(m.length))
    .replace(/`([^`\\]|\\[\s\S])*`/g, m => ' '.repeat(m.length));
}
const clean = strip(s);
const lines = s.split('\n');

function lineOf(idx){ return s.slice(0, idx).split('\n').length; }

// намери всеки catch(
let i = 0, hits = [];
while ((i = clean.indexOf('catch', i)) !== -1) {
  // граници на дума
  const prev = clean[i-1] || ' ', next = clean[i+5] || ' ';
  if (/\w/.test(prev) || /\w/.test(next)) { i += 5; continue; }

  // върни се назад до първия „смислен“ символ (прескачай whitespace)
  let j = i - 1;
  while (j >= 0 && /\s/.test(clean[j])) j--;

  const ok = clean[j] === '}';
  if (!ok) {
    const ln = lineOf(i);
    hits.push(ln);
  }
  i += 5;
}

if (!hits.length) {
  console.log('✅ Всички catch изглеждат след } (OK).');
} else {
  console.log('❌ Подозрителни catch (преди тях няма } ): редове →', hits.join(', '));
  // покажи откъс
  hits.forEach(ln => {
    const start = Math.max(1, ln-2), end = Math.min(lines.length, ln+2);
    console.log('\n--- around line', ln, '---');
    for (let k=start;k<=end;k++){
      const mark = k===ln ? '>' : ' ';
      console.log(mark, String(k).padStart(String(end).length,' '),'|', lines[k-1]);
    }
  });
}