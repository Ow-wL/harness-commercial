/**
 * 결과 "주의할 점"에 보일 문장 (DESIGN.md §8.7). components/WarningPanel.tsx에서 옮겼다 — 동작은 그대로다.
 * 두 위치 비교(5차)에서 위치별로 같은 규칙을 쓰기 위해 lib로 export한다 (docs/COMPARE_DESIGN.md 5.5).
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { BOTTLENECK_WARN_BELOW, confidenceLabel, formatScore, resolutionLabel } from './format.ts'

export type Notice = { tone: 'warning' | 'info'; text: string }

/**
 * 엔진 경고 외에 DESIGN.md §8.7이 이 패널에 모으라고 정한 데이터 한계 안내.
 * 엔진 값(flag·confidence·breakdown 상태·context)을 읽어 사실만 적는다. 엔진 경고 문장은 바꾸지 않는다
 * (예외: 병목 경고 1개, 아래 displayWarnings).
 */
export function dataLimits({ context, result }: AnalyzeResponse): Notice[] {
  const notices: Notice[] = []
  for (const ind of result.지표) {
    if (ind.confidence === 'low') {
      notices.push({ tone: 'warning', text: `${ind.label}: 신뢰도 ${confidenceLabel(ind.confidence)}` })
    }
    const resolution = resolutionLabel(ind)              // 점수가 산출된 관점만 (미산출 관점은 엔진 경고 "계산 불가 지표"가 안내)
    if (resolution) notices.push({ tone: 'info', text: `${ind.label}: ${resolution}로 계산했습니다.` })
  }
  // rent_area=null → 안정성 S4(상권 임대료) 제외 (backend README: 일반 좌표는 항상 null).
  // 안정성 점수가 산출됐을 때만 "제외하고 계산했다"고 쓴다 — 미산출이면 엔진 경고 "계산 불가 지표"가 안내한다
  const stability = result.지표[4]
  const s4 = stability.breakdown.find((b) => b.key === 's4')
  if (context.rent_area === null && stability.score !== null && s4 && s4.score === null) {
    notices.push({
      tone: 'info',
      text: `이 위치는 임대료 조사 상권이 지정되지 않아 안정성의 '${s4.label}' 지표를 제외하고 계산했습니다.`,
    })
  }
  return notices
}

/**
 * 엔진 병목 경고("{관점}이(가) 인천 하위 {점수}%로 …")는 관점 점수를 인천 내 순위처럼 읽게 한다
 * (관점 점수는 백분위의 가중평균, docs/SCORE_EXPLANATION_AUDIT.md 3장). 엔진은 병목 점수 < 25일 때
 * 이 경고를 `경고[0]`에 넣는다(scoring.analyze). 같은 조건이면 그 자리에 구조화된 필드(병목_지표·score)로
 * 만든 문장을 보여 준다 — 병목 점수·경고 조건·위험 안내는 그대로다. 조건이 맞지 않으면 원문을 그대로 둔다.
 */
export function displayWarnings({ result }: AnalyzeResponse): string[] {
  const warnings = [...result.경고]
  const bottleneck = result.지표.find((i) => i.key === result.종합.병목_지표)
  if (
    bottleneck?.score != null &&
    bottleneck.score < BOTTLENECK_WARN_BELOW &&
    warnings[0]?.startsWith(`${bottleneck.label}이(가) `)
  ) {
    warnings[0] =
      `${bottleneck.label} 점수가 ${formatScore(bottleneck.score)}점으로 병목 기준(${BOTTLENECK_WARN_BELOW}점 미만)에 해당합니다. ` +
      '종합 점수와 별개로 이 관점이 실제 위험 요인일 수 있습니다.'
  }
  return warnings
}
