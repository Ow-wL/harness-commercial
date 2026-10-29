/**
 * 반경별 비교 표 (계획 1-5, 12-26): 서버가 광고하는 반경(300·500·1km)마다 **이미 받은 결과만** 한 표에 — 종합·관점 점수·같은 업종
 * 점포 수·확인 필요 수. 아직 분석하지 않은 반경은 빈 행 + "분석하기"(누르면 그 반경으로 다시 분석 = 기존 반경 변경 경로, 캐시에 남는다).
 * - 엔진 값을 다시 계산하지 않는다. 표의 "종합 점수 범위"는 분석한 반경 사이의 최소~최대일 뿐 오차범위·신뢰구간이 아니다(그렇게 부르지 않는다).
 * - 결과 캐시(ResultCache.peek)는 읽기만 한다 — 표를 그리느라 LRU 순서를 바꾸지 않는다.
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { gapLines } from './gaps.ts'

export type RadiusRow = {
  radius: number
  /** 지금 보고 있는 결과의 반경 */
  current: boolean
  /** 그 반경의 결과(지금 결과 또는 캐시). null = 아직 분석하지 않음 */
  response: AnalyzeResponse | null
}

export function radiusRows(options: readonly number[], current: AnalyzeResponse, peek: (radius: number) => AnalyzeResponse | null): RadiusRow[] {
  const currentRadius = current.result.meta.분석반경_m
  return [...options]
    .sort((a, b) => a - b)
    .map((radius) => ({
      radius,
      current: radius === currentRadius,
      response: radius === currentRadius ? current : peek(radius),
    }))
}

/** 한 행의 표시 값. 점수는 엔진 값 그대로(null = 미산출) */
export function rowCells(response: AnalyzeResponse): {
  overall: number | null
  perspectives: (number | null)[]
  stores: number
  gaps: number
} {
  return {
    overall: response.result.종합.점수,
    perspectives: response.result.지표.map((i) => i.score),
    stores: response.result.지표[2].raw.동종점포수,
    gaps: gapLines(response).length,
  }
}

/** 분석한 반경들의 종합 점수 최소·최대 (산출된 것만). 2개 미만이면 null — 범위라 부를 것이 없다 */
export function overallRange(rows: readonly RadiusRow[]): { min: number; max: number; count: number } | null {
  const scores = rows.flatMap((r) => (r.response && r.response.result.종합.점수 !== null ? [r.response.result.종합.점수] : []))
  if (scores.length < 2) return null
  return { min: Math.min(...scores), max: Math.max(...scores), count: scores.length }
}
