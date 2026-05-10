import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { formatBytes } from '../../utils'

interface LangStat {
  language:   string
  color:      string
  fileCount:  number
  byteCount:  number
  percentage: number
  type:       string
}

interface Props {
  data:      LangStat[]
  height?:   number
  onSelect?: (lang: string) => void
}

export default function LanguageTreemap({ data, height = 380, onSelect }: Props) {
  const option = useMemo<echarts.EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger:        'item',
      backgroundColor: '#1c2330',
      borderColor:    '#30363d',
      textStyle:      { color: '#e6edf3', fontSize: 12 },
      formatter: (params: any) => {
        const d = params.data as LangStat
        if (!d?.language) return ''
        return `
          <div style="padding:4px 0">
            <div style="font-weight:600;margin-bottom:4px">${d.language}</div>
            <div style="color:#8b949e;font-size:11px;line-height:1.9">
              ${d.percentage.toFixed(1)}% of codebase<br/>
              ${formatBytes(d.byteCount)}<br/>
              ${d.fileCount.toLocaleString()} files
            </div>
          </div>`
      },
    },
    series: [{
      type:              'treemap',
      roam:              false,
      nodeClick:         false,
      breadcrumb:        { show: false },
      visibleMin:        200,
      label: {
        show:      true,
        formatter: '{b}',
        color:     'rgba(255,255,255,0.9)',
        fontSize:  12,
        fontWeight: 600 as any,
        overflow:  'truncate',
      },
      upperLabel: {
        show:   false,
      },
      itemStyle: {
        borderColor:  '#0d1117',
        borderWidth:  2,
        gapWidth:     2,
      },
      emphasis: {
        label:     { fontSize: 13 },
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
      },
      levels: [
        {
          itemStyle: { borderWidth: 3, borderColor: '#0d1117', gapWidth: 3 },
          upperLabel: { show: false },
        },
      ],
      data: data
        .filter(l => l.byteCount > 0)
        .map(l => ({
          name:       l.language,
          value:      l.byteCount,
          language:   l.language,
          color:      l.color,
          fileCount:  l.fileCount,
          byteCount:  l.byteCount,
          percentage: l.percentage,
          type:       l.type,
          itemStyle: {
            color:          l.color,
            colorAlpha:     0.85,
          },
          label: {
            formatter: (params: any) => {
              const d = params.data as LangStat
              return d.percentage >= 3
                ? `{a|${d.language}}\n{b|${d.percentage.toFixed(1)}%}`
                : d.language
            },
            rich: {
              a: { fontSize: 12, fontWeight: 700 as any, color: 'rgba(255,255,255,0.95)' },
              b: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
            },
          },
        })),
    }],
  }), [data])

  const events = useMemo(() => ({
    click: (params: any) => onSelect?.(params.data?.language),
  }), [onSelect])

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
