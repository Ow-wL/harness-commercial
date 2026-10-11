/**
 * 두 위치 비교의 B(비교 위치) 분석 상태 (docs/COMPARE_DESIGN.md 3장).
 * A는 App의 기존 분석 상태를 그대로 쓰고 여기 두지 않는다 — B가 무엇이 되든 A는 바뀌지 않는다.
 */
import type { ApiFailure } from '../api/client.ts'
import type { AnalyzeResponse } from '../api/schemas.ts'

type Point = { lat: number; lng: number }

/** sameAsA: 고른 B 좌표가 A와 정확히 같아 요청하지 않았다 (D2) */
export type CompareState =
  | { status: 'off' }
  | { status: 'picking'; location: Point | null; sameAsA?: boolean }
  | { status: 'loading'; location: Point }
  | { status: 'error'; location: Point; failure: ApiFailure }
  | { status: 'success'; location: Point; response: AnalyzeResponse }

export type ActiveCompare = Exclude<CompareState, { status: 'off' }>

/** 비교 화면 요소 id — App이 포커스를 옮길 때 쓴다 (비교 화면에서 유일, COMPARE_DESIGN.md 6장) */
export const COMPARE_IDS = {
  start: 'compare-start',
  title: 'compare-title',
  bTitle: 'compare-b-title',
  bAnalyze: 'compare-b-analyze',
  detailA: 'compare-detail-a',
  detailB: 'compare-detail-b',
  storeSideA: 'compare-store-side-a',
  storeSideB: 'compare-store-side-b',
  bError: 'compare-b-error',
  sheetAction: 'compare-sheet-action',
} as const

/** 좌표가 정확히 같은지 (지도 클릭은 소수 6자리로 반올림된 값, 입력은 사용자가 쓴 숫자 그대로) */
export function sameCoordinates(a: Point, b: Point): boolean {
  return a.lat === b.lat && a.lng === b.lng
}

/**
 * B 분석이 성공했을 때 패널이 보여 주는 화면 (§3.3). 비교 분석 상태(CompareState)와 따로 둔다 —
 * 화면을 오가도 A·B 응답은 그대로이고 다시 요청하지 않는다.
 */
export type CompareView = 'summary' | 'detail-A' | 'detail-B'
