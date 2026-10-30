/**
 * 점수보다 먼저 보여야 할 것 (R0, 팀 점검 보고서 A1·A3 — 2026-10-30).
 * - 규제 배너(A1): 엔진 v0.5 가 `경고[0]`에 넣는 학교구역 경고(학교 주변 영업 규제 업종 + 200m 안 초·중·고)를 점수 카드 **위**에
 *   펼친 채 보여 준다. 문장은 엔진 값(업종·학교 수)으로만 만들고, 개별 지점의 영업 가능 여부를 확정하지 않는다(교육지원청 확인 대상).
 * - 주의 관점 한 줄(A3): 25점 미만 관점(엔진 병목_지표)을 점수 카드 아래 한 줄로 — 관점 이름 + 근거 줄(lib/evidence) 인용.
 *   종합과 별개 위험 요인이라는 뜻이며, 순위·확률·추천 표현을 쓰지 않는다.
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { evidenceLine } from './evidence.ts'
import { BOTTLENECK_WARN_BELOW, formatScore } from './format.ts'
import { isSchoolZoneWarning } from './warnings.ts'

export type RegulationAlert = { business: string; schools: number; text: string }

/** 학교구역 규제 배너 (없으면 null). 학교 수는 초보자_접근성.학교구역_200m_학교수 — 경고 원문과 같은 엔진 값 */
export function regulationAlert({ result }: AnalyzeResponse): RegulationAlert | null {
  const schools = result.초보자_접근성.학교구역_200m_학교수
  if (schools === undefined || !result.경고.some(isSchoolZoneWarning)) return null
  const business = result.meta.업종
  return {
    business,
    schools,
    text: `학교 200m 안 초·중·고 ${schools}곳 — ${business}은(는) 학교 주변 영업 규제 업종입니다(교육환경보호구역). 점수보다 영업 가능 여부를 먼저 확인하세요.`,
  }
}

export type WeakAlert = { key: string; label: string; score: number; text: string }

/**
 * 주의 관점 한 줄 (없으면 null): "{관점}이 매우 낮아요 — {근거}". 근거는 요약 탭 근거 줄과 같은 문장(엔진 값 인용).
 * guName·radiusM 은 근거 줄 문구용(시장성 "{구} 하루 유입", 고객성 "반경 {r} 타겟 연령 거주")
 */
export function weakAlert({ context, result }: AnalyzeResponse): WeakAlert | null {
  const ind = result.지표.find((i) => i.key === result.종합.병목_지표)
  if (!ind || ind.score === null || ind.score >= BOTTLENECK_WARN_BELOW) return null
  const evidence = evidenceLine(ind, context.gu_name, result.meta.업종, result.meta.분석반경_m)
  const text = `${ind.label}이 매우 낮아요(${formatScore(ind.score)}점)${evidence ? ` — ${evidence}` : ''}`
  return { key: ind.key, label: ind.label, score: ind.score, text }
}
