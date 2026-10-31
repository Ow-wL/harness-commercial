import { describe, expect, it } from 'vitest'
import { AnalyzeResponseSchema, type AnalyzeResponse } from '../api/schemas.ts'
import { EASY_WORDS } from '../content/conclusion.ts'
import nailFixture from '../fixtures/bupyeong-nailshop.json'
import pcFixture from '../fixtures/bupyeong-pcbang.json'
import schoolFixture from '../fixtures/school-zone-pcbang-v05.json'
import { conclusion } from './conclusion.ts'

const PC = AnalyzeResponseSchema.parse(pcFixture)         // 경쟁성 30.2 가 가장 낮음(≥25), 최고 ≥ 70 인지는 fixture 에 따름
const NAIL = AnalyzeResponseSchema.parse(nailFixture)     // 경쟁성 1.2 < 25
const SCHOOL = AnalyzeResponseSchema.parse(schoolFixture) // v0.5 학교 옆 PC방

/** 순위·확률·추천·단정 표현 금지 (면책 정책 §19.6) */
const FORBIDDEN = /순위|상위|확률|추천|성공|실패|비싸|싸다|합격/

const clone = (r: AnalyzeResponse): AnalyzeResponse => JSON.parse(JSON.stringify(r))
const setScores = (r: AnalyzeResponse, scores: (number | null)[]) => {
  r.result.지표.forEach((i, k) => {
    i.score = scores[k]!
  })
  const scored = r.result.지표.filter((i) => i.score !== null)
  r.result.종합.최고_지표 = scored.length ? [...scored].sort((a, b) => b.score! - a.score!)[0]!.key : null
  r.result.종합.병목_지표 = scored.length ? [...scored].sort((a, b) => a.score! - b.score!)[0]!.key : null
  return r
}

describe('conclusion — 한 줄 결론 템플릿 (13-12, 팀 B1 · Codex R1-5)', () => {
  it('약점 < 25: "{강점}은 좋은/보통인 편이지만, {약점}이 매우 낮아요(참고: 반경 N곳)" — 원인 단정 없이 사실만', () => {
    const c = conclusion(NAIL)
    expect(c.rule).toBe('weak-alert')
    expect(c.weakest?.key).toBe('competition')
    expect(c.text).toMatch(/^.+성은 (좋은|보통인) 편이지만, 경쟁성이 매우 낮아요\(참고: 반경 500m 안 같은 업종 \d+곳\)\.$/)
  })

  it('강점 ≥ 70 · 약점 < 40', () => {
    const r = setScores(clone(PC), [75, 60, 35, 55, 50])     // 시장성 강점, 경쟁성 약점
    const c = conclusion(r)
    expect(c.rule).toBe('strong-weak')
    expect(c.text).toBe(`시장성은 좋은 편이지만, 경쟁성이 약한 자리예요(참고: 반경 500m 안 같은 업종 ${r.result.지표[2].raw.동종점포수}곳).`)
    expect(c.text).not.toContain('(가)')
  })

  it('모든 관점 < 25(Codex 경계 입력 [24,20,15,10,5]): "좋다"고 하지 않고 전반적으로 낮다고 먼저 말한다', () => {
    const c = conclusion(setScores(clone(PC), [24, 20, 15, 10, 5]))
    expect(c.rule).toBe('all-low')
    expect(c.text).toMatch(/^전반적으로 점수가 낮은 자리예요\. 시장성이 그중 높은 편이고, 안정성이 가장 낮아요/)
    expect(c.text).not.toMatch(/좋/)
  })

  it('모두 약함(25~39, [35,34,33,32,31]): 역시 "가장 좋은 자리"가 아니다', () => {
    const c = conclusion(setScores(clone(PC), [35, 34, 33, 32, 31]))
    expect(c.rule).toBe('all-low')
    expect(c.text).not.toMatch(/좋/)
  })

  it('모든 관점 40~70: 무난한 자리', () => {
    const c = conclusion(setScores(clone(PC), [55, 60, 45, 65, 50]))
    expect(c.rule).toBe('flat')
    expect(c.text).toBe('전반적으로 무난한 자리예요. 특별히 강하거나 약한 관점이 없어요.')
  })

  it('최고 40~70 · 최저 25~40: 상대 비교만(mixed), "좋다"고 하지 않는다', () => {
    const c = conclusion(setScores(clone(PC), [62, 55, 30, 50, 45]))
    expect(c.rule).toBe('mixed')
    expect(c.text).toMatch(/^시장성이 가장 높고, 경쟁성은 약한 편이에요\(참고: /)
    expect(c.text).not.toMatch(/좋/)
  })

  it('최고 ≥ 70 · 최저 ≥ 40: "{강점}이 특히 좋은 자리예요(무엇을 본 점수)" (학교 옆 PC방: 고객성 81.2 최고, 최저 61.6)', () => {
    const c = conclusion(SCHOOL)
    expect(c.rule).toBe('strong-only')
    expect(c.strongest?.key).toBe(SCHOOL.result.종합.최고_지표)
    expect(c.text).toBe(`${c.strongest!.label}이 특히 좋은 자리예요(${EASY_WORDS[c.strongest!.key].noun}).`)
  })

  it('미산출 관점은 빼고 판단, 하나만 산출이면 그 사실만, 전부 미산출이면 종합 없음 문장', () => {
    expect(conclusion(setScores(clone(PC), [null, 72, null, null, null])).rule).toBe('single')
    const none = setScores(clone(PC), [null, null, null, null, null])
    none.result.종합.점수 = null
    expect(conclusion(none).rule).toBe('none')
    const c = conclusion(setScores(clone(PC), [null, 72, 20, 60, null]))
    expect(c.rule).toBe('weak-alert')
    expect(c.text).toContain('고객성은 좋은 편이지만')
  })

  it('raw 근거가 없으면 "(참고)"를 붙이지 않는다 — 숫자를 지어내지 않는다', () => {
    const r = setScores(clone(PC), [75, 60, 35, 55, 50])
    delete (r.result.지표[2].raw as Record<string, unknown>).동종점포수
    expect(conclusion(r).text).toBe('시장성은 좋은 편이지만, 경쟁성이 약한 자리예요.')
  })

  it('쉬운말 표·결론 문장에 순위·확률·추천·단정 표현이 없다', () => {
    for (const w of Object.values(EASY_WORDS)) expect(w.noun).not.toMatch(FORBIDDEN)
    const inputs = [PC, NAIL, SCHOOL, setScores(clone(PC), [24, 20, 15, 10, 5]), setScores(clone(PC), [62, 55, 30, 50, 45])]
    for (const r of inputs) expect(conclusion(r).text).not.toMatch(FORBIDDEN)
  })
})
