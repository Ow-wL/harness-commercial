import { describe, expect, it } from 'vitest'
import { bandShares, peakBand, readTime } from './timeInsights.ts'

const FORBIDDEN = /순위|확률|추천|성공|매출/

const hour = (peak: number[]) => Array.from({ length: 24 }, (_, h) => (peak.includes(h) ? 10 : 1))
const inflow = (by_hour: number[]) => ({ gu_code: '28237', gu_name: '부평구', as_of: '2026-08', daily: 679748, by_hour, work_ratio: 0.4 })

describe('timeInsights — 시간대 읽기 (13-15)', () => {
  it('구간 비중: 합 1, 피크는 가장 큰 구간', () => {
    const s = bandShares(hour([18, 19, 20]))!
    expect(s.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1)
    expect(peakBand(s).band.key).toBe('evening')
    expect(bandShares(new Array(24).fill(0))).toBeNull()
    expect(bandShares([1, 2, 3])).toBeNull()
  })

  it('유입 피크 문장 + 업종 프로파일과 겹치면 "기대할 수 있는 편", 엇갈리면 "현장에서 확인"', () => {
    const r = readTime({ inflow: inflow(hour([18, 19, 20])), hours_profile: hour([19, 20, 21]), hours_profile_note: null }, '호프/맥주')!
    expect(r.inflowPeak.band.key).toBe('evening')
    expect(r.aligned).toBe(true)
    expect(r.lines[0]).toMatch(/^부평구는 저녁\(17~21시\) 유입이 하루의 \d+%로 가장 많아요\.$/)
    expect(r.lines[1]).toContain('겹쳐')
    const r2 = readTime({ inflow: inflow(hour([18, 19, 20])), hours_profile: hour([8, 9]), hours_profile_note: null }, '세탁소')!
    expect(r2.aligned).toBe(false)
    expect(r2.lines[1]).toContain('현장에서 확인')
  })

  it('프로파일이 없으면 유입 문장만, insights 가 없으면 null, 엔진 flag 는 한 줄 더', () => {
    const r = readTime({ inflow: inflow(hour([12])), hours_profile: null, hours_profile_note: null }, 'PC방')!
    expect(r.businessPeak).toBeNull()
    expect(r.aligned).toBeNull()
    expect(r.lines).toHaveLength(1)
    expect(readTime(null, 'PC방')).toBeNull()
    expect(readTime({ inflow: null, hours_profile: null, hours_profile_note: null }, 'PC방')).toBeNull()
    const f = readTime({ inflow: inflow(hour([12])), hours_profile: hour([12]), hours_profile_note: null }, 'PC방', ['영업시간대_유입_엇갈림'])!
    expect(f.lines.at(-1)).toContain('엇갈립니다')
  })

  it('문장에 순위·확률·추천·매출 표현이 없다 (점수는 바꾸지 않는다)', () => {
    for (const p of [hour([8]), hour([13]), hour([19]), hour([23, 0, 1])]) {
      const r = readTime({ inflow: inflow(p), hours_profile: hour([19]), hours_profile_note: null }, '주점')!
      for (const line of r.lines) expect(line).not.toMatch(FORBIDDEN)
    }
  })
})
