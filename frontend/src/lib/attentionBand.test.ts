import pc from '../fixtures/bupyeong-pcbang.json'
import nail from '../fixtures/bupyeong-nailshop.json'
import ganghwa from '../fixtures/compare-ganghwa-pcbang.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import guwol from '../fixtures/compare-guwol-pcbang.json'
import b1b from '../fixtures/compare-bupyeong1b-pcbang.json'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { BAND_MAX, compareBand, singleBand, type BandLine } from './attentionBand.ts'
import { displayWarnings } from './warnings.ts'

/** 8-C1a 주의 요약 띠 (docs/UX_REDESIGN.md 2.2) — 실제 응답 fixture 4종(+비교 조합) + 표시 테스트 전용 변형 */
const res = (fx: unknown) => fx as AnalyzeResponse
const view = (lines: BandLine[]) => lines.map((l) => `${l.mark} ${l.text}`)
const FORBIDDEN = /순위|상위\s*\d+\s*%|하위\s*\d+\s*%|백분위|확률|추천|0점/

describe('singleBand — 실제 응답', () => {
  it('부평역 PC방: 학교 0곳 info 1줄만(경쟁성 30.2는 25 이상이라 병목 줄 없음)', () => {
    const lines = singleBand(res(pc))
    expect(view(lines)).toEqual(['i 학교 주변 규제 업종 · 300m 안 초·중·고 0곳'])
    expect(lines[0]).toMatchObject({ kind: 'school', tone: 'info', target: 'access' })
  })

  it('부평역 네일숍: 병목 → 미산출(+자료 등급 낮음) → 기타 엔진 경고 순, 병목 원문·"계산 불가" 원문은 띠에 올리지 않는다', () => {
    const lines = singleBand(res(nail))
    expect(view(lines)).toEqual([
      '! 경쟁성 1.2점 · 병목 기준(25점 미만) — 종합과 별개 위험 요인',
      '! 안정성 미산출 · 종합에서 제외 · 자료 등급 낮음',
      '! 네일숍 제도 진입장벽 높음: 본인 미용사(네일) 면허 필요.',
    ])
    expect(lines.map((l) => l.target)).toEqual(['warnings', 'details', 'warnings'])
    expect(lines.some((l) => l.text.includes('인천 하위'))).toBe(false)
    expect(lines.some((l) => l.text.startsWith('계산 불가 지표'))).toBe(false)
  })

  it('강화읍 PC방: 병목 → 안정성 미산출 → 학교', () => {
    expect(view(singleBand(res(ganghwa)))).toEqual([
      '! 입지성 22.6점 · 병목 기준(25점 미만) — 종합과 별개 위험 요인',
      '! 안정성 미산출 · 종합에서 제외 · 자료 등급 낮음',
      'i 학교 주변 규제 업종 · 300m 안 초·중·고 0곳',
    ])
  })

  it('송도2동 PC방: 경쟁성 0곳 미산출(반경·업종), "반경 내 동종업종이 0개" 원문은 띠에 올리지 않는다', () => {
    expect(view(singleBand(res(songdo)))).toEqual([
      '! 반경 500m 안 PC방 0곳 · 경쟁성 미산출 · 자료 등급 낮음',
      'i 학교 주변 규제 업종 · 300m 안 초·중·고 0곳',
    ])
  })

  it('구월3동 PC방: 학교 1곳은 warning, 엔진 학교 원문은 띠에 올리지 않는다', () => {
    const lines = singleBand(res(guwol))
    expect(view(lines)).toEqual([
      '! 경쟁성 24.4점 · 병목 기준(25점 미만) — 종합과 별개 위험 요인',
      '! 300m 안 초·중·고 1곳 · 교육지원청 확인 필요',
    ])
  })

  it.each([pc, nail, ganghwa, songdo, guwol, b1b])('금지 표현이 없다 (%#)', (fx) => {
    for (const l of singleBand(res(fx))) expect(l.text).not.toMatch(FORBIDDEN)
  })

  it('주의할 점 섹션의 문장(displayWarnings)은 바꾸지 않는다 — 띠는 그 위의 요약', () => {
    const before = displayWarnings(res(nail))
    singleBand(res(nail))
    expect(displayWarnings(res(nail))).toEqual(before)
  })
})

