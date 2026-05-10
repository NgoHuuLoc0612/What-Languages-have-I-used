// GitHub API client — optimized for very large repos (linux kernel scale)

export interface GitTreeEntry {
  path:  string
  mode:  string
  type:  'blob' | 'tree'
  sha:   string
  size?: number
  url:   string
}

export interface GitTreeResponse {
  sha:       string
  url:       string
  tree:      GitTreeEntry[]
  truncated: boolean
}

export interface RepoMeta {
  id:               number
  name:             string
  full_name:        string
  owner:            { login: string }
  description:      string | null
  stargazers_count: number
  forks_count:      number
  private:          boolean
  default_branch:   string
  size:             number
}

export interface RateLimitInfo {
  limit:     number
  remaining: number
  reset:     number
  used:      number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Semaphore-based concurrent executor — fills slots immediately as they free
async function runConcurrent<T>(
  tasks:       Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let   nextIndex    = 0

  async function worker() {
    while (true) {
      const index = nextIndex++
      if (index >= tasks.length) break
      results[index] = await tasks[index]()
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// ─── GitHub API Client ────────────────────────────────────────────────────────
export class GitHubClient {
  private baseUrl = 'https://api.github.com'
  private token:   string

  // Global request semaphore — prevents thundering herd against GitHub
  private inflight = 0
  private readonly MAX_INFLIGHT = 12

  constructor(token: string) {
    this.token = token
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization':        `Bearer ${this.token}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'what-languages/1.0',
    }
  }

  async request<T>(
    endpoint:  string,
    options:   RequestInit = {},
    timeoutMs = 30_000,
    retries   = 4,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Backpressure — wait if too many inflight
      while (this.inflight >= this.MAX_INFLIGHT) {
        await sleep(50)
      }

      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      this.inflight++

      try {
        const resp = await fetch(url, {
          ...options,
          signal:  ctrl.signal,
          headers: { ...this.headers, ...(options.headers as Record<string, string> ?? {}) },
        })
        clearTimeout(timer)
        this.inflight--

        if (resp.status === 403 || resp.status === 429) {
          const resetAt = parseInt(resp.headers.get('x-ratelimit-reset') ?? '0', 10) * 1000
          const remaining = parseInt(resp.headers.get('x-ratelimit-remaining') ?? '0', 10)

          if (remaining === 0) {
            const waitMs = Math.max(resetAt - Date.now(), 2_000)
            console.warn(`[github] Rate limit exhausted — waiting ${Math.ceil(waitMs / 1000)}s until reset`)
            await sleep(Math.min(waitMs + 500, 65_000))
            continue
          }

          // Secondary rate limit (burst) — exponential backoff
          const backoff = 2_000 * 2 ** attempt
          console.warn(`[github] Secondary rate limit hit, backing off ${backoff}ms`)
          await sleep(backoff)
          continue
        }

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({})) as { message?: string }
          throw new GitHubError(body.message ?? `HTTP ${resp.status}`, resp.status, endpoint)
        }

        return resp.json() as Promise<T>

      } catch (err: unknown) {
        clearTimeout(timer)
        this.inflight = Math.max(0, this.inflight - 1)

        const isAbort   = err instanceof Error && err.name === 'AbortError'
        const isNetwork = err instanceof TypeError && !(err instanceof GitHubError)

        if ((isAbort || isNetwork) && attempt < retries) {
          const backoff = 1_000 * 2 ** attempt
          console.warn(`[github] ${isAbort ? `Timeout (${timeoutMs}ms)` : 'Network error'} on ${endpoint}, retry ${attempt + 1}/${retries} in ${backoff}ms`)
          await sleep(backoff)
          continue
        }

        throw err
      }
    }

    throw new Error(`Failed after ${retries} retries: ${endpoint}`)
  }

