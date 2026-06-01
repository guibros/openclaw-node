import { querySessionNoteData, generateSessionNote } from './lib/obsidian-session-notes.mjs';
import { openStore } from './lib/sqlite-store.mjs';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const db = openStore(homedir() + '/.openclaw/state.db', { readonly: true });

const sess = db.prepare('SELECT id, source, start_time, summary, message_count FROM sessions ORDER BY start_time DESC LIMIT 1').get();
console.log('Session:', JSON.stringify(sess, null, 2));

const data = querySessionNoteData(db, sess.id);
console.log('Entities:', data.entities.length, data.entities.map(e => e.name));
console.log('Decisions:', data.decisions.length);

const result = await generateSessionNote({ db, sessionId: sess.id });
console.log('Result:', JSON.stringify(result, null, 2));

const content = readFileSync(result.filePath, 'utf-8');
console.log('--- NOTE CONTENT ---');
console.log(content);

db.close();
