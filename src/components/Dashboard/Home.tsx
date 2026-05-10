import React, { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { formatBytes, formatNumber } from '../../utils'
import LanguagePieChart from '../Charts/LanguagePieChart'
import '../../styles/components/_home.scss'

export default function Home() {
  const { setView, setActiveScan } = useStore()
  const titleRef  = useRef<HTMLHeadingElement>(null)
  const cardsRef  = useRef<HTMLDivElement>(null)
  const badgeRef  = useRef<HTMLDivElement>(null)

  const globalQ   = trpc.stats.getGlobalStats.useQuery()
  const recentQ   = trpc.stats.listScans.useQuery({ mode: 'all', limit: 3, offset: 0 })

  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    if (badgeRef.current) {
      tl.fromTo(badgeRef.current,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.4 }
      )
    }
    if (titleRef.current) {
      tl.fromTo(titleRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.6 }, '-=0.2'
      )
    }
    if (cardsRef.current) {
      tl.fromTo(
        Array.from(cardsRef.current.children),
        { opacity: 0, y: 30, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, stagger: 0.1, duration: 0.5 }, '-=0.2'
      )
    }
  }, [])

  const g = globalQ.data

  return (
    <div className="home">
      <div className="home__hero">
        <div className="home__badge" ref={badgeRef}>
          🔬 Language Intelligence Platform
        </div>

        <h1 className="home__title" ref={titleRef}>
          What Languages<br />
          <em>Have You Used?</em>
        </h1>

        <p className="home__subtitle">
          Analyze language distribution across GitHub repositories or local folders.
          Powered by Linguist's language definitions — the same system GitHub uses.
        </p>

        <div className="home__actions">
          <button className="btn btn--primary btn--lg" onClick={() => setView('github')}>
            ⑂ GitHub Mode
          </button>
          <button className="btn btn--secondary btn--lg" onClick={() => setView('folder')}>
            ⊟ Folder Mode
          </button>
          {g && g.scanCount > 0 && (
            <button className="btn btn--ghost btn--lg" onClick={() => setView('history')}>
              ⊙ View History
            </button>
          )}
        </div>
      </div>

      {/* Mode cards */}
      <div className="home__modes" ref={cardsRef}>
        <div className="home__mode-card home__mode-card--github" onClick={() => setView('github')}>
          <div className="home__mode-icon home__mode-icon--github">⑂</div>
          <div className="home__mode-title">GitHub Mode</div>
          <div className="home__mode-desc">
            Scan any public or private GitHub repository using the Git Trees API. Handles repos with 100k+ files.
          </div>
          <ul className="home__mode-features">
            <li>Full recursive file tree via GitHub API</li>
            <li>Multi-repo batch analysis</li>
            <li>PAT token management</li>
            <li>Rate limit aware</li>
          </ul>
        </div>

        <div className="home__mode-card home__mode-card--folder" onClick={() => setView('folder')}>
          <div className="home__mode-icon home__mode-icon--folder">⊟</div>
          <div className="home__mode-title">Folder Mode</div>
          <div className="home__mode-desc">
            Pick any folder from your computer. Fast-glob patterns let you include/exclude files with full control.
          </div>
          <ul className="home__mode-features">
            <li>Browser folder picker (webkitdirectory)</li>
            <li>fast-glob include/exclude patterns</li>
            <li>Live filter preview</li>
            <li>Saved pattern presets</li>
          </ul>
        </div>
      </div>

      {/* Global stats */}
      {g && g.scanCount > 0 && (
        <>
          <div className="home__stats-strip">
            <div className="home__stat-item">
              <div className="home__stat-item-value">{formatNumber(g.scanCount)}</div>
              <div className="home__stat-item-label">Scans</div>
            </div>
            <div className="home__stat-item">
              <div className="home__stat-item-value">{formatNumber(g.totalFiles)}</div>
              <div className="home__stat-item-label">Files Analyzed</div>
            </div>
            <div className="home__stat-item">
              <div className="home__stat-item-value">{formatBytes(g.totalBytes)}</div>
              <div className="home__stat-item-label">Code Indexed</div>
            </div>
            <div className="home__stat-item">
              <div className="home__stat-item-value">{g.topLanguages.length}</div>
              <div className="home__stat-item-label">Languages</div>
            </div>
          </div>

          {g.topLanguages.length > 0 && (
            <div style={{ maxWidth: 560, width: '100%', marginTop: 32 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', marginBottom: 12, textAlign: 'center' }}>
                All-time language distribution
              </div>
              <LanguagePieChart
                data={g.topLanguages.map(l => ({
                  language:   l.language,
                  color:      l.color ?? '#858585',
                  type:       l.type ?? 'unknown',
                  fileCount:  l.fileCount ?? 0,
                  byteCount:  l.byteCount ?? 0,
                  percentage: l.percentage,
                }))}
                height={280}
                type="donut"
                onSelect={lang => {
                  // could filter to scans with this language
                }}
              />
            </div>
          )}

          {/* Recent scans */}
          {(recentQ.data ?? []).filter(s => s.status === 'done').length > 0 && (
            <div style={{ maxWidth: 560, width: '100%', marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Recent Scans</span>
                <button className="btn btn--ghost btn--sm" onClick={() => setView('history')} style={{ fontSize: 12 }}>
                  View all →
                </button>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                {recentQ.data?.filter(s => s.status === 'done').slice(0, 3).map(scan => (
                  <div
                    key={scan.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                      borderBottom: '1px solid #21262d', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onClick={() => setActiveScan(scan.id)}
                    onMouseEnter={e => (e.currentTarget.style.background = '#21262d')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: scan.mode === 'github' ? 'rgba(63,185,80,0.15)' : 'rgba(210,153,34,0.15)',
                      color: scan.mode === 'github' ? '#3fb950' : '#d29922',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
                    }}>
                      {scan.mode === 'github' ? '⑂' : '⊟'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>{scan.name}</div>
                      <div style={{ fontSize: 11, color: '#6e7681', fontFamily: 'monospace' }}>
                        {formatNumber(scan.totalFiles)} files · {formatBytes(scan.totalBytes)}
                      </div>
                    </div>
                    <span style={{ fontSize: 18, color: '#30363d' }}>›</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
