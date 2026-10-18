import type { EngineResult } from '../api/schemas.ts'
import { formatRatio, groupName, type Indicator } from '../lib/format.ts'
import './CoverageMeta.css'

/**
 * 충족 1줄 (8-C1b, docs/UX_REDESIGN.md 2.1·2.5, DESIGN.md §8.4 개정안):
 * "데이터 충족 100% ■■■■■ · 가중치 기본(목적방문형) · 진입장벽 중간". 텍스트 우선, 5칸 세그먼트는 보조.
 * - 신뢰도 개수는 이 줄에서 뺐다 — 관점별 신뢰도는 막대 행 chip(낮음)과 "왜 이런 점수가 나왔나" 각 관점에 그대로 있고,
 *   낮음이 있으면 주의 요약 띠에 "{관점} 신뢰도 낮음(엔진 판정)" 줄이 있다(2.2)
 * - 진입장벽은 엔진 `초보자_접근성.제도_진입장벽` 그대로(없는 업종이면 이 조각을 뺀다). 자세한 내용은 초보자 접근성 섹션
 */
export function CoverageMeta({
  summary,
  indicators,
  group,
  access,
}: {
  summary: EngineResult['종합']
  indicators: readonly Indicator[]
  /** meta.업종그룹 ("C_목적방문형") — 기본 가중치일 때 그룹 이름을 붙인다 */
  group: string
  access: EngineResult['초보자_접근성'] | null
}) {
  const weights = summary.가중치_출처 === '기본(업종그룹)' ? `기본(${groupName(group)})` : summary.가중치_출처

  return (
    <p className="coverage">
      <span className="coverage__item">
        데이터 충족 <strong>{formatRatio(summary.데이터_충족률)}</strong>
        <span className="coverage__segments" aria-hidden="true">
          {indicators.map((ind) => (
            <span
              key={ind.key}
              className={`coverage__segment${ind.score === null ? ' coverage__segment--missing' : ''}`}
            />
          ))}
        </span>
      </span>
      <span className="coverage__item">가중치 {weights}</span>
      {access && <span className="coverage__item">진입장벽 {access.제도_진입장벽}</span>}
    </p>
  )
}
