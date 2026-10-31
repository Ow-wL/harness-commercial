import { describe, expect, it } from 'vitest'
import { bandShares, fitLevel, peakBand, readTime } from './timeInsights.ts'

const FORBIDDEN = /순위|확률|추천|성공|매출/

const hour = (peak: number[]) => Array.from({ length: 24 }, (_, h) => (peak.includes(h) ? 10 : 1))
const inflow = (by_hour: number[]) => ({ gu_code: '28237', gu_name: '부평구', as_of: '2026-08', daily: 679748, by_hour, work_ratio: 0.4 })
const ins = (by_hour: number[], profile: number[] | null) => ({ inflow: inflow(by_hour), hours_profile: profile, hours_profile_note: null })

/** 엔진 time_fit 과 같은 식(scoring.py): 두 분포를 각각 합 1로 맞춘 내적 × 24 */
const engineFit = (biz: number[], dong: number[]) => {
  const sw = biz.reduce((a, b) => a + b, 0)
  const sp = dong.reduce((a, b) => a + b, 0)
  return biz.reduce((a, w, h) => a + (w / sw) * (dong[h]! / sp), 0) * 24
}

describe('timeInsights — 시간대 읽기 (13-15, Codex R1-1)', () => {
  it('구간 비중: 합 1, 피크는 가장 큰 구간', () => {
    const s = bandShares(hour([18, 19, 20]))!
    expect(s.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1)
    expect(peakBand(s).band.key).toBe('evening')
    expect(bandShares(new Array(24).fill(0))).toBeNull()
    expect(bandShares([1, 2, 3])).toBeNull()
  })

  it('수준은 엔진 경계 그대로: > 1.20 집중, < 0.85 엇갈림, 그 사이 보통 — 엔진 flag 가 있으면 flag 우선', () => {
    expect(fitLevel(1.3235)).toBe('high')
    expect(fitLevel(1.2)).toBe('normal')
    expect(fitLevel(0.85)).toBe('normal')
    expect(fitLevel(0.84)).toBe('low')
    expect(fitLevel(null)).toBeNull()
    expect(fitLevel(1.0, ['영업시간대_유입_집중'])).toBe('high')
    expect(fitLevel(1.0, ['영업시간대_유입_엇갈림'])).toBe('low')
  })

  it('부평역 PC방(Codex 재현): 유입 피크는 낮, 영업 피크는 저녁이지만 적합도 1.32 → "몰리는 편", "엇갈려요"라고 하지 않는다', () => {
    const day = Array.from({ length: 24 }, (_, h) => (h >= 11 && h <= 16 ? 10 : h >= 17 && h <= 23 ? 9 : 2))
    const pc = Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 23 ? 3 : h >= 12 ? 2 : 1))
    const r = readTime(ins(day, pc), 'PC방', { fit: 1.3235, flags: ['영업시간대_유입_집중'] })!
    expect(r.inflowPeak.band.key).toBe('day')
    expect(r.businessPeak?.band.key).not.toBe('day')                   // 피크 구간은 다르다
    expect(r.level).toBe('high')
    expect(r.lines[1]).toBe('PC방은 영업 시간대에 사람이 몰리는 편이에요(주로 저녁 영업 · 시간대 적합도 1.32, 1.0 = 24시간 고르게 퍼졌을 때).')
    expect(r.lines.join(' ')).not.toContain('엇갈')
  })

  it('피크 구간이 달라도 겹침이 크면 엇갈린다고 하지 않는다(엔진 식으로 계산한 적합도 > 1)', () => {
    const dong = Array.from({ length: 24 }, (_, h) => (h >= 11 && h <= 16 ? 10 : h >= 17 && h <= 21 ? 9 : 1))
    const biz = Array.from({ length: 24 }, (_, h) => (h >= 15 && h <= 21 ? 1 : 0))
    const fit = engineFit(biz, dong)
    expect(fit).toBeGreaterThan(1)
    const r = readTime(ins(dong, biz), '카페', { fit, flags: [] })!
    expect(r.inflowPeak.band.key).toBe('day')
    expect(r.businessPeak?.band.key).toBe('evening')
    expect(r.lines.join(' ')).not.toContain('엇갈')
  })

  it('균등 유입: 8시간짜리 밤 구간이 "가장 많다"로 나와도 적합도 1.0 은 보통 수준', () => {
    const flat = new Array(24).fill(1)
    const r = readTime(ins(flat, hour([19, 20, 21])), '호프/맥주', { fit: engineFit(hour([19, 20, 21]), flat), flags: [] })!
    expect(r.level).toBe('normal')
    expect(r.lines[1]).toContain('보통 수준')
  })

  it('적합도 < 0.85 이면 엇갈림 + 현장 확인', () => {
    const r = readTime(ins(hour([8, 9]), hour([22, 23, 0])), '세탁소', { fit: 0.62, flags: ['영업시간대_유입_엇갈림'] })!
    expect(r.level).toBe('low')
    expect(r.lines[1]).toContain('엇갈리는 편')
    expect(r.lines[1]).toContain('현장에서 확인')
  })

  it('적합도가 없으면(미산출) 맞는지 말하지 않고 영업 시간대 관찰만, 프로파일도 없으면 유입 문장만', () => {
    const r = readTime(ins(hour([12]), hour([19, 20])), 'PC방', { fit: null, flags: [] })!
    expect(r.level).toBeNull()
    expect(r.lines[1]).toBe('PC방은 주로 저녁에 영업하는 업종이에요 — 이 시간대 유동은 현장에서 확인하세요.')
    expect(r.lines.join(' ')).not.toMatch(/엇갈|겹쳐|몰리는/)
    const only = readTime(ins(hour([12]), null), 'PC방')!
    expect(only.businessPeak).toBeNull()
    expect(only.lines).toHaveLength(1)
    expect(readTime(null, 'PC방')).toBeNull()
    expect(readTime({ inflow: null, hours_profile: null, hours_profile_note: null }, 'PC방')).toBeNull()
  })

  it('문장에 순위·확률·추천·매출 표현이 없다 (점수는 바꾸지 않는다)', () => {
    for (const p of [hour([8]), hour([13]), hour([19]), hour([23, 0, 1])]) {
      for (const fit of [0.6, 1.0, 1.4, null]) {
        const r = readTime(ins(p, hour([19])), '주점', { fit, flags: [] })!
        for (const line of r.lines) expect(line).not.toMatch(FORBIDDEN)
      }
    }
  })
})
