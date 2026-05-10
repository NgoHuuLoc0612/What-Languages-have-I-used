import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, loggedProcedure } from '../trpc.js'
import { scans, repos, languageStats, fileRecords } from '../../db/schema.js'
import { db } from '../../db/index.js'
import { eq, desc, asc, sum, count, and, sql, inArray } from 'drizzle-orm'

export const statsRouter = router({

  // ── List all scans ─────────────────────────────────────────────────────────
  listScans: loggedProcedure
    .input(z.object({
      mode:   z.enum(['github', 'folder', 'all']).default('all'),
      limit:  z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const q = db.select().from(scans)
        .orderBy(desc(scans.createdAt))
        .limit(input.limit)
        .offset(input.offset)

      if (input.mode !== 'all') {
        return q.where(eq(scans.mode, input.mode))
      }
      return q
    }),

  // ── Get scan detail with repos ─────────────────────────────────────────────
  getScan: loggedProcedure
    .input(z.object({ scanId: z.number() }))
    .query(async ({ input }) => {
      const [scan] = await db.select().from(scans).where(eq(scans.id, input.scanId))
      if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scan not found' })

      const repoList = await db.select().from(repos)
        .where(eq(repos.scanId, input.scanId))
        .orderBy(desc(repos.totalFiles))

      // GROUP BY language to avoid duplicates when scan spans multiple repos
      const aggregated = await db
        .select({
          id:        sql<number>`min(${languageStats.id})`,
          scanId:    languageStats.scanId,
          language:  languageStats.language,
          type:      languageStats.type,
          color:     languageStats.color,
          fileCount: sql<number>`sum(${languageStats.fileCount})`,
          byteCount: sql<number>`sum(${languageStats.byteCount})`,
          percentage: sql<number>`0`,
          repoId:    sql<null>`null`,
        })
        .from(languageStats)
        .where(eq(languageStats.scanId, input.scanId))
        .groupBy(languageStats.language, languageStats.type, languageStats.color, languageStats.scanId)
        .orderBy(desc(sql`sum(${languageStats.byteCount})`))

      const totalBytes = aggregated.reduce((s, r) => s + r.byteCount, 0)
      const langStats = aggregated.map(r => ({
        ...r,
        percentage: totalBytes > 0 ? (r.byteCount / totalBytes) * 100 : 0,
      }))

      return { scan, repos: repoList, languages: langStats }
    }),

  // ── Get language stats for a scan ──────────────────────────────────────────
  getScanLanguages: loggedProcedure
    .input(z.object({
      scanId:   z.number(),
      repoId:   z.number().optional(),
      langType: z.enum(['all', 'programming', 'markup', 'data', 'prose']).default('all'),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(languageStats.scanId, input.scanId)]
      if (input.repoId) conditions.push(eq(languageStats.repoId, input.repoId))
      if (input.langType !== 'all') conditions.push(eq(languageStats.type, input.langType))

      // When repoId is set, return per-repo rows directly (no need to aggregate)
      if (input.repoId) {
        const rows = await db.select().from(languageStats)
          .where(and(...conditions))
          .orderBy(desc(languageStats.byteCount))
        const totalBytes = rows.reduce((s, r) => s + r.byteCount, 0)
        return rows.map(r => ({
          ...r,
          percentage: totalBytes > 0 ? (r.byteCount / totalBytes) * 100 : 0,
        }))
      }

      // Without repoId: GROUP BY language to merge rows from multiple repos
      const aggregated = await db
        .select({
          id:        sql<number>`min(${languageStats.id})`,
          scanId:    languageStats.scanId,
          language:  languageStats.language,
          type:      languageStats.type,
          color:     languageStats.color,
          fileCount: sql<number>`sum(${languageStats.fileCount})`,
          byteCount: sql<number>`sum(${languageStats.byteCount})`,
          percentage: sql<number>`0`,
          repoId:    sql<null>`null`,
        })
        .from(languageStats)
        .where(and(...conditions))
        .groupBy(languageStats.language, languageStats.type, languageStats.color, languageStats.scanId)
        .orderBy(desc(sql`sum(${languageStats.byteCount})`))

      const totalBytes = aggregated.reduce((s, r) => s + r.byteCount, 0)
      return aggregated.map(r => ({
        ...r,
        percentage: totalBytes > 0 ? (r.byteCount / totalBytes) * 100 : 0,
      }))
    }),

  // ── Get file breakdown for a scan ──────────────────────────────────────────
  getScanFiles: loggedProcedure
    .input(z.object({
      scanId:   z.number(),
      repoId:   z.number().optional(),
      language: z.string().optional(),
      limit:    z.number().int().min(1).max(1000).default(200),
      offset:   z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(fileRecords.scanId, input.scanId)]
      if (input.repoId)   conditions.push(eq(fileRecords.repoId, input.repoId))
      if (input.language) conditions.push(eq(fileRecords.language, input.language))

      const [totalRow] = await db.select({ n: count() }).from(fileRecords)
        .where(and(...conditions))

      const rows = await db.select().from(fileRecords)
        .where(and(...conditions))
        .orderBy(desc(fileRecords.sizeBytes))
        .limit(input.limit)
        .offset(input.offset)

      return { total: totalRow?.n ?? 0, files: rows }
    }),

  // ── Aggregate stats across ALL scans (global summary) ─────────────────────
  getGlobalStats: loggedProcedure.query(async () => {
    const [scanCount] = await db.select({ n: count() }).from(scans)
      .where(eq(scans.status, 'done'))

    const [fileTotals] = await db.select({
      totalFiles: sum(scans.totalFiles),
      totalBytes: sum(scans.totalBytes),
    }).from(scans).where(eq(scans.status, 'done'))

    // Top languages across all scans
    const topLangs = await db
      .select({
        language:  languageStats.language,
        type:      languageStats.type,
        color:     languageStats.color,
        fileCount: sql<number>`sum(${languageStats.fileCount})`,
        byteCount: sql<number>`sum(${languageStats.byteCount})`,
        scanCount: sql<number>`count(distinct ${languageStats.scanId})`,
      })
      .from(languageStats)
      .groupBy(languageStats.language, languageStats.type, languageStats.color)
      .orderBy(desc(sql`sum(${languageStats.byteCount})`))
      .limit(30)

    const totalBytesAll = topLangs.reduce((s, l) => s + (l.byteCount ?? 0), 0)

    return {
      scanCount:   scanCount?.n ?? 0,
      totalFiles:  Number(fileTotals?.totalFiles ?? 0),
      totalBytes:  Number(fileTotals?.totalBytes ?? 0),
      topLanguages: topLangs.map(l => ({
        ...l,
        percentage: totalBytesAll > 0 ? ((l.byteCount ?? 0) / totalBytesAll) * 100 : 0,
      })),
    }
  }),

  // ── Compare two scans ──────────────────────────────────────────────────────
  compareScans: loggedProcedure
    .input(z.object({
      scanIdA: z.number(),
      scanIdB: z.number(),
    }))
    .query(async ({ input }) => {
      const langsA = await db.select().from(languageStats)
        .where(eq(languageStats.scanId, input.scanIdA))
      const langsB = await db.select().from(languageStats)
        .where(eq(languageStats.scanId, input.scanIdB))

      // Build maps
      const mapA = new Map(langsA.map(l => [l.language, l]))
      const mapB = new Map(langsB.map(l => [l.language, l]))

      const allLangs = new Set([...mapA.keys(), ...mapB.keys()])
      const comparison = Array.from(allLangs).map(lang => ({
        language:  lang,
        color:     mapA.get(lang)?.color ?? mapB.get(lang)?.color ?? '#858585',
        type:      mapA.get(lang)?.type  ?? mapB.get(lang)?.type  ?? 'unknown',
        a: {
          fileCount:  mapA.get(lang)?.fileCount  ?? 0,
          byteCount:  mapA.get(lang)?.byteCount  ?? 0,
          percentage: mapA.get(lang)?.percentage ?? 0,
        },
        b: {
          fileCount:  mapB.get(lang)?.fileCount  ?? 0,
          byteCount:  mapB.get(lang)?.byteCount  ?? 0,
          percentage: mapB.get(lang)?.percentage ?? 0,
        },
        delta: {
          byteCount: (mapB.get(lang)?.byteCount ?? 0) - (mapA.get(lang)?.byteCount ?? 0),
          percentage: (mapB.get(lang)?.percentage ?? 0) - (mapA.get(lang)?.percentage ?? 0),
        },
      })).sort((a, b) => b.b.byteCount - a.b.byteCount)

      return comparison
    }),

  // ── Language timeline (scans over time) ───────────────────────────────────
  getLanguageTimeline: loggedProcedure
    .input(z.object({
      language: z.string().optional(),
      limit:    z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const doneScans = await db.select({
        id:        scans.id,
        name:      scans.name,
        mode:      scans.mode,
        createdAt: scans.createdAt,
      }).from(scans)
        .where(eq(scans.status, 'done'))
        .orderBy(asc(scans.createdAt))
        .limit(input.limit)

      if (doneScans.length === 0) return []

      const scanIds = doneScans.map(s => s.id)

      const allStats = await db.select().from(languageStats)
        .where(inArray(languageStats.scanId, scanIds))

      // Group by scan
      const byScan = new Map<number, typeof allStats>()
      for (const s of allStats) {
        if (!byScan.has(s.scanId)) byScan.set(s.scanId, [])
        byScan.get(s.scanId)!.push(s)
      }

      return doneScans.map(scan => ({
        scanId:    scan.id,
        name:      scan.name,
        mode:      scan.mode,
        createdAt: scan.createdAt,
        languages: (byScan.get(scan.id) ?? [])
          .sort((a, b) => b.byteCount - a.byteCount)
          .slice(0, input.language ? undefined : 10)
          .filter(l => !input.language || l.language === input.language),
      }))
    }),

  // ── Delete a scan ─────────────────────────────────────────────────────────
  deleteScan: loggedProcedure
    .input(z.object({ scanId: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(scans).where(eq(scans.id, input.scanId))
      return { ok: true }
    }),

  // ── Rename a scan ─────────────────────────────────────────────────────────
  renameScan: loggedProcedure
    .input(z.object({ scanId: z.number(), name: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      await db.update(scans).set({ name: input.name }).where(eq(scans.id, input.scanId))
      return { ok: true }
    }),

  // ── Export scan data as JSON ──────────────────────────────────────────────
  exportScan: loggedProcedure
    .input(z.object({ scanId: z.number() }))
    .query(async ({ input }) => {
      const [scan] = await db.select().from(scans).where(eq(scans.id, input.scanId))
      if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scan not found' })

      const repoList  = await db.select().from(repos).where(eq(repos.scanId, input.scanId))
      const langStats = await db.select().from(languageStats).where(eq(languageStats.scanId, input.scanId))

      return { scan, repos: repoList, languageStats: langStats }
    }),
})
