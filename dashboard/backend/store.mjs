import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function openStore(directory) {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(path.join(directory, 'chat.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT,thread_id TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),role TEXT,content TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),status TEXT,prompt TEXT,source_url TEXT,error TEXT,created_at TEXT,model TEXT,reasoning_effort TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT REFERENCES tasks(id),payload TEXT);`)
  const taskColumns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name))
  if (!taskColumns.has('model')) db.exec('ALTER TABLE tasks ADD COLUMN model TEXT')
  if (!taskColumns.has('reasoning_effort')) db.exec('ALTER TABLE tasks ADD COLUMN reasoning_effort TEXT')
  const all = (sql, ...args) => db.prepare(sql).all(...args)
  const get = (sql, ...args) => db.prepare(sql).get(...args)
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  const event = (id, payload) => run('INSERT INTO events(task_id,payload) VALUES(?,?)', id, JSON.stringify(payload))
  // A killed process cannot safely resume mutations automatically.
  for (const task of all("SELECT * FROM tasks WHERE status IN ('queued','running')")) {
    run("UPDATE tasks SET status='failed',error=? WHERE id=?", '服务重启，任务中断；请检查结果后重试', task.id)
    event(task.id, { type: 'status', status: 'failed', error: '服务重启，任务中断' })
  }
  return { db, all, get, run, event,
    conversation(title = '新对话') {
      const id = randomUUID()
      run('INSERT INTO conversations VALUES(?,?,NULL,?)', id, title.slice(0,80), new Date().toISOString())
      return get('SELECT * FROM conversations WHERE id=?', id)
    },
    message(id, role, content) {
      run('INSERT INTO messages VALUES(?,?,?,?,?)', randomUUID(), id, role, content, new Date().toISOString())
    },
  }
}
