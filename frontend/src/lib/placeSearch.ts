/** 장소 이름으로 찾기(12-14)의 고정값 — 컴포넌트(PlaceSearch)와 테스트가 같이 쓴다 */

/** 검색어 상한 — backend places.MAX_QUERY_CHARS 와 같다 */
export const PLACE_QUERY_MAX = 60
/** 예시 장소 이름: 역·관공서·상업시설 하나씩(검색 결과는 NAVER 가 돌려주는 대로다) */
export const PLACE_EXAMPLES = ['부평역', '인천시청', '송도 트리플스트리트'] as const
