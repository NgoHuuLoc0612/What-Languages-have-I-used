import React, { useState } from 'react'
import { trpc } from '../../trpc'
import { useStore } from '../../store/useStore'
import { useSlideIn } from '../../hooks/useAnimations'
import { formatBytes, formatPct } from '../../utils'
import ReactECharts from 'echarts-for-react'

export default function CompareScans() {
  const { compareScanIds, setCompareScan, setView } = useStore()
  const [scanAId, scanBId] = compareScanIds
  const slideRef = useSlideIn('up', [])

  const scanAQ = trpc.stats.getScan.useQuery({ scanId: scanAId! }, { enabled: !!scanAId })
  const scanBQ = trpc.stats.getScan.useQuery({ scanId: scanBId! }, { enabled: !!scanBId })
  const compareQ = trpc.stats.compareScans.useQuery(
    { scanIdA: scanAId!, scanIdB: scanBId! },
    { enabled: !!scanAId && !!scanBId }
  )

  const allScansQ = trpc.stats.listScans.useQuery({ mode: 'all', limit: 50, offset: 0 })

  const data = compareQ.data ?? []
  const top20 = data.slice(0, 20)

  // ECharts option for side-by-side bar
  const chartOption = top20.length > 0 ? {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1c2330',
      borderColor: '#30363d',
      textStyle: { color: '#e6edf3', fontSize: 12 },
    },
    legend: {
      data: [scanAQ.data?.scan.name ?? 'Scan A', scanBQ.data?.scan.name ?? 'Scan B'],
      textStyle: { color: '#8b949e', fontSize: 11 },
      bottom: 0,
    },
    grid: { left: 120, right: 12, top: 12, bottom: 40, containLabel: false },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#21262d' } },
      axisLabel: { color: '#6e7681', fontSize: 10, formatter: (v: number) => `${v}%` },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: top20.map(l => l.language).reverse(),
      axisLabel: { color: '#8b949e', fontSize: 11 },
      axisLine: { lineStyle: { color: '#21262d' } },
      axisTick: { show: false },
    },
    series: [
      {
        name: scanAQ.data?.scan.name ?? 'Scan A',
        type: 'bar',
        barGap: '10%',
        barMaxWidth: 18,
        itemStyle: { color: '#58a6ff', borderRadius: [0, 3, 3, 0] },
        data: top20.map(l => l.a.percentage.toFixed(2)).reverse(),
      },
      {
        name: scanBQ.data?.scan.name ?? 'Scan B',
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { color: '#bc8cff', borderRadius: [0, 3, 3, 0] },
        data: top20.map(l => l.b.percentage.toFixed(2)).reverse(),
      },
    ],
  } : null

  return (
    <div ref={slideRef}>
      <div className="page-header">
        <div className="page-header__eyebrow">⊞ Compare</div>
        <h1 className="page-header__title">Compare Scans</h1>
        <p className="page-header__subtitle">Side-by-side language distribution comparison</p>
      </div>

      {/* Scan selectors */}
      <div className="compare__grid" style={{ marginBottom: 16 }}>
        {([0, 1] as const).map(slot => {
          const selId = compareScanIds[slot]
          const selQ  = slot === 0 ? scanAQ : scanBQ
          const label = slot === 0 ? 'A' : 'B'
          const color = slot === 0 ? '#58a6ff' : '#bc8cff'

          return (
            <div
              key={slot}
              className="card"
              style={{ borderColor: color + '40' }}
            >
              <div className="card__header" style={{ borderBottom: `2px solid ${color}20` }}>
                <div className="card__title" style={{ color }}>
                  Scan {label}
                </div>
              </div>
              <div className="card__body">
                <select
                  className="input"
                  value={selId ?? ''}
                  onChange={e => setCompareScan(slot, e.target.value ? Number(e.target.value) : null)}
                  style={{ marginBottom: 12 }}
                >
                  <option value="">— Select a scan —</option>
                  {allScansQ.data?.filter(s => s.status === 'done').map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {selQ.data && (
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#e6edf3' }}>
                        {selQ.data.scan.totalFiles.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 11, color: '#6e7681' }}>files</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#e6edf3' }}>
                        {formatBytes(selQ.data.scan.totalBytes)}
                      </div>
                      <div style={{ fontSize: 11, color: '#6e7681' }}>size</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#e6edf3' }}>
                        {selQ.data.languages.length}
                      </div>
                      <div style={{ fontSize: 11, color: '#6e7681' }}>languages</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Comparison chart */}
      {chartOption && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__header">
            <div className="card__title">Language Distribution Comparison</div>
          </div>
          <div className="card__body" style={{ padding: '12px 16px' }}>
            <ReactECharts
              option={chartOption}
              style={{ height: Math.max(320, top20.length * 28), width: '100%' }}
              notMerge
            />
          </div>
        </div>
      )}

      {/* Diff table */}
      {data.length > 0 && (
        <div className="card">
          <div className="card__header">
            <div className="card__title">Language Diff</div>
            <span style={{ fontSize: 11, color: '#6e7681' }}>{data.length} languages total</span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <table className="lang-table">
              <thead className="lang-table__head">
                <tr>
                  <th>Language</th>
                  <th>Scan A</th>
                  <th>Scan B</th>
                  <th>Δ %</th>
                  <th>Δ Bytes</th>
                </tr>
              </thead>
              <tbody>
                {data.map(l => (
                  <tr key={l.language} className="lang-table__row">
                    <td>
                      <div className="lang-table__lang-cell">
                        <div className="lang-dot" style={{ background: l.color }} />
                        <span className="lang-table__lang-name">{l.language}</span>
                        <span className={`badge badge--${l.type}`} style={{ fontSize: 10 }}>{l.type}</span>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#58a6ff' }}>
                      {l.a.percentage > 0 ? `${l.a.percentage.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#bc8cff' }}>
                      {l.b.percentage > 0 ? `${l.b.percentage.toFixed(1)}%` : '—'}
                    </td>
                    <td>
                      <div className={`compare__delta compare__delta--${
                        l.delta.percentage > 0.1 ? 'up' : l.delta.percentage < -0.1 ? 'down' : 'zero'
                      }`}>
                        {l.delta.percentage > 0 ? '+' : ''}{l.delta.percentage.toFixed(1)}%
                      </div>
                    </td>
                    <td>
                      <div className={`compare__delta compare__delta--${
                        l.delta.byteCount > 0 ? 'up' : l.delta.byteCount < 0 ? 'down' : 'zero'
                      }`}>
                        {l.delta.byteCount > 0 ? '+' : ''}{formatBytes(Math.abs(l.delta.byteCount))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(!scanAId || !scanBId) && (
        <div className="empty-state">
          <div className="empty-state__icon">⊞</div>
          <h3 className="empty-state__title">Select two scans to compare</h3>
          <p className="empty-state__text">
            Go to History, mark scans as A and B using the comparison buttons, then come back here.
          </p>
          <button className="btn btn--secondary" onClick={() => setView('history')}>
            View History
          </button>
        </div>
      )}
    </div>
  )
}
