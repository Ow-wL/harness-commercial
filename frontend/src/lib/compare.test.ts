import { AnalyzeResponseSchema, type AnalyzeResponse } from '../api/schemas.ts'
import bupyeongFixture from '../fixtures/bupyeong-pcbang.json'
import bupyeong1bFixture from '../fixtures/compare-bupyeong1b-pcbang.json'
import ganghwaFixture from '../fixtures/compare-ganghwa-pcbang.json'
import guwolFixture from '../fixtures/compare-guwol-pcbang.json'
import songdoFixture from '../fixtures/compare-songdo-pcbang.json'
import {
  areaRelation,
  compareAppliedWeights,
  displayScoreDiff,
  notComputedNotices,
  overallCompositionNotice,
  perspectiveUnit,
  radiusOverlap,
  RAW_ROWS,
  rawCell,
  rawCellText,
  sameAreaNotice,
  sharedPerspectives,
  straightDistanceM,
} from './compare.ts'

// 실제 POST /analyze 응답 (모두 PC방 R10406, docs/COMPARE_DESIGN.md 10.1). parse가 곧 계약 검사다
const A = AnalyzeResponseSchema.parse(bupyeongFixture)            // 부평구 부평1동 (부평역)
const SAME_DONG = AnalyzeResponseSchema.parse(bupyeong1bFixture)  // 부평구 부평1동, A와 약 322m
const OTHER_GU = AnalyzeResponseSchema.parse(guwolFixture)        // 남동구 구월3동
const NO_STABILITY = AnalyzeResponseSchema.parse(ganghwaFixture)  // 강화군 강화읍: 안정성 미산출
const NO_COMPETITION = AnalyzeResponseSchema.parse(songdoFixture) // 연수구 송도2동: 동종 점포 0곳 → 경쟁성 미산출

const score = (r: AnalyzeResponse, key: string) => r.result.지표.find((i) => i.key === key)!.score

/** 테스트 안에서만 쓰는 변형 (fixture 파일은 고치지 않는다) */
function withContext(r: AnalyzeResponse, context: Partial<AnalyzeResponse['context']>): AnalyzeResponse {
  return { ...r, context: { ...r.context, ...context } }
}

describe('fixture 사례 (실제 응답이 설계 전제와 맞는지)', () => {
  it('같은 업종이고, 사례별 미산출 관점이 설계대로다', () => {
    for (const r of [SAME_DONG, OTHER_GU, NO_STABILITY, NO_COMPETITION]) {
      expect(r.result.meta.업종코드).toBe(A.result.meta.업종코드)
    }
    expect(score(NO_STABILITY, 'stability')).toBeNull()
    expect(score(NO_COMPETITION, 'competition')).toBeNull()
    expect(NO_COMPETITION.result.지표[2].raw.동종점포수).toBe(0)
    expect(A.result.지표.every((i) => i.score !== null)).toBe(true)
  })
})

describe('displayScoreDiff — 표시용 차이 A−B', () => {
  it('×10 정수로 빼서 부동소수 오차 없이 소수 1자리로 낸다', () => {
    expect(30.2 - 24.4).not.toBe(5.8)                          // 그냥 빼면 5.799999…
    expect(displayScoreDiff(30.2, 24.4)).toEqual({ value: 5.8, text: '+5.8', spoken: 'A에서 B를 뺀 값 플러스 5.8' })
  })

  it('음수는 U+2212 기호, 읽기 문구는 "마이너스"', () => {
    expect(displayScoreDiff(61.6, 68.7)).toEqual({ value: -7.1, text: '−7.1', spoken: 'A에서 B를 뺀 값 마이너스 7.1' })
  })

  it('0과 -0은 모두 "0.0"이고 부호를 붙이지 않는다', () => {
    const same = displayScoreDiff(55.1, 55.1)!
    expect(same.text).toBe('0.0')
    const negZero = displayScoreDiff(1.0, 1.03)!                // round(-0.3) = -0
    expect(Object.is(negZero.value, 0)).toBe(true)
    expect(negZero.text).toBe('0.0')
  })

  it('한쪽이라도 미산출(null)이면 차이를 만들지 않는다 (0으로 보지 않는다)', () => {
    expect(displayScoreDiff(null, 50)).toBeNull()
    expect(displayScoreDiff(73.2, null)).toBeNull()
    expect(displayScoreDiff(score(A, 'stability'), score(NO_STABILITY, 'stability'))).toBeNull()
  })

  it('실제 응답 쌍(부평1동 − 구월3동)', () => {
    expect(displayScoreDiff(A.result.종합.점수, OTHER_GU.result.종합.점수)!.text).toBe('+6.7')
    expect(displayScoreDiff(score(A, 'stability'), score(OTHER_GU, 'stability'))!.text).toBe('+48.4')
    expect(displayScoreDiff(score(A, 'customer'), score(OTHER_GU, 'customer'))!.text).toBe('−8.6')
  })
})

