/**
 * 시간대·인구 읽기 (R1 13-15): /insights(구 단위 24시간 유입, 업종 영업시간 프로파일)와 엔진 raw 로 "읽기 문장"을 만든다.
 * 점수는 바꾸지 않는다 — 문장은 "유리한 편 / 확인" 수준이고 순위·확률·추천을 말하지 않는다(테스트 고정). 자료 단위(구)·기준월을 카드에 적는다.
 * 시간대 구간: 아침 06~10 · 낮 11~16 · 저녁 17~21 · 밤 22~05. 피크 = 유입 비중이 가장 큰 구간(설명용 관찰).
 *
 * "겹친다/엇갈린다"는 구간 피크 이름이 아니라 엔진의 시간대 적합도(시장성 raw `시간대_적합도`, 24시간 전체 분포의 겹침)와
 * 엔진 flag 기준(> 1.20 집중, < 0.85 엇갈림 — content/timeInsights TIME_FIT)으로만 말한다(Codex R1-1: 피크 구간이 달라도 두 분포는
 * 크게 겹칠 수 있다). 적합도가 없으면 두 피크의 관찰만 쓰고 맞는지 단정하지 않는다.
 */
import type { AnalyzeInsights } from '../api/schemas.ts'
import { TIME_BANDS, TIME_FIT, type TimeBand } from '../content/timeInsights.ts'
import { withJosa } from './josa.ts'

export type BandShare = { band: TimeBand; share: number }

const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0)

/** 24시간 값 → 구간별 비중(합 1). 전부 0이면 null */
export function bandShares(byHour: readonly number[]): BandShare[] | null {
  if (byHour.length !== 24) return null
  const total = sum(byHour)
  if (!(total > 0)) return null
  return TIME_BANDS.map((b) => ({ band: b, share: sum(b.hours.map((h) => byHour[h] ?? 0)) / total }))
}

export const peakBand = (shares: readonly BandShare[]): BandShare => [...shares].sort((a, b) => b.share - a.share)[0]!

/** 엔진 시간대 적합도의 읽기 수준 — 엔진 flag 와 같은 경계 */
export type FitLevel = 'high' | 'normal' | 'low'

export function fitLevel(fit: number | null, flags: readonly string[] = []): FitLevel | null {
  if (flags.includes(TIME_FIT.highFlag)) return 'high'
  if (flags.includes(TIME_FIT.lowFlag)) return 'low'
  if (fit === null || !Number.isFinite(fit)) return null
  if (fit > TIME_FIT.high) return 'high'
  if (fit < TIME_FIT.low) return 'low'
  return 'normal'
}

export type TimeReading = {
  /** 유입 피크 구간과 비중 */
  inflowPeak: BandShare
  /** 업종 영업시간 프로파일의 피크 구간(프로파일이 없으면 null) */
  businessPeak: BandShare | null
  /** 엔진 시간대 적합도 수준 (null = 적합도 없음 — 맞는지 말하지 않는다) */
  level: FitLevel | null
  /** 읽기 문장 1~2줄 */
  lines: string[]
}

/** market: 엔진 시장성 지표의 시간대 적합도(raw)·flags */
export function readTime(
  insights: AnalyzeInsights | null | undefined,
  business: string,
  market: { fit: number | null; flags: readonly string[] } = { fit: null, flags: [] },
): TimeReading | null {
  const inflow = insights?.inflow
  if (!inflow) return null
  const shares = bandShares(inflow.by_hour)
  if (!shares) return null
  const inflowPeak = peakBand(shares)
  const profile = insights?.hours_profile ? bandShares(insights.hours_profile) : null
  const businessPeak = profile ? peakBand(profile) : null
  const level = fitLevel(market.fit, market.flags)
  const pct = Math.round(inflowPeak.share * 100)
  const lines: string[] = [`${withJosa(inflow.gu_name, '은')} ${inflowPeak.band.label}(${inflowPeak.band.range}) 유입이 하루의 ${pct}%로 가장 많아요.`]
  const detail = [
    businessPeak && `주로 ${businessPeak.band.label} 영업`,
    market.fit !== null && Number.isFinite(market.fit) && `시간대 적합도 ${market.fit.toFixed(2)}, 1.0 = 24시간 고르게 퍼졌을 때`,
  ]
    .filter(Boolean)
    .join(' · ')
  const paren = detail ? `(${detail})` : ''
  const subject = withJosa(business, '은')
  if (level === 'high') {
    lines.push(`${subject} 영업 시간대에 사람이 몰리는 편이에요${paren}.`)
  } else if (level === 'low') {
    lines.push(`${subject} 영업 시간대와 유입 시간대가 엇갈리는 편이에요${paren} — 영업 시간대의 실제 유동은 현장에서 확인하세요.`)
  } else if (level === 'normal') {
    lines.push(`${subject} 영업 시간대의 유입이 보통 수준이에요${paren}.`)
  } else if (businessPeak) {
    // 적합도가 없으면 관찰만: 피크 구간이 다르다고 엇갈린다고 단정하지 않는다
    lines.push(`${subject} 주로 ${businessPeak.band.label}에 영업하는 업종이에요 — 이 시간대 유동은 현장에서 확인하세요.`)
  }
  return { inflowPeak, businessPeak, level, lines }
}
