import pc from '../fixtures/bupyeong-pcbang.json'
import nail from '../fixtures/bupyeong-nailshop.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import type { AnalyzeResponse, EngineResult } from '../api/schemas.ts'
import { headline } from './headline.ts'

/** 8-C1a 헤드라인 (docs/UX_REDESIGN.md 2.3) — 실제 응답 fixture + 표시 테스트 전용 변형 */
const real = (fx: unknown) => (fx as AnalyzeResponse).result
type Score = number | null
/** 표시 테스트 전용: 관점 점수만 바꾼 사본 (엔진이 실제로 이 조합을 냈다는 뜻이 아니다) */
function displayOnly(scores: [Score, Score, Score, Score, Score], over: Partial<EngineResult['종합']> = {}): EngineResult {
  const r = structuredClone(real(pc))
  r.지표.forEach((ind, i) => ((ind as { score: Score }).score = scores[i]!))
  Object.assign(r.종합, over)
  return r
}

const FORBIDDEN = /순위|상위\s*\d+\s*%|하위\s*\d+\s*%|백분위|확률|추천|성공/

describe('headline — 실제 응답', () => {
  it.each([
    ['부평역 PC방(산출 5개)', pc, '고객성이 가장 높고, 경쟁성이 가장 낮습니다'],
    ['부평역 네일숍(안정성 미산출)', nail, '입지성이 가장 높고, 경쟁성이 가장 낮습니다 · 안정성 미산출(종합에서 제외)'],
    ['송도2동 PC방(경쟁성 0곳)', songdo, '고객성이 가장 높고, 안정성이 가장 낮습니다 · 경쟁성 미산출(종합에서 제외)'],
  ])('%s', (_, fx, want) => {
    const text = headline(real(fx))
    expect(text).toBe(want)
    expect(text).not.toMatch(FORBIDDEN)
  })
})

describe('headline — 표시 테스트 전용 변형(동점·부분 산출·사용자 가중치)', () => {
  it('최고 동점: 엔진 최고_지표를 앞에, 나머지는 관점 고정 순서', () => {
    const r = displayOnly([82.8, 82.8, 30.2, 82.8, 73.2], { 최고_지표: 'location', 병목_지표: 'competition' })
    expect(headline(r)).toBe('입지성·시장성·고객성이 가장 높고, 경쟁성이 가장 낮습니다')
  })

  it('병목 동점: 엔진 병목_지표를 앞에', () => {
    const r = displayOnly([30.2, 82.8, 30.2, 79.8, 73.2], { 최고_지표: 'customer', 병목_지표: 'competition' })
    expect(headline(r)).toBe('고객성이 가장 높고, 경쟁성·시장성이 가장 낮습니다')
  })

  it('동점은 화면 표시(소수 1자리) 기준', () => {
    const r = displayOnly([61.64, 61.6, 30.2, 61.61, 50], { 최고_지표: 'market', 병목_지표: 'competition' })
    expect(headline(r)).toBe('시장성·고객성·입지성이 가장 높고, 경쟁성이 가장 낮습니다')
  })

  it('다섯 관점이 모두 같은 점수', () => {
    expect(headline(displayOnly([50, 50, 50, 50, 50]))).toBe('다섯 관점 점수가 모두 50.0점입니다')
  })

  it('산출 2~4개가 모두 같은 점수', () => {
    expect(headline(displayOnly([50, null, 50, null, 50]))).toBe(
      '산출한 3개 관점 점수가 모두 50.0점입니다 · 고객성·입지성 미산출(종합에서 제외)',
    )
  })

  it('산출 1개', () => {
    expect(headline(displayOnly([null, 82.8, null, null, null]))).toBe('고객성만 산출했습니다(82.8점) · 나머지 4개 미산출')
  })

  it('산출 0개(종합 null)', () => {
    expect(headline(displayOnly([null, null, null, null, null], { 점수: null }))).toBe(
      '산출한 관점이 없어 종합 점수를 내지 않았습니다',
    )
  })

  it('사용자 가중치면 문장 끝에 표시', () => {
    const r = displayOnly([61.6, 82.8, 30.2, 79.8, 73.2], { 가중치_출처: '사용자(중요도 1~5)' })
    expect(headline(r)).toBe('고객성이 가장 높고, 경쟁성이 가장 낮습니다 (사용자 가중치 적용)')
  })
})
