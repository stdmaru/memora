import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = resolve(process.env.MANAGER_DB_PATH || 'data/ai-memory-manager.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    workspace TEXT,
    project TEXT,
    page_path TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success','failure')),
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS audit_log_created_at ON audit_log(created_at DESC);
`)

const getSetting = database.prepare('SELECT value FROM app_settings WHERE key = ?')
const setSetting = database.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
const insertAudit = database.prepare(`INSERT INTO audit_log (action, workspace, project, page_path, outcome, detail)
  VALUES (@action, @workspace, @project, @page_path, @outcome, @detail)`)

export function readSettings() {
  return Object.fromEntries(database.prepare('SELECT key, value FROM app_settings').all().map(({ key, value }) => [key, JSON.parse(value)]))
}

export function writeSettings(settings) {
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const [key, value] of Object.entries(settings)) setSetting.run(key, JSON.stringify(value))
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return readSettings()
}

export function logAudit({ action, workspace = null, project = null, path = null, outcome, detail = null }) {
  insertAudit.run({ action, workspace, project, page_path: path, outcome, detail })
}

console.log(`SQLite do painel: ${databasePath}`)
