/**
 * 시간대·인구 읽기 (R1 13-15): /analyze insights(구 단위 24시간 유입, 업종 영업시간 프로파일)와 엔진 raw 로 "읽기 문장"을 만든다.
 * 점수는 바꾸지 않는다 — 문장은 "유리한 편 / 확인" 수준이고 순위·확률·추천을 말하지 않는다(테스트 고정). 자료 단위(구)·기준월을 카드에 적는다.
 * 시간대 구간: 아침 06~10 · 낮 11~16 · 저녁 17~21 · 밤 22~05. 피크 = 유입 비중이 가장 큰 구간.
 */
import type { AnalyzeInsights } from '../api/schemas.ts'
import { TIME_BANDS, type TimeBand } from '../content/timeInsights.ts'

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

export type TimeReading = {
  /** 유입 피크 구간과 비중 */
  inflowPeak: BandShare
  /** 업종 영업시간 프로파일의 피크 구간(프로파일이 없으면 null) */
  businessPeak: BandShare | null
  /** 두 피크가 같은 구간인지 (null = 프로파일 없음) */
  aligned: boolean | null
  /** 읽기 문장 1~2줄 */
  lines: string[]
}

export function readTime(insights: AnalyzeInsights | null | undefined, business: string, flags: readonly string[] = []): TimeReading | null {
  const inflow = insights?.inflow
  if (!inflow) return null
  const shares = bandShares(inflow.by_hour)
  if (!shares) return null
  const inflowPeak = peakBand(shares)
  const profile = insights?.hours_profile ? bandShares(insights.hours_profile) : null
  const businessPeak = profile ? peakBand(profile) : null
  const aligned = businessPeak ? businessPeak.band.key === inflowPeak.band.key : null
  const pct = Math.round(inflowPeak.share * 100)
  const lines: string[] = [`${inflow.gu_name}는 ${inflowPeak.band.label}(${inflowPeak.band.range}) 유입이 하루의 ${pct}%로 가장 많아요.`]
  if (businessPeak) {
    if (aligned) {
      lines.push(`${business}의 주된 영업 시간대(${businessPeak.band.label})와 겹쳐 이 시간대 손님 흐름을 기대할 수 있는 편이에요.`)
    } else {
      lines.push(`${business}의 주된 영업 시간대(${businessPeak.band.label})와는 엇갈려요 — ${businessPeak.band.label} 시간대의 실제 유동은 현장에서 확인하세요.`)
    }
  }
  if (flags.includes('영업시간대_유입_엇갈림')) lines.push('엔진 특이사항: 영업시간대와 유입 시간대가 엇갈립니다.')
  return { inflowPeak, businessPeak, aligned, lines }
}
