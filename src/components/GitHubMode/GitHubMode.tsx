import React, { useState, useRef } from 'react'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { useSlideIn, useShake } from '../../hooks/useAnimations'
import { formatDateTime, timeAgo } from '../../utils'
import '../../styles/components/_modes.scss'

export default function GitHubMode() {
  const {
    activeTokenId, setActiveToken,
    repoInputs, setRepoInputs, addRepoInput, removeRepoInput,
    addToast, setActiveScan,
  } = useStore()

  const [newTokenLabel, setNewTokenLabel] = useState('')
  const [newTokenValue, setNewTokenValue] = useState('')
  const [showTokenForm, setShowTokenForm] = useState(false)
  const [scanName, setScanName] = useState('GitHub Scan')
  const [scanning, setScanning]  = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanMsg, setScanMsg]    = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [activeSuggInput, setActiveSuggInput] = useState<number | null>(null)

  const slideRef  = useSlideIn('up', [])
  const { ref: shakeRef, shake } = useShake()
  const utils     = trpc.useUtils()

  // ── Queries ────────────────────────────────────────────────────────────────
  const tokensQ = trpc.github.listTokens.useQuery()
  const myReposQ = trpc.github.listMyRepos.useQuery(
    { tokenId: activeTokenId!, page: 1 },
    { enabled: !!activeTokenId }
  )

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveTokenMut    = trpc.github.saveToken.useMutation()
  const deleteTokenMut  = trpc.github.deleteToken.useMutation()
  const createScanMut   = trpc.github.createScan.useMutation()
  const executeScanMut  = trpc.github.executeScan.useMutation()

  // ── Save token ─────────────────────────────────────────────────────────────
  const handleSaveToken = async () => {
    if (!newTokenLabel.trim() || !newTokenValue.trim()) {
      shake(); return
    }
    try {
      const result = await saveTokenMut.mutateAsync({
        label: newTokenLabel.trim(),
        token: newTokenValue.trim(),
      })
      addToast({ type: 'success', title: `Token saved`, message: `Logged in as @${result.username}` })
      setActiveToken(result.id)
      setShowTokenForm(false)
      setNewTokenLabel('')
      setNewTokenValue('')
      utils.github.listTokens.invalidate()
    } catch (e: any) {
      addToast({ type: 'error', title: 'Token error', message: e.message })
      shake()
    }
  }

  // ── Delete token ───────────────────────────────────────────────────────────
  const handleDeleteToken = async (id: number) => {
    if (!confirm('Remove this token?')) return
    await deleteTokenMut.mutateAsync({ id })
    if (activeTokenId === id) setActiveToken(null)
    utils.github.listTokens.invalidate()
  }

  // ── Validate a repo ref string has both owner and repo parts ──────────────
  const isValidRepoRef = (input: string): boolean => {
    const cleaned = input.trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
    const parts = cleaned.split('/').filter(Boolean)
    return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0
  }

  // ── Start scan ─────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    const validRepos = repoInputs.map(r => r.trim()).filter(isValidRepoRef)
    const invalidInputs = repoInputs.map(r => r.trim()).filter(r => r && !isValidRepoRef(r))

    if (!activeTokenId) {
      addToast({ type: 'error', title: 'Select a token first' }); shake(); return
    }
    if (invalidInputs.length > 0) {
      addToast({
        type: 'error',
        title: 'Invalid repo format',
        message: `"${invalidInputs[0]}" — use owner/repo or GitHub URL`,
      }); shake(); return
    }
    if (validRepos.length === 0) {
      addToast({ type: 'error', title: 'Add at least one repo' }); shake(); return
    }

    setScanning(true)
    setScanProgress(5)
    setScanMsg('Creating scan...')

    try {
      const { scanId } = await createScanMut.mutateAsync({
        name:     scanName,
        tokenId:  activeTokenId,
        repoRefs: validRepos,
      })

      setScanProgress(15)
      setScanMsg(`Fetching file trees for ${validRepos.length} repo(s)...`)

      // Execute (this is the long operation)
      const result = await executeScanMut.mutateAsync({
        scanId,
        excludePatterns: [
          '**/node_modules/**', '**/.git/**', '**/dist/**',
          '**/build/**', '**/.next/**', '**/__pycache__/**',
          '**/*.min.js', '**/*.min.css', '**/vendor/**',
        ],
      })

      setScanProgress(100)
      setScanMsg(`Done! ${result.totalFiles.toLocaleString()} files analyzed.`)

      addToast({
        type: 'success',
        title: 'Scan complete!',
        message: `${result.totalFiles.toLocaleString()} files · ${validRepos.length} repo(s)`,
      })

      utils.stats.listScans.invalidate()
      utils.stats.getGlobalStats.invalidate()

      setTimeout(() => {
        setScanning(false)
        setScanProgress(0)
        setActiveScan(scanId)
      }, 1000)

    } catch (e: any) {
      addToast({ type: 'error', title: 'Scan failed', message: e.message })
      setScanMsg(`Error: ${e.message}`)
      setScanProgress(0)
      setScanning(false)
    }
  }

  // ── Suggestion click ───────────────────────────────────────────────────────
  const handleSuggestion = (index: number, fullName: string) => {
    const newInputs = [...repoInputs]
    newInputs[index] = fullName
    setRepoInputs(newInputs)
    setActiveSuggInput(null)
  }

  const currentToken = tokensQ.data?.find(t => t.id === activeTokenId)

  return (
    <div ref={slideRef}>
      <div className="page-header">
        <div className="page-header__eyebrow">⑂ GitHub Mode</div>
        <h1 className="page-header__title">
          Analyze <em>GitHub</em> Repositories
        </h1>
        <p className="page-header__subtitle">
          Fetch complete file trees using GitHub's Git Trees API and analyze language composition
        </p>
      </div>

      {/* ── Tokens ──────────────────────────────────────────────────────────── */}
      <div className="card github-mode__token-section">
        <div className="card__header">
          <div className="card__title">🔑 GitHub Tokens</div>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setShowTokenForm(!showTokenForm)}
          >
            {showTokenForm ? 'Cancel' : '+ Add Token'}
          </button>
        </div>
        <div className="card__body" style={{ padding: showTokenForm ? '16px' : '0' }}>
          {/* Add token form */}
          {showTokenForm && (
            <div ref={shakeRef as any} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>Label</label>
                <input
                  className="input"
                  placeholder="e.g. My GitHub Account"
                  value={newTokenLabel}
                  onChange={e => setNewTokenLabel(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>
                  Personal Access Token
                  <a href="https://github.com/settings/tokens/new?scopes=repo,read:user" target="_blank" rel="noopener"
                    style={{ marginLeft: 8, fontSize: 11 }}>Generate token ↗</a>
                </label>
                <input
                  className="input input--mono"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  type="password"
                  value={newTokenValue}
                  onChange={e => setNewTokenValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveToken()}
                />
                <p style={{ fontSize: 11, color: '#6e7681', marginTop: 4 }}>
                  Needs: repo (read), read:user — tokens are stored locally in SQLite only
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn btn--primary ${saveTokenMut.isPending ? 'btn--loading' : ''}`}
                  onClick={handleSaveToken}
                  disabled={saveTokenMut.isPending}
                >
                  Validate & Save
                </button>
              </div>
            </div>
          )}

          {/* Token list */}
          {!showTokenForm && (
            <div>
              {tokensQ.data?.length === 0 && (
                <div style={{ padding: '20px 16px', textAlign: 'center', color: '#6e7681', fontSize: 13 }}>
                  No tokens yet. Add one to get started.
                </div>
              )}
              {tokensQ.data?.map(tok => (
                <div
                  key={tok.id}
                  className={`github-mode__token-card ${activeTokenId === tok.id ? 'github-mode__token-card--active' : ''}`}
                  onClick={() => setActiveToken(tok.id)}
                >
                  <div className="github-mode__token-avatar">
                    {(tok.username ?? 'U')[0].toUpperCase()}
                  </div>
                  <div className="github-mode__token-info">
                    <div className="github-mode__token-name">{tok.label}</div>
                    <div className="github-mode__token-meta">
                      @{tok.username} · {tok.scopes?.split(',').slice(0,3).join(', ')}
                      {tok.lastUsed ? ` · used ${timeAgo(tok.lastUsed)}` : ''}
                    </div>
                  </div>
                  <div className="github-mode__rate-bar">
                    {tok.rateLimit !== null && (
                      <div className="github-mode__rate-bar-text">
                        {tok.rateLimit?.toLocaleString()} req/h left
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn--ghost btn--icon"
                    onClick={e => { e.stopPropagation(); handleDeleteToken(tok.id) }}
                    style={{ color: '#6e7681' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Repo inputs ─────────────────────────────────────────────────────── */}
      {activeTokenId && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <div className="card__title">📦 Repositories to Analyze</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#6e7681' }}>Max 50 repos per scan</span>
            </div>
          </div>
          <div className="card__body">
            {/* Scan name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>Scan Name</label>
              <input
                className="input"
                value={scanName}
                onChange={e => setScanName(e.target.value)}
                placeholder="e.g. My Projects Analysis"
              />
            </div>

            {/* Repo inputs */}
            <div className="github-mode__repo-inputs">
              {repoInputs.map((repo, i) => (
                <div key={i} className="github-mode__repo-row" style={{ position: 'relative' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <div className="input-group__prefix">github.com/</div>
                    <input
                      className="input"
                      placeholder="owner/repo or paste GitHub URL"
                      value={repo}
                      style={{
                        borderColor: repo.trim() && !isValidRepoRef(repo) ? '#f85149' : undefined,
                        boxShadow:   repo.trim() && !isValidRepoRef(repo) ? '0 0 0 3px rgba(248,81,73,0.1)' : undefined,
                      }}
                      onChange={e => {
                        const v = [...repoInputs]
                        v[i] = e.target.value
                        setRepoInputs(v)
                      }}
                      onFocus={() => setActiveSuggInput(i)}
                      onBlur={() => setTimeout(() => setActiveSuggInput(null), 150)}
                    />
                    {repo.trim() && !isValidRepoRef(repo) && (
                      <div style={{ position: 'absolute', bottom: -18, left: 0, fontSize: 10, color: '#f85149', fontFamily: 'monospace' }}>
                        ✕ needs "owner/repo" format
                      </div>
                    )}
                  </div>
                  {repoInputs.length > 1 && (
                    <button className="btn btn--ghost btn--icon" onClick={() => removeRepoInput(i)}>✕</button>
                  )}
                  {/* My repos suggestion dropdown */}
                  {activeSuggInput === i && myReposQ.data && myReposQ.data.length > 0 && !repo && (
                    <div className="github-mode__repo-suggestions">
                      {myReposQ.data.slice(0, 10).map(r => (
                        <div
                          key={r.id}
                          className="github-mode__suggestion-item"
                          onMouseDown={() => handleSuggestion(i, r.full_name)}
                        >
                          <span className="github-mode__suggestion-item-icon">
                            {r.private ? '🔒' : '⑂'}
                          </span>
                          <span className="github-mode__suggestion-item-name">{r.full_name}</span>
                          <span className="github-mode__suggestion-item-stars">⭐ {r.stargazers_count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => addRepoInput('')}
                disabled={repoInputs.length >= 50}
              >
                + Add Repo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scan progress ────────────────────────────────────────────────────── */}
      {scanning && (
        <div className="github-mode__progress" style={{ marginBottom: 16 }}>
          <div className="github-mode__progress-header">
            <div className="github-mode__progress-title">
              <div className="loading-dots" style={{ display: 'inline-flex', marginRight: 8 }}>
                <span/><span/><span/>
              </div>
              Scanning repositories...
            </div>
            <div className="github-mode__progress-pct">{scanProgress}%</div>
          </div>
          <div className="progress progress--thick">
            <div className="progress__bar" style={{
              width: `${scanProgress}%`,
              background: 'linear-gradient(90deg, #58a6ff, #bc8cff)',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div className="github-mode__progress-msg">{scanMsg}</div>
        </div>
      )}

      {/* ── Start scan button ────────────────────────────────────────────────── */}
      {activeTokenId && (
        <button
          className={`btn btn--success btn--full btn--lg ${scanning ? 'btn--loading' : ''}`}
          onClick={handleStartScan}
          disabled={scanning}
          style={{ fontSize: 15 }}
        >
          {!scanning && '⑂ Start GitHub Scan'}
        </button>
      )}

      {/* My repos quick grid */}
      {activeTokenId && myReposQ.data && !scanning && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__header">
            <div className="card__title">My Repositories</div>
            <span style={{ fontSize: 11, color: '#6e7681' }}>Click to add</span>
          </div>
          <div className="card__body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {myReposQ.data.map(r => (
                <button
                  key={r.id}
                  className="btn btn--secondary"
                  style={{ justifyContent: 'flex-start', fontSize: 12, gap: 6, padding: '6px 10px' }}
                  onClick={() => {
                    if (!repoInputs.includes(r.full_name)) {
                      if (repoInputs[repoInputs.length - 1] === '') {
                        const v = [...repoInputs]
                        v[v.length - 1] = r.full_name
                        setRepoInputs(v)
                      } else {
                        addRepoInput(r.full_name)
                      }
                    }
                  }}
                >
                  {r.private ? '🔒' : '⑂'} {r.name}
                  <span style={{ marginLeft: 'auto', color: '#6e7681', fontFamily: 'monospace', fontSize: 10 }}>
                    ⭐{r.stargazers_count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
