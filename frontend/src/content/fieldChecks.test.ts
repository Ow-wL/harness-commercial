import { AnalyzeResponseSchema } from '../api/schemas.ts'
import pc from '../fixtures/bupyeong-pcbang.json'
import pcV05 from '../fixtures/bupyeong-pcbang-v05.json'
import nail from '../fixtures/bupyeong-nailshop.json'
import school from '../fixtures/school-zone-pcbang-v05.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import { FIELD_CHECK_COUNT, FIELD_CHECK_RULES, fieldChecks } from './fieldChecks.ts'

const res = (fx: unknown) => AnalyzeResponseSchema.parse(fx)

describe('현장 확인 카드 규칙 (12-27, 계획 1-4) — 결과의 지표·결측에 연결, 사실 단정 없음', () => {
  it('부평역 PC방(v0.5): 같은 업종 점포 · 임대 조건 · 유동 관찰 — 근거 줄은 엔진 값 그대로', () => {
    const cards = fieldChecks(res(pcV05))
    expect(cards.map((c) => c.id)).toEqual(['competitors', 'rent', 'market-gu'])
    expect(cards[0]!.because).toBe('반경 500m 안 PC방 12곳 · 점포당 잠재수요(거주+종사자) 1,925명 — 점포 목록은 주변 점포 탭')
    expect(cards[1]!.because).toBe('이 위치는 임대료 조사 상권 밖이라 임대료가 점수에 들어가지 않았습니다')
    expect(cards[2]!.because).toBe('유입 인구는 부평구 구 단위 자료(하루 유입 679,748명) — 이 자리의 유동은 담지 않습니다')
    for (const c of cards) expect(c.record).toHaveLength(3)
  })

  it('학교 50m PC방(v0.5): 학교 주변 영업 가능 여부가 첫 카드', () => {
    const cards = fieldChecks(res(school))
    expect(cards.map((c) => c.id)).toEqual(['school-zone', 'competitors', 'rent'])
    expect(cards[0]!.record[0]).toContain('교육지원청')
  })

  it('네일숍(안정성 미산출): 임대 카드 없이 같은 업종 · 유동 · 접근 동선', () => {
    const cards = fieldChecks(res(nail))
    expect(cards.map((c) => c.id)).toEqual(['competitors', 'market-gu', 'access'])
    expect(cards[2]!.because).toBe('부평역까지 직선거리 85m — 걷는 거리·시간은 다릅니다')
  })

  it('송도2동 PC방(동종 0곳): "같은 업종이 없는 이유" 카드가 경쟁 카드를 대신한다', () => {
    const cards = fieldChecks(res(songdo))
    expect(cards[0]!.id).toBe('vacant')
    expect(cards.some((c) => c.id === 'competitors')).toBe(false)
  })

  it('v0.3 결과도 카드가 나오고(반경 인구 카드는 v0.5 만), 항상 정확히 3장이다', () => {
    for (const fx of [pc, pcV05, nail, school, songdo]) expect(fieldChecks(res(fx))).toHaveLength(FIELD_CHECK_COUNT)
    expect(fieldChecks(res(pc)).some((c) => c.id === 'customer-radius')).toBe(false)
  })

  it('규칙 id 는 유일하고 마지막 규칙(접근 동선)은 항상 맞는다 — 카드가 비는 결과가 없다', () => {
    const ids = FIELD_CHECK_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(FIELD_CHECK_RULES[FIELD_CHECK_RULES.length - 1]!.id).toBe('access')
  })

  it('문장에 순위·확률·추천·단정(비싸다/유망) 표현이 없다', () => {
    for (const fx of [pc, pcV05, nail, school, songdo]) {
      for (const c of fieldChecks(res(fx))) {
        for (const text of [c.title, c.because, ...c.record]) expect(text).not.toMatch(/순위|확률|추천|유망|비싸|싸다|보장/)
      }
    }
  })
})
