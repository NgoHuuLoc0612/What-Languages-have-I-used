import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = path.resolve(__dirname, '../../data')
const DB_PATH   = path.join(DATA_DIR, 'what-languages.db')

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true })

const client = createClient({
  url: `file:${DB_PATH}`,
})

export const db = drizzle(client, { schema })

// Run migrations (creates tables if they don't exist)
export async function initDb() {
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('PRAGMA synchronous = NORMAL')
  await bootstrapSchema()
  console.log(`[db] SQLite ready at ${DB_PATH}`)
}

async function bootstrapSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS scans (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      mode         TEXT    NOT NULL CHECK(mode IN ('github','folder')),
      status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','error')),
      total_files  INTEGER NOT NULL DEFAULT 0,
      total_bytes  INTEGER NOT NULL DEFAULT 0,
      error_msg    TEXT,
      meta         TEXT,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      finished_at  INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS repos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      owner        TEXT    NOT NULL,
      repo_name    TEXT    NOT NULL,
      full_name    TEXT    NOT NULL,
      branch       TEXT    NOT NULL DEFAULT 'HEAD',
      description  TEXT,
      stars        INTEGER DEFAULT 0,
      forks        INTEGER DEFAULT 0,
      is_private   INTEGER DEFAULT 0,
      total_files  INTEGER NOT NULL DEFAULT 0,
      total_bytes  INTEGER NOT NULL DEFAULT 0,
      scanned_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS language_stats (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      repo_id     INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      language    TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'unknown',
      color       TEXT,
      file_count  INTEGER NOT NULL DEFAULT 0,
      byte_count  INTEGER NOT NULL DEFAULT 0,
      percentage  REAL    NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS lang_scan_idx ON language_stats(scan_id)`,
    `CREATE INDEX IF NOT EXISTS lang_repo_idx ON language_stats(repo_id)`,
    `CREATE INDEX IF NOT EXISTS lang_name_idx ON language_stats(language)`,
    `CREATE TABLE IF NOT EXISTS file_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      repo_id     INTEGER REFERENCES repos(id) ON DELETE CASCADE,
      path        TEXT    NOT NULL,
      extension   TEXT,
      language    TEXT,
      size_bytes  INTEGER DEFAULT 0,
      sha         TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS file_scan_idx ON file_records(scan_id)`,
    `CREATE INDEX IF NOT EXISTS file_lang_idx ON file_records(language)`,
    `CREATE TABLE IF NOT EXISTS github_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT    NOT NULL,
      token       TEXT    NOT NULL,
      scopes      TEXT,
      username    TEXT,
      rate_limit  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_used   INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS glob_patterns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      includes    TEXT    NOT NULL DEFAULT '**/*',
      excludes    TEXT    NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`,
  ]
  for (const stmt of statements) {
    await client.execute(stmt)
  }
}

export { client as sqlite }
