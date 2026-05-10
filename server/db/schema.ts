import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

// ─── Scans ────────────────────────────────────────────────────────────────────
// A "scan" is a single analysis session (either GitHub or Folder mode)
export const scans = sqliteTable('scans', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  name:        text('name').notNull(),
  mode:        text('mode', { enum: ['github', 'folder'] }).notNull(),
  status:      text('status', { enum: ['pending', 'running', 'done', 'error'] }).notNull().default('pending'),
  totalFiles:  integer('total_files').notNull().default(0),
  totalBytes:  integer('total_bytes').notNull().default(0),
  errorMsg:    text('error_msg'),
  meta:        text('meta'),  // JSON blob for extra data
  createdAt:   integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s','now'))`),
  finishedAt:  integer('finished_at', { mode: 'timestamp' }),
})

// ─── Repos ────────────────────────────────────────────────────────────────────
// GitHub repos associated with a scan
export const repos = sqliteTable('repos', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  scanId:      integer('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  owner:       text('owner').notNull(),
  repoName:    text('repo_name').notNull(),
  fullName:    text('full_name').notNull(),
  branch:      text('branch').notNull().default('HEAD'),
  description: text('description'),
  stars:       integer('stars').default(0),
  forks:       integer('forks').default(0),
  isPrivate:   integer('is_private', { mode: 'boolean' }).default(false),
  totalFiles:  integer('total_files').notNull().default(0),
  totalBytes:  integer('total_bytes').notNull().default(0),
  scannedAt:   integer('scanned_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s','now'))`),
}, (t) => ({
  scanIdx: index('repos_scan_idx').on(t.scanId),
}))

// ─── Language Stats ───────────────────────────────────────────────────────────
// Per-language breakdown for each scan (or repo)
export const languageStats = sqliteTable('language_stats', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  scanId:      integer('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  repoId:      integer('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  language:    text('language').notNull(),
  type:        text('type', { enum: ['programming', 'markup', 'data', 'prose', 'unknown'] }).notNull().default('unknown'),
  color:       text('color'),
  fileCount:   integer('file_count').notNull().default(0),
  byteCount:   integer('byte_count').notNull().default(0),
  percentage:  real('percentage').notNull().default(0),
}, (t) => ({
  scanIdx:  index('lang_scan_idx').on(t.scanId),
  repoIdx:  index('lang_repo_idx').on(t.repoId),
  langIdx:  index('lang_name_idx').on(t.language),
}))

// ─── File Records ─────────────────────────────────────────────────────────────
// Individual file entries per repo/scan (truncated to first 50k per scan)
export const fileRecords = sqliteTable('file_records', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  scanId:      integer('scan_id').notNull().references(() => scans.id, { onDelete: 'cascade' }),
  repoId:      integer('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  path:        text('path').notNull(),
  extension:   text('extension'),
  language:    text('language'),
  sizeBytes:   integer('size_bytes').default(0),
  sha:         text('sha'),  // git SHA for GitHub files
}, (t) => ({
  scanIdx: index('file_scan_idx').on(t.scanId),
  langIdx: index('file_lang_idx').on(t.language),
}))

// ─── GitHub Tokens ────────────────────────────────────────────────────────────
// Stored GitHub personal access tokens (user manages these)
export const githubTokens = sqliteTable('github_tokens', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  label:     text('label').notNull(),
  token:     text('token').notNull(),
  scopes:    text('scopes'),
  username:  text('username'),
  rateLimit: integer('rate_limit'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s','now'))`),
  lastUsed:  integer('last_used', { mode: 'timestamp' }),
})

// ─── Saved Glob Patterns ─────────────────────────────────────────────────────
// User-saved glob pattern presets
export const globPatterns = sqliteTable('glob_patterns', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  name:        text('name').notNull(),
  includes:    text('includes').notNull().default('**/*'),  // newline-separated
  excludes:    text('excludes').notNull().default(''),      // newline-separated
  createdAt:   integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s','now'))`),
})

// ─── Relations ────────────────────────────────────────────────────────────────
export const scansRelations = relations(scans, ({ many }) => ({
  repos:         many(repos),
  languageStats: many(languageStats),
  fileRecords:   many(fileRecords),
}))

export const reposRelations = relations(repos, ({ one, many }) => ({
  scan:          one(scans, { fields: [repos.scanId], references: [scans.id] }),
  languageStats: many(languageStats),
  fileRecords:   many(fileRecords),
}))

export const languageStatsRelations = relations(languageStats, ({ one }) => ({
  scan: one(scans, { fields: [languageStats.scanId], references: [scans.id] }),
  repo: one(repos, { fields: [languageStats.repoId],  references: [repos.id] }),
}))

export const fileRecordsRelations = relations(fileRecords, ({ one }) => ({
  scan: one(scans, { fields: [fileRecords.scanId], references: [scans.id] }),
  repo: one(repos, { fields: [fileRecords.repoId],  references: [repos.id] }),
}))

// ─── Types ────────────────────────────────────────────────────────────────────
export type Scan           = typeof scans.$inferSelect
export type NewScan        = typeof scans.$inferInsert
export type Repo           = typeof repos.$inferSelect
export type NewRepo        = typeof repos.$inferInsert
export type LanguageStat   = typeof languageStats.$inferSelect
export type NewLanguageStat= typeof languageStats.$inferInsert
export type FileRecord     = typeof fileRecords.$inferSelect
export type NewFileRecord  = typeof fileRecords.$inferInsert
export type GithubToken    = typeof githubTokens.$inferSelect
export type GlobPattern    = typeof globPatterns.$inferSelect
