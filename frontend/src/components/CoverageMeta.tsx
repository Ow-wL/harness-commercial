import type { EngineResult } from '../api/schemas.ts'
import { formatRatio, groupName, type Indicator } from '../lib/format.ts'
import './CoverageMeta.css'

/**
 * 충족 1줄 (8-C1b, docs/UX_REDESIGN.md 2.1·2.5, DESIGN.md §8.4 개정안; 12-17 라벨 수정):
 * "관점 5/5 산출 ■■■■■ · 세부지표 없음 4: … · 가중치 기본(목적방문형) · 진입장벽 중간". 텍스트 우선, 5칸 세그먼트는 보조.
 * - 엔진 `종합.데이터_충족률`은 "점수를 낸 관점의 가중치 비율"이지 세부자료 완성률이 아니다(scoring._weighted → total_cov).
 *   "데이터 충족 100%"로 쓰면 임대료처럼 빠진 세부지표가 있어도 모두 갖춘 것처럼 읽혀서, 관점 산출 수와 빠진 세부지표 목록으로
 *   나눠 보인다. 관점이 다 산출되지 않았을 때만 그 비율을 "(가중치 기준 N%)"로 덧붙인다(5/5면 항상 100%라 생략).
 * - 빠진 세부지표는 점수를 낸 관점의 breakdown 중 score null 행(엔진 label 그대로). 미산출 관점의 세부지표는 "관점 산출"에서
 *   이미 빠진 것으로 보이므로 목록에 넣지 않는다.
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
  const computed = indicators.filter((ind) => ind.score !== null)
  const missing = computed.flatMap((ind) => ind.breakdown.filter((b) => b.score === null).map((b) => b.label))
  const partial = computed.length < indicators.length

  return (
    <p className="coverage">
      <span className="coverage__item">
        관점{' '}
        <strong>
          {computed.length}/{indicators.length}
        </strong>{' '}
        산출{partial && `(가중치 기준 ${formatRatio(summary.데이터_충족률)})`}
        <span className="coverage__segments" aria-hidden="true">
          {indicators.map((ind) => (
            <span
              key={ind.key}
              className={`coverage__segment${ind.score === null ? ' coverage__segment--missing' : ''}`}
            />
          ))}
        </span>
      </span>
      {missing.length > 0 && (
        <span className="coverage__item">
          세부지표 없음 <strong>{missing.length}</strong>: {missing.join(', ')}
        </span>
      )}
      <span className="coverage__item">가중치 {weights}</span>
      {access && <span className="coverage__item">진입장벽 {access.제도_진입장벽}</span>}
    </p>
  )
}
