import { isAreaWeightedEngine } from '../api/schemas.ts'

/**
 * [이 점수는?] 첫 줄 — '무엇인지'부터 (13-5, 팀 점검 보고서 C2 — 2026-10-30): 이전에는 네 문장이 모두 "…이 아닙니다"라
 * '그럼 뭔데?'가 남았다. 비교 기준은 엔진마다 다르다(v0.5: 인천 158개 행정동 중심점 백분위, v0.3·v0.4: 인천 안 비교 모집단).
 */
export const SCORE_HELP_WHAT_V05 =
  '인천의 동네 158곳 평균 지점과 비교해, 이 자리가 다섯 관점에서 얼마나 유리한지를 0~100으로 나타낸 점수예요. 50이면 보통 동네와 비슷하고, 높을수록 그 관점에서 유리한 편입니다. 매출이나 성공 확률을 뜻하지는 않아요.'
export const SCORE_HELP_WHAT =
  '인천 안의 비교 모집단과 견주어, 이 자리가 다섯 관점에서 얼마나 유리한지를 0~100으로 나타낸 점수예요. 50이면 비교 모집단의 중간쯤이고, 높을수록 그 관점에서 유리한 편입니다. 매출이나 성공 확률을 뜻하지는 않아요.'

/** [이 점수는?] 펼친 내용 (8-C1d, 승인 초안 A.6 · UX_REDESIGN 2.3): 점수 읽는 법(§8.9b)의 요약 3항목 */
export const SCORE_HELP = [
  '"가장 높음·낮음"은 이 위치에서 산출한 관점 점수끼리 비교한 표현입니다. 다른 위치와 비교한 순위가 아닙니다.',
  // 부분 미산출(산출된 관점만, 가중치 재분배)·사용자 가중치에도 맞게 "산출된 관점 · 적용 가중치"로 쓴다
  '종합 적합도는 산출된 관점 점수에 적용 가중치를 반영한 가중평균입니다. 인천 내 순위나 "상위 N%"가 아닙니다.',
  '창업 성공 확률이나 매출·수익을 예측하지 않습니다.',
] as const

/** 엔진 v0.5(D-028)에서 [이 점수는?] 둘째 줄 뒤에 더하는 비교 기준 한 줄 — 엔진 meta.정규화_기준과 같은 뜻 */
export const SCORE_HELP_V05_BASIS =
  '고객성·경쟁성·입지성은 인천 158개 행정동 중심점(동네 평균 지점) 대비 백분위입니다. 상업지 후보지끼리의 순위가 아닙니다.'

/** 엔진 버전에 맞는 [이 점수는?] 항목 — 첫 줄은 '무엇인지'(13-5), 그 뒤 기존 설명 */
export function scoreHelp(engineVersion: string): readonly string[] {
  return isAreaWeightedEngine(engineVersion)
    ? [SCORE_HELP_WHAT_V05, SCORE_HELP[0], SCORE_HELP[1], SCORE_HELP_V05_BASIS, SCORE_HELP[2]]
    : [SCORE_HELP_WHAT, SCORE_HELP[0], SCORE_HELP[1], SCORE_HELP[2]]
}
