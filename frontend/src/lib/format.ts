/**
 * 표시 형식 규칙 (DESIGN.md §3.2). 엔진 값을 다시 계산하거나 반올림하지 않는다.
 */
import type { EngineResult } from '../api/schemas.ts'

/**
 * 점수 표기: 소수 1자리. 엔진이 이미 round(…, 1)로 낸 값이라 자릿수만 맞춘다
 * (JSON `88.0`이 JS에서 `88`이 되므로 `88.0`으로 되돌린다).
 */
export function formatScore(score: number): string {
  return score.toFixed(1)
}

/** 0–1 비율을 % 로 (데이터 충족률·coverage). */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** 엔진 confidence 값 → 표기 (DESIGN.md §8.4). 3개 외 값은 원문. */
const CONFIDENCE_LABEL: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' }

export function confidenceLabel(confidence: string): string {
  return CONFIDENCE_LABEL[confidence] ?? confidence
}

/** 업종그룹 키 → 표시명. backend business_catalog()와 같은 규칙("C_목적방문형" → "목적방문형"). */
export function groupName(groupCode: string): string {
  return groupCode.split('_').slice(1).join('_')
}

/**
 * 해상도 한계 flag → 칩 문구 (DESIGN.md §8.4). 단위 이름은 엔진 FALLBACK_LADDER 정의를 따른다.
 * 해상도 flag가 없으면 null.
 */
export function resolutionLabel(flags: readonly string[]): string | null {
  if (flags.includes('해상도_시군구') || flags.includes('해상도_저하__gugu_sobun')) return '시군구 단위 데이터'
  if (flags.includes('해상도_저하__incheon_avg')) return '인천 전체 업종평균 데이터'
  if (flags.includes('해상도_저하__dong_jung')) return '업종 중분류 데이터'
  return null
}

export type Indicator = EngineResult['지표'][number]
