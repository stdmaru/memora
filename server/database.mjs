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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS ai_memory_nodes (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    encrypted_read_token TEXT NOT NULL,
    encrypted_admin_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS ai_memory_nodes_owner ON ai_memory_nodes(owner_user_id);
  CREATE TABLE IF NOT EXISTS user_node_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_node_id TEXT REFERENCES ai_memory_nodes(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS user_node_scopes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES ai_memory_nodes(id) ON DELETE CASCADE,
    workspace TEXT NOT NULL,
    project TEXT NOT NULL,
    PRIMARY KEY (user_id, node_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
`)

const usersWithoutPreferences = database.prepare(`SELECT users.id, app_settings.value AS legacy_theme
  FROM users LEFT JOIN user_preferences ON user_preferences.user_id = users.id
  LEFT JOIN app_settings ON app_settings.key = 'theme'
  WHERE user_preferences.user_id IS NULL`)
const insertMigratedPreference = database.prepare('INSERT OR IGNORE INTO user_preferences (user_id, theme) VALUES (?, ?)')
for (const user of usersWithoutPreferences.all()) {
  let legacyTheme = 'system'
  try {
    const value = user.legacy_theme ? JSON.parse(user.legacy_theme) : null
    if (value === 'light' || value === 'dark' || value === 'system') legacyTheme = value
  } catch {}
  insertMigratedPreference.run(user.id, legacyTheme)
}

const insertAudit = database.prepare(`INSERT INTO audit_log (action, workspace, project, page_path, outcome, detail)
  VALUES (@action, @workspace, @project, @page_path, @outcome, @detail)`)
const adminExistsQuery = database.prepare("SELECT 1 AS present FROM users WHERE role = 'admin' LIMIT 1")
const createAdminQuery = database.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
const createPreferencesQuery = database.prepare('INSERT INTO user_preferences (user_id, theme) VALUES (?, ?)')
const readUserPreferencesQuery = database.prepare('SELECT theme FROM user_preferences WHERE user_id = ?')
const userByEmailQuery = database.prepare("SELECT id, name, email, password_hash, role FROM users WHERE email = ? COLLATE NOCASE AND role = 'admin'")
const adminPasswordByIdQuery = database.prepare("SELECT password_hash FROM users WHERE id = ? AND role = 'admin'")
const updateAdminPasswordQuery = database.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND role = \'admin\'')
const revokeOtherSessionsQuery = database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
const userByIdQuery = database.prepare(`SELECT users.id, users.name, users.email, users.role, user_preferences.theme
  FROM users LEFT JOIN user_preferences ON user_preferences.user_id = users.id WHERE users.id = ?`)
const insertSessionQuery = database.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
const readSessionQuery = database.prepare(`SELECT users.id, users.name, users.email, users.role,
  user_preferences.theme, sessions.id AS session_id, sessions.expires_at
  FROM sessions JOIN users ON users.id = sessions.user_id
  LEFT JOIN user_preferences ON user_preferences.user_id = users.id
  WHERE sessions.token_hash = ?`)
const updateSessionSeenQuery = database.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?")
const deleteSessionQuery = database.prepare('DELETE FROM sessions WHERE token_hash = ?')
const deleteExpiredSessionsQuery = database.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')")
const updateUserThemeQuery = database.prepare("UPDATE user_preferences SET theme = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?")
const nodesForUserQuery = database.prepare('SELECT id, name, endpoint, encrypted_read_token, encrypted_admin_token FROM ai_memory_nodes WHERE owner_user_id = ? ORDER BY name COLLATE NOCASE')
const nodeForUserQuery = database.prepare('SELECT id, name, endpoint, encrypted_read_token, encrypted_admin_token FROM ai_memory_nodes WHERE owner_user_id = ? AND id = ?')
const insertNodeQuery = database.prepare('INSERT INTO ai_memory_nodes (id, owner_user_id, name, endpoint, encrypted_read_token, encrypted_admin_token) VALUES (?, ?, ?, ?, ?, ?)')
const updateNodeQuery = database.prepare('UPDATE ai_memory_nodes SET name = ?, endpoint = ?, encrypted_read_token = ?, encrypted_admin_token = ? WHERE owner_user_id = ? AND id = ?')
const deleteNodeQuery = database.prepare('DELETE FROM ai_memory_nodes WHERE owner_user_id = ? AND id = ?')
const activeNodeForUserQuery = database.prepare('SELECT active_node_id FROM user_node_preferences WHERE user_id = ?')
const setActiveNodeQuery = database.prepare(`INSERT INTO user_node_preferences (user_id, active_node_id) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET active_node_id = excluded.active_node_id`)
const nodeScopeForUserQuery = database.prepare('SELECT workspace, project FROM user_node_scopes WHERE user_id = ? AND node_id = ?')
const setNodeScopeQuery = database.prepare(`INSERT INTO user_node_scopes (user_id, node_id, workspace, project) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, node_id) DO UPDATE SET workspace = excluded.workspace, project = excluded.project`)

export function listAiMemoryNodes(userId) {
  return nodesForUserQuery.all(userId)
}

export function findAiMemoryNode(userId, nodeId) {
  return nodeForUserQuery.get(userId, nodeId) || null
}

export function createAiMemoryNode({ id, userId, name, endpoint, encryptedReadToken, encryptedAdminToken }) {
  insertNodeQuery.run(id, userId, name, endpoint, encryptedReadToken, encryptedAdminToken)
}

export function updateAiMemoryNode({ id, userId, name, endpoint, encryptedReadToken, encryptedAdminToken }) {
  return updateNodeQuery.run(name, endpoint, encryptedReadToken, encryptedAdminToken, userId, id).changes === 1
}

export function deleteAiMemoryNode(userId, nodeId) {
  return deleteNodeQuery.run(userId, nodeId).changes === 1
}

export function readActiveNodeId(userId) {
  return activeNodeForUserQuery.get(userId)?.active_node_id || ''
}

export function writeActiveNodeId(userId, nodeId) {
  setActiveNodeQuery.run(userId, nodeId || null)
}

export function readNodeScope(userId, nodeId) {
  return nodeScopeForUserQuery.get(userId, nodeId) || null
}

export function writeNodeScope(userId, nodeId, { workspace, project }) {
  setNodeScopeQuery.run(userId, nodeId, workspace, project)
}

export function logAudit({ action, workspace = null, project = null, path = null, outcome, detail = null }) {
  insertAudit.run({ action, workspace, project, page_path: path, outcome, detail })
}

export function hasAdmin() {
  return Boolean(adminExistsQuery.get())
}

export function createInitialAdmin({ id, name, email, passwordHash, theme = 'system' }) {
  database.exec('BEGIN IMMEDIATE')
  try {
    if (adminExistsQuery.get()) {
      database.exec('ROLLBACK')
      return false
    }
    createAdminQuery.run(id, name, email, passwordHash)
    createPreferencesQuery.run(id, theme)
    database.exec('COMMIT')
    return true
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function readUserPreferences(userId) {
  return readUserPreferencesQuery.get(userId) || { theme: 'system' }
}

export function findAdminByEmail(email) {
  return userByEmailQuery.get(email)
}

export function findAdminPasswordById(userId) {
  return adminPasswordByIdQuery.get(userId)?.password_hash || null
}

export function updateAdminPassword(userId, passwordHash, currentTokenHash) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = updateAdminPasswordQuery.run(passwordHash, userId)
    if (result.changes !== 1) {
      database.exec('ROLLBACK')
      return false
    }
    revokeOtherSessionsQuery.run(userId, currentTokenHash)
    database.exec('COMMIT')
    return true
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function readUser(userId) {
  return userByIdQuery.get(userId) || null
}

export function createSession({ id, userId, tokenHash, expiresAt }) {
  deleteExpiredSessionsQuery.run()
  insertSessionQuery.run(id, userId, tokenHash, expiresAt)
}

export function readSession(tokenHash) {
  const session = readSessionQuery.get(tokenHash)
  if (!session) return null
  if (Date.parse(session.expires_at) <= Date.now()) {
    deleteSessionQuery.run(tokenHash)
    return null
  }
  updateSessionSeenQuery.run(tokenHash)
  return session
}

export function deleteSession(tokenHash) {
  deleteSessionQuery.run(tokenHash)
}

export function updateUserTheme(userId, theme) {
  updateUserThemeQuery.run(theme, userId)
  return readUser(userId)
}

console.log(`SQLite do painel: ${databasePath}`)
