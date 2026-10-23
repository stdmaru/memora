import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('database migration preserves valid legacy themes and defaults invalid values', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'memora-migration-test-'))
  try {
    for (const { legacyValue, expectedTheme } of [
      { legacyValue: JSON.stringify('dark'), expectedTheme: 'dark' },
      { legacyValue: JSON.stringify('unsupported'), expectedTheme: 'system' },
    ]) {
      const databasePath = join(tempDirectory, `${expectedTheme}.sqlite`)
      const legacyDatabase = new DatabaseSync(databasePath)
      legacyDatabase.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES ('legacy-admin', 'Legacy Admin', 'legacy@example.com', 'hash', 'admin');
      `)
      legacyDatabase.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('theme', legacyValue)
      legacyDatabase.close()

      const migration = spawnSync(process.execPath, [
        '--input-type=module',
        '-e',
        "await import('./server/database.mjs')",
      ], {
        cwd: process.cwd(),
        env: { ...process.env, MANAGER_DB_PATH: databasePath },
        encoding: 'utf8',
      })
      assert.equal(migration.status, 0, migration.stderr)

      const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true })
      const preference = migratedDatabase.prepare(
        'SELECT theme FROM user_preferences WHERE user_id = ?',
      ).get('legacy-admin')
      migratedDatabase.close()
      assert.equal(preference.theme, expectedTheme)
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
})
