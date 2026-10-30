/**
 * 학교 주변 영업 규제(교육환경보호구역) 업종 (R1 13-18, 팀 D5): 엔진 access.py 의 `입지규제=True` 업종과 같다 — 화면 표시(업종 선택창 표시)용.
 * 점수·경고 판정은 엔진(/analyze 경고[0]·/rank regulated)이 하고, 이 목록은 선택 전에 미리 알려 주는 용도다. 엔진 목록이 바뀌면 함께 고친다.
 */
export const REGULATED_BUSINESS_CODES: ReadonlySet<string> = new Set(['R10406', 'R10407', 'R10404', 'I21101'])   // PC방 · 전자 게임장 · 노래방 · 일반 유흥 주점
