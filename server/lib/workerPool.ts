/**
 * WorkerPool — Node.js Worker Threads pool for CPU-bound tasks.
 *
 * Language detection on 50k+ files is pure CPU work (string ops + Map lookups).
 * Running it on the main thread blocks the event loop and stalls all concurrent
 * HTTP handling. This pool shards file lists across N workers (default: CPU
 * count - 1) and merges results back on the main thread.
 *
 * The worker script is inlined via `workerData` so no separate compiled file
 * is needed — the worker bootstraps itself using the same ESM loader.
 */

import { Worker, isMainThread, parentPort, workerData, receiveMessageOnPort, MessageChannel } from 'worker_threads'
import { availableParallelism } from 'os'
import { fileURLToPath } from 'url'
import path from 'path'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface FileEntry {
  path:  string
  size:  number
}

export interface LangStat {
  language:   string
  type:       string
  color:      string
  fileCount:  number
  byteCount:  number
  percentage: number
}

export interface FileLangResult {
  path:     string
  language: string | null
}

interface WorkerTask {
  files:       FileEntry[]
  ymlPath:     string
}

interface WorkerResult {
  stats:   LangStat[]
  perFile: FileLangResult[]
  error?:  string
}

// ─── Worker side (runs inside worker thread) ──────────────────────────────────

if (!isMainThread) {
  ;(async () => {
    const { files, ymlPath } = workerData as WorkerTask

    try {
      // Dynamic import inside worker — each worker loads its own module scope
      const { detectLanguages, computeStats } = await import('./languageDetector.js')

      const detected = detectLanguages(files)
      const stats    = computeStats(detected)

      // Build per-file language map
      const perFile: FileLangResult[] = files.map(f => {
        const { detectLanguage } = require('./languageDetector.js') // already cached
        return {
          path:     f.path,
          language: null, // filled below
        }
      })

      // Faster: rebuild per-file from detected map directly
      const fileToLang = new Map<string, string>()
      for (const [langName, entry] of detected) {
        for (const f of entry.files) {
          fileToLang.set(f.path, langName)
        }
      }

      const perFileResult: FileLangResult[] = files.map(f => ({
        path:     f.path,
        language: fileToLang.get(f.path) ?? null,
      }))

      const result: WorkerResult = { stats, perFile: perFileResult }
      parentPort!.postMessage(result)
    } catch (err) {
      const result: WorkerResult = {
        stats:   [],
        perFile: [],
        error:   err instanceof Error ? err.message : String(err),
      }
      parentPort!.postMessage(result)
    }
  })()
}

// ─── Pool side (runs on main thread) ─────────────────────────────────────────

interface PoolWorker {
  worker: Worker
  busy:   boolean
}

interface PendingTask {
  files:   FileEntry[]
  ymlPath: string
  resolve: (r: WorkerResult) => void
  reject:  (e: Error) => void
}

export class DetectionWorkerPool {
  private workers:  PoolWorker[] = []
  private queue:    PendingTask[] = []
  private ymlPath:  string
  private size:     number

  constructor(ymlPath: string, size?: number) {
    this.ymlPath = ymlPath
    this.size    = size ?? Math.max(1, availableParallelism() - 1)
  }

  /** Spawn workers (call once at server startup) */
  async init(): Promise<void> {
    const selfPath = fileURLToPath(import.meta.url)

    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(selfPath, {
        workerData: { files: [], ymlPath: this.ymlPath } satisfies WorkerTask,
      })

      worker.on('error', err => {
        console.error(`[workerPool] Worker ${i} error:`, err.message)
      })

      this.workers.push({ worker, busy: false })
    }

    console.log(`[workerPool] ${this.size} detection workers ready`)
  }

  /**
   * Detect languages for a file list. Automatically shards across workers.
   * Returns merged stats + per-file language assignments.
   */
  async detect(files: FileEntry[]): Promise<{ stats: LangStat[]; perFile: FileLangResult[] }> {
    if (files.length === 0) return { stats: [], perFile: [] }

    // Shard file list evenly across workers
    const shardSize  = Math.ceil(files.length / this.size)
    const shards:    FileEntry[][] = []

    for (let i = 0; i < files.length; i += shardSize) {
      shards.push(files.slice(i, i + shardSize))
    }

    const results = await Promise.all(shards.map(shard => this.runOnWorker(shard)))

    // Merge shard results
    const mergedPerFile: FileLangResult[] = results.flatMap(r => r.perFile)

    // Merge stats by language name
    const statMap = new Map<string, LangStat>()
    for (const r of results) {
      for (const s of r.stats) {
        const existing = statMap.get(s.language)
        if (existing) {
          existing.fileCount += s.fileCount
          existing.byteCount += s.byteCount
        } else {
          statMap.set(s.language, { ...s })
        }
      }
    }

    // Recompute percentages after merge
    const totalBytes = Array.from(statMap.values()).reduce((s, v) => s + v.byteCount, 0)
    const mergedStats: LangStat[] = Array.from(statMap.values())
      .map(s => ({ ...s, percentage: totalBytes > 0 ? (s.byteCount / totalBytes) * 100 : 0 }))
      .sort((a, b) => b.byteCount - a.byteCount)

    return { stats: mergedStats, perFile: mergedPerFile }
  }

  /** Terminate all workers (call on server shutdown) */
  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map(w => w.worker.terminate()))
    this.workers = []
    console.log('[workerPool] All workers terminated')
  }

  get workerCount() { return this.size }

  // ── Internal ──────────────────────────────────────────────────────────────

  private runOnWorker(files: FileEntry[]): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const free = this.workers.find(w => !w.busy)
      if (free) {
        this.dispatch(free, files, resolve, reject)
      } else {
        this.queue.push({ files, ymlPath: this.ymlPath, resolve, reject })
      }
    })
  }

  private dispatch(
    pw:      PoolWorker,
    files:   FileEntry[],
    resolve: (r: WorkerResult) => void,
    reject:  (e: Error) => void,
  ): void {
    pw.busy = true

    const onMessage = (result: WorkerResult) => {
      pw.worker.removeListener('message', onMessage)
      pw.busy = false

      if (result.error) {
        reject(new Error(result.error))
      } else {
        resolve(result)
      }

      // Drain queue
      const next = this.queue.shift()
      if (next) {
        this.dispatch(pw, next.files, next.resolve, next.reject)
      }
    }

    pw.worker.on('message', onMessage)
    pw.worker.postMessage({ files, ymlPath: this.ymlPath } satisfies WorkerTask)
  }
}

// ─── Singleton (shared across all tRPC handlers) ──────────────────────────────

let _pool: DetectionWorkerPool | null = null

export async function getWorkerPool(ymlPath: string): Promise<DetectionWorkerPool> {
  if (!_pool) {
    _pool = new DetectionWorkerPool(ymlPath)
    await _pool.init()
  }
  return _pool
}

export async function shutdownWorkerPool(): Promise<void> {
  if (_pool) {
    await _pool.shutdown()
    _pool = null
  }
}
