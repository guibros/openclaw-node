const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'mission-control.db');
const db = new Database(DB_PATH);

const rows = db.prepare(`
  SELECT id, title, type, scheduled_date, start_date, end_date, status, description, parent_id
  FROM tasks
  WHERE project = 'arcane-rapture' AND type = 'task'
  ORDER BY scheduled_date ASC, id ASC
`).all();

// Also get phases and months for context
const phases = db.prepare(`
  SELECT id, title, start_date, end_date, description
  FROM tasks
  WHERE project = 'arcane-rapture' AND (type = 'phase' OR type = 'pipeline')
  ORDER BY start_date ASC, id ASC
`).all();

db.close();

// Group tasks by date
const byDate = {};
for (const r of rows) {
  const key = r.scheduled_date || 'Unscheduled';
  if (!byDate[key]) byDate[key] = [];
  byDate[key].push(r);
}

// Extract dept from description
function getDept(desc) {
  if (!desc) return '';
  const m = desc.match(/(?:CRITICAL PATH|IMPORTANT)\s*[—–-]\s*(\w+)/);
  if (m) return m[1];
  if (/^[A-Z]{2,6}$/.test(desc.trim())) return desc.trim();
  return desc;
}

const lines = [];
lines.push('# Arcane Rapture — Full Task Chronology');
lines.push('');
lines.push(`Generated: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Montreal' })}`);
lines.push(`Total tasks: ${rows.length}`);
lines.push('');

// Phase summary
lines.push('## Pipeline Overview');
lines.push('');
lines.push('| ID | Name | Start | End |');
lines.push('|----|------|-------|-----|');
for (const p of phases) {
  lines.push(`| ${p.id} | ${p.title} | ${p.start_date || '-'} | ${p.end_date || '-'} |`);
}
lines.push('');
lines.push('---');
lines.push('');

// Tasks by date
let taskNum = 0;
const sortedDates = Object.keys(byDate).sort((a, b) => {
  if (a === 'Unscheduled') return 1;
  if (b === 'Unscheduled') return -1;
  return a.localeCompare(b);
});

for (const date of sortedDates) {
  const tasks = byDate[date];
  let heading;
  if (date === 'Unscheduled') {
    heading = 'Unscheduled';
  } else {
    const d = new Date(date + 'T12:00:00');
    heading = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ` (${date})`;
  }

  lines.push(`## ${heading}`);
  lines.push('');
  lines.push('| # | ID | Task | Dept | Status |');
  lines.push('|---|-----|------|------|--------|');

  for (const t of tasks) {
    taskNum++;
    const dept = getDept(t.description);
    const isCrit = (t.description || '').includes('CRITICAL');
    const isImp = (t.description || '').includes('IMPORTANT');
    const flag = isCrit ? ' **[CRITICAL]**' : isImp ? ' *[IMPORTANT]*' : '';
    lines.push(`| ${taskNum} | ${t.id} | ${t.title}${flag} | ${dept} | ${t.status} |`);
  }
  lines.push('');
}

lines.push('---');
lines.push(`**Total: ${taskNum} tasks across ${sortedDates.length} days**`);

const output = lines.join('\n');
const outPath = path.join(__dirname, '..', '..', 'arcane', 'ARCANE_RAPTURE_TASK_CHRONOLOGY.md');
fs.writeFileSync(outPath, output);
console.log(`Written to ${outPath}`);
console.log(`${taskNum} tasks, ${sortedDates.length} dates`);
