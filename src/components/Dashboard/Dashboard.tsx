import React, { useState, useRef, useEffect } from 'react'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { useStaggerIn, useCountUp, useSlideIn } from '../../hooks/useAnimations'
import {
  formatBytes, formatNumber, formatDateTime, timeAgo,
  downloadJson, downloadCsv, colorWithAlpha,
} from '../../utils'
import LanguagePieChart     from '../Charts/LanguagePieChart'
import LanguageBarChart     from '../Charts/LanguageBarChart'
import LanguageTreemap      from '../Charts/LanguageTreemap'
import LanguageTimelineChart from '../Charts/LanguageTimelineChart'
import '../../styles/components/_dashboard.scss'

type ChartTab = 'donut' | 'bar' | 'treemap' | 'timeline'
type MetricTab = 'bytes' | 'files' | 'percentage'

export default function Dashboard() {
  const { activeScanId, setActiveScan, dashboardLangType, setDashboardLangType, addToast } = useStore()
  const [chartTab,    setChartTab]    = useState<ChartTab>('donut')
  const [metricTab,   setMetricTab]   = useState<MetricTab>('bytes')
  const [selectedLang, setSelectedLang] = useState<string | null>(null)
  const [fileOffset,  setFileOffset]  = useState(0)
  const [fileSearch,  setFileSearch]  = useState('')
  const [showExport,  setShowExport]  = useState(false)

  const statsRef  = useStaggerIn([activeScanId])
  const headerRef = useSlideIn('up', [activeScanId])

  // ── Queries ────────────────────────────────────────────────────────────────
  const scanQ = trpc.stats.getScan.useQuery(
    { scanId: activeScanId! },
    { enabled: !!activeScanId }
  )

  const langQ = trpc.stats.getScanLanguages.useQuery(
    { scanId: activeScanId!, langType: dashboardLangType as any },
    { enabled: !!activeScanId }
  )

  const fileQ = trpc.stats.getScanFiles.useQuery(
    {
      scanId:   activeScanId!,
      language: selectedLang ?? undefined,
      limit:    100,
      offset:   fileOffset,
    },
    { enabled: !!activeScanId }
  )

  const timelineQ = trpc.stats.getLanguageTimeline.useQuery(
    { limit: 20 },
    { enabled: chartTab === 'timeline' }
  )

  const exportQ = trpc.stats.exportScan.useQuery(
    { scanId: activeScanId! },
    { enabled: false }
  )

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteMut  = trpc.stats.deleteScan.useMutation()
  const renameMut  = trpc.stats.renameScan.useMutation()
  const utils      = trpc.useUtils()

  // Count-up animation for stat numbers
  const filesRef = useCountUp(scanQ.data?.scan.totalFiles ?? 0, 1.2, [scanQ.data])
  const bytesRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!bytesRef.current || !scanQ.data) return
    bytesRef.current.textContent = formatBytes(scanQ.data.scan.totalBytes)
  }, [scanQ.data?.scan.totalBytes])

  if (!activeScanId) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📊</div>
        <h3 className="empty-state__title">No scan selected</h3>
        <p className="empty-state__text">
          Select a scan from the History page, or run a new analysis using GitHub or Folder mode.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn--primary" onClick={() => useStore.getState().setView('github')}>
            ⑂ GitHub Mode
          </button>
          <button className="btn btn--secondary" onClick={() => useStore.getState().setView('folder')}>
            ⊟ Folder Mode
          </button>
        </div>
      </div>
    )
  }

  if (scanQ.isLoading) return <DashboardSkeleton />
  if (scanQ.isError) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">⚠</div>
        <h3 className="empty-state__title">Failed to load scan</h3>
        <p className="empty-state__text">{scanQ.error.message}</p>
        <button className="btn btn--secondary" onClick={() => setActiveScan(null)}>← Back</button>
      </div>
    )
  }

  const { scan, repos, languages } = scanQ.data!

  // Dedupe by language name client-side (safety net for multi-repo scans)
  const rawLangData = langQ.data ?? languages
  const seenLangs = new Map<string, typeof rawLangData[0]>()
  for (const l of rawLangData) {
    const existing = seenLangs.get(l.language)
    if (existing) {
      // Merge: sum fileCount + byteCount, keep first color
      seenLangs.set(l.language, {
        ...existing,
        fileCount: existing.fileCount + l.fileCount,
        byteCount: existing.byteCount + l.byteCount,
      })
    } else {
      seenLangs.set(l.language, { ...l })
    }
  }
  const langData = Array.from(seenLangs.values()).map(l => {
    const total = Array.from(seenLangs.values()).reduce((s, x) => s + x.byteCount, 0)
    return { ...l, percentage: total > 0 ? (l.byteCount / total) * 100 : 0 }
  }).sort((a, b) => b.byteCount - a.byteCount)

  const totalBytes = langData.reduce((s, l) => s + l.byteCount, 0)
  const topLangs   = langData.slice(0, 8)

  const handleDelete = async () => {
    if (!confirm(`Delete "${scan.name}"? This cannot be undone.`)) return
    await deleteMut.mutateAsync({ scanId: scan.id })
    utils.stats.listScans.invalidate()
    setActiveScan(null)
    addToast({ type: 'success', title: 'Scan deleted' })
  }

  const handleExport = async (fmt: 'json' | 'csv') => {
    const data = await exportQ.refetch()
    if (!data.data) return
    if (fmt === 'json') {
      downloadJson(data.data, `${scan.name.replace(/\s+/g, '-')}.json`)
    } else {
      downloadCsv(
        data.data.languageStats.map(l => ({
          language:   l.language,
          type:       l.type,
          fileCount:  l.fileCount,
          byteCount:  l.byteCount,
          percentage: l.percentage.toFixed(2) + '%',
        })),
        `${scan.name.replace(/\s+/g, '-')}-languages.csv`
      )
    }
    setShowExport(false)
  }

  return (
    <div className="dashboard">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header" ref={headerRef}>
        <div className="page-header__eyebrow">
          {scan.mode === 'github' ? '⑂ GitHub Mode' : '⊟ Folder Mode'}
          &nbsp;·&nbsp;
          <span className={`scan-status scan-status--${scan.status}`}>
            <span className="scan-status__dot" />
            {scan.status}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="page-header__title">{scan.name}</h1>
            <p className="page-header__subtitle">
              {timeAgo(scan.createdAt)} · {formatDateTime(scan.finishedAt)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <button className="btn btn--secondary btn--sm" onClick={() => setShowExport(!showExport)}>
                ↓ Export
              </button>
              {showExport && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: '#1c2330', border: '1px solid #30363d',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 100, minWidth: 140, overflow: 'hidden',
                }}>
                  <button className="btn btn--ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px' }}
                    onClick={() => handleExport('json')}>📄 JSON</button>
                  <button className="btn btn--ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px' }}
                    onClick={() => handleExport('csv')}>📊 CSV</button>
                </div>
              )}
            </div>
            <button className="btn btn--danger btn--sm" onClick={handleDelete}>
              🗑 Delete
            </button>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <div className="dashboard__grid" ref={statsRef as any}>
        <div className="stat-card">
          <div className="stat-card__label">
            <div className="stat-card__icon stat-card__icon--blue">📁</div>
            Total Files
          </div>
          <div className="stat-card__value"><span ref={filesRef as any} /></div>
          <div className="stat-card__sub">{repos.length > 0 ? `across ${repos.length} repo${repos.length > 1 ? 's' : ''}` : 'from local folder'}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__label">
            <div className="stat-card__icon stat-card__icon--green">⚖</div>
            Total Size
          </div>
          <div className="stat-card__value"><span ref={bytesRef} /></div>
          <div className="stat-card__sub">code bytes analyzed</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__label">
            <div className="stat-card__icon stat-card__icon--yellow">🔤</div>
            Languages
          </div>
          <div className="stat-card__value">{langData.length}</div>
          <div className="stat-card__sub">{langData.filter(l => l.type === 'programming').length} programming</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__label">
            <div className="stat-card__icon stat-card__icon--purple">👑</div>
            Top Language
          </div>
          <div className="stat-card__value" style={{ fontSize: '1.4rem' }}>
            {langData[0]?.language ?? '—'}
          </div>
          <div className="stat-card__sub">
            {langData[0] ? `${langData[0].percentage.toFixed(1)}% of codebase` : ''}
          </div>
        </div>
      </div>

      {/* ── Language Bar (visual strip) ─────────────────────────────────────── */}
      {topLangs.length > 0 && (
        <div className="card dashboard__lang-bar">
          <div className="card__header">
            <div className="card__title">Language Distribution</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'programming', 'markup', 'data', 'prose'] as const).map(t => (
                <button
                  key={t}
                  className={`btn btn--ghost btn--sm ${dashboardLangType === t ? 'btn--secondary' : ''}`}
                  onClick={() => setDashboardLangType(t)}
                  style={{ fontSize: 11 }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="card__body" style={{ paddingBottom: 0 }}>
            {/* Color bar */}
            <div className="lang-bar" style={{ marginBottom: 12, height: 10 }}>
              {topLangs.map(l => (
                <div
                  key={l.language}
                  className="lang-bar__segment"
                  style={{
                    flex: l.byteCount,
                    background: l.color ?? '#858585',
                    opacity: selectedLang && selectedLang !== l.language ? 0.3 : 1,
                    transition: 'flex 0.5s ease, opacity 0.2s',
                  }}
                  title={`${l.language}: ${l.percentage.toFixed(1)}%`}
                  onClick={() => setSelectedLang(selectedLang === l.language ? null : l.language)}
                />
              ))}
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', paddingBottom: 16 }}>
              {topLangs.map(l => (
                <button
                  key={l.language}
                  onClick={() => setSelectedLang(selectedLang === l.language ? null : l.language)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '2px 4px', borderRadius: 4,
                    opacity: selectedLang && selectedLang !== l.language ? 0.4 : 1,
                    background2: selectedLang === l.language ? colorWithAlpha(l.color ?? '#858585', 0.1) : 'transparent',
                  } as any}
                >
                  <div className="lang-dot" style={{ background: l.color ?? '#858585' }} />
                  <span style={{ fontSize: 12, color: '#8b949e' }}>{l.language}</span>
                  <span style={{ fontSize: 11, color: '#6e7681', fontFamily: 'monospace' }}>
                    {l.percentage.toFixed(1)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <div className="card__title">Visualization</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['donut', 'bar', 'treemap', 'timeline'] as ChartTab[]).map(t => (
              <button
                key={t}
                className={`btn btn--sm ${chartTab === t ? 'btn--secondary' : 'btn--ghost'}`}
                onClick={() => setChartTab(t)}
              >
                {t === 'donut'    ? '🍩' :
                 t === 'bar'      ? '📊' :
                 t === 'treemap'  ? '⬛' : '📈'} {t}
              </button>
            ))}
            {chartTab === 'bar' && (
              <div style={{ marginLeft: 8, display: 'flex', gap: 4 }}>
                {(['bytes', 'files', 'percentage'] as MetricTab[]).map(m => (
                  <button
                    key={m}
                    className={`btn btn--sm ${metricTab === m ? 'btn--accent' : 'btn--ghost'}`}
                    onClick={() => setMetricTab(m)}
                    style={{ fontSize: 10 }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card__body" style={{ padding: '12px 16px' }}>
          {chartTab === 'donut' && (
            <div className="dashboard__charts">
              <LanguagePieChart
                data={langData}
                height={340}
                type="donut"
                onSelect={lang => setSelectedLang(lang === selectedLang ? null : lang)}
              />
              <LanguagePieChart
                data={langData.filter(l => l.type === 'programming')}
                height={340}
                title="Programming Only"
                type="pie"
                onSelect={lang => setSelectedLang(lang === selectedLang ? null : lang)}
              />
            </div>
          )}
          {chartTab === 'bar' && (
            <LanguageBarChart
              data={langData}
              height={Math.max(280, langData.length * 26)}
              metric={metricTab}
              showTop={20}
              onSelect={lang => setSelectedLang(lang === selectedLang ? null : lang)}
            />
          )}
          {chartTab === 'treemap' && (
            <LanguageTreemap
              data={langData}
              height={420}
              onSelect={lang => setSelectedLang(lang === selectedLang ? null : lang)}
            />
          )}
          {chartTab === 'timeline' && (
            timelineQ.isLoading
              ? <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681' }}>Loading timeline...</div>
              : <LanguageTimelineChart data={timelineQ.data ?? []} height={320} />
          )}
        </div>
      </div>

      {/* ── Language Table ──────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__header">
          <div className="card__title">Language Breakdown</div>
          <span style={{ fontSize: 11, color: '#6e7681', fontFamily: 'monospace' }}>
            {langData.length} languages
          </span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          <table className="lang-table">
            <thead className="lang-table__head">
              <tr>
                <th>Language</th>
                <th>Type</th>
                <th>Distribution</th>
                <th>Share</th>
                <th>Files</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {langData.map((l, idx) => (
                <tr
                  key={`${l.language}-${idx}`}
                  className={`lang-table__row ${selectedLang === l.language ? 'lang-table__row--selected' : ''}`}
                  onClick={() => setSelectedLang(selectedLang === l.language ? null : l.language)}
                >
                  <td>
                    <div className="lang-table__lang-cell">
                      <div className="lang-dot" style={{ background: l.color ?? '#858585' }} />
                      <span className="lang-table__lang-name">{l.language}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge--${l.type}`}>{l.type}</span>
                  </td>
                  <td className="lang-table__bar-cell">
                    <div className="progress">
                      <div
                        className="progress__bar"
                        style={{ width: `${l.percentage}%`, background: l.color ?? '#58a6ff' }}
                      />
                    </div>
                  </td>
                  <td className="lang-table__pct">{l.percentage.toFixed(1)}%</td>
                  <td className="lang-table__count">{l.fileCount.toLocaleString()}</td>
                  <td className="lang-table__bytes">{formatBytes(l.byteCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Repos (GitHub mode) ─────────────────────────────────────────────── */}
      {repos.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <div className="card__title">⑂ Repositories ({repos.length})</div>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {repos.map(repo => (
              <div key={repo.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', borderBottom: '1px solid #21262d',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#e6edf3' }}>{repo.fullName}</div>
                  {repo.description && (
                    <div style={{ fontSize: 12, color: '#6e7681', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'monospace', color: '#8b949e', flexShrink: 0 }}>
                  <span>⭐ {(repo.stars ?? 0).toLocaleString()}</span>
                  <span>🍴 {(repo.forks ?? 0).toLocaleString()}</span>
                  <span>📁 {repo.totalFiles.toLocaleString()}</span>
                  <span>⚖ {formatBytes(repo.totalBytes)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── File Browser ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card__header">
          <div className="card__title">📄 Files {selectedLang ? `— ${selectedLang}` : ''}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selectedLang && (
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedLang(null)}>
                Clear filter
              </button>
            )}
            <span style={{ fontSize: 11, color: '#6e7681', fontFamily: 'monospace' }}>
              {fileQ.data?.total.toLocaleString() ?? '…'} files
            </span>
          </div>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          <div className="file-browser__list">
            {fileQ.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid #21262d', display: 'flex', gap: 8 }}>
                  <div className="skeleton" style={{ flex: 1, height: 12 }} />
                  <div className="skeleton" style={{ width: 60, height: 12 }} />
                </div>
              ))
            ) : (
              fileQ.data?.files.map(f => (
                <div key={f.id} className="file-browser__item">
                  <div className="file-browser__path">{f.path}</div>
                  {f.language && (
                    <span className="file-browser__ext">{f.language}</span>
                  )}
                  <span className="file-browser__size">{formatBytes(f.sizeBytes ?? 0)}</span>
                </div>
              ))
            )}
          </div>
          {(fileQ.data?.total ?? 0) > 100 && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid #21262d', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn--ghost btn--sm"
                disabled={fileOffset === 0}
                onClick={() => setFileOffset(Math.max(0, fileOffset - 100))}
              >← Prev</button>
              <span style={{ fontSize: 11, color: '#6e7681' }}>
                {fileOffset + 1}–{Math.min(fileOffset + 100, fileQ.data?.total ?? 0)} of {fileQ.data?.total.toLocaleString()}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                disabled={fileOffset + 100 >= (fileQ.data?.total ?? 0)}
                onClick={() => setFileOffset(fileOffset + 100)}
              >Next →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div>
      <div style={{ height: 80, marginBottom: 24 }}>
        <div className="skeleton" style={{ height: 14, width: 120, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 32, width: 280, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 12, width: 200 }} />
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 100 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 400 }} />
    </div>
  )
}
