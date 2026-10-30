import type { PerspectiveKey } from '../api/schemas.ts'
import { formatScore } from '../lib/format.ts'
import { gradeOf } from '../lib/grade.ts'
import { radarPoint, type RadarPoint } from '../lib/radar.ts'
import './RadarChart.css'

export type RadarItem = { key: PerspectiveKey | string; label: string; score: number | null }
export type RadarSeries = { id: string; name: string; items: readonly RadarItem[] }

/**
 * 거미줄(레이더) 그래프 (13-13): 다섯 관점 0~100, 50 기준 점선 오각형, 산출 안 된 관점은 축을 회색으로 두고 점을 찍지 않는다
 * (0으로 그리지 않는다 — §8.2). 라이브러리 없이 SVG 만. 두 번째 series(비교 B)는 빈 면·점선으로 겹친다.
 * 접근성: <title> + 관점별 점수를 글자로(visually-hidden 목록). 색은 등급색(13-4)이되 글자 등급이 행 목록에 있으므로 여기서는 보조.
 */
export function RadarChart({ series, size = 240, title = '다섯 관점 거미줄 그래프' }: { series: readonly RadarSeries[]; size?: number; title?: string }) {
  const first = series[0]
  if (!first || first.items.length < 3) return null
  const n = first.items.length
  const c = size / 2
  const r = size / 2 - 42                                   // 라벨 자리(위·아래 글자가 잘리지 않게)
  const ring = (pct: number) =>
    Array.from({ length: n }, (_, i) => radarPoint(i, n, pct, r, c))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ')
  const polygon = (items: readonly RadarItem[]) =>
    items
      .map((it, i) => (it.score === null ? null : radarPoint(i, n, it.score, r, c)))
      .filter((p): p is RadarPoint => p !== null)
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ')
  const overall = (items: readonly RadarItem[]) => {
    const s = items.filter((i) => i.score !== null).map((i) => i.score as number)
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null
  }
  return (
    <figure className="radar" aria-label={title}>
      <svg className="radar__svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-hidden="true">
        <title>{title}</title>
        {[25, 50, 75, 100].map((pct) => (
          <polygon key={pct} className={`radar__ring${pct === 50 ? ' radar__ring--reference' : ''}`} points={ring(pct)} />
        ))}
        {first.items.map((it, i) => {
          const end = radarPoint(i, n, 100, r, c)
          const lab = radarPoint(i, n, 100, r + 22, c)
          return (
            <g key={it.key}>
              <line className={`radar__axis${it.score === null ? ' radar__axis--missing' : ''}`} x1={c} y1={c} x2={end.x} y2={end.y} />
              <text className="radar__label" x={lab.x} y={lab.y} textAnchor="middle" dominantBaseline="middle">
                {it.label}
              </text>
            </g>
          )
        })}
        {series.map((s, si) => {
          const g = gradeOf(overall(s.items)) ?? 'mid'
          const pts = polygon(s.items)
          return (
            pts.split(' ').length >= 3 && (
              <g key={s.id} className={`radar__series radar__series--${si === 0 ? 'a' : 'b'} radar__series--${g}`}>
                <polygon className="radar__area" points={pts} />
                {s.items.map((it, i) => {
                  if (it.score === null) return null
                  const p = radarPoint(i, n, it.score, r, c)
                  return <circle key={it.key} className="radar__dot" cx={p.x} cy={p.y} r={si === 0 ? 4 : 3.5} />
                })}
              </g>
            )
          )
        })}
      </svg>
      <figcaption className="visually-hidden">
        {series.map((s) => (
          <ul key={s.id} aria-label={s.name}>
            {s.items.map((it) => (
              <li key={it.key}>
                {it.label} {it.score === null ? '미산출' : `${formatScore(it.score)}점`}
              </li>
            ))}
          </ul>
        ))}
        점선 오각형은 50(인천 동네 평균 지점)입니다.
      </figcaption>
      {series.length > 1 && (
        <ul className="radar__legend" aria-hidden="true">
          {series.map((s, si) => (
            <li key={s.id} className={`radar__legend-item radar__legend-item--${si === 0 ? 'a' : 'b'}`}>
              <span className="radar__legend-swatch" />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
