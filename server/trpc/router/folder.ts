import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, loggedProcedure } from '../trpc.js'
import { detectLanguages, computeStats, DEFAULT_EXCLUDES, BINARY_EXTENSIONS } from '../../lib/languageDetector.js'
import { scans, languageStats, fileRecords, globPatterns } from '../../db/schema.js'
import { db } from '../../db/index.js'
import { eq, desc } from 'drizzle-orm'
import micromatch from 'micromatch'
import path from 'path'

// Zod schema for a file entry sent from the client (via FileList API)
const FileEntrySchema = z.object({
  path:      z.string(),            // webkitRelativePath
  name:      z.string(),
  size:      z.number().int().min(0),
  extension: z.string(),
})

export const folderRouter = router({

  // ── Analyze uploaded file list from browser directory picker ─────────────
  analyzeFolderFiles: loggedProcedure
    .input(z.object({
      scanName:        z.string().min(1).max(128).default('Local Folder Scan'),
      files:           z.array(FileEntrySchema).max(200_000),
      includePatterns: z.array(z.string()).default(['**/*']),
      excludePatterns: z.array(z.string()).default(DEFAULT_EXCLUDES),
    }))
    .mutation(async ({ input }) => {
      // Filter files using micromatch (simulates fast-glob patterns)
      const filtered = input.files.filter(f => {
        const fp = f.path

        // Skip binary files
        const ext = path.extname(fp).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) return false

        // Apply include patterns
        const included = micromatch.isMatch(fp, input.includePatterns, { dot: true })
        if (!included) return false

        // Apply exclude patterns
        const excluded = micromatch.isMatch(fp, input.excludePatterns, { dot: true })
        return !excluded
      })

      if (filtered.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No files matched after applying filters. Try adjusting your glob patterns.',
        })
      }

      // Create scan record
      const [scan] = await db.insert(scans).values({
        name:   input.scanName,
        mode:   'folder',
        status: 'running',
        meta:   JSON.stringify({
          totalInputFiles: input.files.length,
          filteredFiles:   filtered.length,
          includes:        input.includePatterns,
          excludes:        input.excludePatterns,
        }),
      }).returning()

      try {
        // Build path list for detection
        const fileList = filtered.map(f => ({
          path: f.path,
          size: f.size,
        }))

        // Detect languages
        const detected = detectLanguages(fileList)
        const stats    = computeStats(detected)

        const totalFiles = filtered.length
        const totalBytes = filtered.reduce((s, f) => s + f.size, 0)

        // Store language stats
        if (stats.length > 0) {
          for (let i = 0; i < stats.length; i += 500) {
            await db.insert(languageStats).values(
              stats.slice(i, i + 500).map(s => ({
                scanId:     scan.id,
                language:   s.language,
                type:       s.type as any,
                color:      s.color,
                fileCount:  s.fileCount,
                byteCount:  s.byteCount,
                percentage: s.percentage,
              }))
            )
          }
        }

        // Store file records (limit 50k)
        const MAX_FILES = 50_000
        const fileInserts = filtered.slice(0, MAX_FILES).map(f => {
          const ext = path.extname(f.path).toLowerCase()
          const lang = findLanguageForFile(detected, f.path)
          return {
            scanId:    scan.id,
            path:      f.path,
            extension: ext || undefined,
            language:  lang,
            sizeBytes: f.size,
          }
        })

        for (let i = 0; i < fileInserts.length; i += 500) {
          await db.insert(fileRecords).values(fileInserts.slice(i, i + 500))
        }

        // Mark scan as done
        await db.update(scans)
          .set({ status: 'done', totalFiles, totalBytes, finishedAt: new Date() })
          .where(eq(scans.id, scan.id))

        return {
          scanId:     scan.id,
          totalFiles,
          totalBytes,
          languages:  stats.length,
          topLangs:   stats.slice(0, 5).map(s => s.language),
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await db.update(scans)
          .set({ status: 'error', errorMsg: msg })
          .where(eq(scans.id, scan.id))
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg })
      }
    }),

  // ── Preview: Apply glob patterns to file list and return counts ────────────
  previewGlob: loggedProcedure
    .input(z.object({
      files:           z.array(z.string()).max(200_000),
      includePatterns: z.array(z.string()).default(['**/*']),
      excludePatterns: z.array(z.string()).default(DEFAULT_EXCLUDES),
    }))
    .mutation(async ({ input }) => {
      const included = micromatch(input.files, input.includePatterns, { dot: true })
      const filtered = micromatch.not(included, input.excludePatterns, { dot: true })

      // Categorize by extension
      const extCounts: Record<string, number> = {}
      for (const fp of filtered) {
        const ext = path.extname(fp).toLowerCase() || '(no ext)'
        extCounts[ext] = (extCounts[ext] ?? 0) + 1
      }

      const topExts = Object.entries(extCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([ext, count]) => ({ ext, count }))

      return {
        total:    input.files.length,
        matched:  filtered.length,
        excluded: input.files.length - filtered.length,
        topExts,
      }
    }),

  // ── Glob pattern presets ──────────────────────────────────────────────────
  listGlobPresets: loggedProcedure.query(async () => {
    return db.select().from(globPatterns).orderBy(desc(globPatterns.createdAt))
  }),

  saveGlobPreset: loggedProcedure
    .input(z.object({
      name:     z.string().min(1).max(64),
      includes: z.array(z.string()),
      excludes: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const [saved] = await db.insert(globPatterns).values({
        name:     input.name,
        includes: input.includes.join('\n'),
        excludes: input.excludes.join('\n'),
      }).returning()
      return saved
    }),

  deleteGlobPreset: loggedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(globPatterns).where(eq(globPatterns.id, input.id))
      return { ok: true }
    }),
})

// Find which language a file was detected as
function findLanguageForFile(
  detected: Map<string, { language: { name: string }; files: Array<{ path: string }> }>,
  filePath: string,
): string | undefined {
  for (const [, entry] of detected) {
    if (entry.files.some(f => f.path === filePath)) {
      return entry.language.name
    }
  }
  return undefined
}
