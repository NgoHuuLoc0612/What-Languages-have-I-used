import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { formatBytes } from '../../utils'

interface LangStat {
  language:   string
  color:      string
  fileCount:  number
  byteCount:  number
  percentage: number
}

interface Props {
  data:      LangStat[]
  height?:   number
  metric?:   'bytes' | 'files' | 'percentage'
  showTop?:  number
  onSelect?: (lang: string) => void
}

export default function LanguageBarChart({
  data,
  height   = 340,
  metric   = 'bytes',
  showTop  = 15,
  onSelect,
}: Props) {
  const sorted = useMemo(() =>
    [...data]
      .sort((a, b) => {
        if (metric === 'bytes')      return b.byteCount  - a.byteCount
        if (metric === 'files')      return b.fileCount  - a.fileCount
        return b.percentage - a.percentage
      })
      .slice(0, showTop)
      .reverse(), // ECharts horizontal bars are bottom-to-top
    [data, metric, showTop]
  )

  const option = useMemo<echarts.EChartsOption>(() => ({
    backgroundColor: 'transparent',
    grid: { left: 110, right: 80, top: 12, bottom: 12, containLabel: false },
    tooltip: {
      trigger:        'axis',
      axisPointer:    { type: 'shadow' },
      backgroundColor: '#1c2330',
      borderColor:    '#30363d',
      textStyle:      { color: '#e6edf3', fontSize: 12 },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params
        const d = sorted[p.dataIndex]
        return `
          <div style="padding:4px 0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="width:8px;height:8px;border-radius:2px;background:${d.color}"></div>
              <strong>${d.language}</strong>
            </div>
            <div style="color:#8b949e;font-size:11px;line-height:1.8">
              Bytes: ${formatBytes(d.byteCount)}<br/>
              Files: ${d.fileCount.toLocaleString()}<br/>
              Share: ${d.percentage.toFixed(1)}%
            </div>
          </div>`
      },
    },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#21262d' } },
      axisLabel: {
        color: '#6e7681',
        fontSize: 11,
        formatter: (v: number) => {
          if (metric === 'bytes')      return formatBytes(v, 0)
          if (metric === 'percentage') return `${v}%`
          return v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type:      'category',
      data:      sorted.map(l => l.language),
      axisLabel: { color: '#8b949e', fontSize: 11 },
      axisLine:  { lineStyle: { color: '#21262d' } },
      axisTick:  { show: false },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 24,
      itemStyle: {
        borderRadius: [0, 3, 3, 0],
        color: (params: any) => sorted[params.dataIndex]?.color ?? '#58a6ff',
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 8,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0,0,0,0.4)',
        },
      },
      data: sorted.map(l => ({
        value: metric === 'bytes'      ? l.byteCount
             : metric === 'files'      ? l.fileCount
             : l.percentage,
      })),
      label: {
        show:     true,
        position: 'right',
        color:    '#6e7681',
        fontSize: 10,
        formatter: (params: any) => {
          const d = sorted[params.dataIndex]
          if (metric === 'bytes')      return formatBytes(d.byteCount, 0)
          if (metric === 'percentage') return `${d.percentage.toFixed(1)}%`
          return d.fileCount.toLocaleString()
        },
      },
    }],
  }), [sorted, metric])

  const events = useMemo(() => ({
    click: (params: any) => {
      const d = sorted[params.dataIndex]
      if (d) onSelect?.(d.language)
    },
  }), [sorted, onSelect])

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 13 }}>
        No data
      </div>
    )
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      onEvents={events}
      notMerge
    />
  )
}
