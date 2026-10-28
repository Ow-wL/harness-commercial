/** 주소로 찾기(7-B4)의 고정값·정렬 — 컴포넌트(AddressSearch)와 테스트가 같이 쓴다 (docs/ADDRESS_DESIGN.md §5.2 A) */
import type { GeocodeItem, LatLngPoint } from '../map/geocoder.ts'

/** 결과 정렬 기준점(인천광역시청). 가까운 순 정렬에만 쓰고, 인천 밖 결과를 거르지 않는다 */
export const SEARCH_ORIGIN: LatLngPoint = { lat: 37.4563, lng: 126.7052 }
/** 한 번에 받는 결과 수. "더 보기"는 받은 목록을 펼칠 뿐 다시 부르지 않는다 */
export const SEARCH_COUNT = 10
/** 처음 보이는 결과 수 */
export const SEARCH_VISIBLE = 5
export const INCHEON_SIDO = '인천광역시'

/** 인천 결과를 앞에, 나머지는 받은 순서 그대로(안정 정렬). 시·도는 정렬·안내에만 쓰고 선택을 막지 않는다 */
export function incheonFirst(items: GeocodeItem[]): GeocodeItem[] {
  return [...items].sort((a, b) => Number(b.sido === INCHEON_SIDO) - Number(a.sido === INCHEON_SIDO))
}

/**
 * 예시 주소(12-21): 운영 NAVER Geocoder 에서 2026-10-29 검색 결과 1건을 확인한 인천 도로명 주소 3개(부평역 인근·남동구 인하로·송도).
 * 장소 이름이 아니라 "도로명 + 번지" 형태를 보여 주는 용도다. 분석에 쓰는 좌표는 사용자가 고른 결과의 adapter 값이다.
 */
export const SEARCH_EXAMPLES = ['부평대로 1', '인하로 497-23', '인천타워대로 99'] as const
