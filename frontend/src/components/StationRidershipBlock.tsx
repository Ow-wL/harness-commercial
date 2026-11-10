import { useState } from 'react'
import type { StationRidership } from '../api/schemas.ts'
import { formatDistance } from '../lib/format.ts'
import { DataNote } from './DataNote.tsx'

const fmt = (v: number) => Math.round(v).toLocaleString('ko-KR')
/** "18시" → "18시예요", "06시 전" → "06시 전이에요" (마지막 글자 받침) */
const yeyo = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return `${w}${c >= 0 && c <= 11171 && c % 28 !== 0 ? '이에요' : '예요'}`
}
type DayType = 'weekday' | 'weekend'
const DAY_LABEL: Record<DayType, string> = { weekday: '평일', weekend: '주말' }

/**
 * 가까운 역 시간대별 승하차 (R3 13-41, D-040) — 시간대·인구 카드 안. 자료가 있는 가장 가까운 역(1km 안)의 하루 평균 하차(그 역에 내린 사람)
 * 막대와 승차·하차 합계 한 줄. 인천교통공사 노선만이라 같은 역의 다른 노선(예: 경인선) 이용자는 빠진다 — coverage 를 그대로 밝힌다.
 * 점수와 무관한 참고 자료다.
 */
export function StationRidershipBlock({ station }: { station: StationRidership }) {
  const [day, setDay] = useState<DayType>('weekday')
  const d = station[day]
  const max = Math.max(1, ...d.alight)
  const peakAt = d.alight.indexOf(Math.max(...d.alight))
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const period = station.period_from && station.period_to ? `${station.period_from.slice(0, 7)}~${station.period_to.slice(0, 7)}` : null
  const width = station.bands.length * 12
  return (
    <div className="time-card__station" role="group" aria-labelledby="station-ridership-title">
      <div className="time-card__station-head">
        <h3 id="station-ridership-title" className="time-card__station-title">
          가까운 역 · {station.name}역 <span className="time-card__station-lines">{station.lines}</span>
        </h3>
        <span className="time-card__meta">직선 {formatDistance(station.distance_m)}</span>
        <div className="time-card__daytype" role="group" aria-label="요일 구분">
          {(['weekday', 'weekend'] as const).map((t) => (
            <button key={t} type="button" className="time-card__daybtn" aria-pressed={day === t} onClick={() => setDay(t)}>
              {DAY_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <figure className="time-chart" aria-label={`${station.name}역 ${DAY_LABEL[day]} 시간대별 하차`}>
        <svg className="time-chart__svg" viewBox={`0 0 ${width} 72`} role="img" aria-hidden="true">
          <title>시간대별 하차</title>
          {d.alight.map((v, i) => {
            const height = (v / max) * 56
            return (
              <rect key={i} className={`time-chart__bar${i === peakAt ? ' time-chart__bar--peak' : ''}`} x={i * 12 + 1} y={60 - height} width={10} height={height} rx={1.5} />
            )
          })}
          {[1, 7, 13, 18].map((i) => (                                   // 6·12·18·23시 — 끝 칸(24시 후)은 잘려서 쓰지 않는다
            <text key={i} className="time-chart__tick" x={i * 12 + 1} y={70}>
              {station.bands[i]}
            </text>
          ))}
        </svg>
      </figure>
      <p className="time-card__line">
        {DAY_LABEL[day]} 하루 평균 하차 {fmt(sum(d.alight))}명 · 승차 {fmt(sum(d.board))}명, 하차가 가장 많은 때는 {yeyo(station.bands[peakAt] ?? '')}.
      </p>
      <p className="time-card__hint">역을 오간 사람 수예요 · 점수와 무관한 참고 자료</p>
      <DataNote>
        <p className="time-card__note">
          {station.source} {period ? `${period} ` : ''}{DAY_LABEL[day]} {fmt(d.days)}일 평균. {station.coverage} 역을 오간 사람 수라 주변 상권 방문과 같지 않으며,
          점수에는 쓰지 않는 참고 자료입니다.
        </p>
      </DataNote>
    </div>
  )
}