describe('같은 구·동 판정과 안내', () => {
  it('구 코드·행정동 이름으로만 판정한다', () => {
    expect(areaRelation(A.context, SAME_DONG.context)).toBe('same-dong')
    expect(areaRelation(A.context, OTHER_GU.context)).toBe('different-gu')
    expect(areaRelation(A.context, { ...SAME_DONG.context, dong_name: '부평2동' })).toBe('same-gu')
    // 같은 이름의 동이라도 구가 다르면 다른 구
    expect(areaRelation(A.context, { ...SAME_DONG.context, gu_code: '28185' })).toBe('different-gu')
  })

  it('같은 동: "같다"고 안내하는 관점(시장성·고객성·안정성)은 실제 응답에서도 점수가 같고, 나머지는 다르다', () => {
    const shared = sharedPerspectives(A, SAME_DONG)
    expect(shared.map((s) => [s.key, s.unit])).toEqual([
      ['market', '구'],
      ['customer', '행정동'],
      ['stability', '구'],
    ])
    for (const { key } of shared) expect(score(SAME_DONG, key)).toBe(score(A, key))
    expect(score(SAME_DONG, 'competition')).not.toBe(score(A, 'competition'))
    expect(score(SAME_DONG, 'location')).not.toBe(score(A, 'location'))
    expect(sameAreaNotice(A, SAME_DONG)).toBe(
      '두 위치가 같은 행정동(부평구 부평1동)에 있습니다. 시장성·안정성은 구 단위, 고객성은 행정동 단위 데이터라 ' +
        '두 위치 점수가 같습니다. 이 비교에서 위치 차이는 경쟁성(반경 500m)과 입지성(좌표)에만 나타납니다.',
    )
  })

  it('같은 구·다른 동: 시장성·안정성만 같다고 안내한다', () => {
    const otherDong = withContext(SAME_DONG, { dong_name: '부평2동', label: '부평구 부평2동' })
    expect(sharedPerspectives(A, otherDong).map((s) => s.key)).toEqual(['market', 'stability'])
    expect(sameAreaNotice(A, otherDong)).toBe('두 위치가 같은 구(부평구)에 있습니다. 시장성·안정성은 구 단위 데이터라 두 위치 점수가 같습니다.')
  })

  it('미산출 관점은 "같다" 목록에서 뺀다 (고정 문구가 아니다)', () => {
    // 강화읍(안정성 미산출) 응답을 같은 구로 놓고 보면 안정성은 빠지고 시장성만 남는다
    const sameGuNoStability = withContext(NO_STABILITY, { gu_code: A.context.gu_code, gu_name: '부평구', dong_name: '부평2동' })
    expect(sharedPerspectives(A, sameGuNoStability).map((s) => s.key)).toEqual(['market'])
    expect(sameAreaNotice(A, sameGuNoStability)).toBe('두 위치가 같은 구(부평구)에 있습니다. 시장성은 구 단위 데이터라 두 위치 점수가 같습니다.')
  })

  it('다른 구면 안내하지 않는다', () => {
    expect(sharedPerspectives(A, OTHER_GU)).toEqual([])
    expect(sameAreaNotice(A, OTHER_GU)).toBeNull()
  })
})

