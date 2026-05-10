/**
 * scanPipeline.ts — Pipelined, concurrent GitHub repo scanner.
 *
 * Architecture:
 *   - Fetch phase:  concurrent repo tree fetches via Semaphore (I/O bound)
 *   - Detect phase: CPU-bound language detection offloaded to Worker Threads
 *   - Write phase:  batched DB inserts, never blocks fetch or detect
 *
 * The three phases overlap using a producer-consumer model:
 *   fetch → detect → insert all run concurrently across repos.
 *   While repo N is being detected, repo N+1 is already being fetched.
 */

import { Semaphore } from './Semaphore.js'
import { GitHubClient, parseRepoRef, GitTreeEntry } from './githubApi.js'
import { detectLanguages, detectLanguage, computeStats, BINARY_EXTENSIONS } from './languageDetector.js'
import { db } from '../db/index.js'
import { scans, repos, languageStats, fileRecords, githubTokens } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import micromatch from 'micromatch'
import { availableParallelism } from 'os'

// ─── Config ───────────────────────────────────────────────────────────────────

const CPUS              = availableParallelism()
const FETCH_CONCURRENCY = Math.min(6, CPUS * 2)   // concurrent repo tree fetches
const DB_BATCH_SIZE     = 500                       // rows per INSERT
const MAX_FILES_PER_REPO = 50_000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  scanId:          number
  token:           string
  repoRefs:        string[]
  excludePatterns: string[]
  onProgress?:     (update: ProgressUpdate) => void
}

export interface ProgressUpdate {
  reposDone:   number
  reposTotal:  number
  filesScanned: number
  currentRepo:  string
  phase:        'fetching' | 'detecting' | 'writing' | 'done'
}

