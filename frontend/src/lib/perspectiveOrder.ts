/** 관점 행 순서 (13-14, components/PerspectiveScores). 표시 전용 — 엔진 지표 배열은 바꾸지 않는다 */
import type { Indicator } from './format.ts'

export type PerspectiveOrder = 'score' | 'fixed'

/** 점수순(높은 → 낮은, 안정 정렬) — 미산출은 엔진 순서대로 맨 아래. 'fixed' 는 엔진 순서 그대로 */
export function orderIndicators(indicators: readonly Indicator[], order: PerspectiveOrder): Indicator[] {
  if (order === 'fixed') return [...indicators]
  const scored = indicators.filter((i) => i.score !== null).sort((a, b) => b.score! - a.score!)
  return [...scored, ...indicators.filter((i) => i.score === null)]
}
