import React, { useState, useRef, useCallback, useEffect } from 'react'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { useSlideIn, useCountUp } from '../../hooks/useAnimations'
import { formatBytes, formatNumber } from '../../utils'
import '../../styles/components/_modes.scss'

export default function FolderMode() {
  const {
    folderFiles, setFolderFiles, clearFolderFiles,
    includePatterns, setIncludePatterns,
    excludePatterns, setExcludePatterns,
    addToast, setActiveScan,
  } = useStore()

  const [scanName,      setScanName]      = useState('Local Folder Scan')
  const [dragOver,      setDragOver]      = useState(false)
  const [scanning,      setScanning]      = useState(false)
  const [previewData,   setPreviewData]   = useState<any>(null)
  const [newInclude,    setNewInclude]    = useState('')
  const [newExclude,    setNewExclude]    = useState('')
  const [showPresets,   setShowPresets]   = useState(false)
  const [presetName,    setPresetName]    = useState('')

  const fileInputRef   = useRef<HTMLInputElement>(null)
  const slideRef       = useSlideIn('up', [])
  const filesCountRef  = useCountUp(folderFiles.length, 0.8, [folderFiles.length])
  const utils          = trpc.useUtils()

  // ── Queries ────────────────────────────────────────────────────────────────
  const presetsQ = trpc.folder.listGlobPresets.useQuery()

  // ── Mutations ──────────────────────────────────────────────────────────────
  const analyzeMut       = trpc.folder.analyzeFolderFiles.useMutation()
  const previewMut       = trpc.folder.previewGlob.useMutation()
  const savePresetMut    = trpc.folder.saveGlobPreset.useMutation()
  const deletePresetMut  = trpc.folder.deleteGlobPreset.useMutation()

  // ── Handle folder selection via <input type="file" webkitdirectory> ─────────
  const handleFileInput = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    const files: typeof folderFiles = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]
      const relativePath = (f as any).webkitRelativePath || f.name
      const ext = relativePath.includes('.') ? '.' + relativePath.split('.').pop()!.toLowerCase() : ''
      files.push({
        path:      relativePath,
        name:      f.name,
        size:      f.size,
        extension: ext,
      })
    }

    setFolderFiles(files)
    addToast({
      type:    'info',
      title:   `${files.length.toLocaleString()} files loaded`,
      message: `From: ${files[0]?.path.split('/')[0] ?? 'folder'}`,
    })
  }, [setFolderFiles, addToast])

  // Auto-preview whenever files or patterns change
  useEffect(() => {
    if (folderFiles.length === 0) return
    const paths = folderFiles.map(f => f.path)
    previewMut.mutateAsync({
      files:           paths,
      includePatterns,
      excludePatterns,
    }).then(setPreviewData).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderFiles.length, includePatterns.join(','), excludePatterns.join(',')])

  // ── Run analysis ───────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (folderFiles.length === 0) {
      addToast({ type: 'error', title: 'No files selected' }); return
    }

    setScanning(true)
    try {
      const result = await analyzeMut.mutateAsync({
        scanName,
        files:           folderFiles,
        includePatterns,
        excludePatterns,
      })

      addToast({
        type:    'success',
        title:   'Analysis complete!',
        message: `${result.totalFiles.toLocaleString()} files · ${result.languages} languages`,
      })

      utils.stats.listScans.invalidate()
      utils.stats.getGlobalStats.invalidate()

      setActiveScan(result.scanId)
    } catch (e: any) {
      addToast({ type: 'error', title: 'Analysis failed', message: e.message })
    } finally {
      setScanning(false)
    }
  }

  // ── Preset management ──────────────────────────────────────────────────────
  const handleSavePreset = async () => {
    if (!presetName.trim()) return
    await savePresetMut.mutateAsync({
      name:     presetName,
      includes: includePatterns,
      excludes: excludePatterns,
    })
    utils.folder.listGlobPresets.invalidate()
    setPresetName('')
    addToast({ type: 'success', title: 'Preset saved' })
  }

  const handleLoadPreset = (preset: { includes: string; excludes: string }) => {
    setIncludePatterns(preset.includes.split('\n').filter(Boolean))
    setExcludePatterns(preset.excludes.split('\n').filter(Boolean))
    setShowPresets(false)
    addToast({ type: 'info', title: 'Preset loaded' })
  }

  const totalSize = folderFiles.reduce((s, f) => s + f.size, 0)
  const extCounts: Record<string, number> = {}
  for (const f of folderFiles.slice(0, 10000)) {
    extCounts[f.extension || '(none)'] = (extCounts[f.extension || '(none)'] ?? 0) + 1
  }
  const topExts = Object.entries(extCounts).sort((a,b) => b[1]-a[1]).slice(0, 8)

  return (
    <div ref={slideRef}>
      <div className="page-header">
        <div className="page-header__eyebrow">⊟ Folder Mode</div>
        <h1 className="page-header__title">
          Analyze <em>Local</em> Folder
        </h1>
        <p className="page-header__subtitle">
          Pick any folder from your computer — fast-glob patterns are applied server-side to filter files before analysis
        </p>
      </div>

      {/* ── Drop zone / folder picker ────────────────────────────────────────── */}
      <div
        className={`folder-mode__drop-zone ${dragOver ? 'folder-mode__drop-zone--drag-over' : ''} ${folderFiles.length > 0 ? 'folder-mode__drop-zone--has-files' : ''}`}
        style={{ marginBottom: 16, position: 'relative' }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false)
          // Note: drag-drop of directories has limited browser support
          // The input[webkitdirectory] approach is more reliable
          addToast({ type: 'info', title: 'Use the button below to pick a folder', message: 'Drag-drop of folders is not supported in all browsers' })
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          multiple
          // @ts-ignore - webkitdirectory is non-standard
          webkitdirectory="true"
          onChange={e => handleFileInput(e.target.files)}
          onClick={e => e.stopPropagation()}
        />

        {folderFiles.length === 0 ? (
          <>
            <div className="folder-mode__drop-icon">📂</div>
            <div className="folder-mode__drop-title">Pick a Folder</div>
            <div className="folder-mode__drop-sub">
              Click to browse, or drag & drop a folder here
            </div>
            <button
              className="btn btn--secondary btn--lg"
              onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
            >
              📁 Choose Folder
            </button>
          </>
        ) : (
          <div className="folder-mode__file-summary">
            <div className="folder-mode__file-summary-stat">
              <div className="folder-mode__file-summary-stat-value">
                <span ref={filesCountRef as any} />
              </div>
              <div className="folder-mode__file-summary-stat-label">Total Files</div>
            </div>
            <div className="folder-mode__file-summary-stat">
              <div className="folder-mode__file-summary-stat-value">{formatBytes(totalSize)}</div>
              <div className="folder-mode__file-summary-stat-label">Total Size</div>
            </div>
            <div className="folder-mode__file-summary-stat">
              <div className="folder-mode__file-summary-stat-value">{Object.keys(extCounts).length}</div>
              <div className="folder-mode__file-summary-stat-label">Extensions</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn--secondary btn--sm"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                Change folder
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={e => { e.stopPropagation(); clearFolderFiles(); setPreviewData(null) }}
                style={{ color: '#f85149' }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {folderFiles.length > 0 && (
        <>
          {/* ── Scan name ────────────────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__header">
              <div className="card__title">⚙ Scan Settings</div>
            </div>
            <div className="card__body">
              <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>Scan Name</label>
              <input
                className="input"
                value={scanName}
                onChange={e => setScanName(e.target.value)}
                placeholder="e.g. My Project"
              />
            </div>
          </div>

          {/* ── Glob patterns ────────────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__header">
              <div className="card__title">🔍 Glob Patterns (fast-glob)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowPresets(!showPresets)}>
                  📋 Presets
                </button>
              </div>
            </div>
            <div className="card__body">
              {showPresets && (
                <div style={{
                  background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
                  padding: 12, marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 8 }}>Saved Presets</div>
                  {presetsQ.data?.length === 0 && (
                    <div style={{ fontSize: 12, color: '#6e7681' }}>No presets yet</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                    {presetsQ.data?.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button className="btn btn--secondary btn--sm" style={{ flex: 1, justifyContent: 'flex-start' }}
                          onClick={() => handleLoadPreset(p)}>
                          {p.name}
                        </button>
                        <button className="btn btn--ghost btn--icon" style={{ color: '#f85149' }}
                          onClick={() => { deletePresetMut.mutateAsync({ id: p.id }); utils.folder.listGlobPresets.invalidate() }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" placeholder="Preset name" value={presetName}
                      onChange={e => setPresetName(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn btn--secondary btn--sm" onClick={handleSavePreset}>Save current</button>
                  </div>
                </div>
              )}

              <div className="folder-mode__patterns">
                {/* Include */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#3fb950', marginBottom: 6 }}>
                    ✓ Include Patterns
                  </div>
                  <div className="folder-mode__pattern-list">
                    {includePatterns.map((p, i) => (
                      <span key={i} className="tag">
                        {p}
                        <span className="tag__remove"
                          onClick={() => setIncludePatterns(includePatterns.filter((_, j) => j !== i))}>×</span>
                      </span>
                    ))}
                  </div>
                  <div className="folder-mode__pattern-input-row">
                    <input
                      className="input input--mono"
                      placeholder="**/*.ts"
                      value={newInclude}
                      onChange={e => setNewInclude(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newInclude.trim()) {
                          setIncludePatterns([...includePatterns, newInclude.trim()])
                          setNewInclude('')
                        }
                      }}
                    />
                    <button className="btn btn--secondary btn--sm" onClick={() => {
                      if (newInclude.trim()) {
                        setIncludePatterns([...includePatterns, newInclude.trim()])
                        setNewInclude('')
                      }
                    }}>+</button>
                  </div>
                </div>

                {/* Exclude */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#f85149', marginBottom: 6 }}>
                    ✕ Exclude Patterns
                  </div>
                  <div className="folder-mode__pattern-list">
                    {excludePatterns.map((p, i) => (
                      <span key={i} className="tag" style={{ borderColor: '#4d1c1c' }}>
                        {p}
                        <span className="tag__remove"
                          onClick={() => setExcludePatterns(excludePatterns.filter((_, j) => j !== i))}>×</span>
                      </span>
                    ))}
                  </div>
                  <div className="folder-mode__pattern-input-row">
                    <input
                      className="input input--mono"
                      placeholder="**/node_modules/**"
                      value={newExclude}
                      onChange={e => setNewExclude(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newExclude.trim()) {
                          setExcludePatterns([...excludePatterns, newExclude.trim()])
                          setNewExclude('')
                        }
                      }}
                    />
                    <button className="btn btn--secondary btn--sm" onClick={() => {
                      if (newExclude.trim()) {
                        setExcludePatterns([...excludePatterns, newExclude.trim()])
                        setNewExclude('')
                      }
                    }}>+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Preview ──────────────────────────────────────────────────────── */}
          {previewData && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card__header">
                <div className="card__title">👁 Filter Preview</div>
              </div>
              <div className="card__body" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#e6edf3' }}>
                      {previewData.total.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#6e7681' }}>Input files</div>
                  </div>
                  <div style={{ fontSize: 20, color: '#6e7681', alignSelf: 'center' }}>→</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#3fb950' }}>
                      {previewData.matched.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#6e7681' }}>Will analyze</div>
                  </div>
                  <div style={{ textAlign: 'center', marginLeft: 'auto' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#f85149' }}>
                      {previewData.excluded.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#6e7681' }}>Excluded</div>
                  </div>
                </div>

                {/* Top extensions preview */}
                {previewData.topExts?.length > 0 && (
                  <div className="folder-mode__preview">
                    {previewData.topExts.slice(0, 8).map((e: any) => (
                      <div key={e.ext} className="folder-mode__preview-row">
                        <span className="folder-mode__preview-ext">{e.ext}</span>
                        <div style={{ flex: 1, margin: '0 12px' }}>
                          <div className="progress">
                            <div className="progress__bar" style={{
                              width: `${(e.count / previewData.matched) * 100}%`,
                              background: '#58a6ff',
                            }} />
                          </div>
                        </div>
                        <span className="folder-mode__preview-count">{e.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Top extensions from loaded files ──────────────────────────────── */}
          {topExts.length > 0 && !previewData && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card__header">
                <div className="card__title">📊 File Extensions</div>
              </div>
              <div className="folder-mode__preview">
                {topExts.map(([ext, count]) => (
                  <div key={ext} className="folder-mode__preview-row">
                    <span className="folder-mode__preview-ext">{ext || '(no ext)'}</span>
                    <div style={{ flex: 1, margin: '0 12px' }}>
                      <div className="progress">
                        <div className="progress__bar" style={{
                          width: `${(count / folderFiles.length) * 100}%`,
                        }} />
                      </div>
                    </div>
                    <span className="folder-mode__preview-count">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Analyze button ───────────────────────────────────────────────── */}
          <button
            className={`btn btn--success btn--full btn--lg ${scanning ? 'btn--loading' : ''}`}
            onClick={handleAnalyze}
            disabled={scanning}
            style={{ fontSize: 15 }}
          >
            {!scanning && `⊟ Analyze ${(previewData?.matched ?? folderFiles.length).toLocaleString()} Files`}
          </button>
        </>
      )}
    </div>
  )
}