describe('singleBand — 표시 테스트 전용 변형', () => {
  /** 표시 테스트 전용: 네일숍 응답의 경고를 늘려 줄 수가 5를 넘게 만든다 */
  function displayOnlyManyWarnings(): AnalyzeResponse {
    const r = structuredClone(res(nail))
    r.result.경고 = [...r.result.경고, '경고 A (테스트)', '경고 B (테스트)', '경고 C (테스트)']
    return r
  }

  it('줄이 5개를 넘으면 전체 목록은 그대로 돌려주고(화면이 5줄 + "N건 더 보기"), 순서는 규칙대로', () => {
    const lines = singleBand(displayOnlyManyWarnings())
    expect(lines).toHaveLength(6)
    expect(BAND_MAX).toBe(5)
    expect(lines.map((l) => l.kind)).toEqual(['bottleneck', 'not-computed', 'other', 'other', 'other', 'other'])
  })

  it('자료 등급 낮음은 산출된 관점이면 따로 1줄(원인 없이)', () => {
    const r = structuredClone(res(pc))
    ;(r.result.지표[0] as { confidence: string }).confidence = 'low'
    expect(view(singleBand(r))).toContain('! 시장성 자료 등급 낮음(엔진 판정)')
  })

  it('반경 1km 결과의 경쟁성 0곳 줄은 그 반경으로', () => {
    const r = structuredClone(res(songdo))
    ;(r.result.meta as { 분석반경_m: number }).분석반경_m = 1000
    expect(singleBand(r)[0]!.text).toBe('반경 1km 안 PC방 0곳 · 경쟁성 미산출 · 자료 등급 낮음')
  })
})

describe('compareBand — 실제 응답 조합', () => {
  it('A 부평역 · B 강화읍: † 계산 구성 차이가 첫 줄, 이어서 종류별 A→B', () => {
    const lines = compareBand(res(pc), res(ganghwa))
    expect(view(lines)).toEqual([
      '† 종합 계산 구성이 다릅니다 · A 5개 관점, B 4개(안정성 미산출)',
      '! B 입지성 22.6 · 병목',
      '! B 안정성 미산출 · 종합에서 제외 · 자료 등급 낮음',
      'i A 학교 주변 규제 업종 · 300m 안 초·중·고 0곳',
      'i B 학교 주변 규제 업종 · 300m 안 초·중·고 0곳',
    ])
    expect(lines.map((l) => l.target)).toEqual([
      'compare-score',
      'compare-warnings',
      'compare-not-computed',
      'compare-warnings',
      'compare-warnings',
    ])
  })

  it('A 부평역 · B 구월3동: 병목은 "B 경쟁성 24.4 · 병목"', () => {
    expect(view(compareBand(res(pc), res(guwol))).slice(0, 1)).toEqual(['! B 경쟁성 24.4 · 병목'])
  })

  it('A 부평역 · B 송도2동: † + B 경쟁성 0곳', () => {
    expect(view(compareBand(res(pc), res(songdo))).slice(0, 2)).toEqual([
      '† 종합 계산 구성이 다릅니다 · A 5개 관점, B 4개(경쟁성 미산출)',
      '! B 반경 500m 안 PC방 0곳 · 경쟁성 미산출 · 자료 등급 낮음',
    ])
  })

  it('같은 행정동·반경 겹침은 마지막 info 줄', () => {
    expect(view(compareBand(res(pc), res(b1b))).slice(-2)).toEqual([
      'i 같은 행정동 · 시장성·고객성·안정성은 같은 데이터',
      'i 반경 겹침 · 직선거리 322m',
    ])
  })

  it.each([
    [pc, ganghwa],
    [pc, songdo],
    [pc, guwol],
    [pc, b1b],
  ])('금지 표현이 없다 (%#)', (a, b) => {
    for (const l of compareBand(res(a), res(b))) expect(l.text).not.toMatch(FORBIDDEN)
  })
})