  async getAuthUser(): Promise<{ login: string; scopes: string }> {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const resp = await fetch(`${this.baseUrl}/user`, {
        signal:  ctrl.signal,
        headers: this.headers,
      })
      clearTimeout(timer)
      if (!resp.ok) throw new GitHubError('Invalid token', resp.status, '/user')
      const scopes = resp.headers.get('x-oauth-scopes') ?? ''
      const data   = await resp.json() as { login: string }
      return { login: data.login, scopes }
    } finally {
      clearTimeout(timer)
    }
  }

  async getRateLimit(): Promise<RateLimitInfo> {
    const data = await this.request<{ resources: { core: RateLimitInfo } }>('/rate_limit')
    return data.resources.core
  }

  async getRepo(owner: string, repo: string): Promise<RepoMeta> {
    return this.request<RepoMeta>(`/repos/${owner}/${repo}`)
  }

  // ── Full file tree — handles truncated repos (linux kernel scale) ──────────
  async getFullTree(owner: string, repo: string, ref = 'HEAD'): Promise<GitTreeEntry[]> {
    // Resolve branch → tree SHA
    let treeSha: string
    try {
      const branch = await this.request<{
        commit: { commit: { tree: { sha: string } } }
      }>(`/repos/${owner}/${repo}/branches/${ref}`, {}, 20_000)
      treeSha = branch.commit.commit.tree.sha
    } catch {
      const commit = await this.request<{
        sha: string
        commit: { tree: { sha: string } }
      }>(`/repos/${owner}/${repo}/commits/${ref}`, {}, 20_000)
      treeSha = commit.commit.tree.sha
    }

    console.log(`[github] Fetching tree for ${owner}/${repo}@${ref} (sha: ${treeSha.slice(0, 8)}...)`)

    // Try recursive first — works for most repos
    const tree = await this.request<GitTreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
      {},
      90_000,  // large repos can take a while even when not truncated
    )

    if (!tree.truncated) {
      const blobs = tree.tree.filter(e => e.type === 'blob')
      console.log(`[github] Got ${blobs.length} files for ${owner}/${repo} (full tree, no truncation)`)
      return blobs
    }

    // Truncated — must expand sub-trees manually
    // For linux: ~4500 directories, need ~4500 API calls
    console.warn(`[github] Tree truncated for ${owner}/${repo} — expanding sub-trees (this may take several minutes for large repos)`)

    const rate = await this.getRateLimit()
    console.log(`[github] Rate limit: ${rate.remaining}/${rate.limit} remaining, resets at ${new Date(rate.reset * 1000).toISOString()}`)

    if (rate.remaining < 200) {
      const waitMs = Math.max(rate.reset * 1000 - Date.now(), 0)
      console.warn(`[github] Low rate limit (${rate.remaining} remaining) — waiting ${Math.ceil(waitMs / 1000)}s for reset before expanding`)
      await sleep(waitMs + 1_000)
    }

    return this.expandTree(owner, repo, treeSha)
  }

  // ── Expand truncated tree with adaptive concurrency ───────────────────────
  // Uses a work-stealing queue — all blobs and sub-tree SHAs discovered at
  // each level are immediately enqueued. Concurrency adapts to rate limit
  // headroom so we never exhaust the quota mid-scan.
  private async expandTree(
    owner:   string,
    repo:    string,
    rootSha: string,
  ): Promise<GitTreeEntry[]> {
    const blobs:   GitTreeEntry[] = []
    const queue:   Array<{ sha: string; prefix: string }> = [{ sha: rootSha, prefix: '' }]
    let   processed = 0

    // Dynamic concurrency: start at 6, back off if we see rate limit warnings
    let concurrency = 6

    while (queue.length > 0) {
      // Drain up to `concurrency` items from the front of the queue
      const batch = queue.splice(0, concurrency)

      const rate = await this.getRateLimit()

      // Adapt concurrency based on remaining quota
      if (rate.remaining > 2000)       concurrency = 10
      else if (rate.remaining > 1000)  concurrency = 6
      else if (rate.remaining > 500)   concurrency = 3
      else if (rate.remaining > 100)   concurrency = 1
      else {
        const waitMs = Math.max(rate.reset * 1000 - Date.now(), 0)
        console.warn(`[github] Rate limit almost exhausted (${rate.remaining} left) — waiting ${Math.ceil(waitMs / 1000)}s`)
        await sleep(waitMs + 2_000)
        concurrency = 6
      }

      const results = await runConcurrent(
        batch.map(({ sha, prefix }) => async () => {
          const subtree = await this.request<GitTreeResponse>(
            `/repos/${owner}/${repo}/git/trees/${sha}`,
            {},
            30_000,
          )
          return { subtree, prefix }
        }),
        concurrency,
      )

      for (const { subtree, prefix } of results) {
        for (const entry of subtree.tree) {
          const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path

          if (entry.type === 'blob') {
            blobs.push({ ...entry, path: fullPath })
          } else if (entry.type === 'tree') {
            queue.push({ sha: entry.sha, prefix: fullPath })
          }
        }
      }

      processed += batch.length

      if (processed % 100 === 0) {
        console.log(`[github] Expanded ${processed} trees, ${queue.length} remaining in queue, ${blobs.length} files found`)
      }
    }

    console.log(`[github] Expansion complete: ${processed} trees, ${blobs.length} total files`)
    return blobs
  }

  async listUserRepos(page = 1, perPage = 30): Promise<RepoMeta[]> {
    return this.request<RepoMeta[]>(
      `/user/repos?per_page=${perPage}&page=${page}&sort=updated&type=all`,
    )
  }

  async searchRepos(query: string, page = 1): Promise<{
    total_count: number
    items:       RepoMeta[]
  }> {
    return this.request(
      `/search/repositories?q=${encodeURIComponent(query)}&per_page=10&page=${page}`,
    )
  }
}

// ─── Parse owner/repo ─────────────────────────────────────────────────────────
export function parseRepoRef(input: string): { owner: string; repo: string; ref?: string } {
  const cleaned = input.trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')

  const match = cleaned.match(/^([^/\s@#]+)\/([^/\s@#]+)(?:[@#](.+))?$/)
  if (!match) throw new Error(`Invalid repo format: "${input}". Use "owner/repo" or GitHub URL.`)

  return { owner: match[1], repo: match[2], ref: match[3] }
}

// ─── Error ────────────────────────────────────────────────────────────────────
export class GitHubError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint:   string,
  ) {
    super(message)
    this.name = 'GitHubError'
  }

  get isRateLimit()    { return this.statusCode === 403 || this.statusCode === 429 }
  get isNotFound()     { return this.statusCode === 404 }
  get isUnauthorized() { return this.statusCode === 401 }
}
