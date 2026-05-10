# What Languages Have I Used?

> Analyze language distribution across your GitHub repositories and local folders — file counts, byte sizes, percentages, timelines, and side-by-side scan comparisons.

![favicon](public/favicon.png)

---

## Features

- **GitHub Mode** — Provide a Personal Access Token and scan any public or private repo by `owner/repo`. Handles repos of any size including truncated trees (linux kernel scale: ~85k files, ~4500 directories).
- **Folder Mode** — Drop a local directory via the browser file picker. No uploads to any server — file metadata stays local.
- **Language Detection** — Powered by a bundled `languages.yml` (GitHub Linguist-compatible). Detects by extension and exact filename (`Makefile`, `Dockerfile`, etc.). Covers 500+ languages.
- **Charts** — Bar chart, pie chart, treemap, and timeline chart via ECharts.
- **Scan History** — Every scan is persisted to SQLite. Browse, rename, delete, and re-open past scans.
- **Scan Comparison** — Pick any two scans and diff language breakdown side by side with byte-count deltas.
- **Language Timeline** — Track how your language distribution shifts across scans over time.
- **Export** — Export any scan as JSON.
- **Glob Pattern Presets** — Save and reuse include/exclude glob patterns across scans.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, SCSS |
| Charts | ECharts + echarts-for-react |
| State | Zustand (persisted) |
| API | tRPC v10 (type-safe end-to-end) |
| Server | Fastify 4, Node.js |
| Database | SQLite via libsql + Drizzle ORM |
| Animations | GSAP |

---

## Project Structure

```
what-languages/
├── index.html
├── package.json
├── vite.config.ts
├── public/
│   └── favicon.png
├── src/                          # Frontend
│   ├── App.tsx
│   ├── trpc.ts                   # tRPC client setup
│   ├── store/
│   │   └── useStore.ts           # Zustand global state
│   ├── components/
│   │   ├── Layout/
│   │   │   └── Sidebar.tsx
│   │   ├── Dashboard/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── ScanHistory.tsx
│   │   │   └── CompareScans.tsx
│   │   ├── Charts/
│   │   │   ├── LanguageBarChart.tsx
│   │   │   ├── LanguagePieChart.tsx
│   │   │   ├── LanguageTreemap.tsx
│   │   │   └── LanguageTimelineChart.tsx
│   │   ├── GitHubMode/
│   │   │   └── GitHubMode.tsx
│   │   └── FolderMode/
│   │       └── FolderMode.tsx
│   └── styles/
│       ├── main.scss
│       ├── _variables.scss
│       └── components/
│           ├── _sidebar.scss
│           ├── _dashboard.scss
│           ├── _home.scss
│           └── _modes.scss
└── server/                       # Backend
    ├── index.ts                  # Fastify entry point
    ├── languages.yml             # Linguist language definitions
    ├── db/
    │   ├── index.ts              # libsql client + initDb()
    │   └── schema.ts             # Drizzle schema (scans, repos, language_stats, file_records, github_tokens, glob_patterns)
    ├── lib/
    │   ├── githubApi.ts          # GitHub REST client (timeout, retry, adaptive rate limit)
    │   ├── languageDetector.ts   # Extension + filename → language lookup
    │   ├── scanPipeline.ts       # Pipelined fetch → detect → write
    │   └── Semaphore.ts          # Bounded concurrency primitive
    └── trpc/
        ├── trpc.ts
        └── router/
            ├── index.ts
            ├── github.ts         # Token management + scan orchestration
            ├── folder.ts         # Local folder scan
            └── stats.ts          # Scan history, global stats, compare, timeline, export
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- A GitHub Personal Access Token with `repo` and `read:user`scope (for GitHub mode)

### Install

```bash
npm install
```

### Run (dev)

```bash
npm run dev
```

This starts both the Fastify API server (`localhost:3001`) and the Vite dev server (`localhost:5173`) concurrently.

### Build

```bash
npm run build
```

---

## GitHub Token Setup

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Generate a **Classic** token with `repo` scope (needed for private repos) or no scopes at all (public repos only)
3. Open the app → Settings → Add Token → paste the token

The token is stored locally in the SQLite database (`data/what-languages.db`). It never leaves your machine.

> **Rate limits:** GitHub allows 5,000 API requests per hour per authenticated token. Small repos (< 1k files) use ~5 requests. Large repos with truncated trees (e.g. `torvalds/linux`) use one request per directory — up to ~4,500 requests. The client automatically waits for rate limit reset if quota is exhausted.

---

## Scan Behavior

### GitHub Mode

1. Token is validated against the GitHub API on save.
2. For each repo ref (`owner/repo` or full GitHub URL):
   - Fetches repo metadata (stars, forks, default branch).
   - Fetches the full recursive file tree via the Git Trees API.
   - If the tree is **truncated** (GitHub's limit for very large repos), expands sub-trees with adaptive concurrency (backs off automatically as rate limit decreases).
3. Binary files and configured exclude patterns (`node_modules`, `dist`, `*.min.js`, etc.) are filtered before detection.
4. Language detection runs on the filtered file list.
5. Results are batch-inserted into SQLite (500 rows per statement).

Multiple repos in a single scan are fetched concurrently (up to 6 at a time). Fetch, detect, and write phases are pipelined — writing repo A starts as soon as its fetch completes, while repo B is still downloading.

### Folder Mode

The browser's directory picker API provides file metadata (path, name, size) without reading file contents. The metadata is sent to the server, filtered by glob patterns, and detected. No file contents are ever read or transmitted.

---

## Data Model

```
scans           — one record per analysis session
repos           — GitHub repos associated with a scan (1:N → scans)
language_stats  — per-language aggregates (1:N → scans, N:1 → repos)
file_records    — individual file entries, capped at 50k per repo
github_tokens   — stored PATs (label, username, scopes, rate limit)
glob_patterns   — saved include/exclude preset patterns
```

The database is created automatically at `data/what-languages.db` on first run.

---

## tRPC API

| Namespace | Procedure | Type | Description |
|-----------|-----------|------|-------------|
| `github` | `saveToken` | mutation | Validate and persist a PAT |
| `github` | `listTokens` | query | List all stored tokens |
| `github` | `deleteToken` | mutation | Remove a token |
| `github` | `getRateLimit` | query | Current rate limit for a token |
| `github` | `listMyRepos` | query | List authenticated user's repos |
| `github` | `searchRepos` | query | Search GitHub repos |
| `github` | `createScan` | mutation | Create a pending scan record |
| `github` | `executeScan` | mutation | Run the scan pipeline |
| `folder` | `analyzeFolderFiles` | mutation | Scan a local folder file list |
| `folder` | `previewGlob` | mutation | Preview glob filter results |
| `folder` | `listGlobPresets` | query | List saved glob presets |
| `folder` | `saveGlobPreset` | mutation | Save a glob preset |
| `folder` | `deleteGlobPreset` | mutation | Delete a glob preset |
| `stats` | `listScans` | query | List scan history |
| `stats` | `getScan` | query | Get scan detail with repos and languages |
| `stats` | `getScanLanguages` | query | Language breakdown for a scan |
| `stats` | `getScanFiles` | query | File list for a scan |
| `stats` | `getGlobalStats` | query | Aggregated stats across all scans |
| `stats` | `compareScans` | query | Diff two scans by language |
| `stats` | `getLanguageTimeline` | query | Language percentages over time |
| `stats` | `deleteScan` | mutation | Delete a scan and all its data |
| `stats` | `renameScan` | mutation | Rename a scan |
| `stats` | `exportScan` | query | Export scan as JSON |

---

## License

MIT