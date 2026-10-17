/**
 * 표시 형식 규칙 (DESIGN.md §3.2). 엔진 값을 다시 계산하거나 반올림하지 않는다.
 */
import type { AnalyzeContext, EngineResult } from '../api/schemas.ts'

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

/** 병목 경고 기준 = 엔진 config.BOTTLENECK_THRESHOLD (병목 관점 점수 < 25면 엔진이 경고). 표시 판단에만 쓴다. */
export const BOTTLENECK_WARN_BELOW = 25

/** 관점 점수 산출 기준 = 엔진 config.MIN_COVERAGE. 계산된 세부지표 가중치 비율이 이보다 작으면 관점 점수는 null. */
export const MIN_COVERAGE = 0.5

/**
 * 해상도 한계 flag → 칩 문구 (DESIGN.md §8.4). 단위 이름은 엔진 FALLBACK_LADDER 정의를 따른다.
 * 점수가 산출된 관점에만 붙인다 — 엔진은 산출하지 못한 관점에도 폴백 flag(예: `해상도_저하__incheon_avg`)를
 * 남기므로, 그 flag는 "그 단위로 계산했다"는 뜻이 아니다 (docs/SCORE_EXPLANATION_AUDIT.md 4장).
 * 해상도 flag가 없거나 점수가 null이면 null.
 */
export function resolutionLabel(ind: Indicator): string | null {
  if (ind.score === null) return null
  const { flags } = ind
  if (flags.includes('해상도_시군구') || flags.includes('해상도_저하__gugu_sobun')) return '시군구 단위 데이터'
  if (flags.includes('해상도_저하__incheon_avg')) return '인천 전체 업종평균 데이터'
  if (flags.includes('해상도_저하__dong_jung')) return '업종 중분류 데이터'
  return null
}

/** 관점 점수가 null인 이유를 score·coverage로만 쓴다 (엔진 note의 "…단위로 계산했습니다"는 쓰지 않는다). */
export function notComputedText(ind: Indicator): string {
  const excluded = '점수를 내지 않았고, 종합점수에서 제외했습니다'
  return ind.coverage < MIN_COVERAGE
    ? `세부지표 충족률 ${formatRatio(ind.coverage)}로 기준(${formatRatio(MIN_COVERAGE)})에 못 미쳐 ${excluded}`
    : excluded
}

/**
 * 위치 이름 = API context의 시군구 + 행정동 (DESIGN.md §8.5). 행정동 이름이며 도로명주소가 아니다.
 * 행정동은 backend가 좌표로 판정한 값이라 분석 응답이 오기 전에는 쓸 수 없다(좌표만 보여 준다).
 */
export function locationName(context: AnalyzeContext): string {
  return `${context.gu_name} ${context.dong_name}`
}

export type NearestStation = { name: string; distanceM: number }

/**
 * 최근접역 = 입지성 raw `최근접역`·`최근접역_거리m` (DESIGN.md §8.5a). 정보가 없으면 null.
 * - 거리는 분석 좌표와 역 좌표 사이의 직선거리(m, 엔진이 반올림)다. 도보 거리가 아니다.
 * - 엔진은 역 이름에서 "역" 접미사·괄호를 떼어 둔다(etl_location.load_stations, 예 "부평") → 표시할 때 "역"을 붙인다.
 */
export function nearestStation(indicators: EngineResult['지표']): NearestStation | null {
  const { 최근접역: name, 최근접역_거리m: distanceM } = indicators[3].raw
  if (!name || distanceM === null) return null
  return { name: `${name}역`, distanceM }
}

/** 직선거리 표기: 엔진 정수 m 그대로, 천 단위 구분 (예: 85m, 1,240m). */
export function formatDistance(m: number): string {
  return `${m.toLocaleString('ko-KR')}m`
}

/** 분석 반경 표기 (8-D3): 1,000m 이상은 km — 300m · 500m · 1km */
export function formatRadius(m: number): string {
  return m >= 1000 && m % 1000 === 0 ? `${m / 1000}km` : `${m.toLocaleString('ko-KR')}m`
}

/** 동종 점포 표시 문구 (DESIGN.md §8.14). 상호·주소가 없으면 없다고 쓴다(지어내지 않는다). */
export function storeName(store: { name: string | null }): string {
  return store.name ?? '상호 정보 없음'
}

/** 도로명주소 우선, 없으면 지번주소, 둘 다 없으면 "주소 정보 없음". */
export function storeAddress(store: { road_address: string | null; jibun_address: string | null }): string {
  return store.road_address ?? store.jibun_address ?? '주소 정보 없음'
}

export type Indicator = EngineResult['지표'][number]
