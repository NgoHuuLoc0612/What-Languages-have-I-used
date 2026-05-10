import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { groupSmallLanguages, formatBytes, formatPct } from '../../utils'

interface LangStat {
  language:   string
  color:      string
  fileCount:  number
  byteCount:  number
  percentage: number
  type:       string
}

interface Props {
  data:     LangStat[]
  height?:  number
  showTop?: number
  title?:   string
  type?:    'pie' | 'donut'
  onSelect?: (lang: string) => void
}

export default function LanguagePieChart({
  data,
  height   = 340,
  showTop  = 12,
  title,
  type     = 'donut',
  onSelect,
}: Props) {
  const grouped = useMemo(() => groupSmallLanguages(data, 1.5, showTop), [data, showTop])

  const option = useMemo<echarts.EChartsOption>(() => ({
    backgroundColor: 'transparent',
    title: title ? {
      text:       title,
      textStyle:  { color: '#e6edf3', fontSize: 13, fontWeight: 600 },
      left:       'center',
      top:        8,
    } : undefined,
    tooltip: {
      trigger:    'item',
      backgroundColor: '#1c2330',
      borderColor:    '#30363d',
      textStyle:      { color: '#e6edf3', fontSize: 12 },
      formatter: (params: any) => {
        const d = params.data as LangStat
        return `
          <div style="padding:4px 0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="width:10px;height:10px;border-radius:50%;background:${params.color}"></div>
              <strong>${d.language}</strong>
            </div>
            <div style="color:#8b949e;font-size:11px">
              ${formatPct(d.percentage)} &nbsp;·&nbsp;
              ${formatBytes(d.byteCount)} &nbsp;·&nbsp;
              ${d.fileCount.toLocaleString()} files
            </div>
          </div>`
      },
    },
    legend: {
      type:      'scroll',
      orient:    'vertical',
      right:     8,
      top:       'center',
      itemWidth:  10,
      itemHeight: 10,
      textStyle: { color: '#8b949e', fontSize: 11 },
      pageTextStyle: { color: '#8b949e' },
      pageIconColor:       '#58a6ff',
      pageIconInactiveColor: '#30363d',
    },
    series: [{
      name:          'Languages',
      type:          'pie',
      radius:        type === 'donut' ? ['42%', '68%'] : '68%',
      center:        ['38%', '52%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 4,
        borderColor:  '#0d1117',
        borderWidth:  2,
      },
      label: {
        show:      false,
        position:  'center',
      },
      emphasis: {
        label: {
          show:      type === 'donut',
          fontSize:  14,
          fontWeight: 600 as any,
          color:     '#e6edf3',
          formatter: (params: any) => `${params.name}\n${formatPct(params.data.percentage)}`,
        },
        itemStyle: { shadowBlur: 12, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' },
        scaleSize: 5,
      },
      labelLine: { show: false },
      data: grouped.map(l => ({
        value:    l.byteCount,
        name:     l.language,
        language: l.language,
        color:    l.color,
        fileCount: 'fileCount' in l ? l.fileCount : 0,
        byteCount: l.byteCount,
        percentage: l.percentage,
        itemStyle: { color: l.color },
      })),
    }],
  }), [grouped, title, type])

  const events = useMemo(() => ({
    click: (params: any) => onSelect?.(params.data.language),
  }), [onSelect])

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 13 }}>
        No language data
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
