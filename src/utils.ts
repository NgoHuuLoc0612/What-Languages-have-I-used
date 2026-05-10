// ─── Format bytes to human-readable ─────────────────────────────────────────
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

// ─── Format large numbers ─────────────────────────────────────────────────────
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ─── Format percentage ────────────────────────────────────────────────────────
export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

// ─── Format date ──────────────────────────────────────────────────────────────
export function formatDate(d: Date | number | null | undefined): string {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d * 1000)
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatDateTime(d: Date | number | null | undefined): string {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d * 1000)
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function timeAgo(d: Date | number | null | undefined): string {
  if (!d) return '—'
  const date  = d instanceof Date ? d : new Date(Number(d) * 1000)
  const now   = Date.now()
  const diff  = now - date.getTime()
  const secs  = Math.floor(diff / 1000)
  const mins  = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)

  if (days  > 0)  return `${days}d ago`
  if (hours > 0)  return `${hours}h ago`
  if (mins  > 0)  return `${mins}m ago`
  return 'just now'
}

// ─── Truncate path for display ────────────────────────────────────────────────
export function truncatePath(p: string, maxLen = 60): string {
  if (p.length <= maxLen) return p
  const parts  = p.split('/')
  const fname  = parts[parts.length - 1]
  const prefix = p.slice(0, maxLen - fname.length - 4)
  return `${prefix}.../${fname}`
}

// ─── Get extension from path ──────────────────────────────────────────────────
export function getExtension(p: string): string {
  const base = p.split('/').pop() ?? p
  const dot  = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot) : ''
}

// ─── Color helpers ────────────────────────────────────────────────────────────
export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return [128, 128, 128]
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ]
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Group language stats into "Others" ───────────────────────────────────────
export function groupSmallLanguages<T extends { percentage: number; language: string; color: string; byteCount: number }>(
  stats: T[],
  threshold = 1.5,
  topN = 12,
): Array<T | { language: string; percentage: number; color: string; byteCount: number; isOther: true }> {
  const top    = stats.slice(0, topN)
  const others = stats.slice(topN).filter(s => s.percentage < threshold)
  const keep   = stats.slice(topN).filter(s => s.percentage >= threshold)

  const combined = [...top, ...keep]

  if (others.length === 0) return combined

  const otherPct   = others.reduce((s, l) => s + l.percentage, 0)
  const otherBytes = others.reduce((s, l) => s + l.byteCount, 0)

  return [
    ...combined,
    {
      language:  `Others (${others.length})`,
      percentage: otherPct,
      color:     '#858585',
      byteCount: otherBytes,
      isOther:   true as const,
    },
  ]
}

// ─── Download helper ─────────────────────────────────────────────────────────
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h]
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '')
      }).join(',')
    ),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