describe('적용 가중치 비교 — 종합 계산 구성', () => {
  it('둘 다 5개 관점·같은 가중치면 같다', () => {
    expect(compareAppliedWeights(A.result.종합, OTHER_GU.result.종합)).toEqual({ kind: 'same' })
    expect(overallCompositionNotice(A.result, OTHER_GU.result)).toBeNull()
  })

  it('안정성 미산출 위치와 비교하면 구성이 다르다고 알린다', () => {
    expect(compareAppliedWeights(A.result.종합, NO_STABILITY.result.종합)).toEqual({
      kind: 'different-perspectives',
      a: ['market', 'customer', 'competition', 'location', 'stability'],
      b: ['market', 'customer', 'competition', 'location'],
    })
    expect(overallCompositionNotice(A.result, NO_STABILITY.result)).toBe(
      '두 종합 점수의 계산 구성이 다릅니다. A는 시장성·고객성·경쟁성·입지성·안정성 5개 관점, ' +
        'B는 시장성·고객성·경쟁성·입지성 4개 관점의 가중평균입니다(미산출 관점은 빼고 나머지 가중치를 다시 나눴습니다). ' +
        '종합 점수 차이는 같은 기준끼리의 차이가 아닙니다.',
    )
  })

  it('경쟁성 미산출도 같은 규칙으로 알린다 (안정성 고정 문구가 아니다)', () => {
    const notice = overallCompositionNotice(A.result, NO_COMPETITION.result)!
    expect(notice).toContain('B는 시장성·고객성·입지성·안정성 4개 관점')
    expect(notice).not.toContain('안정성을 빼고')
  })

  it('관점 수가 같아도(4개) 구성이 다르면 다르다', () => {
    expect(compareAppliedWeights(NO_STABILITY.result.종합, NO_COMPETITION.result.종합).kind).toBe('different-perspectives')
    expect(overallCompositionNotice(NO_STABILITY.result, NO_COMPETITION.result)).toContain(
      'A는 시장성·고객성·경쟁성·입지성 4개 관점, B는 시장성·고객성·입지성·안정성 4개 관점',
    )
  })

  it('같은 관점이라도 적용 가중치 값이 다르면 다르다 (사용자 가중치)', () => {
    const custom = { ...A.result.종합, 적용_가중치: { ...A.result.종합.적용_가중치, market: 0.3, customer: 0.12 } }
    expect(compareAppliedWeights(A.result.종합, custom).kind).toBe('different-weights')
    expect(overallCompositionNotice(A.result, { ...A.result, 종합: custom })).toBe(
      '두 종합 점수에 적용된 가중치가 다릅니다. 종합 점수 차이는 같은 기준끼리의 차이가 아닙니다.',
    )
  })
})

describe('미산출 안내', () => {
  it('모두 산출된 위치는 안내가 없다', () => {
    expect(notComputedNotices('A', A)).toEqual([])
  })

  it('실제 미산출 관점마다 위치를 붙여 한 줄씩 만든다', () => {
    expect(notComputedNotices('B', NO_STABILITY)).toEqual([
      'B 강화군 강화읍: 안정성 미산출 — 세부지표 충족률 0%로 기준(50%)에 못 미쳐 점수를 내지 않았고, 종합점수에서 제외했습니다',
    ])
  })

  it('경쟁성 0곳은 충족률이 아니라 0곳 이유를 쓴다', () => {
    expect(notComputedNotices('A', NO_COMPETITION)).toEqual([
      'A 연수구 송도2동: 경쟁성 미산출 — 반경 500m 안에 같은 업종 점포가 없어 점수를 내지 않았고, 종합점수에서 제외했습니다',
    ])
  })
})

