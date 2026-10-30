/**
 * 결과 "주의할 점"에 보일 문장 (DESIGN.md §8.7). components/WarningPanel.tsx에서 옮겼다 — 동작은 그대로다.
 * 두 위치 비교(5차)에서 위치별로 같은 규칙을 쓰기 위해 lib로 export한다 (docs/COMPARE_DESIGN.md 5.5).
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { BOTTLENECK_WARN_BELOW, confidenceLabel, formatScore } from './format.ts'

export type Notice = { tone: 'warning' | 'info'; text: string }

/**
 * v0.5 학교구역 경고(엔진이 `경고[0]`에 넣는다, "⚠ {업종}은(는) 학교 주변 영업 규제 업종인데 …"). 화면은 원문 그대로
 * 맨 앞에 두고 강조만 한다 — 개별 지점의 영업 가능 여부를 확정하는 문장으로 바꾸지 않는다(관할 교육지원청 확인 대상).
 */
export const isSchoolZoneWarning = (text: string | undefined): boolean =>
  text !== undefined && text.startsWith('⚠') && text.includes('학교 주변 영업 규제 업종')

/**
 * 엔진 경고 외에 DESIGN.md §8.7이 이 패널에 모으라고 정한 데이터 한계 안내.
 * 엔진 값(flag·confidence·breakdown 상태·context)을 읽어 사실만 적는다. 엔진 경고 문장은 바꾸지 않는다
 * (예외: 병목 경고 1개, 아래 displayWarnings).
 */
export function dataLimits({ context, result }: AnalyzeResponse): Notice[] {
  const notices: Notice[] = []
  for (const ind of result.지표) {
    if (ind.confidence === 'low') {
      notices.push({ tone: 'warning', text: `${ind.label}: 자료 등급 ${confidenceLabel(ind.confidence)}` })
    }
    // 해상도 안내("…단위로 계산했습니다")는 8-C1b부터 막대 아래 근거 줄 끝 "· 구 단위"로 옮겼다(docs/UX_REDESIGN.md 2.2·2.5)
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
 * 이 경고를 병목 이외 경고보다 앞에 넣는다(scoring.analyze — v0.3·v0.4는 `경고[0]`, v0.5는 학교구역 경고가 있으면 그 뒤 `경고[1]`).
 * 같은 조건이면 그 자리에 구조화된 필드(병목_지표·score)로 만든 문장을 보여 준다 — 병목 점수·경고 조건·위험 안내·
 * 경고 순서는 그대로다. 조건이 맞지 않으면 원문을 그대로 둔다. 나머지 경고는 엔진 순서·원문 그대로 모두 보인다.
 */
export function displayWarnings({ result }: AnalyzeResponse): string[] {
  const warnings = [...result.경고]
  const bottleneck = result.지표.find((i) => i.key === result.종합.병목_지표)
  const at = isSchoolZoneWarning(warnings[0]) ? 1 : 0
  if (
    bottleneck?.score != null &&
    bottleneck.score < BOTTLENECK_WARN_BELOW &&
    warnings[at]?.startsWith(`${bottleneck.label}이(가) `)
  ) {
    warnings[at] =
      `${bottleneck.label} 점수가 ${formatScore(bottleneck.score)}점으로 주의 기준(${BOTTLENECK_WARN_BELOW}점 미만)에 해당합니다. ` +
      '종합 점수와 별개로 이 관점이 실제 위험 요인일 수 있습니다.'
  }
  return warnings
}
