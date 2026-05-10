import React, { useState } from 'react'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { useStaggerIn, useSlideIn } from '../../hooks/useAnimations'
import { formatBytes, formatNumber, formatDateTime, timeAgo } from '../../utils'

export default function ScanHistory() {
  const { setActiveScan, setView, addToast, setCompareScan, compareScanIds } = useStore()
  const [mode,   setMode]   = useState<'all' | 'github' | 'folder'>('all')
  const [search, setSearch] = useState('')

  const slideRef  = useSlideIn('up', [])
  const listRef   = useStaggerIn([mode])

  const scansQ = trpc.stats.listScans.useQuery({ mode, limit: 50, offset: 0 })
  const deleteMut = trpc.stats.deleteScan.useMutation()
  const renameMut = trpc.stats.renameScan.useMutation()
  const utils     = trpc.useUtils()

  const handleDelete = async (scanId: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"?`)) return
    await deleteMut.mutateAsync({ scanId })
    utils.stats.listScans.invalidate()
    addToast({ type: 'success', title: 'Scan deleted' })
  }

  const handleRename = async (scanId: number, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const name = prompt('New name:', currentName)
    if (!name || name === currentName) return
    await renameMut.mutateAsync({ scanId, name })
    utils.stats.listScans.invalidate()
    addToast({ type: 'success', title: 'Renamed' })
  }

  const filtered = (scansQ.data ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={slideRef}>
      <div className="page-header">
        <div className="page-header__eyebrow">⊙ History</div>
        <h1 className="page-header__title">Scan History</h1>
        <p className="page-header__subtitle">All your past analyses in one place</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="tabs" style={{ flex: 'none' }}>
          {(['all', 'github', 'folder'] as const).map(m => (
            <div
              key={m}
              className={`tabs__item ${mode === m ? 'tabs__item--active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'all' ? 'All' : m === 'github' ? '⑂ GitHub' : '⊟ Folder'}
            </div>
          ))}
        </div>
        <input
          className="input"
          placeholder="Search scans..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <span style={{ fontSize: 11, color: '#6e7681', fontFamily: 'monospace', marginLeft: 'auto' }}>
          {filtered.length} scans
        </span>
        {compareScanIds[0] && compareScanIds[1] && (
          <button className="btn btn--primary btn--sm" onClick={() => setView('compare')}>
            ⊞ Compare selected
          </button>
        )}
      </div>

      {/* List */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {scansQ.isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
              <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ height: 14, width: 200, marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 11, width: 140 }} />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">⊙</div>
            <h3 className="empty-state__title">No scans yet</h3>
            <p className="empty-state__text">Run your first analysis using GitHub or Folder mode</p>
          </div>
        ) : (
          <div ref={listRef as any}>
            {filtered.map(scan => {
              const isCompareA = compareScanIds[0] === scan.id
              const isCompareB = compareScanIds[1] === scan.id

              return (
                <div
                  key={scan.id}
                  className="scan-history__item"
                  onClick={() => { setActiveScan(scan.id) }}
                  style={{
                    outline: isCompareA ? '2px solid #58a6ff' : isCompareB ? '2px solid #bc8cff' : 'none',
                    outlineOffset: -2,
                  }}
                >
                  <div className={`scan-history__mode-icon scan-history__mode-icon--${scan.mode}`}>
                    {scan.mode === 'github' ? '⑂' : '⊟'}
                  </div>

                  <div className="scan-history__info">
                    <div className="scan-history__name">{scan.name}</div>
                    <div className="scan-history__meta">
                      {formatNumber(scan.totalFiles)} files · {formatBytes(scan.totalBytes)}
                      {' · '}
                      <span className={`scan-status scan-status--${scan.status}`} style={{ display: 'inline-flex' }}>
                        <span className="scan-status__dot" />{scan.status}
                      </span>
                    </div>
                  </div>

                  <div className="scan-history__right">
                    <span style={{ fontSize: 11, color: '#6e7681' }}>{timeAgo(scan.createdAt)}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {/* Compare toggles */}
                      <button
                        className={`btn btn--sm ${isCompareA ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={e => { e.stopPropagation(); setCompareScan(0, isCompareA ? null : scan.id) }}
                        title="Set as Compare A"
                      >A</button>
                      <button
                        className={`btn btn--sm ${isCompareB ? 'btn--secondary' : 'btn--ghost'}`}
                        style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={e => { e.stopPropagation(); setCompareScan(1, isCompareB ? null : scan.id) }}
                        title="Set as Compare B"
                      >B</button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={e => handleRename(scan.id, scan.name, e)}
                        title="Rename"
                      >✏</button>
                      <button
                        className="btn btn--ghost btn--sm"
                        style={{ color: '#f85149' }}
                        onClick={e => handleDelete(scan.id, scan.name, e)}
                        title="Delete"
                      >🗑</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
