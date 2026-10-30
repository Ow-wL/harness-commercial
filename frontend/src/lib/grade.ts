/**
 * 점수 등급 (13-4, 팀 점검 보고서 B2 — 2026-10-30): 종합·관점 점수를 같은 규칙으로 네 단계로 읽는다.
 * 경계값 70/40/25는 엔진의 주의(병목) 기준 25(lib/format.BOTTLENECK_WARN_BELOW)에 맞춘 팀 제안이다 — 바꾸려면 엔진 담당과 맞춘다.
 * 등급은 "관점 점수의 평균 수준"을 읽는 말이지 "좋은 자리/나쁜 자리"·합격/불합격이 아니다. 색만으로 뜻을 전하지 않도록
 * 화면은 항상 글자 등급을 함께 쓴다. 점수는 엔진 값 그대로이고 여기서는 읽기만 한다.
 */
import { BOTTLENECK_WARN_BELOW } from './format.ts'

export type Grade = 'good' | 'mid' | 'weak' | 'alert'

/** 등급 하한: 이 값 이상이면 그 등급 (좋음 ≥ 70 · 보통 ≥ 40 · 약함 ≥ 25 · 주의 < 25) */
export const GRADE_FLOOR = { good: 70, mid: 40, weak: BOTTLENECK_WARN_BELOW } as const

export const GRADE_LABEL: Record<Grade, string> = { good: '좋음', mid: '보통', weak: '약함', alert: '주의' }

export function gradeOf(score: number | null | undefined): Grade | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null
  if (score >= GRADE_FLOOR.good) return 'good'
  if (score >= GRADE_FLOOR.mid) return 'mid'
  if (score >= GRADE_FLOOR.weak) return 'weak'
  return 'alert'
}

/** 화면 글자: "좋음" 등. 산출되지 않은 점수는 null */
export function gradeLabel(score: number | null | undefined): string | null {
  const g = gradeOf(score)
  return g ? GRADE_LABEL[g] : null
}