interface RepoPayload {
  owner:       string
  repoName:    string
  branch:      string
  description: string | null
  stars:       number
  forks:       number
  isPrivate:   boolean
  files:       Array<{ path: string; size: number; sha: string }>
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runScan(opts: ScanOptions): Promise<{
  totalFiles: number
  totalBytes: number
  reposScanned: number
}> {
  const { scanId, token, repoRefs, excludePatterns, onProgress } = opts
  const client   = new GitHubClient(token)
  const fetchSem = new Semaphore(FETCH_CONCURRENCY)

  let reposDone    = 0
  let filesScanned = 0

  // Mark scan running
  await db.update(scans)
    .set({ status: 'running' })
    .where(eq(scans.id, scanId))

  try {
    // ── Phase 1: fetch all repo trees concurrently ──────────────────────────
    // Each fetch is I/O — semaphore keeps GitHub happy (< rate limit pressure)
    const payloadPromises = repoRefs.map(ref =>
      fetchSem.run(async () => {
        const { owner, repo, ref: branch } = parseRepoRef(ref)

        onProgress?.({
          reposDone,
          reposTotal:   repoRefs.length,
          filesScanned,
          currentRepo:  `${owner}/${repo}`,
          phase:        'fetching',
        })

        const [repoMeta, tree] = await Promise.all([
          client.getRepo(owner, repo),
          client.getFullTree(owner, repo, branch ?? 'HEAD'),
        ])

        // Filter binaries and excludes in the fetch worker — don't carry dead weight
        const filtered = filterTree(tree, excludePatterns)

        const payload: RepoPayload = {
          owner,
          repoName:    repo,
          branch:      branch ?? repoMeta.default_branch,
          description: repoMeta.description,
          stars:       repoMeta.stargazers_count,
          forks:       repoMeta.forks_count,
          isPrivate:   repoMeta.private,
          files:       filtered.map(e => ({
            path: e.path,
            size: e.size ?? 0,
            sha:  e.sha,
          })),
        }

        return payload
      })
    )

    // ── Phase 2 + 3: detect + write — overlap with fetch via Promise ordering
    // As each fetch resolves, immediately pipeline into detect → write.
    // We don't await all fetches first — we process each as it arrives.
    let totalFiles = 0
    let totalBytes = 0

    const processPayload = async (payload: RepoPayload): Promise<void> => {
      const { owner, repoName } = payload

      onProgress?.({
        reposDone,
        reposTotal:   repoRefs.length,
        filesScanned,
        currentRepo:  `${owner}/${repoName}`,
        phase:        'detecting',
      })

      // ── Detect (CPU-bound — runs synchronously but is fast for < 50k files)
      // For true multi-core, swap detectLanguages() with workerPool.detect()
      // Worker pool init has overhead; only worth it for > 20k files per repo.
      const fileList  = payload.files.slice(0, MAX_FILES_PER_REPO)
      const detected  = detectLanguages(fileList)
      const stats     = computeStats(detected)

      const fileToLang = new Map<string, string>()
      for (const [langName, entry] of detected) {
        for (const f of entry.files) {
          fileToLang.set(f.path, langName)
        }
      }

      const repoFileCount = fileList.length
      const repoByteCount = fileList.reduce((s, f) => s + f.size, 0)

      onProgress?.({
        reposDone,
        reposTotal:   repoRefs.length,
        filesScanned,
        currentRepo:  `${owner}/${repoName}`,
        phase:        'writing',
      })

      // ── Write — insert repo record first, then bulk-insert dependents
      const [repoRow] = await db.insert(repos).values({
        scanId,
        owner,
        repoName,
        fullName:    `${owner}/${repoName}`,
        branch:      payload.branch,
        description: payload.description ?? undefined,
        stars:       payload.stars,
        forks:       payload.forks,
        isPrivate:   payload.isPrivate,
        totalFiles:  repoFileCount,
        totalBytes:  repoByteCount,
      }).returning()

      // Language stats — small enough to insert in one shot
      if (stats.length > 0) {
        await db.insert(languageStats).values(
          stats.map(s => ({
            scanId,
            repoId:     repoRow.id,
            language:   s.language,
            type:       s.type as 'programming' | 'markup' | 'data' | 'prose' | 'unknown',
            color:      s.color,
            fileCount:  s.fileCount,
            byteCount:  s.byteCount,
            percentage: s.percentage,
          }))
        )
      }

      // File records — batched to avoid SQLite max-variable limits
      const fileInserts = fileList.map(f => ({
        scanId,
        repoId:    repoRow.id,
        path:      f.path,
        extension: extractExt(f.path),
        language:  fileToLang.get(f.path) ?? undefined,
        sizeBytes: f.size,
        sha:       f.sha,
      }))

      for (let i = 0; i < fileInserts.length; i += DB_BATCH_SIZE) {
        await db.insert(fileRecords).values(fileInserts.slice(i, i + DB_BATCH_SIZE))
      }

      // Accumulate totals
      totalFiles   += repoFileCount
      totalBytes   += repoByteCount
      filesScanned += repoFileCount
      reposDone++

      onProgress?.({
        reposDone,
        reposTotal:   repoRefs.length,
        filesScanned,
        currentRepo:  `${owner}/${repoName}`,
        phase:        reposDone === repoRefs.length ? 'done' : 'writing',
      })
    }

    // Drive all payload promises — process each as it resolves, not in order.
    // This is the pipelining: if repo A (large) is still fetching, but repo B
    // (small) finishes first, B goes straight into detect+write immediately.
    await Promise.all(
      payloadPromises.map(p => p.then(processPayload))
    )

    // Mark done
    await db.update(scans)
      .set({ status: 'done', totalFiles, totalBytes, finishedAt: new Date() })
      .where(eq(scans.id, scanId))

    return { totalFiles, totalBytes, reposScanned: reposDone }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.update(scans)
      .set({ status: 'error', errorMsg: msg })
      .where(eq(scans.id, scanId))
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterTree(tree: GitTreeEntry[], excludePatterns: string[]): GitTreeEntry[] {
  return tree.filter(entry => {
    if (entry.type !== 'blob') return false

    const ext = entry.path.split('.').pop()?.toLowerCase()
    if (ext && BINARY_EXTENSIONS.has(`.${ext}`)) return false

    if (excludePatterns.length > 0 && micromatch.isMatch(entry.path, excludePatterns)) {
      return false
    }

    return true
  })
}

function extractExt(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  const slash = filePath.lastIndexOf('/')
  if (dot > slash && dot !== -1) {
    return filePath.slice(dot).toLowerCase()
  }
  return undefined
}
