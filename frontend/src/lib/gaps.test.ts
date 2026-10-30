import { AnalyzeResponseSchema } from '../api/schemas.ts'
import pc from '../fixtures/bupyeong-pcbang.json'
import pcV05 from '../fixtures/bupyeong-pcbang-v05.json'
import nail from '../fixtures/bupyeong-nailshop.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import { gapLines } from './gaps.ts'

/** 12-20 "확인 필요" 한 줄 — 실제 응답 fixture 에서 규칙으로 만든 문장만, 지어낸 사실 없음 */
const res = (fx: unknown) => AnalyzeResponseSchema.parse(fx)

describe('gapLines', () => {
  it('부평역 PC방(v0.3): 임대료 제외 · 구 단위(유입·생존율) · 거주 인구만', () => {
    expect(gapLines(res(pc))).toEqual(['임대료 미반영', '유입·생존율은 구 단위 자료', '잠재수요는 거주 인구만(방문객 유동 없음)'])
  })

  it('부평역 PC방(v0.5): 반경 인구 면적 배분 · 잠재수요(거주+종사자)에 방문객 없음', () => {
    expect(gapLines(res(pcV05))).toEqual([
      '임대료 미반영',
      '유입·생존율은 구 단위 자료',
      '반경 안 인구는 동 면적 비율로 나눠 추정',
      '잠재수요에 방문객 유동 없음(번화가는 경쟁성이 실제보다 낮게 나올 수 있음)',
    ])
  })

  it('부평역 네일숍: 안정성 미산출이면 임대료·생존율 줄은 없다(미산출은 주의 띠가 맡는다)', () => {
    expect(gapLines(res(nail))).toEqual(['유입은 구 단위 자료', '잠재수요는 거주 인구만(방문객 유동 없음)'])
  })

  it('송도2동 PC방: 경쟁성 미산출(동종 0곳)이면 잠재수요 줄은 없다', () => {
    const lines = gapLines(res(songdo))
    expect(lines.some((l) => l.startsWith('잠재수요'))).toBe(false)
    expect(lines).toContain('임대료 미반영')
  })

  it('문장에 순위·확률·추천 표현이 없다', () => {
    for (const fx of [pc, pcV05, nail, songdo]) {
      for (const l of gapLines(res(fx))) expect(l).not.toMatch(/순위|확률|추천|가장/)
    }
  })
})