describe('반경 겹침', () => {
  it('직선거리는 엔진 haversine_m과 같은 식이다', () => {
    // 기대값: scoring_engine/v0_3/radius_demand.haversine_m 으로 계산 (2026-10-11)
    expect(straightDistanceM(A.context, SAME_DONG.context)).toBeCloseTo(321.7299820607596, 6)
    expect(straightDistanceM(A.context, OTHER_GU.context)).toBeCloseTo(5085.576222336308, 6)
  })

  it('중심 거리 < 2 × 반경이면 겹친다', () => {
    expect(radiusOverlap(A.context, SAME_DONG.context, 500)).toEqual({ distanceM: 322, overlaps: true })
    expect(radiusOverlap(A.context, OTHER_GU.context, 500)).toEqual({ distanceM: 5086, overlaps: false })
    // 경도가 같으면 위도 차가 곧 대원 거리: 1m ≈ 180 / (π × 6,371,000)°
    const degPerM = 180 / (Math.PI * 6_371_000)
    const north = (m: number) => ({ lat: A.context.lat + m * degPerM, lng: A.context.lng })
    expect(radiusOverlap(A.context, north(999), 500)).toEqual({ distanceM: 999, overlaps: true })
    expect(radiusOverlap(A.context, north(1001), 500)).toEqual({ distanceM: 1001, overlaps: false })
  })
})

describe('핵심 원시값 표시', () => {
  const texts = (r: AnalyzeResponse) => Object.fromEntries(RAW_ROWS.map((row) => [row.label, rawCellText(rawCell(r.result, row))]))

  it('정상 응답은 모든 행의 키가 응답에 있다', () => {
    for (const r of [A, SAME_DONG, OTHER_GU, NO_STABILITY]) {
      for (const row of RAW_ROWS) expect(rawCell(r.result, row).status).not.toBe('absent')
    }
  })

  it('단위를 붙이고, 0~1 비율은 소수 1자리 %로 쓴다 (0.004가 "0%"로 보이지 않게)', () => {
    expect(texts(A)).toMatchObject({
      '일평균 유입인구': '679,748명',
      '시간대 적합도 (1.0 = 24시간 균등 기준)': '1.32',
      '1인 세대 비중': '38.7%',
      '반경 안 같은 업종 점포 수': '12곳',
      '점포당 잠재수요': '4,433명',
      '같은 업종 비중': '0.4%',
      '가장 가까운 역': '부평역 · 직선거리 85m',
      '3년 생존율': '52.3%',
      '최근 폐업률': '5.0%',
      '평균 업력': '4.27년',
    })
  })

  it('동종 점포 0곳 응답: 없는 키는 "해당 없음", null은 "데이터 없음" — 0이나 정상 값으로 바꾸지 않는다', () => {
    const competition = RAW_ROWS.filter((r) => r.perspective === 'competition')
    const cells = Object.fromEntries(competition.map((row) => [row.label, rawCell(NO_COMPETITION.result, row)]))
    expect(cells['반경 안 같은 업종 점포 수']).toEqual({ status: 'value', text: '0곳' })   // 엔진이 낸 실제 값
    expect(cells['점포당 잠재수요']).toEqual({ status: 'null' })
    expect(cells['같은 업종 비중']).toEqual({ status: 'absent' })                         // 응답에 키가 없다
    expect(rawCellText(cells['같은 업종 비중']!)).toBe('해당 없음')
    expect(rawCellText(cells['점포당 잠재수요']!)).toBe('데이터 없음')
  })

  it('미산출 관점의 null 원시값은 "데이터 없음"', () => {
    expect(texts(NO_STABILITY)['3년 생존율']).toBe('데이터 없음')
  })

  it('관점 단위 표기 (반경은 meta.분석반경_m)', () => {
    expect(perspectiveUnit('market', 500)).toBe('구')
    expect(perspectiveUnit('customer', 500)).toBe('행정동')
    expect(perspectiveUnit('competition', A.result.meta.분석반경_m)).toBe('반경 500m')
    expect(perspectiveUnit('stability', 500)).toBe('구 × 업종')
  })
})
