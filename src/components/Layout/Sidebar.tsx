import React, { useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { trpc } from '../../trpc'
import { useSlideIn } from '../../hooks/useAnimations'
import '../../styles/components/_sidebar.scss'

const NAV_ITEMS = [
  { id: 'home',      label: 'Home',         icon: '⌂',  view: 'home'      },
  { id: 'github',    label: 'GitHub Mode',  icon: '⑂',  view: 'github', mode: 'github' },
  { id: 'folder',    label: 'Folder Mode',  icon: '⊟',  view: 'folder', mode: 'folder' },
] as const

const SECONDARY_ITEMS = [
  { id: 'history',  label: 'Scan History',  icon: '⊙', view: 'history'  },
  { id: 'compare',  label: 'Compare Scans', icon: '⊞', view: 'compare'  },
] as const

function SidebarItem({
  icon, label, active, onClick, badge, className = '',
}: {
  icon: string; label: string; active?: boolean
  onClick: () => void; badge?: string | number; className?: string
}) {
  const { sidebarOpen } = useStore()
  return (
    <button
      className={`sidebar__item ${active ? 'sidebar__item--active' : ''} ${className}`}
      onClick={onClick}
      data-tooltip={!sidebarOpen ? label : undefined}
    >
      <span className="sidebar__icon">{icon}</span>
      <span className="sidebar__label">{label}</span>
      {badge !== undefined && (
        <span className="sidebar__badge">{badge}</span>
      )}
    </button>
  )
}

export default function Sidebar() {
  const { view, setView, sidebarOpen, setSidebar, activeScanId, setActiveScan, theme, toggleTheme } = useStore()
  const ref = useSlideIn('left', [])

  const scansQuery = trpc.stats.listScans.useQuery(
    { mode: 'all', limit: 5 },
    { refetchInterval: 5000 }
  )

  const recentScans = (scansQuery.data ?? []).filter(s => s.status === 'done').slice(0, 5)

  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar--collapsed'}`} ref={ref as React.RefObject<HTMLElement>}>
      {/* Logo */}
      <div className="sidebar__logo" onClick={() => setView('home')} style={{ cursor: 'pointer' }}>
        <div className="sidebar__logo-icon">🔬</div>
        <div className="sidebar__logo-text">
          What Languages Have I Used
          <span>Language Analyzer</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sidebar__nav">
        <div className="sidebar__section">
          {NAV_ITEMS.map(item => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={view === item.view}
              onClick={() => setView(item.view as any)}
              className={item.id === 'github' ? 'sidebar__item--mode-github' : item.id === 'folder' ? 'sidebar__item--mode-folder' : ''}
            />
          ))}
        </div>

        <div className="sidebar__section">
          <div className="sidebar__section-title">Analysis</div>
          {SECONDARY_ITEMS.map(item => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={view === item.view}
              onClick={() => setView(item.view as any)}
            />
          ))}
        </div>

        {/* Recent scans */}
        {recentScans.length > 0 && (
          <div className="sidebar__section">
            <div className="sidebar__section-title">Recent Scans</div>
            {recentScans.map(scan => (
              <button
                key={scan.id}
                className="sidebar__recent-scan"
                onClick={() => setActiveScan(scan.id)}
                data-tooltip={!sidebarOpen ? scan.name : undefined}
              >
                <div
                  className="sidebar__recent-scan-dot"
                  style={{ background: scan.mode === 'github' ? '#3fb950' : '#d29922' }}
                />
                <span className="sidebar__recent-scan-name">{scan.name}</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="sidebar__bottom">
        <SidebarItem
          icon={theme === 'dark' ? '☀' : '☾'}
          label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          onClick={toggleTheme}
        />
        <div
          className="sidebar__toggle"
          onClick={() => setSidebar(!sidebarOpen)}
          data-tooltip={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? '◀' : '▶'}
        </div>
      </div>
    </aside>
  )
}