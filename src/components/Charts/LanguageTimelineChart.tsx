import React, { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { formatDate } from '../../utils'

interface TimelinePoint {
  scanId:    number
  name:      string
  createdAt: Date | number | null
  languages: Array<{
    language:   string
    color:      string | null
    percentage: number
    byteCount:  number
  }>
}

interface Props {
  data:        TimelinePoint[]
  topLanguages?: string[]
  height?:     number
  metric?:     'percentage' | 'bytes'
}

const DEFAULT_COLORS: Record<string, string> = {
  TypeScript:  '#3178c6',
  JavaScript:  '#f1e05a',
  Python:      '#3572A5',
  Rust:        '#dea584',
  Go:          '#00ADD8',
  Java:        '#b07219',
  'C++':       '#f34b7d',
  C:           '#555555',
  Ruby:        '#701516',
  PHP:         '#4F5D95',
  Swift:       '#F05138',
  Kotlin:      '#A97BFF',
  HTML:        '#e34c26',
  CSS:         '#563d7c',
  SCSS:        '#c6538c',
  Shell:       '#89e051',
  Dockerfile:  '#384d54',
  YAML:        '#cb171e',
}

export default function LanguageTimelineChart({
  data,
  topLanguages,
  height = 320,
  metric = 'percentage',
}: Props) {
  // Discover top N languages across all scans
  const langs = useMemo(() => {
    if (topLanguages) return topLanguages

    const counts: Record<string, number> = {}
    for (const point of data) {
      for (const l of point.languages) {
        counts[l.language] = (counts[l.language] ?? 0) + (metric === 'percentage' ? l.percentage : l.byteCount)
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([l]) => l)
  }, [data, topLanguages, metric])

  const option = useMemo<echarts.EChartsOption>(() => {
    if (data.length === 0) return {}

    const xData = data.map(d => {
      const dt = d.createdAt
      if (!dt) return d.name
      const date = dt instanceof Date ? dt : new Date(Number(dt) * 1000)
      return `${d.name}\n${formatDate(date)}`
    })

    const series = langs.map(lang => ({
      name:   lang,
      type:   'line' as const,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2 },
      itemStyle: {
        color: DEFAULT_COLORS[lang] ?? data.flatMap(d =>
          d.languages.find(l => l.language === lang) ? [d.languages.find(l => l.language === lang)!.color] : []
        )[0] ?? '#58a6ff',
      },
      data: data.map(d => {
        const l = d.languages.find(l => l.language === lang)
        return l ? (metric === 'percentage' ? +l.percentage.toFixed(2) : l.byteCount) : 0
      }),
      areaStyle: { opacity: 0.08 },
    }))

    return {
      backgroundColor: 'transparent',
      grid: { left: 48, right: 16, top: 24, bottom: 60 },
      tooltip: {
        trigger:        'axis',
        backgroundColor: '#1c2330',
        borderColor:    '#30363d',
        textStyle:      { color: '#e6edf3', fontSize: 11 },
        formatter: (params: any) => {
          const lines = (params as any[])
            .sort((a, b) => b.value - a.value)
            .map((p: any) => `
              <div style="display:flex;align-items:center;gap:6px">
                <div style="width:8px;height:8px;border-radius:2px;background:${p.color}"></div>
                <span style="color:#8b949e">${p.seriesName}:</span>
                <strong>${metric === 'percentage' ? p.value + '%' : p.value}</strong>
              </div>`)
          return `<div style="padding:4px 0">${lines.join('')}</div>`
        },
      },
      legend: {
        bottom:    0,
        type:      'scroll',
        textStyle: { color: '#8b949e', fontSize: 11 },
        itemWidth:  12,
        itemHeight: 8,
        pageTextStyle:     { color: '#8b949e' },
        pageIconColor:     '#58a6ff',
        pageIconInactiveColor: '#30363d',
      },
      xAxis: {
        type:      'category',
        data:      xData,
        axisLabel: { color: '#6e7681', fontSize: 10 },
        axisLine:  { lineStyle: { color: '#21262d' } },
        axisTick:  { show: false },
      },
      yAxis: {
        type:       'value',
        splitLine:  { lineStyle: { color: '#21262d' } },
        axisLabel: {
          color:    '#6e7681',
          fontSize: 11,
          formatter: metric === 'percentage' ? '{value}%' : '{value}',
        },
        axisLine: { show: false },
        axisTick: { show: false },
        min:      0,
      },
      series,
    }
  }, [data, langs, metric])

  if (data.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 13 }}>
        Need at least 2 scans to show timeline
      </div>
    )
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      notMerge
    />
  )
}
