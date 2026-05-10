import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LanguageDef {
  name:        string
  type:        'programming' | 'markup' | 'data' | 'prose' | 'nil'
  color?:      string
  extensions?: string[]
  filenames?:  string[]
  aliases?:    string[]
  interpreters?: string[]
  group?:      string
  language_id: number
  ace_mode:    string
  tm_scope:    string
}

export interface DetectedLanguage {
  language:  string
  type:      LanguageDef['type']
  color:     string
  extension: string
}

// ─── Raw YAML shape ───────────────────────────────────────────────────────────
type RawYaml = Record<string, {
  type:         string
  color?:       string
  extensions?:  string[]
  filenames?:   string[]
  aliases?:     string[]
  interpreters?: string[]
  group?:       string
  language_id:  number
  ace_mode:     string
  tm_scope:     string
}>

// ─── Singleton maps (built once) ─────────────────────────────────────────────
let _byExtension: Map<string, LanguageDef> | null = null
let _byFilename:  Map<string, LanguageDef> | null = null
let _allDefs:     Map<string, LanguageDef> | null = null

function loadLanguages(): void {
  if (_byExtension) return  // already loaded

  const ymlPath = path.resolve(__dirname, '../languages.yml')
  const raw = yaml.load(fs.readFileSync(ymlPath, 'utf8')) as RawYaml

  _byExtension = new Map()
  _byFilename  = new Map()
  _allDefs     = new Map()

  for (const [name, def] of Object.entries(raw)) {
    const lang: LanguageDef = {
      name,
      type:        def.type as LanguageDef['type'],
      color:       def.color,
      extensions:  def.extensions,
      filenames:   def.filenames,
      aliases:     def.aliases,
      interpreters: def.interpreters,
      group:       def.group,
      language_id: def.language_id,
      ace_mode:    def.ace_mode,
      tm_scope:    def.tm_scope,
    }

    _allDefs.set(name, lang)

    // Index by extension (lowercase)
    for (const ext of def.extensions ?? []) {
      const key = ext.toLowerCase()
      // First definition wins (list is alphabetically ordered so popular ones come first)
      if (!_byExtension.has(key)) {
        _byExtension.set(key, lang)
      }
    }

    // Index by filename (exact match, case-insensitive)
    for (const fname of def.filenames ?? []) {
      _byFilename.set(fname.toLowerCase(), lang)
    }
  }

  console.log(`[lang] Loaded ${_allDefs.size} language definitions from languages.yml`)
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function detectLanguage(filePath: string, sizeBytes = 0): DetectedLanguage | null {
  loadLanguages()

  const basename = path.basename(filePath)
  const ext      = path.extname(filePath).toLowerCase()

  // 1. Try exact filename match (e.g., "Makefile", "Dockerfile")
  const byName = _byFilename!.get(basename.toLowerCase())
  if (byName) {
    return toDetected(byName, ext || basename)
  }

  // 2. Try extension match
  if (ext) {
    const byExt = _byExtension!.get(ext)
    if (byExt) return toDetected(byExt, ext)
  }

  return null
}

export function detectLanguages(filePaths: Array<{ path: string; size?: number }>): Map<string, {
  language: LanguageDef
  files:    Array<{ path: string; size: number }>
  totalBytes: number
}> {
  loadLanguages()
  const result = new Map<string, {
    language: LanguageDef
    files:    Array<{ path: string; size: number }>
    totalBytes: number
  }>()

  for (const { path: fp, size = 0 } of filePaths) {
    const detected = detectLanguage(fp, size)
    if (!detected) continue

    const key = detected.language
    if (!result.has(key)) {
      result.set(key, {
        language:   _allDefs!.get(key)!,
        files:      [],
        totalBytes: 0,
      })
    }
    const entry = result.get(key)!
    entry.files.push({ path: fp, size })
    entry.totalBytes += size
  }

  return result
}

export function getLanguageDef(name: string): LanguageDef | undefined {
  loadLanguages()
  return _allDefs!.get(name)
}

export function getAllLanguageDefs(): LanguageDef[] {
  loadLanguages()
  return Array.from(_allDefs!.values())
}

export function computeStats(
  detected: Map<string, { language: LanguageDef; files: Array<{ path: string; size: number }>; totalBytes: number }>,
): Array<{
  language:   string
  type:       string
  color:      string
  fileCount:  number
  byteCount:  number
  percentage: number
}> {
  const total = Array.from(detected.values()).reduce((s, v) => s + v.totalBytes, 0)
  const rows: ReturnType<typeof computeStats> = []

  for (const [lang, entry] of detected) {
    rows.push({
      language:   lang,
      type:       entry.language.type,
      color:      entry.language.color ?? '#858585',
      fileCount:  entry.files.length,
      byteCount:  entry.totalBytes,
      percentage: total > 0 ? (entry.totalBytes / total) * 100 : 0,
    })
  }

  // Sort by byte count descending
  rows.sort((a, b) => b.byteCount - a.byteCount)
  return rows
}

function toDetected(def: LanguageDef, ext: string): DetectedLanguage {
  return {
    language:  def.name,
    type:      def.type,
    color:     def.color ?? '#858585',
    extension: ext,
  }
}

// ─── Ignore lists (files/dirs to skip) ───────────────────────────────────────
export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/*.map',
  '**/*.snap',
]

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.ogg', '.mov', '.avi',
  '.ttf', '.woff', '.woff2', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.db', '.sqlite', '.sqlite3',
  '.pyc', '.pyo',
])
