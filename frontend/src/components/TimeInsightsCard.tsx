import type { AnalyzeResponse } from '../api/schemas.ts'
import { readTime } from '../lib/timeInsights.ts'
import { TIME_BANDS } from '../content/timeInsights.ts'
import './TimeInsightsCard.css'

const fmt = (v: number) => Math.round(v).toLocaleString('ko-KR')
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * 시간대·인구 카드 (R1 13-15): 구 단위 24시간 유입 미니 차트(피크 구간 강조) + 읽기 문장(lib/timeInsights) + 반경 인구 숫자 3개(엔진 고객성 raw).
 * 점수는 바꾸지 않는다. 자료 단위(구)·기준월을 밝힌다. insights 가 없으면(구버전 서버) 카드를 그리지 않는다.
 */
export function TimeInsightsCard({ analysis }: { analysis: AnalyzeResponse }) {
  const { result, insights } = analysis
  const market = result.지표[0]
  const reading = readTime(insights, result.meta.업종, market.flags)
  if (!reading || !insights?.inflow) return null
  const inflow = insights.inflow
  const max = Math.max(...inflow.by_hour)
  const customer = result.지표[1].raw as Readonly<Record<string, unknown>>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const target = num(customer.타겟연령_거주인구)
  const targetShare = num(customer.타겟연령_비중)
  const workers = num(customer.종사자수)
  const solo = num(customer['1인세대_비중'])
  const popBasis = typeof customer.인구_기준 === 'string' ? customer.인구_기준 : '행정동 전체'
  const peakHours = new Set(reading.inflowPeak.band.hours)
  const shares = TIME_BANDS.map((b) => ({ b, v: b.hours.reduce((a, h) => a + (inflow.by_hour[h] ?? 0), 0) }))
  const total = shares.reduce((a, s) => a + s.v, 0)

  return (
    <section className="time-card" aria-labelledby="time-card-title">
      <div className="time-card__head">
        <h2 id="time-card-title" className="result__section-title">시간대와 사람</h2>
        <span className="time-card__meta">
          {inflow.gu_name} 하루 유입 {fmt(inflow.daily)}명 · 구 단위{inflow.as_of ? ` · ${inflow.as_of} 기준` : ''}
        </span>
      </div>
      <div className="time-card__body">
        <figure className="time-chart" aria-label={`${inflow.gu_name} 시간대별 유입`}>
          <svg className="time-chart__svg" viewBox="0 0 240 72" role="img" aria-hidden="true">
            <title>시간대별 유입</title>
            {inflow.by_hour.map((v, h) => {
              const height = max > 0 ? (v / max) * 56 : 0
              return (
                <rect
                  key={h}
                  className={`time-chart__bar${peakHours.has(h) ? ' time-chart__bar--peak' : ''}`}
                  x={h * 10 + 1}
                  y={60 - height}
                  width={8}
                  height={height}
                  rx={1.5}
                />
              )
            })}
            {[0, 6, 12, 18].map((h) => (
              <text key={h} className="time-chart__tick" x={h * 10 + 1} y={70}>
                {h}시
              </text>
            ))}
          </svg>
          <figcaption className="time-chart__bands">
            {shares.map(({ b, v }) => (
              <span key={b.key} className={`time-chart__band${b.key === reading.inflowPeak.band.key ? ' time-chart__band--peak' : ''}`}>
                {b.label} {total > 0 ? Math.round((v / total) * 100) : 0}%
              </span>
            ))}
          </figcaption>
        </figure>
        <div className="time-card__text">
          {reading.lines.map((line) => (
            <p key={line} className="time-card__line">
              {line}
            </p>
          ))}
          <dl className="time-card__pop">
            {target !== null && (
              <div>
                <dt>타겟 연령 거주</dt>
                <dd>
                  {fmt(target)}명{targetShare !== null && ` · ${pct(targetShare)}`}
                </dd>
              </div>
            )}
            {workers !== null && (
              <div>
                <dt>종사자</dt>
                <dd>{fmt(workers)}명</dd>
              </div>
            )}
            {solo !== null && (
              <div>
                <dt>1인 세대 비중</dt>
                <dd>{pct(solo)}</dd>
              </div>
            )}
          </dl>
          <p className="time-card__note">
            인구는 {popBasis} 기준(엔진 고객성 자료), 유입은 구 단위 생활이동 자료입니다. 점수에는 이미 반영된 값이며 여기서 점수를 더하지 않습니다.
            {insights.hours_profile_note && ` ${insights.hours_profile_note}`}
          </p>
        </div>
      </div>
    </section>
  )
}
