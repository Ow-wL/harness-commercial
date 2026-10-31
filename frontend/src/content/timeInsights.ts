/** 시간대 구간 표 (R1 13-15). 라벨·범위는 화면 문장에 그대로 쓴다 */
export type TimeBand = { key: 'morning' | 'day' | 'evening' | 'night'; label: string; range: string; hours: readonly number[] }

export const TIME_BANDS: readonly TimeBand[] = [
  { key: 'morning', label: '아침', range: '06~10시', hours: [6, 7, 8, 9, 10] },
  { key: 'day', label: '낮', range: '11~16시', hours: [11, 12, 13, 14, 15, 16] },
  { key: 'evening', label: '저녁', range: '17~21시', hours: [17, 18, 19, 20, 21] },
  { key: 'night', label: '밤', range: '22~05시', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
]

/**
 * 엔진 시간대 적합도 경계 (scoring_engine 각 버전 scoring.py 시장성 — fit < 0.85 → 영업시간대_유입_엇갈림, fit > 1.20 → 영업시간대_유입_집중).
 * 엔진 값을 바꾸지 않고 같은 경계로 읽는다(Codex R1-1). 엔진 flag 가 있으면 그것을 먼저 따른다.
 */
export const TIME_FIT = { low: 0.85, high: 1.2, lowFlag: '영업시간대_유입_엇갈림', highFlag: '영업시간대_유입_집중' } as const
