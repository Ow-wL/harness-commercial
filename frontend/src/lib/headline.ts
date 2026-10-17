/**
 * 결과 헤드라인 1줄 (8-C1a, docs/UX_REDESIGN.md 2.3). 응답 값(관점 점수·최고/병목 지표·가중치 출처)만으로 만든다.
 * "높다/낮다"는 그 위치 안 5개 관점 사이의 비교다 — 순위·백분위·성공 확률·추천 표현을 쓰지 않는다.
 * 관점 라벨은 모두 받침 있는 "…성"이라 조사는 "이".
 */
import type { EngineResult, PerspectiveKey } from '../api/schemas.ts'
import { formatScore } from './format.ts'

type Scored = { key: PerspectiveKey; label: string; score: number }

/** 표시 값(소수 1자리)이 같으면 동점 — 화면에 보이는 숫자와 같은 기준 */
const same = (a: number, b: number) => formatScore(a) === formatScore(b)

/** 엔진이 고른 지표를 앞에 두고, 같은 점수의 다른 관점은 관점 고정 순서(엔진 지표 순서)로 뒤에 */
function tiedLabels(scored: Scored[], engineKey: PerspectiveKey | null, score: number): string {
  const tied = scored.filter((s) => same(s.score, score))
  const first = tied.find((s) => s.key === engineKey) ?? tied[0]!
  return [first, ...tied.filter((s) => s !== first)].map((s) => s.label).join('·')
}

export function headline(result: EngineResult): string {
  const all = result.지표
  const scored: Scored[] = all.flatMap((i) => (i.score === null ? [] : [{ key: i.key, label: i.label, score: i.score }]))
  const missing = all.filter((i) => i.score === null).map((i) => i.label)
  const userWeights = result.종합.가중치_출처 !== '기본(업종그룹)' ? ' (사용자 가중치 적용)' : ''

  if (result.종합.점수 === null || scored.length === 0) return '산출한 관점이 없어 종합 점수를 내지 않았습니다'
  if (scored.length === 1) {
    const only = scored[0]!
    return `${only.label}만 산출했습니다(${formatScore(only.score)}점) · 나머지 ${missing.length}개 미산출${userWeights}`
  }

  const max = Math.max(...scored.map((s) => s.score))
  const min = Math.min(...scored.map((s) => s.score))
  const suffix = missing.length > 0 ? ` · ${missing.join('·')} 미산출(종합에서 제외)` : ''
  let body: string
  if (same(max, min)) {
    body =
      scored.length === 5
        ? `다섯 관점 점수가 모두 ${formatScore(max)}점입니다`
        : `산출한 ${scored.length}개 관점 점수가 모두 ${formatScore(max)}점입니다`
  } else {
    const high = tiedLabels(scored, result.종합.최고_지표, max)
    const low = tiedLabels(scored, result.종합.병목_지표, min)
    body = `${high}이 가장 높고, ${low}이 가장 낮습니다`
  }
  return body + suffix + userWeights
}
