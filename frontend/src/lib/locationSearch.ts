import type { LocationMethod } from '../components/LocationMethodSwitch.tsx'

/** 검색으로 찾기(13-52, 주소 + 장소 이름 한 검색창)의 고정값 — 컴포넌트(LocationSearch)와 테스트가 같이 쓴다 */

/** 한 목록에 보이는 주소 결과 수(장소 결과는 서버가 주는 최대 5건 그대로) — 목록이 길어지지 않게 */
export const LOCATION_SEARCH_ADDRESS_VISIBLE = 3
/** 예시: 장소 이름 둘 + 도로명 주소 하나 — 둘 다 된다는 것을 보여 준다 */
export const LOCATION_SEARCH_EXAMPLES = ['부평역', '인천시청', '부평대로 1'] as const

/**
 * 지금 쓸 수 있는 방법으로 바꾼다(13-52): 주소·장소 검색이 둘 다 되면 검색창 하나("search")로 합치고, 하나만 되면 그쪽으로,
 * 둘 다 안 되면 지도 안내로 본다. 조건 패널과 mobile 지도 시트가 같은 규칙을 쓴다.
 */
export function availableMethod(method: LocationMethod, addressReady: boolean, placesReady: boolean): LocationMethod {
  if (method === 'map' || method === 'coords') return method
  if (addressReady && placesReady) return 'search'
  if (addressReady) return 'address'
  if (placesReady) return 'place'
  return 'map'
}
