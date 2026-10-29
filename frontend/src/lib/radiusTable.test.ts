import { AnalyzeResponseSchema, type AnalyzeResponse } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang-v05.json'
import { overallRange, radiusRows, rowCells } from './radiusTable.ts'

const r500 = AnalyzeResponseSchema.parse(fixture)

function at(radius: number, overall: number | null): AnalyzeResponse {
  const c = structuredClone(r500)
  c.result.meta.분석반경_m = radius
  c.result.종합.점수 = overall
  return c
}

describe('반경별 비교 표 (12-26, 계획 1-5) — 캐시에 있는 결과만, 다시 계산하지 않는다', () => {
  it('광고 반경을 오름차순으로, 지금 반경은 지금 결과·나머지는 peek 값(없으면 null)', () => {
    const r1000 = at(1000, 64.8)
    const rows = radiusRows([500, 1000, 300], r500, (r) => (r === 1000 ? r1000 : null))
    expect(rows.map((r) => [r.radius, r.current, r.response === null ? null : r.response.result.meta.분석반경_m])).toEqual([
      [300, false, null],
      [500, true, 500],
      [1000, false, 1000],
    ])
    expect(rows[1]!.response).toBe(r500)                   // 지금 결과는 캐시를 보지 않는다
  })

  it('행 값은 엔진 값 그대로: 종합·관점 5개·같은 업종 점포 수·확인 필요 수', () => {
    const cells = rowCells(r500)
    expect(cells.overall).toBe(r500.result.종합.점수)
    expect(cells.perspectives).toEqual(r500.result.지표.map((i) => i.score))
    expect(cells.stores).toBe(r500.result.지표[2].raw.동종점포수)
    expect(cells.gaps).toBe(4)                             // 임대료·구 단위·면적 배분·유동
  })

  it('종합 점수 범위는 분석한 반경이 2개 이상이고 산출된 점수만 센다 (1개면 범위 없음)', () => {
    const rows = radiusRows([300, 500, 1000], r500, (r) => (r === 300 ? at(300, 60.1) : r === 1000 ? at(1000, null) : null))
    expect(overallRange(rows)).toEqual({ min: 60.1, max: r500.result.종합.점수, count: 2 })
    expect(overallRange(radiusRows([300, 500, 1000], r500, () => null))).toBeNull()
  })
})
