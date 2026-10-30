import { describe, expect, it } from 'vitest'
import { BOTTLENECK_WARN_BELOW } from './format.ts'
import { GRADE_FLOOR, GRADE_LABEL, gradeLabel, gradeOf } from './grade.ts'

describe('grade — 점수 등급 (13-4, 팀 제안 70/40/25)', () => {
  it('경계값: 70 이상 좋음, 40 이상 보통, 25 이상 약함, 25 미만 주의 (하한 포함)', () => {
    expect(gradeOf(100)).toBe('good')
    expect(gradeOf(70)).toBe('good')
    expect(gradeOf(69.9)).toBe('mid')
    expect(gradeOf(40)).toBe('mid')
    expect(gradeOf(39.9)).toBe('weak')
    expect(gradeOf(25)).toBe('weak')
    expect(gradeOf(24.9)).toBe('alert')
    expect(gradeOf(0)).toBe('alert')
  })

  it('주의 경계는 엔진의 병목 기준과 같다 — 따로 어긋나지 않게 묶는다', () => {
    expect(GRADE_FLOOR.weak).toBe(BOTTLENECK_WARN_BELOW)
  })

  it('미산출(null·undefined·NaN)은 등급 없음', () => {
    expect(gradeOf(null)).toBeNull()
    expect(gradeOf(undefined)).toBeNull()
    expect(gradeOf(Number.NaN)).toBeNull()
    expect(gradeLabel(null)).toBeNull()
  })

  it('글자 등급은 합격·불합격·추천 같은 판정 말이 아니다', () => {
    expect(gradeLabel(77.5)).toBe('좋음')
    expect(gradeLabel(50)).toBe('보통')
    expect(gradeLabel(31.9)).toBe('약함')
    expect(gradeLabel(6.9)).toBe('주의')
    for (const label of Object.values(GRADE_LABEL)) expect(label).not.toMatch(/합격|추천|성공|순위/)
  })
})
